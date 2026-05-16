// In-memory IntentPorts adapter — ships in Phase 2.0 before the Prisma
// migration (Phase 2.1) lands. Suitable for:
//   - Pre-migration deployments (operator wants to enable the feature
//     flag before running the Prisma migration for IntentManifest +
//     IntentActual).
//   - Local development without a live database.
//   - The intent.algorithm.spec.ts test fixture pattern.
//
// State is process-local and LOST on restart. Manifests issued before
// a restart will return 404 on reconciliation. Acceptable for the
// 30-60s TTL envelope — operators MUST upgrade to the Prisma adapter
// before opening intent issuance to production traffic. The default
// AEGIS_INTENT_MANIFEST_STORAGE=memory|prisma env flag selects between
// the two; memory is the safe default until OD-018+19+20 land.

import type { ReconciliationResult } from '@aegis/intent-manifest';

import {
  IntentAlgorithmException,
  type IntentPorts,
  type ManifestSnapshot,
} from './intent.ports.js';

export interface MemoryAdapterDeps {
  /** Sign a manifest body. Wired by the Nest module to AuditSignerService. */
  signManifest: IntentPorts['signManifest'];
  /** Append an audit event. Wired by the Nest module to AuditService. */
  recordAudit: IntentPorts['recordAudit'];
  /** Fire-and-forget BATE signal. Wired by the Nest module to BateService. */
  ingestSignal: IntentPorts['ingestSignal'];
  /** Clock provider. Wired by the Nest module (real) or test fixture (fake). */
  now: IntentPorts['now'];
  /** Optional TTL bounds override. Defaults to [30, 60] per ADR-0016. */
  ttlBounds?: IntentPorts['ttlBounds'];
}

/**
 * Build an in-memory IntentPorts implementation. Caller supplies the
 * non-storage ports (sign / audit / signal / now); storage is held in
 * Maps inside the closure.
 *
 * Returned `intentPorts` is the IntentPorts surface to hand to the
 * pure algorithm.  Returned `inspect` is for tests + admin tooling.
 */
export function buildMemoryIntentAdapter(deps: MemoryAdapterDeps): {
  intentPorts: IntentPorts;
  inspect: {
    manifestCount(): number;
    reconciliationCount(): number;
    listManifestIds(): readonly string[];
  };
} {
  const manifests = new Map<string, ManifestSnapshot>();
  const reconciliations = new Map<
    string,
    { idempotencyKey: string; actuals: unknown; result: ReconciliationResult }
  >();

  const ttlBoundsImpl = deps.ttlBounds ?? (() => ({ minSeconds: 30, maxSeconds: 60 }));

  const intentPorts: IntentPorts = {
    signManifest: deps.signManifest,
    recordAudit: deps.recordAudit,
    ingestSignal: deps.ingestSignal,
    now: deps.now,
    ttlBounds: ttlBoundsImpl,

    async saveManifest(snapshot) {
      if (manifests.has(snapshot.manifestId)) {
        throw new IntentAlgorithmException({
          kind: 'manifest_collision',
          manifestId: snapshot.manifestId,
        });
      }
      manifests.set(snapshot.manifestId, {
        ...snapshot,
        status: 'OPEN',
        reconciledAt: null,
        priorResult: null,
      });
    },

    async loadManifest(manifestId) {
      const snap = manifests.get(manifestId);
      if (!snap) return null;
      // Lazy expiry check — flip status to EXPIRED on load if past
      // expiresAt and not yet reconciled. Algorithm reads via snapshot
      // so this lazy check is sufficient (no background sweeper in
      // Phase 2.0 memory adapter; Prisma adapter in Phase 2.1 SHOULD
      // have a periodic sweeper for cold-archive purposes).
      const nowSec = Math.floor(deps.now().getTime() / 1000);
      if (snap.status === 'OPEN' && snap.signedManifest.body.expiresAt < nowSec) {
        const expired = { ...snap, status: 'EXPIRED' as const };
        manifests.set(manifestId, expired);
        return expired;
      }
      return snap;
    },

    async saveReconciliation(manifestId, idempotencyKey, actuals, result) {
      const prior = reconciliations.get(manifestId);
      if (prior) {
        // Per IntentPorts contract: same key + same body = replay;
        // same key + different body = idempotency_conflict; different
        // key entirely = also conflict (a manifest may be reconciled
        // exactly once, so a second-key second-body second call is
        // double-reconciliation).
        const sameKey = prior.idempotencyKey === idempotencyKey;
        const sameBody = JSON.stringify(prior.actuals) === JSON.stringify(actuals);
        if (!sameKey || !sameBody) {
          throw new IntentAlgorithmException({
            kind: 'idempotency_conflict',
            manifestId,
            idempotencyKey,
          });
        }
        return { replay: true };
      }

      reconciliations.set(manifestId, {
        idempotencyKey,
        actuals,
        result,
      });

      const snap = manifests.get(manifestId);
      if (snap) {
        manifests.set(manifestId, {
          ...snap,
          status: 'RECONCILED',
          reconciledAt: new Date(deps.now().getTime()),
          priorResult: result,
        });
      }
      return { replay: false };
    },
  };

  const inspect = {
    manifestCount: () => manifests.size,
    reconciliationCount: () => reconciliations.size,
    listManifestIds: () => Array.from(manifests.keys()),
  };

  return { intentPorts, inspect };
}
