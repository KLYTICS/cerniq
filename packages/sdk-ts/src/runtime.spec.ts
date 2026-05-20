import { detectRuntime, capabilities } from './runtime.js';

describe('detectRuntime', () => {
  it('returns "node" in the jest test process', () => {
    // Jest runs under Node; this is the default detection branch.
    expect(detectRuntime()).toBe('node');
  });

  it('returns one of the known runtime literals', () => {
    const KNOWN = new Set([
      'cloudflare-workers',
      'deno',
      'bun',
      'edge',
      'node',
      'browser',
      'unknown',
    ]);
    expect(KNOWN.has(detectRuntime())).toBe(true);
  });
});

describe('capabilities', () => {
  it('node runtime: hasFilesystem + hasFetch + hasWebCrypto', () => {
    const c = capabilities();
    expect(c.runtime).toBe('node');
    expect(c.hasFilesystem).toBe(true);
    expect(c.hasFetch).toBe(true);
    expect(c.hasWebCrypto).toBe(true);
    expect(c.hasBrowserStorage).toBe(false);
  });
});
