// POST /v1/verify/rar/evaluate — RFC 9396 RAR decision endpoint.
//
// Stateless RAR evaluation: caller passes authorization_details + a
// candidate action; AEGIS returns ALLOW or a typed DENY. No policy
// persistence is involved — the FAPI client supplies the RAR claims
// inline, exactly as RFC 9396 §2.1 envisages.
//
// Auth: VerifyKeyOnly — same surface as /v1/verify, so a relying party
// using AEGIS for verification flows can also call RAR evaluation
// without provisioning a different key. The endpoint emits no audit
// event (the evaluation is a pure decision; the *acting* call carries
// the audit semantics via /v1/verify).
//
// Binding contract: `docs/spec/05_FAPI_2_0_PROFILE.md` §2 — RFC-9396.

import { Body, Controller, Logger, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { VerifyKeyOnly } from '../../auth/api-key.guard';
import { Auth } from '../../../common/decorators/auth.decorator';
import type { AuthenticatedKey } from '../../auth/api-key.service';
import { PlanAwareThrottlerGuard } from '../../../common/throttle/plan-aware-throttler.guard';
import { MetricsService } from '../../../common/observability/metrics.service';
import { evaluateRar } from './rar.evaluator';
import type { AegisAuthorizationDetail, RarCandidate } from './rar.types';
import {
  RarEvaluateRequestDto,
  RarEvaluateResponseDto,
} from './rar.dto';

/** Binding version. Bump on any semantic change to the evaluator's
 *  decision algorithm — promotes a CHANGELOG entry + 90-day notice. */
const RAR_BINDING_VERSION = 'aegis-rar-1.0';

@ApiTags('Verification')
@Controller('verify/rar')
@UseGuards(PlanAwareThrottlerGuard)
export class RarController {
  private readonly logger = new Logger(RarController.name);

  constructor(private readonly metrics: MetricsService) {}

  @Post('evaluate')
  @VerifyKeyOnly()
  @ApiSecurity('PublicVerifyKey')
  @ApiOperation({
    summary: 'Evaluate an RFC 9396 RAR authorization_details[] against a candidate action.',
    description:
      'Stateless decision endpoint — pass `authorization_details` and `candidate` in the body, get ALLOW or a typed RAR deny reason back. ' +
      'No audit event is emitted (the acting call carries the audit semantics via /v1/verify). ' +
      'Bindingly implements RFC 9396 — see /.well-known/aegis-configuration#standards_implemented.',
  })
  evaluate(
    @Auth() auth: AuthenticatedKey,
    @Body() dto: RarEvaluateRequestDto,
  ): RarEvaluateResponseDto {
    const startNs = process.hrtime.bigint();

    // Coerce the loose array<object> to the discriminated union; the
    // evaluator handles invalid shapes by returning a typed failure
    // reason rather than throwing — matching FAPI introspection style.
    // Cast through `unknown` because TS strict mode rejects direct
    // Record<string, unknown> → AegisAuthorizationDetail (discriminated
    // unions require type-narrowing the compiler can't infer from the
    // wire shape). The evaluator gracefully handles a missing `type`
    // by returning `type_unauthorized` — same surface as a wrong type.
    const details = dto.authorization_details as unknown as readonly AegisAuthorizationDetail[];
    const candidate: RarCandidate = {
      type: dto.candidate.type,
      action: dto.candidate.action,
      amount_usd: dto.candidate.amount_usd,
      currency: dto.candidate.currency,
      qty: dto.candidate.qty,
      instrument: dto.candidate.instrument,
      destination: dto.candidate.destination,
      resource: dto.candidate.resource,
      is_pii: dto.candidate.is_pii,
      at: dto.candidate.at ? new Date(dto.candidate.at) : undefined,
      spent_today_usd: dto.candidate.spent_today_usd,
    };

    const result = evaluateRar(details, candidate);
    const latencySeconds =
      Number(process.hrtime.bigint() - startNs) / 1_000_000_000;

    // Observability — emit metrics + structured log with bounded labels.
    // `detail_type` label intentionally uses 'none' when the evaluator
    // short-circuits before matching (e.g. type_unauthorized or empty
    // input) — keeps label cardinality bounded to the registered types
    // plus 'none'. `principal.id` lives in the log, NOT in metric labels
    // (CLAUDE.md observability rule: no free-form labels).
    const decisionLabels = result.ok
      ? {
          result: 'allow' as const,
          detail_type: result.matched_detail_type,
          deny_reason: 'allow' as const,
        }
      : {
          result: 'deny' as const,
          detail_type: 'none' as const,
          deny_reason: result.reason,
        };
    this.metrics.rarEvaluationsTotal.inc(decisionLabels);
    this.metrics.rarEvaluationLatency.observe(
      { result: decisionLabels.result },
      latencySeconds,
    );

    this.logger.log({
      msg: 'rar.evaluate',
      principal_id: auth.principalId,
      candidate_type: candidate.type,
      candidate_action: candidate.action,
      details_count: details.length,
      result: decisionLabels.result,
      deny_reason: result.ok ? null : result.reason,
      matched_detail_type: result.ok ? result.matched_detail_type : null,
      latency_ms: Math.round(latencySeconds * 1000),
    });

    if (result.ok) {
      return {
        ok: true,
        matched_detail_type: result.matched_detail_type,
        reason: null,
        detail: null,
        evaluated_at: new Date().toISOString(),
        binding_version: RAR_BINDING_VERSION,
      };
    }
    return {
      ok: false,
      matched_detail_type: null,
      reason: result.reason,
      detail: result.detail ?? null,
      evaluated_at: new Date().toISOString(),
      binding_version: RAR_BINDING_VERSION,
    };
  }
}
