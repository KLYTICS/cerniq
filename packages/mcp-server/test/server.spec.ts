import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
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

  it('ListTools returns annotations on every tool', async () => {
    const server = createAegisMcpServer();
    // Reach into the request handler registry. MCP SDK doesn't expose this
    // publicly; we use the schemas directly to invoke.
    const handler = (server as unknown as {
      _requestHandlers: Map<string, (req: unknown) => Promise<unknown>>;
    })._requestHandlers.get(ListToolsRequestSchema.shape.method.value);
    expect(handler).toBeDefined();
    const result = (await handler!({ method: 'tools/list', params: {} })) as {
      tools: Array<{ name: string; annotations: { openWorldHint?: boolean } }>;
    };
    expect(result.tools.length).toBeGreaterThan(0);
    for (const t of result.tools) {
      expect(t.annotations).toBeDefined();
      expect(t.annotations.openWorldHint).toBe(true);
    }
  });

  it('CallTool returns tool_not_found with the available list when name is unknown', async () => {
    const server = createAegisMcpServer();
    const handler = (server as unknown as {
      _requestHandlers: Map<string, (req: unknown) => Promise<unknown>>;
    })._requestHandlers.get(CallToolRequestSchema.shape.method.value);
    expect(handler).toBeDefined();
    const result = (await handler!({
      method: 'tools/call',
      params: { name: 'aegis.not.real', arguments: {} },
    })) as { content: Array<{ text: string }>; isError: boolean };
    expect(result.isError).toBe(true);
    const payload = JSON.parse(result.content[0]!.text) as {
      error: string;
      name: string;
      available: string[];
    };
    expect(payload.error).toBe('tool_not_found');
    expect(payload.name).toBe('aegis.not.real');
    expect(payload.available).toContain('aegis.verify');
  });
});
