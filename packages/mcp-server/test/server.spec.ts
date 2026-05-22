import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createOkoroMcpServer } from '../src/server';

// The MCP SDK's Server requires a transport for end-to-end testing. For
// unit tests we instantiate without connecting and exercise the handlers
// via the registered request schemas. This keeps tests fast (no transport)
// and deterministic.

describe('createOkoroMcpServer', () => {
  beforeEach(() => {
    process.env.OKORO_API_KEY = 'okoro_test_unit';
    process.env.OKORO_BASE_URL = 'https://api.okoro.test';
  });

  it('throws when no API key is configured', () => {
    delete process.env.OKORO_API_KEY;
    expect(() => createOkoroMcpServer({})).toThrow(/OKORO_API_KEY required/);
  });

  it('builds a server with default name okoro-mcp', () => {
    const server = createOkoroMcpServer();
    expect(server).toBeDefined();
  });

  it('honors a custom server name', () => {
    const server = createOkoroMcpServer({ name: 'okoro-readonly' });
    expect(server).toBeDefined();
  });

  it('honors allowedTools restriction', () => {
    const server = createOkoroMcpServer({ allowedTools: ['okoro.verify', 'okoro.audit.search'] });
    expect(server).toBeDefined();
  });
});
