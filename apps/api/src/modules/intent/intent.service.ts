// Nest service: thin orchestration over the pure algorithm + injected
// IntentPorts. Holds NO business logic — every decision flows through
// `intent.algorithm.ts` so the Phase-3 CF Worker port can reuse the
// algorithm bit-for-bit.
//
// Tenant boundary discipline:
//   - principalId arrives via the ApiKeyGuard (req.principal.id)
//   - service methods take principalId as the first arg
//   - service does the cross-principal check on the agent BEFORE the
//     algorithm is invoked (algorithm trusts that check)

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ulid } from 'ulid';

import { MetricsService } from '../../common/observability/metrics.service.js';
import {
  issueManifest as algoIssue,
  reconcileActuals as algoReconcile,
} from './intent.algorithm.js';
import { INTENT_PORTS } from './intent.constants.js';
import {
  IntentAlgorithmException,
  type IntentPorts,
  type IssueInput,
  type ReconcileInput,
} from './intent.ports.js';

@Injectable()
export class IntentService {
  private readonly logger = new Logger(IntentService.name);

  constructor(
    @Inject(INTENT_PORTS) private readonly ports: IntentPorts,
    @Optional() private readonly metrics?: MetricsService,
    @Optional() @Inject('INTENT_ID_GENERATOR') private readonly idGen: () => string = () => `int_${ulid()}`,
  ) {}

  /**
   * Issue a signed intent manifest. Caller (controller) MUST have
   * verified that the agent belongs to `principalId` before calling
   * (per CLAUDE.md invariant #5 — tenant isolation at the boundary).
   */
  async issue(
    principalId: string,
    input: Omit<IssueInput, 'principalId'>,
  ): Promise<{
    manifestId: string;
    signedManifest: unknown;
    expiresAt: number;
    auditEventId: string;
  }> {
    const manifestId = this.idGen();
    const stop = this.metrics?.intentIssueLatency.startTimer();
    try {
      const out = await algoIssue(
        { principalId, ...input },
        this.ports,
        manifestId,
      );
      this.metrics?.intentIssuedTotal.inc({ intent_kind: input.intent.kind });
      this.logger.log({
        msg: 'intent_issued',
        manifestId: out.manifestId,
        principalId,
        agentId: input.agentId,
        intentKind: input.intent.kind,
      });
      return out;
    } catch (e) {
      this.logRethrow('issue', principalId, e);
      throw e;
    } finally {
      stop?.();
    }
  }

  async reconcile(
    principalId: string,
    manifestId: string,
    idempotencyKey: string,
    actuals: ReconcileInput['actuals'],
  ): Promise<{
    manifestId: string;
    actualCount: number;
    mismatches: ReadonlyArray<{ kind: string; detail: string; detectedAt: number }>;
    recommendedDenialReason: 'INTENT_MISMATCH' | null;
    idempotencyReplay: boolean;
  }> {
    const stop = this.metrics?.intentReconcileLatency.startTimer();
    try {
      const out = await algoReconcile(
        { principalId, manifestId, idempotencyKey, actuals },
        this.ports,
      );
      // Outcome label discipline — bounded to 4 values per metrics.service.ts.
      const outcome = out.idempotencyReplay
        ? 'replay'
        : out.result.recommendedDenialReason !== null
          ? 'mismatch_denied'
          : out.result.mismatches.length > 0
            ? 'mismatch_advised'
            : 'clean';
      this.metrics?.intentReconciledTotal.inc({ outcome });
      // Per-kind mismatch counters — one increment per IntentMismatch
      // in the result. Bounded cardinality (8 kinds per kernel enum).
      if (!out.idempotencyReplay) {
        for (const m of out.result.mismatches) {
          this.metrics?.intentMismatchTotal.inc({ mismatch_kind: m.kind });
        }
      }
      this.logger.log({
        msg: 'intent_reconciled',
        manifestId,
        principalId,
        mismatchCount: out.result.mismatches.length,
        denied: out.result.recommendedDenialReason !== null,
        replay: out.idempotencyReplay,
      });
      return {
        manifestId: out.result.manifestId,
        actualCount: out.result.actualCount,
        mismatches: out.result.mismatches,
        recommendedDenialReason: out.result.recommendedDenialReason,
        idempotencyReplay: out.idempotencyReplay,
      };
    } catch (e) {
      this.logRethrow('reconcile', principalId, e);
      throw e;
    } finally {
      stop?.();
    }
  }

  /**
   * Load a manifest for inspection. Returns null on tenant mismatch
   * (collapses to 404 at the controller per anti-enumeration discipline).
   */
  async get(
    principalId: string,
    manifestId: string,
  ): Promise<{
    manifest: unknown;
    status: 'OPEN' | 'RECONCILED' | 'EXPIRED';
    reconciledAt: Date | null;
    priorResult: unknown;
  } | null> {
    const snap = await this.ports.loadManifest(manifestId);
    if (!snap) return null;
    if (snap.principalId !== principalId) {
      // Anti-enumeration: same shape as 404, no leak of existence.
      return null;
    }
    return {
      manifest: snap.signedManifest,
      status: snap.status,
      reconciledAt: snap.reconciledAt,
      priorResult: snap.priorResult,
    };
  }

  private logRethrow(op: string, principalId: string, e: unknown): void {
    if (e instanceof IntentAlgorithmException) {
      this.logger.warn({
        msg: 'intent_algorithm_failure',
        op,
        principalId,
        cause: e.cause,
      });
    } else {
      this.logger.error({
        msg: 'intent_unexpected_failure',
        op,
        principalId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
}
