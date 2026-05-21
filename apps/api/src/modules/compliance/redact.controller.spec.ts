/**
 * RedactController — unit tests
 *
 * GDPR Art. 17 surface. Controller extracts principalId from req.principalId
 * (ApiKeyGuard contract) and delegates to RedactService.
 */

import type { Request } from 'express';

import { RedactController } from './redact.controller';
import type { RedactAuditByAgentDto, RedactAuditEventDto } from './redact.dto';
import type { RedactService } from './redact.service';

// ── Stubs ─────────────────────────────────────────────────────────────────────

function makeService(): jest.Mocked<Pick<RedactService, 'redactEvent' | 'redactByAgent'>> {
  return {
    redactEvent: jest.fn().mockResolvedValue({ eventId: 'evt_1', redactedFields: ['action'], redactionAuditId: 'evt_r' }),
    redactByAgent: jest.fn().mockResolvedValue({ agentId: 'agt_1', eventsRedacted: 5, metaEventId: 'evt_m' }),
  };
}

function makeReq(principalId?: string): Request {
  return { principalId } as unknown as Request;
}

const EVENT_DTO: RedactAuditEventDto = {
  eventId: 'evt_x',
  fields: ['action'],
  reason: 'gdpr-erasure',
} as unknown as RedactAuditEventDto;

const BY_AGENT_DTO: RedactAuditByAgentDto = {
  agentId: 'agt_1',
  fields: ['action', 'relyingParty'],
  reason: 'gdpr-erasure',
} as unknown as RedactAuditByAgentDto;

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('RedactController', () => {
  let service: jest.Mocked<Pick<RedactService, 'redactEvent' | 'redactByAgent'>>;
  let controller: RedactController;

  beforeEach(() => {
    service = makeService();
    controller = new RedactController(service as unknown as RedactService);
  });

  describe('redactEvent()', () => {
    it('delegates to redact.redactEvent with req.principalId and dto', async () => {
      await controller.redactEvent(makeReq('prn_A'), EVENT_DTO);
      expect(service.redactEvent).toHaveBeenCalledWith('prn_A', EVENT_DTO);
    });

    it('throws when req.principalId is missing (guard contract)', async () => {
      await expect(controller.redactEvent(makeReq(undefined), EVENT_DTO)).rejects.toThrow('principal_missing');
    });

    it('returns the service result', async () => {
      const result = await controller.redactEvent(makeReq('prn_A'), EVENT_DTO);
      expect((result as { eventId: string }).eventId).toBe('evt_1');
    });

    it('principalId isolation — prn_A cannot use prn_B credential', async () => {
      await controller.redactEvent(makeReq('prn_A'), EVENT_DTO);
      expect(service.redactEvent).toHaveBeenCalledWith('prn_A', EVENT_DTO);
      expect(service.redactEvent).not.toHaveBeenCalledWith('prn_B', EVENT_DTO);
    });
  });

  describe('redactByAgent()', () => {
    it('delegates to redact.redactByAgent with req.principalId and dto', async () => {
      await controller.redactByAgent(makeReq('prn_A'), BY_AGENT_DTO);
      expect(service.redactByAgent).toHaveBeenCalledWith('prn_A', BY_AGENT_DTO);
    });

    it('throws when req.principalId is missing', async () => {
      await expect(controller.redactByAgent(makeReq(undefined), BY_AGENT_DTO)).rejects.toThrow('principal_missing');
    });

    it('returns the service result', async () => {
      const result = await controller.redactByAgent(makeReq('prn_A'), BY_AGENT_DTO);
      expect((result as unknown as { eventsRedacted: number }).eventsRedacted).toBeDefined();
    });
  });
});
