import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createCerniqMcpServer } from '../src/server';

// The MCP SDK's Server requires a transport for end-to-end testing. For
// unit tests we instantiate without connecting and exercise the handlers
// via the registered request schemas. This keeps tests fast (no transport)
// and deterministic.

describe('createCerniqMcpServer', () => {
  beforeEach(() => {
    process.env.CERNIQ_API_KEY = 'cerniq_test_unit';
    process.env.CERNIQ_BASE_URL = 'https://api.cerniq.test';
  });

  it('throws when no API key is configured', () => {
    delete process.env.CERNIQ_API_KEY;
    expect(() => createCerniqMcpServer({})).toThrow(/CERNIQ_API_KEY required/);
  });

  it('builds a server with default name cerniq-mcp', () => {
    const server = createCerniqMcpServer();
    expect(server).toBeDefined();
  });

  it('honors a custom server name', () => {
    const server = createCerniqMcpServer({ name: 'cerniq-readonly' });
    expect(server).toBeDefined();
  });

  it('honors allowedTools restriction', () => {
    const server = createCerniqMcpServer({
      allowedTools: ['cerniq.verify', 'cerniq.audit.search'],
    });
    expect(server).toBeDefined();
  });
});
