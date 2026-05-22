// Unit tests for AdminController — direct construction (no NestJS
// TestingModule) because the controller is a thin adapter over
// PrismaService + ApiKeyService.
//
// Per root CLAUDE.md "Crypto, auth, billing, policy, audit, and
// tenant-boundary changes require paired tests in the same change."
// AdminController is a tenant-boundary-crossing surface — these tests
// lock the boundary behavior even though AdminGuard owns the auth
// check (which has its own spec at common/guards/admin.guard.spec.ts).

import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';

import { AdminController } from './admin.controller';
import type { ApiKeyService } from '../auth/api-key.service';
import type { PrismaService } from '../../common/prisma/prisma.service';

const FIXED_NOW = new Date('2026-05-21T20:00:00.000Z');

function buildPrisma(overrides: {
  principalFindUnique?: jest.Mock;
  principalCreate?: jest.Mock;
} = {}): PrismaService {
  return {
    principal: {
      findUnique: overrides.principalFindUnique ?? jest.fn(),
      create: overrides.principalCreate ?? jest.fn(),
    },
  } as unknown as PrismaService;
}

function buildApiKeys(issueImpl?: jest.Mock): ApiKeyService {
  return {
    issue: issueImpl ?? jest.fn(async (_principalId, _label, scope) => ({
      apiKeyId: 'ak_test_123',
      plaintextKey: `${scope === 'VERIFY_ONLY' ? 'aegis_vk_' : 'aegis_sk_'}testplaintext26charsabcdefg`,
      keyPrefix: scope === 'VERIFY_ONLY' ? 'aegis_vk_te' : 'aegis_sk_te',
    })),
  } as unknown as ApiKeyService;
}

describe('AdminController.createPrincipal', () => {
  describe('input validation', () => {
    it('rejects body without email', async () => {
      const controller = new AdminController(buildPrisma(), buildApiKeys());
      await expect(controller.createPrincipal({ name: 'no email' }))
        .rejects.toThrow(BadRequestException);
    });

    it('rejects body with invalid email shape', async () => {
      const controller = new AdminController(buildPrisma(), buildApiKeys());
      await expect(controller.createPrincipal({ email: 'not-an-email' }))
        .rejects.toThrow(BadRequestException);
    });

    it('rejects body with invalid planTier', async () => {
      const controller = new AdminController(buildPrisma(), buildApiKeys());
      await expect(controller.createPrincipal({ email: 'a@b.com', planTier: 'SCALE' }))
        .rejects.toThrow(BadRequestException);
    });

    it('rejects body with name over 100 chars', async () => {
      const controller = new AdminController(buildPrisma(), buildApiKeys());
      await expect(controller.createPrincipal({
        email: 'a@b.com',
        name: 'x'.repeat(101),
      })).rejects.toThrow(BadRequestException);
    });
  });

  describe('happy path', () => {
    it('creates principal with email + default planTier FREE', async () => {
      const principalCreate = jest.fn(async () => ({
        id: 'p_test_new',
        email: 'alice@example.com',
        planTier: 'FREE',
        createdAt: FIXED_NOW,
      }));
      const prisma = buildPrisma({
        principalFindUnique: jest.fn(async () => null),
        principalCreate,
      });
      const controller = new AdminController(prisma, buildApiKeys());

      const result = await controller.createPrincipal({ email: 'alice@example.com' });

      expect(result).toEqual({
        principalId: 'p_test_new',
        email: 'alice@example.com',
        planTier: 'FREE',
        createdAt: FIXED_NOW.toISOString(),
      });
      expect(principalCreate).toHaveBeenCalledWith({
        data: { email: 'alice@example.com', name: null, planTier: 'FREE' },
        select: { id: true, email: true, planTier: true, createdAt: true },
      });
    });

    it('creates principal with name + non-default planTier ENTERPRISE', async () => {
      const principalCreate = jest.fn(async () => ({
        id: 'p_test_ent',
        email: 'cfo@acme.com',
        planTier: 'ENTERPRISE',
        createdAt: FIXED_NOW,
      }));
      const prisma = buildPrisma({
        principalFindUnique: jest.fn(async () => null),
        principalCreate,
      });
      const controller = new AdminController(prisma, buildApiKeys());

      await controller.createPrincipal({
        email: 'cfo@acme.com',
        name: 'Acme Corp CFO',
        planTier: 'ENTERPRISE',
      });

      expect(principalCreate).toHaveBeenCalledWith({
        data: { email: 'cfo@acme.com', name: 'Acme Corp CFO', planTier: 'ENTERPRISE' },
        select: { id: true, email: true, planTier: true, createdAt: true },
      });
    });
  });

  describe('email-unique collision', () => {
    it('throws 409 with existing principalId when email already in use', async () => {
      const prisma = buildPrisma({
        principalFindUnique: jest.fn(async () => ({
          id: 'p_test_existing',
          email: 'taken@example.com',
          planTier: 'FREE',
          createdAt: FIXED_NOW,
        })),
        principalCreate: jest.fn(),
      });
      const controller = new AdminController(prisma, buildApiKeys());

      try {
        await controller.createPrincipal({ email: 'taken@example.com' });
        fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ConflictException);
        const response = (err as ConflictException).getResponse() as { error: string; principalId: string };
        expect(response.error).toBe('principal_exists');
        expect(response.principalId).toBe('p_test_existing');
      }
      expect(prisma.principal.create).not.toHaveBeenCalled();
    });
  });
});

describe('AdminController.issueApiKey', () => {
  describe('input validation', () => {
    it('rejects body with invalid scope value', async () => {
      const controller = new AdminController(buildPrisma(), buildApiKeys());
      await expect(controller.issueApiKey('p_test', { scope: 'ADMIN' }))
        .rejects.toThrow(BadRequestException);
    });

    it('rejects body with label over 120 chars', async () => {
      const controller = new AdminController(buildPrisma(), buildApiKeys());
      await expect(controller.issueApiKey('p_test', { label: 'x'.repeat(121) }))
        .rejects.toThrow(BadRequestException);
    });
  });

  describe('principal existence check', () => {
    it('throws 404 when principalId does not exist', async () => {
      const prisma = buildPrisma({
        principalFindUnique: jest.fn(async () => null),
      });
      const issue = jest.fn();
      const controller = new AdminController(prisma, buildApiKeys(issue));

      try {
        await controller.issueApiKey('p_does_not_exist', {});
        fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(NotFoundException);
        const response = (err as NotFoundException).getResponse() as { error: string };
        expect(response.error).toBe('principal_not_found');
      }
      expect(issue).not.toHaveBeenCalled();
    });
  });

  describe('happy path', () => {
    it('issues FULL-scope key with label', async () => {
      const prisma = buildPrisma({
        principalFindUnique: jest.fn(async () => ({ id: 'p_alice' })),
      });
      const issue = jest.fn(async () => ({
        apiKeyId: 'ak_test_new',
        plaintextKey: 'aegis_sk_abcdefghijklmnopqrstuvwxyz',
        keyPrefix: 'aegis_sk_ab',
      }));
      const controller = new AdminController(prisma, buildApiKeys(issue));

      const result = await controller.issueApiKey('p_alice', { label: 'acme-prod' });

      expect(issue).toHaveBeenCalledWith('p_alice', 'acme-prod', 'FULL');
      expect(result).toMatchObject({
        apiKeyId: 'ak_test_new',
        plaintextKey: 'aegis_sk_abcdefghijklmnopqrstuvwxyz',
        keyPrefix: 'aegis_sk_ab',
        principalId: 'p_alice',
        scope: 'FULL',
      });
      expect(result.issuedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('issues VERIFY_ONLY key when scope is specified', async () => {
      const prisma = buildPrisma({
        principalFindUnique: jest.fn(async () => ({ id: 'p_alice' })),
      });
      const issue = jest.fn(async () => ({
        apiKeyId: 'ak_test_vo',
        plaintextKey: 'aegis_vk_xyzdefghijklmnopqrstuvwxyz',
        keyPrefix: 'aegis_vk_xy',
      }));
      const controller = new AdminController(prisma, buildApiKeys(issue));

      const result = await controller.issueApiKey('p_alice', { scope: 'VERIFY_ONLY' });

      expect(issue).toHaveBeenCalledWith('p_alice', null, 'VERIFY_ONLY');
      expect(result.scope).toBe('VERIFY_ONLY');
    });

    it('defaults scope to FULL and label to null when omitted', async () => {
      const prisma = buildPrisma({
        principalFindUnique: jest.fn(async () => ({ id: 'p_alice' })),
      });
      const issue = jest.fn(async () => ({
        apiKeyId: 'ak',
        plaintextKey: 'aegis_sk_p',
        keyPrefix: 'aegis_sk_p',
      }));
      const controller = new AdminController(prisma, buildApiKeys(issue));

      await controller.issueApiKey('p_alice', {});
      expect(issue).toHaveBeenCalledWith('p_alice', null, 'FULL');
    });
  });

  describe('plaintext exposure boundary (regression guard)', () => {
    it('returns plaintextKey EXACTLY ONCE in the response (CLAUDE.md doctrine: never persisted in cleartext)', async () => {
      const prisma = buildPrisma({
        principalFindUnique: jest.fn(async () => ({ id: 'p_alice' })),
      });
      const issue = jest.fn(async () => ({
        apiKeyId: 'ak_unique',
        plaintextKey: 'aegis_sk_the_one_and_only_secret_abc',
        keyPrefix: 'aegis_sk_th',
      }));
      const controller = new AdminController(prisma, buildApiKeys(issue));

      const result = await controller.issueApiKey('p_alice', { label: 'audit-trail' });
      expect(result.plaintextKey).toBe('aegis_sk_the_one_and_only_secret_abc');
      // The controller is responsible for surfacing the plaintext in
      // the response body — the persistence (bcrypt-hash only) is
      // owned by ApiKeyService.issue. This test locks the wire-shape:
      // every field present, plaintext NOT echoed in any wrapper.
      expect(Object.keys(result).sort()).toEqual(
        ['apiKeyId', 'issuedAt', 'keyPrefix', 'plaintextKey', 'principalId', 'scope'].sort(),
      );
    });
  });
});
