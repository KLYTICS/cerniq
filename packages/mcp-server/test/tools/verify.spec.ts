import { describe, it, expect, vi } from 'vitest';
import { registerVerifyTool } from '../../src/tools/verify';
import type { ToolDefinition } from '../../src/tools/registry';

describe('cerniq.verify tool', () => {
  it('registers exactly one tool', () => {
    const cerniq = { verify: vi.fn() } as unknown as Parameters<typeof registerVerifyTool>[0];
    const reg = new Map<string, ToolDefinition>();
    registerVerifyTool(cerniq, reg);
    expect(reg.size).toBe(1);
    expect(reg.has('cerniq.verify')).toBe(true);
  });

  it('passes token and optional fields straight to cerniq.verify()', async () => {
    const verify = vi.fn(async () => ({ valid: true }));
    const cerniq = { verify } as unknown as Parameters<typeof registerVerifyTool>[0];
    const reg = new Map<string, ToolDefinition>();
    registerVerifyTool(cerniq, reg);
    const tool = reg.get('cerniq.verify')!;
    await tool.handler({
      token: 'abc.def.ghi',
      action: 'commerce.purchase',
      amount: 250,
      currency: 'USD',
    });
    expect(verify).toHaveBeenCalledWith('abc.def.ghi', {
      action: 'commerce.purchase',
      merchantDomain: undefined,
      amount: 250,
      currency: 'USD',
    });
  });

  it('inputSchema marks token as required', () => {
    const cerniq = { verify: vi.fn() } as unknown as Parameters<typeof registerVerifyTool>[0];
    const reg = new Map<string, ToolDefinition>();
    registerVerifyTool(cerniq, reg);
    expect(reg.get('cerniq.verify')!.inputSchema.required).toEqual(['token']);
  });
});
