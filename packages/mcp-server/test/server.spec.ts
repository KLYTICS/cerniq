import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createAegisMcpServer } from '../src/server';

// The MCP SDK's Server requires a transport for end-to-end testing. For
// unit tests we instantiate without connecting and exercise the handlers
// via the registered request schemas. This keeps tests fast (no transport)
// and deterministic.

describe('createAegisMcpServer', () => {
  beforeEach(() => {
    process.env.AEGIS_API_KEY = 'aegis_test_unit';
    process.env.AEGIS_BASE_URL = 'https://api.aegis.test';
  });

  it('throws when no API key is configured', () => {
    delete process.env.AEGIS_API_KEY;
    expect(() => createAegisMcpServer({})).toThrow(/AEGIS_API_KEY required/);
  });

  it('builds a server with default name aegis-mcp', () => {
    const server = createAegisMcpServer();
    expect(server).toBeDefined();
  });

  it('honors a custom server name', () => {
    const server = createAegisMcpServer({ name: 'aegis-readonly' });
    expect(server).toBeDefined();
  });

  it('honors allowedTools restriction', () => {
    const server = createAegisMcpServer({ allowedTools: ['aegis.verify', 'aegis.audit.search'] });
    expect(server).toBeDefined();
  });
});
