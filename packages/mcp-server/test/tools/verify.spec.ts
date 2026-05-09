import { describe, it, expect, vi } from 'vitest';
import { registerVerifyTool } from '../../src/tools/verify';
import type { ToolDefinition } from '../../src/tools/registry';

describe('aegis.verify tool', () => {
  it('registers exactly one tool', () => {
    const aegis = { verify: vi.fn() } as unknown as Parameters<typeof registerVerifyTool>[0];
    const reg = new Map<string, ToolDefinition>();
    registerVerifyTool(aegis, reg);
    expect(reg.size).toBe(1);
    expect(reg.has('aegis.verify')).toBe(true);
  });

  it('passes token and optional fields straight to aegis.verify()', async () => {
    const verify = vi.fn(async () => ({ valid: true }));
    const aegis = { verify } as unknown as Parameters<typeof registerVerifyTool>[0];
    const reg = new Map<string, ToolDefinition>();
    registerVerifyTool(aegis, reg);
    const tool = reg.get('aegis.verify')!;
    await tool.handler({ token: 'abc.def.ghi', action: 'commerce.purchase', amount: 250, currency: 'USD' });
    expect(verify).toHaveBeenCalledWith('abc.def.ghi', {
      action: 'commerce.purchase',
      merchantDomain: undefined,
      amount: 250,
      currency: 'USD',
    });
  });

  it('inputSchema marks token as required', () => {
    const aegis = { verify: vi.fn() } as unknown as Parameters<typeof registerVerifyTool>[0];
    const reg = new Map<string, ToolDefinition>();
    registerVerifyTool(aegis, reg);
    expect(reg.get('aegis.verify')!.inputSchema.required).toEqual(['token']);
  });
});
