// Static lint for the OKORO Postman v2.1 collection.
//
// Run from this package: `pnpm run validate`.
//
// Exits 0 when every assertion below passes; exits 1 with a one-line
// diagnostic per failure when anything is wrong. Designed to be fast
// (one pass, sub-second on a 50-request collection) and to catch the
// classes of mistakes that historically slip into hand-edited Postman
// JSON: literal hosts, hard-coded keys, drifted folder shapes.
//
// Public surface (used by validate.spec.ts):
//   - runValidate(collectionPath?): { ok, errors, summary }
//   - the module is also a CLI when invoked directly.
//
// CLAUDE.md invariant #4 (no silent failures): every check that fails
// adds an entry to `errors`. We never swallow.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DENIAL_REASON_PRECEDENCE as TYPES_DENIAL_REASON_PRECEDENCE } from '@okoro/types';

// type-rationale: the collection JSON has thousands of arbitrarily-shaped
// fields and we only inspect a small surface. Anything we touch we narrow
// at the use site; the root parse intentionally returns `unknown`.
export interface RawCollection {
  info?: {
    name?: string;
    schema?: string;
  };
  item?: unknown[];
}

export interface LeafRequest {
  /** Folder path joined by ' / ', e.g. "Identity / Register agent". */
  path: string;
  name: string;
  method: string;
  urlRaw: string;
  headers: Array<{ key: string; value: string }>;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  summary: {
    schema: string | undefined;
    leafRequests: number;
    folders: number;
    denialPrecedenceCount: number;
  };
}

export const POSTMAN_V21_SCHEMA =
  'https://schema.getpostman.com/json/collection/v2.1.0/collection.json';

export const DENIAL_PRECEDENCE_FOLDER = 'Denial Precedence Walk-through';

/**
 * Canonical denial precedence for the Postman walk-through (CLAUDE.md
 * invariant 6). Imported from `@okoro/types` to eliminate the drift class
 * that bit Round 17 (TRIAL_EXHAUSTED appeared in 6+ files; this used to
 * be one of them).
 *
 * `PLAN_LIMIT_EXCEEDED` is intentionally excluded: it's a pre-algorithm
 * billing gate (see `packages/types/src/constants.ts` comment lines
 * 57-60) that fires before the verify chain and so isn't part of the
 * walkthrough — the walkthrough exercises the 10-step algorithm chain
 * only. Future denial reason additions only need to land in
 * `@okoro/types`; this filter still classifies them correctly.
 */
export const DENIAL_REASON_PRECEDENCE = TYPES_DENIAL_REASON_PRECEDENCE.filter(
  (r) => r !== 'PLAN_LIMIT_EXCEEDED',
) as readonly string[];

/**
 * Canary patterns that indicate an accidental hard-coded credential.
 * These should never appear as literal substrings in the collection
 * outside of {{var}} replacement tokens.
 *
 * `Bearer ` is excluded when followed by a `{{var}}` token; the
 * substring scan handles that explicitly below.
 */
const SECRET_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: 'okoro api key (okoro_*)', re: /\bokoro_[A-Za-z0-9]{8,}\b/ },
  { name: 'okoro verify key (okorov_*)', re: /\bokorov_[A-Za-z0-9]{8,}\b/ },
  { name: 'webhook secret (whsec_*)', re: /\bwhsec_[A-Za-z0-9]{8,}\b/ },
  { name: 'stripe secret (sk_*)', re: /\bsk_(live|test)_[A-Za-z0-9]{8,}\b/ },
];

/**
 * Recursive walker. Postman v2.1 nests `item` arrays inside folders;
 * a leaf is anything that has a `request` field.
 */
function walk(
  items: unknown[],
  trail: string[],
  collect: { folders: number; leaves: LeafRequest[] },
): void {
  for (const raw of items) {
    if (!raw || typeof raw !== 'object') continue;
    const node = raw as {
      name?: string;
      item?: unknown[];
      request?: {
        method?: string;
        url?: string | { raw?: string };
        header?: Array<{ key?: string; value?: string }>;
      };
    };
    const name = typeof node.name === 'string' ? node.name : '';
    const nextTrail = [...trail, name];

    if (Array.isArray(node.item)) {
      collect.folders += 1;
      walk(node.item, nextTrail, collect);
      continue;
    }

    if (node.request) {
      const url =
        typeof node.request.url === 'string'
          ? node.request.url
          : node.request.url?.raw ?? '';
      const headers = Array.isArray(node.request.header)
        ? node.request.header.map((h) => ({
            key: typeof h.key === 'string' ? h.key : '',
            value: typeof h.value === 'string' ? h.value : '',
          }))
        : [];
      collect.leaves.push({
        path: nextTrail.join(' / '),
        name,
        method: typeof node.request.method === 'string' ? node.request.method : '',
        urlRaw: url,
        headers,
      });
    }
  }
}

/**
 * Find the folder named `folderName` at the top level and return its
 * children. Returns null if absent.
 */
function findTopFolder(
  items: unknown[],
  folderName: string,
): unknown[] | null {
  for (const raw of items) {
    if (!raw || typeof raw !== 'object') continue;
    const node = raw as { name?: string; item?: unknown[] };
    if (node.name === folderName && Array.isArray(node.item)) {
      return node.item;
    }
  }
  return null;
}

/**
 * Search the entire serialised collection for a `Bearer …` literal that
 * is not immediately followed by a `{{var}}` substitution token. We
 * stringify the parsed object (canonical form) so commenting tricks
 * cannot hide an accidental literal token.
 */
function bearerLiteralViolations(serialised: string): string[] {
  const violations: string[] = [];
  // `Bearer <value>` where value is NOT a {{var}} token.
  const re = /Bearer\s+(?!\{\{)([^\s"',]+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(serialised)) !== null) {
    violations.push(`Bearer literal: "Bearer ${match[1]?.slice(0, 20)}…"`);
  }
  return violations;
}

export function runValidate(collectionPath?: string): ValidationResult {
  const here = dirname(fileURLToPath(import.meta.url));
  const path = collectionPath ?? resolve(here, '..', 'okoro.collection.json');
  const raw = readFileSync(path, 'utf8');

  const errors: string[] = [];
  let parsed: RawCollection;
  try {
    parsed = JSON.parse(raw) as RawCollection;
  } catch (err) {
    return {
      ok: false,
      errors: [`collection JSON did not parse: ${(err as Error).message}`],
      summary: {
        schema: undefined,
        leafRequests: 0,
        folders: 0,
        denialPrecedenceCount: 0,
      },
    };
  }

  // 1. Schema must be exactly the v2.1 URL.
  const schema = parsed.info?.schema;
  if (schema !== POSTMAN_V21_SCHEMA) {
    errors.push(
      `info.schema must equal "${POSTMAN_V21_SCHEMA}" — got "${schema ?? '<missing>'}"`,
    );
  }

  // 2. Walk the tree.
  const items = Array.isArray(parsed.item) ? parsed.item : [];
  const collect = { folders: 0, leaves: [] as LeafRequest[] };
  walk(items, [], collect);

  if (collect.leaves.length === 0) {
    errors.push('collection has zero leaf requests');
  }

  // 3. Per-leaf assertions.
  for (const leaf of collect.leaves) {
    if (!leaf.name) {
      errors.push(`unnamed request at path "${leaf.path}"`);
    }
    if (!leaf.urlRaw) {
      errors.push(`request "${leaf.path}" has no url.raw`);
    } else if (!leaf.urlRaw.startsWith('{{base_url}}')) {
      errors.push(
        `request "${leaf.path}" url does not start with {{base_url}} — got "${leaf.urlRaw}"`,
      );
    }
    // Header literal-secret check.
    for (const header of leaf.headers) {
      for (const pattern of SECRET_PATTERNS) {
        if (pattern.re.test(header.value)) {
          errors.push(
            `request "${leaf.path}" header "${header.key}" contains a literal ${pattern.name}`,
          );
        }
      }
      if (
        header.key.toLowerCase() === 'authorization' &&
        /Bearer\s+(?!\{\{)/i.test(header.value)
      ) {
        errors.push(
          `request "${leaf.path}" header "Authorization" carries a literal Bearer token — use {{api_key}} or {{verify_key}}`,
        );
      }
    }
  }

  // 4. Whole-document Bearer literal scan.
  for (const violation of bearerLiteralViolations(raw)) {
    errors.push(violation);
  }

  // 5. Denial-precedence folder shape.
  const denialFolder = findTopFolder(items, DENIAL_PRECEDENCE_FOLDER);
  let denialCount = 0;
  if (!denialFolder) {
    errors.push(`top-level folder "${DENIAL_PRECEDENCE_FOLDER}" not found`);
  } else {
    denialCount = denialFolder.length;
    if (denialCount !== DENIAL_REASON_PRECEDENCE.length) {
      errors.push(
        `"${DENIAL_PRECEDENCE_FOLDER}" must contain exactly ${DENIAL_REASON_PRECEDENCE.length} requests — found ${denialCount}`,
      );
    }
    // Each entry must reference the corresponding denial reason in its
    // name (e.g. "1. AGENT_NOT_FOUND") so reordering is mechanically
    // detectable.
    for (let i = 0; i < denialFolder.length; i++) {
      const node = denialFolder[i] as { name?: string };
      const expected = DENIAL_REASON_PRECEDENCE[i];
      if (!expected) continue;
      if (typeof node.name !== 'string' || !node.name.includes(expected)) {
        errors.push(
          `"${DENIAL_PRECEDENCE_FOLDER}" entry ${i + 1} should reference ${expected} — got "${node.name ?? '<unnamed>'}"`,
        );
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    summary: {
      schema,
      leafRequests: collect.leaves.length,
      folders: collect.folders,
      denialPrecedenceCount: denialCount,
    },
  };
}

// CLI entry point. We detect direct invocation by comparing argv[1] to
// the resolved file URL — Node 20+ supports import.meta.url everywhere.
const isMain = (() => {
  try {
    const invoked = process.argv[1] ? resolve(process.argv[1]) : '';
    const self = fileURLToPath(import.meta.url);
    return invoked === self;
  } catch {
    return false;
  }
})();

if (isMain) {
  const result = runValidate();
  if (result.ok) {
    process.stdout.write(
      `OK — ${result.summary.leafRequests} requests across ${result.summary.folders} folders; denial walk-through ${result.summary.denialPrecedenceCount}/${DENIAL_REASON_PRECEDENCE.length}\n`,
    );
    process.exit(0);
  } else {
    process.stdout.write('FAIL — Postman collection lint:\n');
    for (const err of result.errors) {
      process.stdout.write(`  - ${err}\n`);
    }
    process.exit(1);
  }
}
