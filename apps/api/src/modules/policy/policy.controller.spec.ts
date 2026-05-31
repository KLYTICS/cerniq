/**
 * PolicyController — unit tests
 *
 * Thin delegate: each method forwards principalId from auth context + route
 * params to PolicyService. Tests prove the mapping is correct and that the
 * service result is returned unchanged.
 */

import { Test } from '@nestjs/testing';

import type { AuthenticatedKey } from '../auth/api-key.service';

import { PolicyController } from './policy.controller';
import type { CreatePolicyDto } from './policy.dto';
import { ScopeCategory } from './policy.dto';
import { PolicyService } from './policy.service';

const AUTH = { principalId: 'prn_A', apiKeyId: 'key_1' } as unknown as AuthenticatedKey;

const CREATE_DTO: CreatePolicyDto = {
  scopes: [{ category: ScopeCategory.COMMERCE }],
  expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  label: 'Test',
};

function makeService(): jest.Mocked<PolicyService> {
  return {
    create: jest.fn().mockResolvedValue({ policyId: 'pol_1', signedToken: 'jwt', expiresAt: '' }),
    list: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue({ policyId: 'pol_1', agentId: 'agt_1' }),
    revoke: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<PolicyService>;
}

async function buildController(service: jest.Mocked<PolicyService>) {
  const module = await Test.createTestingModule({
    controllers: [PolicyController],
    providers: [{ provide: PolicyService, useValue: service }],
  }).compile();
  return module.get(PolicyController);
}

describe('PolicyController', () => {
  let service: jest.Mocked<PolicyService>;
  let controller: PolicyController;

  beforeEach(async () => {
    service = makeService();
    controller = await buildController(service);
  });

  describe('create()', () => {
    it('delegates to policy.create with auth.principalId, agentId, and dto', async () => {
      await controller.create(AUTH, 'agt_1', CREATE_DTO);
      expect(service.create).toHaveBeenCalledWith('prn_A', 'agt_1', CREATE_DTO);
    });

    it('returns the service result unchanged', async () => {
      const result = await controller.create(AUTH, 'agt_1', CREATE_DTO);
      expect(result).toBeDefined();
      expect((result as { policyId: string }).policyId).toBe('pol_1');
    });
  });

  describe('list()', () => {
    it('delegates to policy.list with auth.principalId, agentId, and unfiltered query', async () => {
      await controller.list(AUTH, 'agt_1', {});
      expect(service.list).toHaveBeenCalledWith('prn_A', 'agt_1', { status: undefined });
    });

    it('forwards the status filter to policy.list (OD-024 Phase A3)', async () => {
      await controller.list(AUTH, 'agt_1', { status: 'REVOKED' } as never);
      expect(service.list).toHaveBeenCalledWith('prn_A', 'agt_1', { status: 'REVOKED' });
    });
  });

  describe('findOne()', () => {
    it('delegates to policy.findOne with auth.principalId, agentId, and policyId', async () => {
      await controller.findOne(AUTH, 'agt_1', 'pol_x');
      expect(service.findOne).toHaveBeenCalledWith('prn_A', 'agt_1', 'pol_x');
    });
  });

  describe('revoke()', () => {
    it('delegates to policy.revoke with auth.principalId + agentId + policyId + apiKeyId (no body)', async () => {
      await controller.revoke(AUTH, 'agt_1', 'pol_active');
      expect(service.revoke).toHaveBeenCalledWith(
        'prn_A',
        'agt_1',
        'pol_active',
        undefined,
        'key_1',
      );
    });

    it('forwards body.reason for audit capture (OD-024 Phase A2)', async () => {
      await controller.revoke(AUTH, 'agt_1', 'pol_x', { reason: 'rotation' });
      expect(service.revoke).toHaveBeenCalledWith(
        'prn_A',
        'agt_1',
        'pol_x',
        'rotation',
        'key_1',
      );
    });

    it('forwards auth.apiKeyId as revokedBy (OD-024 Phase A6 — SOC2 "who did this")', async () => {
      const operatorAuth = { ...AUTH, apiKeyId: 'key_operator_42' };
      await controller.revoke(operatorAuth, 'agt_1', 'pol_x', { reason: 'rotation' });
      expect(service.revoke).toHaveBeenCalledWith(
        'prn_A',
        'agt_1',
        'pol_x',
        'rotation',
        'key_operator_42',
      );
    });

    it('returns void (204 No Content)', async () => {
      const result = await controller.revoke(AUTH, 'agt_1', 'pol_x');
      expect(result).toBeUndefined();
    });
  });

  it('auth.principalId isolation — different principals call service with their own id', async () => {
    const authA = { ...AUTH, principalId: 'prn_A' };
    const authB = { ...AUTH, principalId: 'prn_B' };
    await controller.list(authA, 'agt_1', {});
    await controller.list(authB, 'agt_1', {});
    expect(service.list).toHaveBeenNthCalledWith(1, 'prn_A', 'agt_1', { status: undefined });
    expect(service.list).toHaveBeenNthCalledWith(2, 'prn_B', 'agt_1', { status: undefined });
  });
});
