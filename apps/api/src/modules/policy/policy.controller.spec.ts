/**
 * PolicyController — unit tests
 *
 * Thin delegate: each method forwards principalId from auth context + route
 * params to PolicyService. Tests prove the mapping is correct and that the
 * service result is returned unchanged.
 */

import { Test } from '@nestjs/testing';
import { PolicyController } from './policy.controller';
import { PolicyService } from './policy.service';
import type { AuthenticatedKey } from '../auth/api-key.service';
import type { CreatePolicyDto } from './policy.dto';
import { ScopeCategory } from './policy.dto';

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
    it('delegates to policy.list with auth.principalId and agentId', async () => {
      await controller.list(AUTH, 'agt_1');
      expect(service.list).toHaveBeenCalledWith('prn_A', 'agt_1');
    });
  });

  describe('revoke()', () => {
    it('delegates to policy.revoke with auth.principalId, agentId, and policyId', async () => {
      await controller.revoke(AUTH, 'agt_1', 'pol_active');
      expect(service.revoke).toHaveBeenCalledWith('prn_A', 'agt_1', 'pol_active');
    });

    it('returns void (204 No Content)', async () => {
      const result = await controller.revoke(AUTH, 'agt_1', 'pol_x');
      expect(result).toBeUndefined();
    });
  });

  it('auth.principalId isolation — different principals call service with their own id', async () => {
    const authA = { ...AUTH, principalId: 'prn_A' } as AuthenticatedKey;
    const authB = { ...AUTH, principalId: 'prn_B' } as AuthenticatedKey;
    await controller.list(authA, 'agt_1');
    await controller.list(authB, 'agt_1');
    expect(service.list).toHaveBeenNthCalledWith(1, 'prn_A', 'agt_1');
    expect(service.list).toHaveBeenNthCalledWith(2, 'prn_B', 'agt_1');
  });
});
