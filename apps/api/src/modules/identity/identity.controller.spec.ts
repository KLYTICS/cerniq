/**
 * IdentityController — unit tests
 *
 * The controller is a thin delegate: every method forwards to IdentityService
 * with the principalId extracted from the auth context. Tests verify:
 *   - register / list / findOne / revoke / issueChallenge / verifyHandshake
 *     all receive auth.principalId (not body-supplied data)
 *   - publicStatus (public route) receives only the agentId param
 */

import { Test } from '@nestjs/testing';

import type { AuthenticatedKey } from '../auth/api-key.service';

import { IdentityController } from './identity.controller';
import type { RegisterAgentDto } from './identity.dto';
import { IdentityService } from './identity.service';

// ── Auth stub ─────────────────────────────────────────────────────────────────

const AUTH = { principalId: 'prn_A', apiKeyId: 'key_1', plan: 'DEVELOPER' } as unknown as AuthenticatedKey;

// ── Service stub ──────────────────────────────────────────────────────────────

function makeService(): jest.Mocked<IdentityService> {
  return {
    register: jest.fn().mockResolvedValue({ agentId: 'agt_1' }),
    list: jest.fn().mockResolvedValue({ agents: [], nextCursor: null, count: 0 }),
    findOne: jest.fn().mockResolvedValue({ agentId: 'agt_1' }),
    revoke: jest.fn().mockResolvedValue(undefined),
    issueChallenge: jest.fn().mockResolvedValue({ challenge: 'hex_challenge', expiresAt: '' }),
    verifyHandshake: jest.fn().mockResolvedValue({ success: true }),
    publicStatus: jest.fn().mockResolvedValue({ agentId: 'agt_1', status: 'ACTIVE', trustBand: 'VERIFIED' }),
  } as unknown as jest.Mocked<IdentityService>;
}

async function buildController(service: jest.Mocked<IdentityService>) {
  const module = await Test.createTestingModule({
    controllers: [IdentityController],
    providers: [{ provide: IdentityService, useValue: service }],
  }).compile();
  return module.get(IdentityController);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('IdentityController', () => {
  let service: jest.Mocked<IdentityService>;
  let controller: IdentityController;

  beforeEach(async () => {
    service = makeService();
    controller = await buildController(service);
  });

  describe('register()', () => {
    it('delegates to identity.register with auth.principalId', async () => {
      const dto = { name: 'test-agent', publicKey: 'abc' } as unknown as RegisterAgentDto;
      await controller.register(AUTH, dto);
      expect(service.register).toHaveBeenCalledWith('prn_A', dto);
    });

    it('returns the service result unchanged', async () => {
      const dto = { name: 'x', publicKey: 'y' } as unknown as RegisterAgentDto;
      const result = await controller.register(AUTH, dto);
      expect(result).toBeDefined();
    });
  });

  describe('list()', () => {
    it('delegates to identity.list with auth.principalId and query', async () => {
      const query = { limit: 10 };
      await controller.list(AUTH, query);
      expect(service.list).toHaveBeenCalledWith('prn_A', query);
    });
  });

  describe('findOne()', () => {
    it('delegates to identity.findOne with auth.principalId and agentId', async () => {
      await controller.findOne(AUTH, 'agt_1');
      expect(service.findOne).toHaveBeenCalledWith('prn_A', 'agt_1');
    });
  });

  describe('revoke()', () => {
    it('delegates to identity.revoke with auth.principalId + agentId + apiKeyId (no body)', async () => {
      await controller.revoke(AUTH, 'agt_1');
      expect(service.revoke).toHaveBeenCalledWith('prn_A', 'agt_1', undefined, 'key_1');
    });

    it('forwards body.reason to identity.revoke for audit capture (OD-024 Phase A2)', async () => {
      await controller.revoke(AUTH, 'agt_1', { reason: 'compromised key' });
      expect(service.revoke).toHaveBeenCalledWith('prn_A', 'agt_1', 'compromised key', 'key_1');
    });

    it('forwards auth.apiKeyId as revokedBy (OD-024 Phase A6 — SOC2 "who did this")', async () => {
      const operatorAuth = { ...AUTH, apiKeyId: 'key_operator_42' } as typeof AUTH;
      await controller.revoke(operatorAuth, 'agt_1', { reason: 'rotation' });
      expect(service.revoke).toHaveBeenCalledWith(
        'prn_A',
        'agt_1',
        'rotation',
        'key_operator_42',
      );
    });
  });

  describe('issueChallenge()', () => {
    it('delegates to identity.issueChallenge with auth.principalId and agentId', async () => {
      await controller.issueChallenge(AUTH, 'agt_1');
      expect(service.issueChallenge).toHaveBeenCalledWith('prn_A', 'agt_1');
    });
  });

  describe('verifyHandshake()', () => {
    it('delegates to identity.verifyHandshake with auth.principalId, agentId, and signature', async () => {
      const dto = { signature: 'hex_sig' };
      await controller.verifyHandshake(AUTH, 'agt_1', dto);
      expect(service.verifyHandshake).toHaveBeenCalledWith('prn_A', 'agt_1', 'hex_sig');
    });
  });

  describe('status() — public route', () => {
    it('delegates to identity.publicStatus with agentId (no auth required)', async () => {
      await controller.status('agt_1');
      expect(service.publicStatus).toHaveBeenCalledWith('agt_1');
    });

    it('does NOT use auth context', async () => {
      // publicStatus takes only agentId — no principalId
      await controller.status('agt_public');
      expect(service.publicStatus).toHaveBeenCalledWith('agt_public');
      expect(service.publicStatus).not.toHaveBeenCalledWith(expect.anything(), expect.anything());
    });
  });

  it('each invocation calls the service exactly once', async () => {
    await controller.register(AUTH, { name: 'x', publicKey: 'y' } as unknown as RegisterAgentDto);
    await controller.list(AUTH, {});
    await controller.findOne(AUTH, 'agt_x');
    await controller.revoke(AUTH, 'agt_x');
    expect(service.register).toHaveBeenCalledTimes(1);
    expect(service.list).toHaveBeenCalledTimes(1);
    expect(service.findOne).toHaveBeenCalledTimes(1);
    expect(service.revoke).toHaveBeenCalledTimes(1);
  });
});
