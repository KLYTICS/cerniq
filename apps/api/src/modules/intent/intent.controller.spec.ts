import type { Request } from 'express';
import { IntentController } from './intent.controller';
import type { IntentService } from './intent.service';
import type { IdentityService } from '../identity/identity.service';
import { ValidationError } from '../../common/errors/aegis-error';

/**
 * Unit tests for IntentController. Direct construction (no NestJS
 * TestingModule) — the controller is a thin adapter and reconcile()
 * delegates real work to IntentService.reconcile(). We focus on the
 * controller-only contract that is easy to regress:
 *   - Idempotency-Key header parsing (Express returns string | string[]
 *     | undefined; array shape happens when a buggy proxy doubles the
 *     header, see apps/api/src/modules/intent/intent.controller.ts:108).
 *   - Missing header → ValidationError before service is touched.
 */

interface ReconcileMock {
  reconcile: jest.Mock<
    ReturnType<IntentService['reconcile']>,
    Parameters<IntentService['reconcile']>
  >;
}

function buildReq(opts: {
  principalId?: string;
  idempotencyHeader?: string | string[] | undefined;
}): Request {
  const headers: Record<string, string | string[]> = {};
  if (opts.idempotencyHeader !== undefined) {
    headers['idempotency-key'] = opts.idempotencyHeader;
  }
  return {
    principal: opts.principalId ? { id: opts.principalId } : undefined,
    headers,
    header: (name: string): string | string[] | undefined => {
      const v = headers[name.toLowerCase()];
      return v;
    },
  } as unknown as Request;
}

function buildController(): { controller: IntentController; svc: ReconcileMock } {
  const svc: ReconcileMock = {
    reconcile: jest.fn(async (_p, manifestId, _ik, actuals) => ({
      manifestId,
      actualCount: actuals.length,
      mismatches: [],
      recommendedDenialReason: null,
      idempotencyReplay: false,
    })),
  };
  const agents = {} as IdentityService;
  const controller = new IntentController(
    svc as unknown as IntentService,
    agents,
  );
  return { controller, svc };
}

const BODY = { actuals: [] };

describe('IntentController.reconcile (Idempotency-Key header)', () => {
  it('accepts a bare string header and forwards it to the service', async () => {
    const { controller, svc } = buildController();
    const req = buildReq({ principalId: 'p_alice', idempotencyHeader: 'idem-abc' });
    await controller.reconcile(req, 'mfst_1', BODY as never);
    expect(svc.reconcile).toHaveBeenCalledWith('p_alice', 'mfst_1', 'idem-abc', []);
  });

  it('resolves an array header to the first element (proxy-doubled header case)', async () => {
    const { controller, svc } = buildController();
    const req = buildReq({
      principalId: 'p_alice',
      idempotencyHeader: ['idem-first', 'idem-second'],
    });
    await controller.reconcile(req, 'mfst_1', BODY as never);
    expect(svc.reconcile).toHaveBeenCalledWith('p_alice', 'mfst_1', 'idem-first', []);
  });

  it('throws ValidationError if the header is missing entirely', async () => {
    const { controller, svc } = buildController();
    const req = buildReq({ principalId: 'p_alice', idempotencyHeader: undefined });
    await expect(controller.reconcile(req, 'mfst_1', BODY as never)).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(svc.reconcile).not.toHaveBeenCalled();
  });

  it('throws ValidationError if the header is an empty array', async () => {
    const { controller, svc } = buildController();
    const req = buildReq({ principalId: 'p_alice', idempotencyHeader: [] });
    await expect(controller.reconcile(req, 'mfst_1', BODY as never)).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(svc.reconcile).not.toHaveBeenCalled();
  });
});
