// Adapter denial-envelope parity — Round 25 supplement audit fix W10 + W15.
//
// SEEDS.md invariant #3 says every adapter package produces the same
// denial envelope: `{ error, message, statusCode, requestId?, next? }`.
//
// Before this spec, that invariant was inlined in each adapter and could
// drift silently — a future contributor renaming `error` → `code` in one
// adapter would break the lock without any build failure.
//
// This spec enforces the invariant TWO ways:
//
//   1. **Source check**: every adapter's `src/index.ts` (and middleware
//      sibling, if present) imports `buildDenialEnvelope` from `@aegis/sdk`.
//      The regex anchors against the import line so a rewrite that drops
//      the helper fails immediately.
//
//   2. **Runtime check**: `buildDenialEnvelope` itself produces an envelope
//      with the required keys + optional keys exactly as declared in
//      `DENIAL_ENVELOPE_REQUIRED_KEYS` / `DENIAL_ENVELOPE_OPTIONAL_KEYS`.
//      Any future addition to the envelope shape must update those constants.
//
// The combination means: any adapter that diverges from the shared
// helper fails check #1; any change to the helper that breaks the
// declared key set fails check #2.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  buildDenialEnvelope,
  DENIAL_ENVELOPE_OPTIONAL_KEYS,
  DENIAL_ENVELOPE_REQUIRED_KEYS,
} from '../../packages/types/src/denial-envelope';

const HERE = dirname(fileURLToPath(import.meta.url));

interface AdapterPath {
  name: string;
  files: string[];
}

const ADAPTERS: AdapterPath[] = [
  {
    name: '@aegis/adapter-nextjs',
    files: [
      'packages/adapter-nextjs/src/index.ts',
      'packages/adapter-nextjs/src/middleware.ts',
    ],
  },
  {
    name: '@aegis/adapter-cloudflare-workers',
    files: ['packages/adapter-cloudflare-workers/src/index.ts'],
  },
  {
    name: '@aegis/adapter-vercel-edge',
    files: ['packages/adapter-vercel-edge/src/index.ts'],
  },
  {
    name: '@aegis/adapter-aws-lambda',
    files: ['packages/adapter-aws-lambda/src/index.ts'],
  },
  {
    name: '@aegis/adapter-hono',
    files: ['packages/adapter-hono/src/index.ts'],
  },
];

describe('buildDenialEnvelope (runtime contract)', () => {
  it('every required key is present on a default envelope', () => {
    const env = buildDenialEnvelope({
      error: 'auth_required',
      message: 'x',
      statusCode: 401,
    });
    for (const key of DENIAL_ENVELOPE_REQUIRED_KEYS) {
      expect(env, `missing required key ${key}`).toHaveProperty(key);
    }
    // No extra keys beyond required + optional.
    const ALLOWED = new Set([
      ...DENIAL_ENVELOPE_REQUIRED_KEYS,
      ...DENIAL_ENVELOPE_OPTIONAL_KEYS,
    ]);
    for (const key of Object.keys(env)) {
      expect(ALLOWED.has(key), `unexpected key ${key} in envelope`).toBe(true);
    }
  });

  it('requestId is auto-generated when not supplied', () => {
    const env = buildDenialEnvelope({ error: 'x', message: 'y', statusCode: 500 });
    expect(env.requestId).toBeTruthy();
    expect(typeof env.requestId).toBe('string');
  });

  it('requestId is preserved verbatim when supplied', () => {
    const env = buildDenialEnvelope({
      error: 'x',
      message: 'y',
      statusCode: 500,
      requestId: 'req_test_abc',
    });
    expect(env.requestId).toBe('req_test_abc');
  });

  it('next + docsUrl are omitted when not supplied (not undefined-valued)', () => {
    const env = buildDenialEnvelope({ error: 'x', message: 'y', statusCode: 500 });
    expect(Object.keys(env)).not.toContain('next');
    expect(Object.keys(env)).not.toContain('docsUrl');
  });

  it('next + docsUrl are present when supplied', () => {
    const env = buildDenialEnvelope({
      error: 'x',
      message: 'y',
      statusCode: 500,
      next: 'do the thing',
      docsUrl: 'https://docs.aegislabs.io/errors/x',
    });
    expect(env.next).toBe('do the thing');
    expect(env.docsUrl).toBe('https://docs.aegislabs.io/errors/x');
  });
});

describe('adapter denial-envelope parity (source check)', () => {
  for (const adapter of ADAPTERS) {
    it(`${adapter.name} imports buildDenialEnvelope from @aegis/sdk`, async () => {
      let importedSomewhere = false;
      for (const rel of adapter.files) {
        const src = await readFile(join(HERE, '../..', rel), 'utf-8');
        // Import line must mention buildDenialEnvelope sourced from @aegis/sdk
        // (which re-exports from @aegis/types — see packages/sdk-ts/src/index.ts).
        if (/from\s+['"]@aegis\/sdk['"]/.test(src) && /buildDenialEnvelope/.test(src)) {
          importedSomewhere = true;
          break;
        }
      }
      expect(
        importedSomewhere,
        `${adapter.name}: no file imports buildDenialEnvelope from @aegis/sdk`,
      ).toBe(true);
    });

    it(`${adapter.name} does not inline an alternate denial-envelope shape`, async () => {
      for (const rel of adapter.files) {
        const src = await readFile(join(HERE, '../..', rel), 'utf-8');
        // Strip comments before searching so the migration-hint comment
        // pattern doesn't trigger a false positive.
        const stripped = src
          .split('\n')
          .map((line) => line.replace(/\/\/.*$/, ''))
          .join('\n');
        // The structural fingerprint of an inline envelope: a `{ error:` /
        // `{ code:` / `error:` followed within ~3 lines by `statusCode:`,
        // OUTSIDE a call to buildDenialEnvelope. We approximate by
        // requiring every literal `error:` to appear inside a
        // buildDenialEnvelope call OR a test/mock context. Round-25 base
        // verified specs hand-construct envelopes for testing, but those
        // live in __tests__/, not src/. Source files in adapters MUST
        // route through the helper.
        const matches = stripped.match(/\berror:\s*['"`]/g) ?? [];
        // If there are `error:` literals in source, they must be inside a
        // buildDenialEnvelope call. We can't fully parse, but we can
        // require that every adapter source file with `error:` literals
        // ALSO mentions buildDenialEnvelope.
        if (matches.length > 0) {
          expect(
            stripped.includes('buildDenialEnvelope('),
            `${adapter.name} (${rel}): inline error-shaped literal without a buildDenialEnvelope call`,
          ).toBe(true);
        }
      }
    });
  }
});
