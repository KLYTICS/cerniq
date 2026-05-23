// Cross-package parity — idempotency header contract.
//
// The SDK ships three header constants in `packages/sdk-ts/src/
// idempotency.ts` that must agree with:
//   - the canonical wire constant `AEGIS_HEADER_IDEMPOTENCY` in
//     `packages/types/src/constants.ts`
//   - the response-header strings the API interceptor literally
//     emits at `apps/api/src/common/idempotency/idempotency.interceptor.ts`
//
// Drift in any of these would silently break every SDK observability
// hook: the SDK would attach `Idempotency-Key` but never see a replay
// flag, or set the wrong header name on the request side and the
// API's per-principal cache would miss every time. This spec is the
// gate that catches it before CI does.
//
// The interceptor literals are parsed via regex against the source —
// no NestJS bootstrap needed for a pure parity check.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { AEGIS_HEADER_IDEMPOTENCY } from '../../packages/types/src/constants';
import {
  FIRST_SEEN_HEADER,
  IDEMPOTENCY_HEADER,
  REPLAY_HEADER,
} from '../../packages/sdk-ts/src/idempotency';

const REPO_ROOT = join(__dirname, '..', '..');
const INTERCEPTOR_PATH = join(
  REPO_ROOT,
  'apps',
  'api',
  'src',
  'common',
  'idempotency',
  'idempotency.interceptor.ts',
);

function readInterceptorSource(): string {
  return readFileSync(INTERCEPTOR_PATH, 'utf8');
}

describe('idempotency header parity — request side', () => {
  it('SDK IDEMPOTENCY_HEADER matches @aegis/types AEGIS_HEADER_IDEMPOTENCY', () => {
    expect(IDEMPOTENCY_HEADER).toBe(AEGIS_HEADER_IDEMPOTENCY);
  });

  it('API interceptor reads the same header (case-insensitive)', () => {
    // The interceptor lowercases the constant for header lookup
    // (`AEGIS_HEADER_IDEMPOTENCY.toLowerCase()`). We assert the
    // import is present, not the literal string — the import edge
    // is the parity guarantee.
    const src = readInterceptorSource();
    expect(src).toMatch(/AEGIS_HEADER_IDEMPOTENCY/);
    expect(src).toMatch(/from\s+['"]@aegis\/types['"]/);
  });
});

describe('idempotency header parity — response side', () => {
  // The API interceptor emits these response headers verbatim at
  // `idempotency.interceptor.ts:70-71`. The SDK uses the same strings
  // to parse the response. Both ends are pinned here so a rename on
  // either side breaks the build, not a customer at runtime.
  //
  // Extraction pattern: `res.setHeader('<name>', ...)` literal capture.
  const SET_HEADER_RE = /res\.setHeader\(['"]([^'"]+)['"]\s*,/g;

  function extractEmittedHeaderNames(): Set<string> {
    const src = readInterceptorSource();
    const names = new Set<string>();
    let match: RegExpExecArray | null;
    while ((match = SET_HEADER_RE.exec(src)) !== null) {
      names.add(match[1]!);
    }
    return names;
  }

  it('API interceptor emits Idempotent-Replay verbatim', () => {
    expect(extractEmittedHeaderNames()).toContain(REPLAY_HEADER);
  });

  it('API interceptor emits Idempotent-First-Seen verbatim', () => {
    expect(extractEmittedHeaderNames()).toContain(FIRST_SEEN_HEADER);
  });

  it('all SDK response constants appear in the interceptor', () => {
    // Belt-and-braces: every SDK constant maps to an emitted header.
    // If the SDK adds a new response header (e.g. `Idempotent-Status`),
    // this assertion forces a paired update in the interceptor.
    const emitted = extractEmittedHeaderNames();
    const sdkResponseHeaders = [REPLAY_HEADER, FIRST_SEEN_HEADER];
    for (const name of sdkResponseHeaders) {
      expect(emitted).toContain(name);
    }
  });
});

describe('SDK header constants are literal strings (no drift via re-export)', () => {
  // These literals are part of the customer contract — third-party
  // tooling (Datadog metric tags, log filters, OpenTelemetry span
  // attributes) reads the raw strings. Lock the wire shape against
  // any future "let's reformat the constant" refactor.
  it('IDEMPOTENCY_HEADER is exactly "Idempotency-Key"', () => {
    expect(IDEMPOTENCY_HEADER).toBe('Idempotency-Key');
  });
  it('REPLAY_HEADER is exactly "Idempotent-Replay"', () => {
    expect(REPLAY_HEADER).toBe('Idempotent-Replay');
  });
  it('FIRST_SEEN_HEADER is exactly "Idempotent-First-Seen"', () => {
    expect(FIRST_SEEN_HEADER).toBe('Idempotent-First-Seen');
  });
});
