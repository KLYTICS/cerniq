// Wires the intent module. Phase 2.0 ships the memory adapter; Phase 2.1
// adds the Prisma adapter — operator chooses via AEGIS_INTENT_MANIFEST_STORAGE
// (default: memory). Module registration in app.module.ts is gated on
// AEGIS_INTENT_MANIFEST_ENABLED=true (default: NOT registered).
//
// Storage-agnostic port deps (sign / audit / signal / now / ttl) are
// extracted into buildSharedDeps() so both adapter providers can share
// the cross-cutting wiring without duplication.

import { Module, type DynamicModule, type Provider } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module.js';
import { AuditService } from '../audit/audit.service.js';
import { AuditSignerService } from '../../common/crypto/audit-signer.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { BateModule } from '../bate/bate.module.js';
import { BateService } from '../bate/bate.service.js';
import { IdentityModule } from '../identity/identity.module.js';
import { ObservabilityModule } from '../../common/observability/observability.module.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';

import { buildMemoryIntentAdapter } from './intent.adapter.memory.js';
import { buildPrismaIntentAdapter } from './intent.adapter.prisma.js';
import { INTENT_PORTS } from './intent.constants.js';
import { IntentController } from './intent.controller.js';
import { IntentService } from './intent.service.js';
import type {
  IntentAuditAppendInput,
  IntentBateSignalInput,
  IntentPorts,
} from './intent.ports.js';

// ────────────────────────────────────────────────────────────────────────
// Shared cross-cutting port deps — storage-agnostic
// ────────────────────────────────────────────────────────────────────────

/**
 * Cross-cutting port deps that are storage-agnostic. Both memory and
 * Prisma adapters take the same closures for sign/audit/signal/now/ttl;
 * extracting them avoids ~70 LOC of duplication between providers.
 */
function buildSharedDeps(
  auditSigner: AuditSignerService,
  audit: AuditService,
  bate: BateService,
): {
  signManifest: IntentPorts['signManifest'];
  recordAudit: IntentPorts['recordAudit'];
  ingestSignal: IntentPorts['ingestSignal'];
  now: IntentPorts['now'];
  ttlBounds: IntentPorts['ttlBounds'];
} {
  return {
    // Sign delegates to the AEGIS audit-chain signer (KMS-aware per M-051).
    // Reuses the audit signing key family by design — single key rotation
    // story; manifest verifier reads /.well-known/audit-signing-key JWKS.
    // If the operator wants intent manifests on a SEPARATE key (defense
    // in depth against signature substitution), introduce a new
    // IntentSignerService — flagged for OD-019 follow-up.
    signManifest: async (body) => {
      const bytes = new TextEncoder().encode(canonicalize(body));
      const { signatureB64Url, kid } = await auditSigner.signChainMessage(bytes);
      return { body, signingKeyId: kid, signatureB64Url };
    },
    // Maps the intent audit event shape to the existing AuditService.
    // The existing AuditEvent.decision enum is APPROVED/DENIED/FLAGGED;
    // we encode intent.* as APPROVED for declared/reconciled and
    // FLAGGED for mismatch. The `action` carries the kind for filterability.
    recordAudit: async (event: IntentAuditAppendInput): Promise<string> => {
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
    // BateService.ingestSignal is async; we fire-and-forget by
    // attaching a tail catch (signal ingestion failure must NOT
    // block reconciliation — the audit row is the durable evidence).
    // Failure is WARN-logged, not silently swallowed (invariant #4).
    ingestSignal: (signal: IntentBateSignalInput): void => {
      bate
        .ingestSignal({
          agentId: signal.agentId,
          signalType: signal.signalType as unknown as Parameters<
            typeof bate.ingestSignal
          >[0]['signalType'],
          severity: signal.severity,
          source: signal.source,
          payload: signal.payload,
        })
        .catch((e: unknown) => {
          // eslint-disable-next-line no-console
          console.warn(
            '[intent] bate.ingestSignal rejected INTENT_MISMATCH_OBSERVED:',
            e,
          );
        });
    },
    now: () => new Date(),
    ttlBounds: () => ({ minSeconds: 30, maxSeconds: 60 }),
  };
}

// ────────────────────────────────────────────────────────────────────────
// Per-adapter providers — same DI symbol, different storage backend
// ────────────────────────────────────────────────────────────────────────

const memoryPortsProvider: Provider = {
  provide: INTENT_PORTS,
  inject: [AuditSignerService, AuditService, BateService],
  useFactory: (
    auditSigner: AuditSignerService,
    audit: AuditService,
    bate: BateService,
  ): IntentPorts => {
    const shared = buildSharedDeps(auditSigner, audit, bate);
    return buildMemoryIntentAdapter(shared).intentPorts;
  },
};

const prismaPortsProvider: Provider = {
  provide: INTENT_PORTS,
  inject: [PrismaService, AuditSignerService, AuditService, BateService],
  useFactory: (
    prisma: PrismaService,
    auditSigner: AuditSignerService,
    audit: AuditService,
    bate: BateService,
  ): IntentPorts => {
    const shared = buildSharedDeps(auditSigner, audit, bate);
    return buildPrismaIntentAdapter({ prisma, ...shared });
  },
};

/**
 * Pick the storage backend at module-build time. Choice is fixed for
 * the lifetime of the process — flipping AEGIS_INTENT_MANIFEST_STORAGE
 * requires a restart. This is intentional: live-switching between
 * in-process memory and durable Prisma would silently lose any
 * in-flight memory-only manifests.
 */
function pickStorageProvider(): Provider {
  const choice = (process.env.AEGIS_INTENT_MANIFEST_STORAGE ?? 'memory').toLowerCase();
  switch (choice) {
    case 'prisma':
      return prismaPortsProvider;
    case 'memory':
      return memoryPortsProvider;
    default:
      throw new Error(
        `AEGIS_INTENT_MANIFEST_STORAGE must be 'memory' or 'prisma' (got '${choice}'). ` +
          `Default is 'memory' (in-process, dev-only). Set 'prisma' for production durability — ` +
          `requires the 20260516000000_add_intent_manifest_phase21 migration to have run.`,
      );
  }
}

// ────────────────────────────────────────────────────────────────────────
// Module
// ────────────────────────────────────────────────────────────────────────

@Module({})
export class IntentModule {
  /**
   * Conditional registration: include only when env flag is true.
   * Call from app.module.ts imports[] as
   *   ...(process.env.AEGIS_INTENT_MANIFEST_ENABLED === 'true'
   *        ? [IntentModule.forRoot()]
   *        : []),
   *
   * Storage backend selected at module-build time via
   * AEGIS_INTENT_MANIFEST_STORAGE=memory|prisma (default: memory).
   * Prisma adapter requires the IntentManifest + IntentActual tables —
   * run `pnpm --filter @aegis/api prisma:migrate` before flipping.
   */
  static forRoot(): DynamicModule {
    return {
      module: IntentModule,
      imports: [AuthModule, IdentityModule, AuditModule, BateModule, ObservabilityModule],
      controllers: [IntentController],
      providers: [IntentService, pickStorageProvider()],
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
