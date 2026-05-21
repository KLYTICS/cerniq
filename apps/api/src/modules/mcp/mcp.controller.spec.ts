/**
 * McpController — unit tests
 *
 * Controller extracts principalId from req.principalId (set by ApiKeyGuard)
 * and delegates to McpService. Tests prove the mapping and guard contract.
 */

import type { Request } from 'express';

import { McpController } from './mcp.controller';
import type { RegisterMcpServerDto } from './mcp.dto';
import type { McpService } from './mcp.service';

// ── Stub factory ──────────────────────────────────────────────────────────────

function makeService(): jest.Mocked<McpService> {
  return {
    register: jest.fn().mockResolvedValue({ id: 'mcp_1', name: 'Test', status: 'ACTIVE' }),
    list: jest.fn().mockResolvedValue({ servers: [], total: 0 }),
    revoke: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<McpService>;
}

function makeReq(principalId?: string): Request {
  return { principalId } as unknown as Request;
}

const REGISTER_DTO: RegisterMcpServerDto = {
  name: 'My MCP Server',
  endpoint: 'https://mcp.example.com',
  transport: 'streamable-http',
  actionPrefix: 'mcp.myserver.',
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('McpController', () => {
  let service: jest.Mocked<McpService>;
  let controller: McpController;

  beforeEach(() => {
    service = makeService();
    controller = new McpController(service);
  });

  describe('register()', () => {
    it('delegates to mcp.register with req.principalId', async () => {
      await controller.register(makeReq('prn_A'), REGISTER_DTO);
      expect(service.register).toHaveBeenCalledWith('prn_A', REGISTER_DTO);
    });

    it('throws when req.principalId is missing (guard contract)', async () => {
      await expect(controller.register(makeReq(undefined), REGISTER_DTO)).rejects.toThrow('principal_missing');
    });

    it('returns the registered server DTO', async () => {
      const result = await controller.register(makeReq('prn_A'), REGISTER_DTO);
      expect((result as { id: string }).id).toBe('mcp_1');
    });
  });

  describe('list()', () => {
    it('delegates to mcp.list with req.principalId', async () => {
      await controller.list(makeReq('prn_A'));
      expect(service.list).toHaveBeenCalledWith('prn_A');
    });

    it('throws when req.principalId is missing', async () => {
      await expect(controller.list(makeReq(undefined))).rejects.toThrow('principal_missing');
    });
  });

  describe('revoke()', () => {
    it('delegates to mcp.revoke with req.principalId and id', async () => {
      await controller.revoke(makeReq('prn_A'), 'mcp_1');
      expect(service.revoke).toHaveBeenCalledWith('prn_A', 'mcp_1');
    });

    it('throws when req.principalId is missing', async () => {
      await expect(controller.revoke(makeReq(undefined), 'mcp_1')).rejects.toThrow('principal_missing');
    });
  });

  it('different principals call service with their own id', async () => {
    await controller.list(makeReq('prn_A'));
    await controller.list(makeReq('prn_B'));
    expect(service.list).toHaveBeenNthCalledWith(1, 'prn_A');
    expect(service.list).toHaveBeenNthCalledWith(2, 'prn_B');
  });
});
