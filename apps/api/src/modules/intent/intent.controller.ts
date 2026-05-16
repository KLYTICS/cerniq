// REST surface for /v1/intent + /v1/intent/{id}/actuals + GET.
//
// CLAUDE.md root invariants honored here:
//   #4 — typed AegisError-shaped responses on every failure (no bare strings)
//   #5 — tenant isolation: principalId comes from ApiKeyGuard; agent
//        ownership pre-check enforced before invoking service.issue()
//
// Note: assumes the same ApiKeyGuard pattern as other controllers; the
// guard sets req.principal.id. If the guard pattern in this repo is
// named differently, swap the @UseGuards decorator.

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import { AEGIS_HEADER_IDEMPOTENCY } from '@aegis/types';

import {
  AegisError,
  AuthenticationError,
  ConflictError,
  IdempotencyConflictError,
  InternalError,
  NotFoundError,
  ServiceUnavailableError,
  ValidationError,
} from '../../common/errors/aegis-error.js';
import { ApiKeyGuard } from '../auth/api-key.guard.js';
import { IdentityService } from '../identity/identity.service.js';

import {
  GetIntentResponseDto,
  IssueIntentRequestDto,
  IssueIntentResponseDto,
  ReconcileRequestDto,
  ReconcileResponseDto,
} from './intent.dto.js';
import { IntentAlgorithmException } from './intent.ports.js';
import { IntentService } from './intent.service.js';

interface PrincipalScopedRequest extends Request {
  principal?: { id: string };
}

@ApiTags('intent')
@Controller('v1/intent')
@UseGuards(ApiKeyGuard)
export class IntentController {
  constructor(
    private readonly intentService: IntentService,
    private readonly agents: IdentityService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Issue a signed intent manifest (ADR-0017).' })
  @ApiResponse({ status: 201, type: IssueIntentResponseDto })
  async issue(
    @Req() req: PrincipalScopedRequest,
    @Body() body: IssueIntentRequestDto,
  ): Promise<IssueIntentResponseDto> {
    const principalId = requirePrincipalId(req);
    await this.assertAgentBelongsToPrincipal(body.agentId, principalId);
    try {
      // The DTO is a loose pass-through; the discriminated IntentClaim
      // union is validated inside @aegis/intent-manifest's reconciler.
      // Cast at the controller boundary; algorithm/kernel re-validate.
      const out = await this.intentService.issue(principalId, {
        agentId: body.agentId,
        verifyTokenJti: body.verifyTokenJti,
        verifyTokenSha256B64Url: body.verifyTokenSha256B64Url,
        intent: body.intent as unknown as Parameters<typeof this.intentService.issue>[1]['intent'],
        reconciliation: body.reconciliation,
        ttlSeconds: body.ttlSeconds,
      });
      return {
        manifestId: out.manifestId,
        signedManifest: out.signedManifest as unknown as Record<string, unknown>,
        expiresAt: out.expiresAt,
      };
    } catch (e) {
      throw this.translate(e);
    }
  }

  @Post(':manifestId/actuals')
  @HttpCode(HttpStatus.OK)
  @ApiHeader({ name: AEGIS_HEADER_IDEMPOTENCY, required: true })
  @ApiOperation({ summary: 'Reconcile actuals against a stored manifest. Idempotent (ADR-0017).' })
  @ApiResponse({ status: 200, type: ReconcileResponseDto })
  async reconcile(
    @Req() req: PrincipalScopedRequest,
    @Param('manifestId') manifestId: string,
    @Body() body: ReconcileRequestDto,
  ): Promise<ReconcileResponseDto> {
    const principalId = requirePrincipalId(req);
    const idempotencyKey = req.header(AEGIS_HEADER_IDEMPOTENCY);
    if (!idempotencyKey) {
      throw new ValidationError(
        `${AEGIS_HEADER_IDEMPOTENCY} header is required for reconciliation`,
      );
    }
    try {
      const out = await this.intentService.reconcile(
        principalId,
        manifestId,
        idempotencyKey,
        body.actuals,
      );
      return {
        manifestId: out.manifestId,
        actualCount: out.actualCount,
        mismatches: [...out.mismatches],
        recommendedDenialReason: out.recommendedDenialReason,
        idempotencyReplay: out.idempotencyReplay,
      };
    } catch (e) {
      throw this.translate(e);
    }
  }

  @Get(':manifestId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Read a stored intent manifest + reconciliation state.' })
  @ApiResponse({ status: 200, type: GetIntentResponseDto })
  async get(
    @Req() req: PrincipalScopedRequest,
    @Param('manifestId') manifestId: string,
  ): Promise<GetIntentResponseDto> {
    const principalId = requirePrincipalId(req);
    const snap = await this.intentService.get(principalId, manifestId);
    if (!snap) {
      throw new NotFoundError('intent manifest');
    }
    // Phase 2.0: actuals + reconciliation surfacing requires the
    // Prisma adapter (which retains per-actual rows). Memory adapter
    // surfaces only the consolidated priorResult. Stub the per-actual
    // listing as empty until Phase 2.1.
    const reconciliation = snap.priorResult
      ? (snap.priorResult as ReconcileResponseDto)
      : null;
    return {
      manifest: snap.manifest as Record<string, unknown>,
      actuals: [],
      reconciliation,
      status: snap.status,
    };
  }

  // ──────────────────────────────────────────────────────────────────────

  private async assertAgentBelongsToPrincipal(
    agentId: string,
    principalId: string,
  ): Promise<void> {
    // IdentityService.findOne enforces tenant boundary itself —
    // throws NotFoundError when agentId not owned by principalId.
    // Re-thrown directly; anti-enumeration handled by the existing
    // identity service contract.
    await this.agents.findOne(principalId, agentId);
  }

  private translate(e: unknown): AegisError {
    if (e instanceof IntentAlgorithmException) {
      switch (e.cause.kind) {
        case 'manifest_not_found':
        case 'tenant_mismatch':
          return new NotFoundError('intent manifest');
        case 'manifest_expired':
          return new ConflictError('intent manifest expired');
        case 'manifest_reconciled':
          return new ConflictError('intent manifest already reconciled');
        case 'manifest_collision':
          return new ConflictError('intent manifest id collision; retry with a fresh id');
        case 'idempotency_conflict':
          return new IdempotencyConflictError();
        case 'ttl_out_of_bounds':
          return new ValidationError(
            `ttlSeconds must be in [${e.cause.minSeconds}, ${e.cause.maxSeconds}]`,
          );
        case 'verify_token_already_used':
          return new ConflictError('verify token already bound to a different intent manifest');
        case 'signing_failed':
          return new ServiceUnavailableError('intent signing service unavailable');
      }
    }
    if (e instanceof AegisError) return e;
    return new InternalError('intent service internal error');
  }
}

function requirePrincipalId(req: PrincipalScopedRequest): string {
  const id = req.principal?.id;
  if (!id) {
    throw new AuthenticationError('principal not on request');
  }
  return id;
}
