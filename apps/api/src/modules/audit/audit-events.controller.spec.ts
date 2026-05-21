/**
 * AuditEventsController — unit tests
 *
 * Tenant-wide NDJSON export (CLAUDE.md invariant #5 — scoped by principalId).
 * Controller delegates to AuditService.exportTenantStream and streams rows
 * via res.write / res.end.
 */

import { Test } from '@nestjs/testing';
import type { Response } from 'express';

import type { AuthenticatedKey } from '../auth/api-key.service';

import { AuditEventsController } from './audit-events.controller';
import type { AuditQueryDto } from './audit.dto';
import { AuditService } from './audit.service';


// ── Stubs ─────────────────────────────────────────────────────────────────────

const AUTH = { principalId: 'prn_A', apiKeyId: 'key_1' } as unknown as AuthenticatedKey;

function makeAuditService(events: object[] = []): jest.Mocked<Pick<AuditService, 'exportTenantStream'>> {
  async function* gen() {
    for (const e of events) yield e;
  }
  return {
    exportTenantStream: jest.fn().mockReturnValue(gen()),
  };
}

function makeRes(): jest.Mocked<Response> {
  return {
    setHeader: jest.fn(),
    write: jest.fn().mockReturnValue(true),
    end: jest.fn(),
    once: jest.fn(),
  } as unknown as jest.Mocked<Response>;
}

async function buildController(service: ReturnType<typeof makeAuditService>) {
  const module = await Test.createTestingModule({
    controllers: [AuditEventsController],
    providers: [{ provide: AuditService, useValue: service }],
  }).compile();
  return module.get(AuditEventsController);
}

const QUERY: AuditQueryDto = { limit: 50 };

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AuditEventsController', () => {
  describe('exportNdjson()', () => {
    it('calls exportTenantStream with auth.principalId and query', async () => {
      const service = makeAuditService();
      const controller = await buildController(service);
      const res = makeRes();
      await controller.exportNdjson(AUTH, QUERY, res);
      expect(service.exportTenantStream).toHaveBeenCalledWith('prn_A', QUERY);
    });

    it('sets Content-Type to application/x-ndjson', async () => {
      const service = makeAuditService();
      const controller = await buildController(service);
      const res = makeRes();
      await controller.exportNdjson(AUTH, QUERY, res);
      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/x-ndjson');
    });

    it('sets a Content-Disposition attachment filename containing principalId', async () => {
      const service = makeAuditService();
      const controller = await buildController(service);
      const res = makeRes();
      await controller.exportNdjson(AUTH, QUERY, res);
      const dispositionCall = (res.setHeader as jest.Mock).mock.calls.find(
        (c) => c[0] === 'Content-Disposition',
      );
      expect(dispositionCall).toBeDefined();
      expect(dispositionCall?.[1]).toContain('prn_A');
      expect(dispositionCall?.[1]).toContain('.ndjson');
    });

    it('writes one NDJSON line per event', async () => {
      const events = [{ eventId: 'e1' }, { eventId: 'e2' }, { eventId: 'e3' }];
      const service = makeAuditService(events);
      const controller = await buildController(service);
      const res = makeRes();
      await controller.exportNdjson(AUTH, QUERY, res);
      expect(res.write).toHaveBeenCalledTimes(3);
    });

    it('calls res.end() exactly once after streaming', async () => {
      const service = makeAuditService([{ eventId: 'e1' }]);
      const controller = await buildController(service);
      const res = makeRes();
      await controller.exportNdjson(AUTH, QUERY, res);
      expect(res.end).toHaveBeenCalledTimes(1);
    });

    it('calls res.end() even when the stream is empty', async () => {
      const service = makeAuditService([]);
      const controller = await buildController(service);
      const res = makeRes();
      await controller.exportNdjson(AUTH, QUERY, res);
      expect(res.end).toHaveBeenCalledTimes(1);
    });

    it('isolates by principalId — different principals call stream with their own id', async () => {
      // Two separate requests from two principals
      const svcA = makeAuditService();
      const ctrlA = await buildController(svcA);
      const svcB = makeAuditService();
      const ctrlB = await buildController(svcB);

      const authB = { principalId: 'prn_B' } as AuthenticatedKey;
      await ctrlA.exportNdjson(AUTH, QUERY, makeRes());
      await ctrlB.exportNdjson(authB, QUERY, makeRes());

      expect(svcA.exportTenantStream).toHaveBeenCalledWith('prn_A', QUERY);
      expect(svcB.exportTenantStream).toHaveBeenCalledWith('prn_B', QUERY);
    });
  });
});
