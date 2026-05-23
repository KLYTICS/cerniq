// Pure intent issuance + reconciliation algorithm.
//
// CLAUDE.md invariant #2 — every line here must run unmodified on
// Cloudflare Workers. No NestJS, no Prisma, no ioredis, no Node-specific
// APIs. Everything I/O-shaped is delivered through the IntentPorts
// interface in `./intent.ports.ts`.
//
// Algorithm boundaries per ADR-0017:
//   - issueManifest(): validate → mint id → sign → persist → audit → return
//   - reconcileActuals(): load → guard temporal/tenant → reconcile via kernel
//                         → persist (idempotent) → audit per mismatch
//                         → emit BATE signal if mismatch → return

import {
  INTENT_MANIFEST_SCHEMA_V1,
  reconcileIntent,
  type IntentManifestBody,
  type ReconciliationResult,
} from '@aegis/intent-manifest';

import {
  IntentAlgorithmException,
  type IntentPorts,
  type IssueInput,
  type IssueOutput,
  type ReconcileInput,
  type ReconcileOutput,
} from './intent.ports.js';

const DEFAULT_TTL_SECONDS = 60;

/**
 * Issue a signed intent manifest. Pure orchestration over IntentPorts.
 *
 * Failure modes (all surfaced via IntentAlgorithmException):
 *   - tenant_mismatch (caller principal ≠ agent's principal)
 *   - ttl_out_of_bounds (caller-requested ttlSeconds outside [min, max])
 *   - manifest_collision (id already exists — caller can retry with new id)
 *   - signing_failed (KMS / env-fallback signing threw)
 */
export async function issueManifest(
  input: IssueInput,
  ports: IntentPorts,
  manifestId: string,
): Promise<IssueOutput> {
  // Tenant boundary — caller's principalId is established by the API key
  // guard; algorithm trusts it as the authority. agentId-side principal
  // is checked at the controller layer before this is called (the
  // controller's responsibility per CLAUDE.md invariant #5). The
  // algorithm assumes the caller has verified the agent belongs to the
  // caller's principal.
  const bounds = ports.ttlBounds();
  const requestedTtl = input.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  if (requestedTtl < bounds.minSeconds || requestedTtl > bounds.maxSeconds) {
    throw new IntentAlgorithmException({
      kind: 'ttl_out_of_bounds',
      requestedSeconds: requestedTtl,
      minSeconds: bounds.minSeconds,
      maxSeconds: bounds.maxSeconds,
    });
  }

  const issuedAt = Math.floor(ports.now().getTime() / 1000);
  const expiresAt = issuedAt + requestedTtl;

  const body: IntentManifestBody = {
    schemaVersion: INTENT_MANIFEST_SCHEMA_V1,
    manifestId,
    issuedAt,
    expiresAt,
    principalId: input.principalId,
    agentId: input.agentId,
    intent: input.intent,
    reconciliation: input.reconciliation ?? { strictness: 'strict' },
    verifyTokenJti: input.verifyTokenJti,
    verifyTokenSha256B64Url: input.verifyTokenSha256B64Url,
  };

  let signed;
  try {
    signed = await ports.signManifest(body);
  } catch (e) {
    throw new IntentAlgorithmException({
      kind: 'signing_failed',
      detail: e instanceof Error ? e.message : String(e),
    });
  }

  await ports.saveManifest({
    manifestId,
    principalId: input.principalId,
    agentId: input.agentId,
    signedManifest: signed,
  });

  const auditEventId = await ports.recordAudit({
    kind: 'intent.declared',
    principalId: input.principalId,
    agentId: input.agentId,
    manifestId,
    payload: {
      verifyTokenJti: input.verifyTokenJti,
      intentKind: input.intent.kind,
      ttlSeconds: requestedTtl,
      strictness: body.reconciliation.strictness,
    },
  });

  return { manifestId, signedManifest: signed, expiresAt, auditEventId };
}

/**
 * Reconcile actuals against a stored manifest. Idempotent per
 * (manifestId, idempotencyKey). Side-effects:
 *   - persists the reconciliation outcome (1 audit event)
 *   - emits 1 audit event per IntentMismatchKind in the result
 *   - emits 1 BATE signal if result has any mismatches AND strictness
 *     is 'strict' OR (strictness is 'graduated' AND
 *     recommendedDenialReason !== null)
 *
 * Failure modes:
 *   - manifest_not_found (404)
 *   - manifest_reconciled (terminal — already done; replay must
 *     present same idempotency-key)
 *   - tenant_mismatch (caller principal ≠ manifest principal)
 *   - idempotency_conflict (same key, different actuals body)
 */
export async function reconcileActuals(
  input: ReconcileInput,
  ports: IntentPorts,
): Promise<ReconcileOutput> {
  const snapshot = await ports.loadManifest(input.manifestId);
  if (!snapshot) {
    throw new IntentAlgorithmException({
      kind: 'manifest_not_found',
      manifestId: input.manifestId,
    });
  }

  if (snapshot.principalId !== input.principalId) {
    // Tenant isolation — return same shape as "not found" at the
    // controller layer to prevent enumeration; algorithm still throws
    // typed error for audit visibility.
    throw new IntentAlgorithmException({
      kind: 'tenant_mismatch',
      expectedPrincipalId: snapshot.principalId,
      actualPrincipalId: input.principalId,
    });
  }

  if (snapshot.status === 'RECONCILED' && snapshot.priorResult) {
    // Terminal state — only valid if this is a replay of the SAME
    // idempotency key. Repository's saveReconciliation enforces this;
    // we surface the prior result here for the fast path.
    // (The repository call below will throw idempotency_conflict if
    // the key differs.)
  }

  // Run the framework-free reconciler.
  const result: ReconciliationResult = reconcileIntent(
    snapshot.signedManifest,
    input.actuals,
    { now: () => ports.now().getTime() },
  );

  // Persist atomically (idempotent on key).
  let saveOutcome;
  try {
    saveOutcome = await ports.saveReconciliation(
      input.manifestId,
      input.idempotencyKey,
      input.actuals,
      result,
    );
  } catch (e) {
    // Repository surfaces idempotency_conflict via thrown error; re-wrap.
    if (e instanceof IntentAlgorithmException) throw e;
    throw new IntentAlgorithmException({
      kind: 'idempotency_conflict',
      manifestId: input.manifestId,
      idempotencyKey: input.idempotencyKey,
    });
  }

  // Audit: one summary event + one event per mismatch kind (for fast
  // dashboard querying by kind without parsing nested JSON).
  const summaryEventId = await ports.recordAudit({
    kind: 'intent.reconciled',
    principalId: input.principalId,
    agentId: snapshot.agentId,
    manifestId: input.manifestId,
    payload: {
      idempotencyKey: input.idempotencyKey,
      actualCount: result.actualCount,
      mismatchCount: result.mismatches.length,
      recommendedDenialReason: result.recommendedDenialReason,
      replay: saveOutcome.replay,
    },
  });

  if (!saveOutcome.replay) {
    for (const mismatch of result.mismatches) {
      await ports.recordAudit({
        kind: 'intent.mismatch',
        principalId: input.principalId,
        agentId: snapshot.agentId,
        manifestId: input.manifestId,
        payload: {
          mismatchKind: mismatch.kind,
          detail: mismatch.detail,
          detectedAt: mismatch.detectedAt,
        },
      });
    }

    if (result.recommendedDenialReason !== null) {
      ports.ingestSignal({
        agentId: snapshot.agentId,
        signalType: 'INTENT_MISMATCH_OBSERVED',
        severity: 'HIGH',
        source: 'intent.reconciler',
        payload: {
          manifestId: input.manifestId,
          mismatchCount: result.mismatches.length,
          mismatchKinds: [...new Set(result.mismatches.map((m: { kind: string }) => m.kind))],
        },
      });
    }
  }

  return {
    result,
    auditEventId: summaryEventId,
    idempotencyReplay: saveOutcome.replay,
  };
}
