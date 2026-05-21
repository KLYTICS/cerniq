/**
 * AuditController — unit tests
 *
 * Coverage:
 *   list()         — delegates auth.principalId + agentId + query to AuditService.list
 *   exportNdjson() — iterates AuditService.exportStream, writes NDJSON lines
 *                    to res, ends the response
 */

import { Test } from '@nestjs/testing';
import type { Response } from 'express';

import type { AuthenticatedKey } from '../auth/api-key.service';

import { AuditController } from './audit.controller';
import type { AuditQueryDto } from './audit.dto';
import { AuditService } from './audit.service';


// ── Stubs ─────────────────────────────────────────────────────────────────────

const AUTH = { principalId: 'prn_A', apiKeyId: 'key_1' } as unknown as AuthenticatedKey;

function makeAuditService(events: object[] = []): jest.Mocked<Pick<AuditService, 'list' | 'exportStream'>> {
  async function* gen() {
    for (const e of events) yield e;
  }
  return {
    list: jest.fn().mockResolvedValue({ events: [], nextCursor: null, count: 0 }),
    exportStream: jest.fn().mockReturnValue(gen()),
  };
}

function makeRes(): jest.Mocked<Response> {
  return {
    setHeader: jest.fn(),
    write: jest.fn().mockReturnValue(true),  // returning true = no backpressure
    end: jest.fn(),
    once: jest.fn(),
  } as unknown as jest.Mocked<Response>;
}

async function buildController(service: ReturnType<typeof makeAuditService>) {
  const module = await Test.createTestingModule({
    controllers: [AuditController],
    providers: [{ provide: AuditService, useValue: service }],
  }).compile();
  return module.get(AuditController);
}

const QUERY: AuditQueryDto = { limit: 10 };

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AuditController', () => {
  let service: ReturnType<typeof makeAuditService>;
  let controller: AuditController;

  beforeEach(async () => {
    service = makeAuditService();
    controller = await buildController(service);
  });

  describe('list()', () => {
    it('delegates to audit.list with auth.principalId, agentId, and query', async () => {
      await controller.list(AUTH, 'agt_1', QUERY);
      expect(service.list).toHaveBeenCalledWith('prn_A', 'agt_1', QUERY);
    });

    it('returns the service result unchanged', async () => {
      const result = await controller.list(AUTH, 'agt_1', QUERY);
      expect(result).toMatchObject({ events: [], nextCursor: null, count: 0 });
    });

    it('auth isolation — principalId comes from auth, not from params', async () => {
      const authB = { ...AUTH, principalId: 'prn_B' };
      await controller.list(authB, 'agt_1', QUERY);
      expect(service.list).toHaveBeenCalledWith('prn_B', 'agt_1', QUERY);
    });
  });

  describe('exportNdjson()', () => {
    it('calls exportStream with auth.principalId, agentId, and query', async () => {
      const res = makeRes();
      await controller.exportNdjson(AUTH, 'agt_1', QUERY, res);
      expect(service.exportStream).toHaveBeenCalledWith('prn_A', 'agt_1', QUERY);
    });

    it('sets the NDJSON content-type header', async () => {
      const res = makeRes();
      await controller.exportNdjson(AUTH, 'agt_1', QUERY, res);
      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/x-ndjson');
    });

    it('calls res.end() after streaming all rows', async () => {
      const svcWithRows = makeAuditService([{ eventId: 'evt_1' }, { eventId: 'evt_2' }]);
      const ctrl = await buildController(svcWithRows);
      const res = makeRes();
      await ctrl.exportNdjson(AUTH, 'agt_1', QUERY, res);
      expect(res.end).toHaveBeenCalledTimes(1);
    });

    it('writes one NDJSON line per event', async () => {
      const svcWithRows = makeAuditService([{ eventId: 'evt_1' }, { eventId: 'evt_2' }]);
      const ctrl = await buildController(svcWithRows);
      const res = makeRes();
      await ctrl.exportNdjson(AUTH, 'agt_1', QUERY, res);
      expect(res.write).toHaveBeenCalledTimes(2);
    });

    it('writes valid JSON + newline for each event', async () => {
      const event = { eventId: 'evt_x', decision: 'APPROVED' };
      const svcWithRows = makeAuditService([event]);
      const ctrl = await buildController(svcWithRows);
      const res = makeRes();
      await ctrl.exportNdjson(AUTH, 'agt_1', QUERY, res);
      const written = (res.write as jest.Mock).mock.calls[0]?.[0] as string;
      expect(written).toBe(`${JSON.stringify(event)}\n`);
    });

    it('calls res.end() even when stream is empty', async () => {
      const res = makeRes();
      await controller.exportNdjson(AUTH, 'agt_1', QUERY, res);
      expect(res.end).toHaveBeenCalledTimes(1);
    });
  });
});
