// Prisma-backed IntentPorts adapter — Phase 2.1 production storage.
//
// Mirrors intent.adapter.memory.ts (Phase 2.0) bit-for-bit on contract;
// the pure algorithm sees an identical IntentPorts surface and behaves
// identically regardless of which adapter is wired. CLAUDE.md invariant
// #2 (verify portability): the algorithm doesn't know which storage is
// behind the ports — only the module factory does.
//
// Storage shape: two tables (IntentManifest + IntentActual), 1:1 via
// manifestId @unique. The `status` column on IntentManifest is a
// denormalized cache for fast filter; the source of truth for
// "reconciled?" is the presence of an IntentActual row.
//
// Tenant isolation (CLAUDE.md invariant #5): the adapter does NOT
// re-check principalId — the algorithm/service layer carries that check
// at the entry boundary. The adapter loads by manifestId and trusts the
// caller has already validated tenant ownership. This matches the memory
// adapter's contract.
//
// Failure mapping: Prisma's well-known error codes are mapped to the
// algorithm's typed IntentAlgorithmException so the controller can
// surface the right HTTP status without parsing Prisma internals.

import type {
  ReconciliationResult,
  SignedIntentManifest,
} from '@aegis/intent-manifest';

import type { PrismaService } from '../../common/prisma/prisma.service.js';
import {
  IntentAlgorithmException,
  type IntentPorts,
  type ManifestSnapshot,
} from './intent.ports.js';

export interface PrismaAdapterDeps {
  prisma: PrismaService;
  signManifest: IntentPorts['signManifest'];
  recordAudit: IntentPorts['recordAudit'];
  ingestSignal: IntentPorts['ingestSignal'];
  now: IntentPorts['now'];
  ttlBounds?: IntentPorts['ttlBounds'];
}

/**
 * Build a Prisma-backed IntentPorts implementation. Caller supplies the
 * non-storage ports (sign / audit / signal / now) — usually wired by the
 * Nest module against AuditSignerService / AuditService / BateService.
 *
 * The returned IntentPorts is plug-compatible with the memory adapter;
 * the only operational difference is durability across process restarts
 * and visibility to peer API replicas.
 */
export function buildPrismaIntentAdapter(deps: PrismaAdapterDeps): IntentPorts {
  const ttlBoundsImpl =
    deps.ttlBounds ?? (() => ({ minSeconds: 30, maxSeconds: 60 }));

  return {
    signManifest: deps.signManifest,
    recordAudit: deps.recordAudit,
    ingestSignal: deps.ingestSignal,
    now: deps.now,
    ttlBounds: ttlBoundsImpl,

    async saveManifest(snapshot) {
      try {
        await deps.prisma.intentManifest.create({
          data: {
            manifestId: snapshot.manifestId,
            principalId: snapshot.principalId,
            agentId: snapshot.agentId,
            body: snapshot.signedManifest.body as unknown as object,
            signingKeyId: snapshot.signedManifest.signingKeyId,
            signatureB64Url: snapshot.signedManifest.signatureB64Url,
            expiresAt: new Date(snapshot.signedManifest.body.expiresAt * 1000),
          },
        });
      } catch (e: unknown) {
        if (isPrismaUniqueError(e)) {
          throw new IntentAlgorithmException({
            kind: 'manifest_collision',
            manifestId: snapshot.manifestId,
          });
        }
        throw e;
      }
    },

    async loadManifest(manifestId) {
      const row = await deps.prisma.intentManifest.findUnique({
        where: { manifestId },
        include: { reconciliation: true },
      });
      if (!row) return null;

      // Status reconciliation: the cached `status` field can be stale
      // relative to (expiresAt vs now()). Compute the EFFECTIVE status
      // on read; defer the write-back to the next mutation (avoid
      // write amplification on hot read paths). Authority is:
      //   1. presence of IntentActual          → RECONCILED
      //   2. else expiresAt < now              → EXPIRED
      //   3. else                              → OPEN
      const nowSec = Math.floor(deps.now().getTime() / 1000);
      const expirySec = Math.floor(row.expiresAt.getTime() / 1000);
      let status: ManifestSnapshot['status'];
      if (row.reconciliation) status = 'RECONCILED';
      else if (expirySec < nowSec) status = 'EXPIRED';
      else status = 'OPEN';

      return {
        manifestId: row.manifestId,
        principalId: row.principalId,
        agentId: row.agentId,
        signedManifest: {
          body: row.body as unknown as SignedIntentManifest['body'],
          signingKeyId: row.signingKeyId,
          signatureB64Url: row.signatureB64Url,
        },
        status,
        reconciledAt: row.reconciliation?.reconciledAt ?? null,
        priorResult:
          (row.reconciliation?.result as unknown as ReconciliationResult | undefined) ??
          null,
      };
    },

    async saveReconciliation(manifestId, idempotencyKey, actuals, result) {
      // Idempotency contract per IntentPorts docstring (intent.ports.ts):
      //   - prior exists, same key, deep-equal actuals → replay
      //   - prior exists, key OR actuals differ        → idempotency_conflict
      //   - no prior                                   → insert + flip status
      const prior = await deps.prisma.intentActual.findUnique({
        where: { manifestId },
      });
      if (prior) {
        const sameKey = prior.idempotencyKey === idempotencyKey;
        const sameBody = deepEqualJson(prior.actuals, actuals);
        if (!sameKey || !sameBody) {
          throw new IntentAlgorithmException({
            kind: 'idempotency_conflict',
            manifestId,
            idempotencyKey,
          });
        }
        return { replay: true };
      }

      // Atomic: insert IntentActual + flip IntentManifest.status in one txn.
      // Without the transaction, a crash between the two writes would leave
      // the manifest cache field stale (status=OPEN despite a reconciliation
      // row existing). loadManifest() compensates by reading reconciliation
      // first, but consistency-by-construction beats consistency-by-coercion.
      try {
        await deps.prisma.$transaction([
          deps.prisma.intentActual.create({
            data: {
              manifestId,
              idempotencyKey,
              actuals: actuals as unknown as object,
              result: result as unknown as object,
            },
          }),
          deps.prisma.intentManifest.update({
            where: { manifestId },
            data: { status: 'RECONCILED' },
          }),
        ]);
      } catch (e: unknown) {
        // P2002 here = race with a concurrent reconcile request that won
        // the unique-constraint check. Re-map to idempotency_conflict
        // (the algorithm contract); the controller surfaces 409.
        if (isPrismaUniqueError(e)) {
          throw new IntentAlgorithmException({
            kind: 'idempotency_conflict',
            manifestId,
            idempotencyKey,
          });
        }
        throw e;
      }
      return { replay: false };
    },
  };
}

/**
 * Deep JSON equality via canonical-JSON stringify. Matches the memory
 * adapter's implementation byte-for-byte so behaviour is identical
 * across storage backends — critical for the algorithm spec's
 * "same key + same body = replay" assertion to pass against either adapter.
 *
 * Not exported because the canonical form lives in @aegis/intent-manifest
 * (canonicalize) — this is the local mirror used purely for adapter
 * equality, not for signature pre-image construction.
 */
function deepEqualJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function isPrismaUniqueError(e: unknown): boolean {
  if (typeof e !== 'object' || e === null) return false;
  const obj = e as { code?: unknown };
  return obj.code === 'P2002';
}
