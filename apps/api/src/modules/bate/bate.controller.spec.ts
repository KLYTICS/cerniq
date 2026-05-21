/**
 * BateController — unit tests
 *
 * Coverage:
 *   report() — ownership check (NotFoundException for wrong principal),
 *              VERIFY_ONLY scope guard (ForbiddenException),
 *              maps eventType → BateSignalType and severity → SignalSeverity,
 *              delegates to BateService.ingestSignal
 */

import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthenticatedKey } from '../auth/api-key.service';

import { BateController } from './bate.controller';
import { BateService } from './bate.service';


// ── Stubs ─────────────────────────────────────────────────────────────────────

function makeService(): jest.Mocked<Pick<BateService, 'ingestSignal'>> {
  return { ingestSignal: jest.fn().mockResolvedValue(undefined) };
}

function makePrisma(ownsAgent: boolean) {
  return {
    agentIdentity: {
      findFirst: jest.fn().mockResolvedValue(ownsAgent ? { id: 'agt_1' } : null),
    },
  };
}

async function buildController(service: ReturnType<typeof makeService>, prisma: ReturnType<typeof makePrisma>) {
  const module = await Test.createTestingModule({
    controllers: [BateController],
    providers: [
      { provide: BateService, useValue: service },
      { provide: PrismaService, useValue: prisma },
    ],
  }).compile();
  return module.get(BateController);
}

const AUTH: AuthenticatedKey = {
  principalId: 'prn_A',
  apiKeyId: 'key_1',
  plan: 'DEVELOPER',
  scope: 'FULL_ACCESS',
} as unknown as AuthenticatedKey;

const REPORT_DTO = {
  eventType: 'fraud_confirmed' as const,
  severity: 'high' as const,
  description: 'Unauthorized transaction',
  transactionId: 'tx_abc123',
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('BateController', () => {
  describe('report()', () => {
    it('throws NotFoundException when the agent does not belong to the principal', async () => {
      const controller = await buildController(makeService(), makePrisma(false));
      await expect(controller.report(AUTH, 'agt_1', REPORT_DTO)).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException for VERIFY_ONLY API key scope', async () => {
      const controller = await buildController(makeService(), makePrisma(true));
      const verifyOnlyAuth = { ...AUTH, scope: 'VERIFY_ONLY' } as unknown as AuthenticatedKey;
      await expect(controller.report(verifyOnlyAuth, 'agt_1', REPORT_DTO)).rejects.toThrow(ForbiddenException);
    });

    it('delegates to bate.ingestSignal when ownership check passes', async () => {
      const service = makeService();
      const controller = await buildController(service, makePrisma(true));
      await controller.report(AUTH, 'agt_1', REPORT_DTO);
      expect(service.ingestSignal).toHaveBeenCalledTimes(1);
    });

    it('passes agentId to ingestSignal', async () => {
      const service = makeService();
      const controller = await buildController(service, makePrisma(true));
      await controller.report(AUTH, 'agt_1', REPORT_DTO);
      expect(service.ingestSignal).toHaveBeenCalledWith(
        expect.objectContaining({ agentId: 'agt_1' }),
      );
    });

    it('maps eventType fraud_confirmed → RELYING_PARTY_FRAUD_REPORT signal', async () => {
      const service = makeService();
      const controller = await buildController(service, makePrisma(true));
      await controller.report(AUTH, 'agt_1', { ...REPORT_DTO, eventType: 'fraud_confirmed' });
      expect(service.ingestSignal).toHaveBeenCalledWith(
        expect.objectContaining({ signalType: 'RELYING_PARTY_FRAUD_REPORT' }),
      );
    });

    it('maps eventType false_positive → CLEAN_TRANSACTION signal', async () => {
      const service = makeService();
      const controller = await buildController(service, makePrisma(true));
      await controller.report(AUTH, 'agt_1', { ...REPORT_DTO, eventType: 'false_positive' });
      expect(service.ingestSignal).toHaveBeenCalledWith(
        expect.objectContaining({ signalType: 'CLEAN_TRANSACTION' }),
      );
    });

    it('maps severity high → HIGH SignalSeverity', async () => {
      const service = makeService();
      const controller = await buildController(service, makePrisma(true));
      await controller.report(AUTH, 'agt_1', { ...REPORT_DTO, severity: 'high' });
      expect(service.ingestSignal).toHaveBeenCalledWith(
        expect.objectContaining({ severity: 'HIGH' }),
      );
    });

    it('defaults severity to MEDIUM when not provided', async () => {
      const service = makeService();
      const controller = await buildController(service, makePrisma(true));
      const dto = { eventType: 'anomaly' as const };  // no severity
      await controller.report(AUTH, 'agt_1', dto);
      expect(service.ingestSignal).toHaveBeenCalledWith(
        expect.objectContaining({ severity: 'MEDIUM' }),
      );
    });

    it('scopes source to the principal (multi-tenant isolation)', async () => {
      const service = makeService();
      const controller = await buildController(service, makePrisma(true));
      await controller.report(AUTH, 'agt_1', REPORT_DTO);
      expect(service.ingestSignal).toHaveBeenCalledWith(
        expect.objectContaining({ source: 'principal:prn_A' }),
      );
    });

    it('returns { accepted: true }', async () => {
      const controller = await buildController(makeService(), makePrisma(true));
      const result = await controller.report(AUTH, 'agt_1', REPORT_DTO);
      expect(result).toEqual({ accepted: true });
    });
  });
});
