import { describe, it, expect, vi } from 'vitest';
import { registerVerifyTool } from '../../src/tools/verify';
import type { ToolDefinition } from '../../src/tools/registry';

describe('okoro.verify tool', () => {
  it('registers exactly one tool', () => {
    const okoro = { verify: vi.fn() } as unknown as Parameters<typeof registerVerifyTool>[0];
    const reg = new Map<string, ToolDefinition>();
    registerVerifyTool(okoro, reg);
    expect(reg.size).toBe(1);
    expect(reg.has('okoro.verify')).toBe(true);
  });

  it('passes token and optional fields straight to okoro.verify()', async () => {
    const verify = vi.fn(async () => ({ valid: true }));
    const okoro = { verify } as unknown as Parameters<typeof registerVerifyTool>[0];
    const reg = new Map<string, ToolDefinition>();
    registerVerifyTool(okoro, reg);
    const tool = reg.get('okoro.verify')!;
    await tool.handler({ token: 'abc.def.ghi', action: 'commerce.purchase', amount: 250, currency: 'USD' });
    expect(verify).toHaveBeenCalledWith('abc.def.ghi', {
      action: 'commerce.purchase',
      merchantDomain: undefined,
      amount: 250,
      currency: 'USD',
    });
  });

  it('inputSchema marks token as required', () => {
    const okoro = { verify: vi.fn() } as unknown as Parameters<typeof registerVerifyTool>[0];
    const reg = new Map<string, ToolDefinition>();
    registerVerifyTool(okoro, reg);
    expect(reg.get('okoro.verify')!.inputSchema.required).toEqual(['token']);
  });
});
