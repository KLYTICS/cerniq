// Wires the intent module. Memory adapter only in Phase 2.0; Prisma
// adapter (Phase 2.1) registers via the same INTENT_PORTS DI symbol
// once OD-018+19+20 lands and the IntentManifest schema migrates.
//
// Module registration in app.module.ts is GATED on
// `AEGIS_INTENT_MANIFEST_ENABLED=true` env. Default: NOT registered.

import { Module, type DynamicModule, type Provider } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module.js';
import { AuditService } from '../audit/audit.service.js';
import { AuditSignerService } from '../../common/crypto/audit-signer.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { BateModule } from '../bate/bate.module.js';
import { BateService } from '../bate/bate.service.js';
import { IdentityModule } from '../identity/identity.module.js';
import { ObservabilityModule } from '../../common/observability/observability.module.js';

import { buildMemoryIntentAdapter } from './intent.adapter.memory.js';
import { INTENT_PORTS } from './intent.constants.js';
import { IntentController } from './intent.controller.js';
import { IntentService } from './intent.service.js';
import type {
  IntentAuditAppendInput,
  IntentBateSignalInput,
  IntentPorts,
} from './intent.ports.js';

const memoryPortsProvider: Provider = {
  provide: INTENT_PORTS,
  inject: [AuditSignerService, AuditService, BateService],
  useFactory: (
    auditSigner: AuditSignerService,
    audit: AuditService,
    bate: BateService,
  ): IntentPorts => {
    return buildMemoryIntentAdapter({
      // Sign delegates to the AEGIS audit-chain signer (KMS-aware per M-051).
      // Reuses the audit signing key family by design — single key rotation
      // story; manifest verifier reads /.well-known/audit-signing-key JWKS.
      // If the operator wants intent manifests on a SEPARATE key (defense
      // in depth against signature substitution), introduce a new
      // IntentSignerService in Phase 2.1.
      signManifest: async (body) => {
        const canonical = canonicalize(body);
        const bytes = new TextEncoder().encode(canonical);
        // AuditSignerService.signChainMessage delegates to KMS when
        // wired (M-051) or to env-derived Ed25519 fallback. Returns
        // base64url-encoded signature + the kid to stamp on the row.
        const { signatureB64Url, kid } = await auditSigner.signChainMessage(bytes);
        return {
          body,
          signingKeyId: kid,
          signatureB64Url,
        };
      },
      recordAudit: async (event: IntentAuditAppendInput): Promise<string> => {
        // Maps the intent audit event shape to the existing AuditService.
        // The existing AuditEvent.decision enum is APPROVED/DENIED/FLAGGED;
        // we encode intent.* as APPROVED for declared/reconciled and
        // FLAGGED for mismatch. The `action` carries the kind for filterability.
        const decision = event.kind === 'intent.mismatch' ? 'FLAGGED' : 'APPROVED';
        const auditEventId = await audit.append({
          principalId: event.principalId,
          agentId: event.agentId,
          claimedAgentId: event.agentId,
          action: event.kind,
          decision,
          policyId: null,
          policySnapshot: { intent: { manifestId: event.manifestId, ...event.payload } },
          trustScoreAtEvent: 0,
          trustBandAtEvent: 'WATCH',
        });
        return auditEventId;
      },
      ingestSignal: (signal: IntentBateSignalInput): void => {
        // BateService.ingest accepts the existing union of signal types
        // (verify.ports.ts BateSignalInput.signalType). Phase 2 adds
        // INTENT_MISMATCH_OBSERVED to that union — wire it via type-widening
        // at the boundary. If BateService rejects the new kind today,
        // the call no-ops with a warn-log instead of throwing (intent
        // reconciliation must not fail on downstream signal failure;
        // mismatch is already in the audit chain).
        // BateService.ingestSignal is async; we fire-and-forget by
        // attaching a tail catch (signal ingestion failure must NOT
        // block reconciliation — the audit row is the durable evidence).
        // Failure is WARN-logged, not silently swallowed (invariant #4).
        bate
          .ingestSignal({
            agentId: signal.agentId,
            signalType: signal.signalType as unknown as Parameters<typeof bate.ingestSignal>[0]['signalType'],
            severity: signal.severity,
            source: signal.source,
            payload: signal.payload,
          })
          .catch((e: unknown) => {
            // eslint-disable-next-line no-console
            console.warn('[intent] bate.ingestSignal rejected INTENT_MISMATCH_OBSERVED:', e);
          });
      },
      now: () => new Date(),
      ttlBounds: () => ({ minSeconds: 30, maxSeconds: 60 }),
    }).intentPorts;
  },
};

@Module({})
export class IntentModule {
  /**
   * Conditional registration: include only when env flag is true.
   * Call from app.module.ts imports[] as
   *   ...(process.env.AEGIS_INTENT_MANIFEST_ENABLED === 'true'
   *        ? [IntentModule.forRoot()]
   *        : []),
   */
  static forRoot(): DynamicModule {
    return {
      module: IntentModule,
      imports: [AuthModule, IdentityModule, AuditModule, BateModule, ObservabilityModule],
      controllers: [IntentController],
      providers: [IntentService, memoryPortsProvider],
      exports: [IntentService],
    };
  }
}

// ────────────────────────────────────────────────────────────────────────
// Local canonicalization mirroring @aegis/intent-manifest canonical.ts —
// kept inline to avoid a Nest module taking a runtime dep on the kernel's
// internal canonical primitive (the kernel exports `canonicalize` via its
// public index — we re-implement here to make the Nest module testable
// without importing the kernel; future: import directly when build wiring
// settles).
// ────────────────────────────────────────────────────────────────────────

function canonicalize(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(sortKeys);
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(obj).sort()) {
    out[k] = sortKeys(obj[k]);
  }
  return out;
}

