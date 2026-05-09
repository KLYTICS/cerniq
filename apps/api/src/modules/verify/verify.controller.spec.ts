/**
 * VerifyController — unit tests
 *
 * The controller is a thin delegate: it receives an authenticated key
 * context (set by ApiKeyGuard) plus the request DTO and forwards both to
 * VerifyService.verify(). Tests here prove:
 *   - The principalId from auth context reaches the service (not body).
 *   - A valid verify result is returned to the caller unchanged.
 *   - A denied result (valid=false) is also returned unchanged — the
 *     controller never throws on denial; the VerifyResponse carries the
 *     denial reason as data, not as an HTTP error.
 */

import { Test } from '@nestjs/testing';
import { ExecutionContext } from '@nestjs/common';
import { VerifyController } from './verify.controller';
import { VerifyService } from './verify.service';
import { PlanAwareThrottlerGuard } from '../../common/throttle/plan-aware-throttler.guard';
import type { VerifyRequestDto, VerifyResponseDto } from './verify.dto';
import type { AuthenticatedKey } from '../auth/api-key.service';

// Allow all requests through in tests — throttling is tested separately in
// plan-aware-throttler.guard.spec.ts; wiring it into every controller test
// would require the entire throttler module.
const PASS_THROTTLE = { canActivate: (_ctx: ExecutionContext) => true };

// ── Auth context stub ─────────────────────────────────────────────────────────

const AUTH = {
  principalId: 'prn_test',
  keyId: 'key_test',
  plan: 'DEVELOPER',
} as unknown as AuthenticatedKey;

// ── VerifyService stub ────────────────────────────────────────────────────────

function makeServiceStub(response: VerifyResponseDto): jest.Mocked<VerifyService> {
  return {
    verify: jest.fn().mockResolvedValue(response),
  } as unknown as jest.Mocked<VerifyService>;
}

function approvedResponse(overrides?: Partial<VerifyResponseDto>): VerifyResponseDto {
  return {
    valid: true,
    agentId: 'agt_test',
    principalId: 'prn_test',
    trustScore: 650,
    trustBand: 'VERIFIED',
    scopesGranted: ['commerce'],
    denialReason: null,
    verifiedAt: new Date().toISOString(),
    ttl: 30,
    auditEventId: null,
    ...overrides,
  };
}

function deniedResponse(reason: VerifyResponseDto['denialReason']): VerifyResponseDto {
  return {
    valid: false,
    agentId: null,
    principalId: null,
    trustScore: 0,
    trustBand: null,
    scopesGranted: [],
    denialReason: reason,
    verifiedAt: new Date().toISOString(),
    ttl: 0,
    auditEventId: null,
  };
}

// ── Test helpers ──────────────────────────────────────────────────────────────

async function buildController(stub: jest.Mocked<VerifyService>) {
  const module = await Test.createTestingModule({
    controllers: [VerifyController],
    providers: [{ provide: VerifyService, useValue: stub }],
  })
    .overrideGuard(PlanAwareThrottlerGuard)
    .useValue(PASS_THROTTLE)
    .compile();
  return module.get(VerifyController);
}

const SAMPLE_DTO: VerifyRequestDto = {
  token: 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.example.sig',
  action: 'commerce.purchase',
  amount: 250,
  currency: 'USD',
  merchantDomain: 'delta.com',
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('VerifyController', () => {
  let controller: VerifyController;
  let service: jest.Mocked<VerifyService>;

  // ── Happy path ──────────────────────────────────────────────────────────────

  describe('POST /verify (approved)', () => {
    beforeEach(async () => {
      service = makeServiceStub(approvedResponse());
      controller = await buildController(service);
    });

    it('delegates to VerifyService.verify with the dto and principalId from auth', async () => {
      await controller.run(AUTH, SAMPLE_DTO);
      expect(service.verify).toHaveBeenCalledWith(SAMPLE_DTO, AUTH.principalId);
    });

    it('returns the service result unchanged', async () => {
      const result = await controller.run(AUTH, SAMPLE_DTO);
      expect(result.valid).toBe(true);
      expect(result.agentId).toBe('agt_test');
      expect(result.trustBand).toBe('VERIFIED');
    });

    it('does not mutate the response (returns the same object reference)', async () => {
      const expected = approvedResponse();
      service.verify.mockResolvedValueOnce(expected);
      const result = await controller.run(AUTH, SAMPLE_DTO);
      expect(result).toBe(expected);
    });
  });

  // ── Denial path ─────────────────────────────────────────────────────────────
  // Critical: the controller MUST return 200 with valid=false — NOT throw 4xx.
  // Relying parties check the `valid` field, not the HTTP status.

  describe('POST /verify (denied — 200 with valid=false)', () => {
    it.each([
      'PLAN_LIMIT_EXCEEDED',
      'AGENT_NOT_FOUND',
      'AGENT_REVOKED',
      'INVALID_SIGNATURE',
      'POLICY_REVOKED',
      'POLICY_EXPIRED',
      'SCOPE_NOT_GRANTED',
      'SPEND_LIMIT_EXCEEDED',
      'TRUST_SCORE_TOO_LOW',
      'ANOMALY_FLAGGED',
    ] as VerifyResponseDto['denialReason'][])(
      'returns valid=false with reason %s — does NOT throw',
      async (reason) => {
        service = makeServiceStub(deniedResponse(reason));
        controller = await buildController(service);

        const result = await controller.run(AUTH, SAMPLE_DTO);
        expect(result.valid).toBe(false);
        expect(result.denialReason).toBe(reason);
      },
    );
  });

  // ── Auth scoping ─────────────────────────────────────────────────────────────
  // principalId MUST come from auth context, never from the request body.

  describe('auth context isolation', () => {
    beforeEach(async () => {
      service = makeServiceStub(approvedResponse());
      controller = await buildController(service);
    });

    it('passes auth.principalId, not a body-supplied principal', async () => {
      const authA = { ...AUTH, principalId: 'prn_A' } as AuthenticatedKey;
      const authB = { ...AUTH, principalId: 'prn_B' } as AuthenticatedKey;

      await controller.run(authA, SAMPLE_DTO);
      await controller.run(authB, SAMPLE_DTO);

      expect(service.verify).toHaveBeenNthCalledWith(1, SAMPLE_DTO, 'prn_A');
      expect(service.verify).toHaveBeenNthCalledWith(2, SAMPLE_DTO, 'prn_B');
    });

    it('calls service.verify exactly once per controller invocation', async () => {
      await controller.run(AUTH, SAMPLE_DTO);
      expect(service.verify).toHaveBeenCalledTimes(1);
    });
  });
});
