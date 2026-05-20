// Error-catalog `next` + `docsUrl` parity — Round 25 Lane C.
//
// Every error a junior developer can hit must come with a one-line
// actionable fix and a stable docs URL. This spec asserts:
//
//   1. Every entry in the source catalog has non-empty `next` and `docsUrl`.
//   2. The generated TS mirror carries both fields verbatim.
//   3. The generated Python mirror carries both fields verbatim.
//   4. `docsUrl` follows the canonical `https://docs.aegislabs.io/errors/<code>`
//      pattern so deep-linking is predictable.
//   5. `next` is imperative and ≤ 100 chars (style enforced — drift in copy
//      voice degrades the junior UX over time).
//
// The fail mode this guards against: a future contributor adds a new error
// class + entry to the catalog but forgets the `next` / `docsUrl` lines.
// Without this gate the SDK would surface `undefined` to the developer.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { ERROR_CATALOG } from '../../apps/api/src/common/errors/error-catalog';

const HERE = dirname(fileURLToPath(import.meta.url));
const TS_GENERATED_PATH = join(HERE, '../../packages/types/src/error-catalog.generated.ts');
const PY_GENERATED_PATH = join(HERE, '../../packages/sdk-py/aegis/error_catalog.py');

describe('error-catalog next + docsUrl', () => {
  it('every source entry has non-empty next', () => {
    for (const [name, entry] of Object.entries(ERROR_CATALOG)) {
      expect(
        typeof entry.next === 'string' && entry.next.length > 0,
        `entry ${name} missing or empty next`,
      ).toBe(true);
    }
  });

  it('every source entry has non-empty docsUrl', () => {
    for (const [name, entry] of Object.entries(ERROR_CATALOG)) {
      expect(
        typeof entry.docsUrl === 'string' && entry.docsUrl.length > 0,
        `entry ${name} missing or empty docsUrl`,
      ).toBe(true);
    }
  });

  it('docsUrl follows the canonical pattern https://docs.aegislabs.io/errors/<code>', () => {
    for (const [name, entry] of Object.entries(ERROR_CATALOG)) {
      expect(entry.docsUrl, `entry ${name}`).toBe(
        `https://docs.aegislabs.io/errors/${entry.code}`,
      );
    }
  });

  it('next is concise (<= 100 chars) so it fits a single terminal line', () => {
    for (const [name, entry] of Object.entries(ERROR_CATALOG)) {
      expect(
        entry.next.length,
        `entry ${name} next is ${entry.next.length} chars: ${entry.next}`,
      ).toBeLessThanOrEqual(100);
    }
  });

  it('next does not end with a period (chains with the customer message in UI)', () => {
    for (const [name, entry] of Object.entries(ERROR_CATALOG)) {
      expect(
        entry.next.endsWith('.'),
        `entry ${name} next ends with '.': ${entry.next}`,
      ).toBe(false);
    }
  });

  it('generated TS mirror carries every next + docsUrl pair', async () => {
    const src = await readFile(TS_GENERATED_PATH, 'utf-8');
    for (const [, entry] of Object.entries(ERROR_CATALOG)) {
      expect(src).toContain(`next: ${JSON.stringify(entry.next)}`);
      expect(src).toContain(`docsUrl: ${JSON.stringify(entry.docsUrl)}`);
    }
  });

  it('generated Python mirror carries every next + docsUrl pair', async () => {
    const src = await readFile(PY_GENERATED_PATH, 'utf-8');
    for (const [, entry] of Object.entries(ERROR_CATALOG)) {
      expect(src).toContain(`"next": ${JSON.stringify(entry.next)}`);
      expect(src).toContain(`"docsUrl": ${JSON.stringify(entry.docsUrl)}`);
    }
  });
});
