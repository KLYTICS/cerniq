import type { Request } from 'express';

import { AlreadyRotatedError, AuthenticationError, AuthorizationError } from '../../common/errors/okoro-error';

import { ApiKeyRotationController } from './api-key-rotation.controller';
import type { ApiKeyService } from './api-key.service';
import type { AuthenticatedKey, RotateResult } from './api-key.service';

/**
 * Unit tests for ApiKeyRotationController. Direct construction (no
 * NestJS TestingModule) because the controller is a thin adapter — all
 * meaningful logic lives in ApiKeyService.rotate(), which has its own
 * spec. We verify:
 *   - happy path response shape (single-use plaintext)
 *   - guard contract (req.auth missing → AuthenticationError)
 *   - error propagation (AlreadyRotatedError → caller)
 *   - principal scoping (defence-in-depth pre-check)
 */

const FIXED_NOW = new Date('2026-05-05T12:00:00.000Z');

function buildAuth(overrides: Partial<AuthenticatedKey> = {}): AuthenticatedKey {
  return { apiKeyId: 'ak_old', principalId: 'p_alice', scope: 'FULL', ...overrides };
}

function buildReq(auth: AuthenticatedKey | undefined): Request {
  return { auth } as unknown as Request;
}

interface RotateMock {
  rotate: jest.Mock<Promise<RotateResult>, [string, string, number]>;
}

function buildSvc(impl: (callingId: string, principalId: string, hours: number) => Promise<RotateResult> | RotateResult): {
  controller: ApiKeyRotationController;
  svc: RotateMock;
} {
  const svc: RotateMock = {
    rotate: jest.fn(async (callingId, principalId, hours) => await impl(callingId, principalId, hours)),
  };
  const controller = new ApiKeyRotationController(svc as unknown as ApiKeyService);
  return { controller, svc };
}

describe('ApiKeyRotationController.rotate (happy path)', () => {
  it('returns new key + plaintext + 24h-from-now expiresAt for the OLD key', async () => {
    const oldExpiresAt = new Date(FIXED_NOW.getTime() + 24 * 60 * 60 * 1000);
    const { controller, svc } = buildSvc(async (callingId, principalId, hours) => {
      expect(callingId).toBe('ak_old');
      expect(principalId).toBe('p_alice');
      expect(hours).toBe(24);
      return {
        newKey: { id: 'ak_new', plaintext: 'okoro_sk_NEWKEYNEWKEYNEWKEYNEWKE', expiresAt: null },
        oldKey: { id: callingId, expiresAt: oldExpiresAt },
      };
    });

    const res = await controller.rotate(buildReq(buildAuth()));

    expect(res.id).toBe('ak_new');
    expect(res.key).toBe('okoro_sk_NEWKEYNEWKEYNEWKEYNEWKE');
    expect(res.expiresAt).toBe(''); // new key has no native expiry
    expect(res.oldKey.id).toBe('ak_old');
    expect(res.oldKey.expiresAt).toBe(oldExpiresAt.toISOString());
    expect(svc.rotate).toHaveBeenCalledTimes(1);
  });

  it('passes the calling key id from the guard to the service (no client-supplied id)', async () => {
    const { controller, svc } = buildSvc(async (callingId) => ({
      newKey: { id: 'ak_new', plaintext: 'okoro_sk_AAAAAAAAAAAAAAAAAAAAAAAAAA', expiresAt: null },
      oldKey: { id: callingId, expiresAt: new Date(FIXED_NOW.getTime() + 24 * 60 * 60 * 1000) },
    }));
    await controller.rotate(buildReq(buildAuth({ apiKeyId: 'ak_specific', principalId: 'p_bob' })));

    const call = svc.rotate.mock.calls[0];
    expect(call[0]).toBe('ak_specific'); // calling key id
    expect(call[1]).toBe('p_bob'); // principal id
    expect(call[2]).toBe(24); // overlapHours
  });
});

describe('ApiKeyRotationController.rotate (guard contract)', () => {
  it('throws AuthenticationError if req.auth is missing (guard misconfigured)', async () => {
    const { controller } = buildSvc(async () => {
      throw new Error('should not be called');
    });

    await expect(controller.rotate(buildReq(undefined))).rejects.toBeInstanceOf(AuthenticationError);
  });

  it('throws AuthorizationError if auth has no apiKeyId', async () => {
    const { controller } = buildSvc(async () => {
      throw new Error('should not be called');
    });

    await expect(
      controller.rotate(buildReq(buildAuth({ apiKeyId: '' as unknown as string }))),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});

describe('ApiKeyRotationController.rotate (error propagation)', () => {
  it('propagates AlreadyRotatedError (HTTP 409) when calling key is in overlap', async () => {
    const { controller } = buildSvc(async () => {
      throw new AlreadyRotatedError();
    });

    const err = await controller.rotate(buildReq(buildAuth())).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AlreadyRotatedError);
    expect((err as AlreadyRotatedError).getStatus()).toBe(409);
  });

  it('propagates AuthorizationError (cross-principal defence-in-depth)', async () => {
    const { controller } = buildSvc(async () => {
      throw new AuthorizationError('API key does not belong to the calling principal.');
    });

    await expect(controller.rotate(buildReq(buildAuth()))).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('cross-principal: principal A cannot rotate principal B s key — service rejects', async () => {
    // The guard puts auth.principalId on req. The service checks
    // calling.principalId against that principalId. We simulate a
    // mismatch as if the guard had been bypassed.
    const { controller, svc } = buildSvc(async (_callingId, principalId) => {
      // Service would reject because callingKey.principalId !== principalId.
      if (principalId === 'p_b') {
        throw new AuthorizationError('API key does not belong to the calling principal.');
      }
      return {
        newKey: { id: 'ak_new', plaintext: 'okoro_sk_AAAAAAAAAAAAAAAAAAAAAAAAAA', expiresAt: null },
        oldKey: { id: 'ak_old', expiresAt: new Date(FIXED_NOW.getTime() + 24 * 60 * 60 * 1000) },
      };
    });

    await expect(
      controller.rotate(buildReq(buildAuth({ principalId: 'p_b' }))),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(svc.rotate).toHaveBeenCalledWith('ak_old', 'p_b', 24);
  });
});

describe('ApiKeyRotationController.rotate (audit safety, indirect)', () => {
  it('does not leak plaintext through the response body for the OLD key', async () => {
    const { controller } = buildSvc(async () => ({
      newKey: { id: 'ak_new', plaintext: 'okoro_sk_PLAINTEXTPLAINTEXTPLAINTEX', expiresAt: null },
      oldKey: { id: 'ak_old', expiresAt: new Date(FIXED_NOW.getTime() + 24 * 60 * 60 * 1000) },
    }));

    const res = await controller.rotate(buildReq(buildAuth()));
    // The new-key plaintext IS returned — that's the point.
    expect(res.key).toMatch(/^okoro_(sk|vk)_/);
    // But the old-key block must NOT contain a plaintext field.
    expect(Object.keys(res.oldKey).sort()).toEqual(['expiresAt', 'id']);
    expect((res.oldKey as Record<string, unknown>).plaintext).toBeUndefined();
    expect((res.oldKey as Record<string, unknown>).key).toBeUndefined();
  });
});
