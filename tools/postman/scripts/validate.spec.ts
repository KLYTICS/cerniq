// Vitest spec for the Postman collection validator.
//
// Strategy: we exercise the validator against (a) the real, shipped
// collection at `tools/postman/cerniq.collection.json` — which must pass
// — and (b) a small set of programmatically-mutated copies that each
// trigger one specific failure path.
//
// CLAUDE.md invariant #4: every assertion is explicit; no `try/catch`
// that swallows. The mutated-copy tests use `mkdtempSync` so they do
// not pollute the workspace.

import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  runValidate,
  POSTMAN_V21_SCHEMA,
  DENIAL_PRECEDENCE_FOLDER,
  DENIAL_REASON_PRECEDENCE,
} from './validate.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const COLLECTION_PATH = resolve(HERE, '..', 'cerniq.collection.json');

interface MutableCollection {
  info: { schema: string };
  item: Array<{
    name: string;
    item?: Array<{
      name: string;
      request?: {
        method: string;
        url: { raw: string };
        header?: Array<{ key: string; value: string }>;
      };
    }>;
  }>;
}

function loadCollection(): MutableCollection {
  return JSON.parse(readFileSync(COLLECTION_PATH, 'utf8')) as MutableCollection;
}

function writeTemp(name: string, doc: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'cerniq-postman-'));
  const path = join(dir, name);
  writeFileSync(path, JSON.stringify(doc, null, 2), 'utf8');
  return path;
}

describe('Postman collection validator', () => {
  it('accepts the real shipped collection', () => {
    const result = runValidate(COLLECTION_PATH);
    if (!result.ok) {
      // Surface every error so a human reading the failure can fix it.
      throw new Error(
        `expected shipped collection to pass; got:\n  - ${result.errors.join('\n  - ')}`,
      );
    }
    expect(result.ok).toBe(true);
  });

  it('reports a healthy summary on the shipped collection', () => {
    const result = runValidate(COLLECTION_PATH);
    expect(result.summary.schema).toBe(POSTMAN_V21_SCHEMA);
    expect(result.summary.leafRequests).toBeGreaterThanOrEqual(28);
    expect(result.summary.denialPrecedenceCount).toBe(DENIAL_REASON_PRECEDENCE.length);
  });

  it('flags a wrong schema URL', () => {
    const doc = loadCollection();
    doc.info.schema = 'https://schema.getpostman.com/json/collection/v2.0.0/collection.json';
    const path = writeTemp('wrong-schema.json', doc);
    const result = runValidate(path);
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/info\.schema/);
  });

  it('flags a request whose URL does not use {{base_url}}', () => {
    const doc = loadCollection();
    const folder = doc.item.find((f) => f.name === 'Health & Discovery');
    expect(folder?.item?.[0]).toBeDefined();
    folder!.item![0]!.request!.url.raw = 'http://localhost:3000/health/live';
    const path = writeTemp('hardcoded-host.json', doc);
    const result = runValidate(path);
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/does not start with \{\{base_url\}\}/);
  });

  it('flags a literal API key in a header', () => {
    const doc = loadCollection();
    const folder = doc.item.find((f) => f.name === 'Identity');
    const req = folder?.item?.find((r) => r.name === 'List agents');
    expect(req).toBeDefined();
    req!.request!.header = [{ key: 'X-CERNIQ-API-Key', value: 'cerniq_LITERALLEAKEDabcdef123456' }];
    const path = writeTemp('leaked-key.json', doc);
    const result = runValidate(path);
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/literal cerniq api key/);
  });

  it('flags a literal Bearer token anywhere in the document', () => {
    const doc = loadCollection();
    const folder = doc.item.find((f) => f.name === 'Identity');
    const req = folder?.item?.find((r) => r.name === 'List agents');
    expect(req).toBeDefined();
    req!.request!.header = [
      { key: 'Authorization', value: 'Bearer hunter2_literal_token_xxxxxxxxxx' },
    ];
    const path = writeTemp('bearer-literal.json', doc);
    const result = runValidate(path);
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/Bearer/);
  });

  it('flags a denial-precedence folder with the wrong number of children', () => {
    const doc = loadCollection();
    const folder = doc.item.find((f) => f.name === DENIAL_PRECEDENCE_FOLDER);
    expect(folder?.item).toBeDefined();
    folder!.item = folder!.item!.slice(0, 5);
    const path = writeTemp('short-precedence.json', doc);
    const result = runValidate(path);
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/exactly 10 requests/);
  });

  it('flags a denial-precedence folder with a reordered entry', () => {
    const doc = loadCollection();
    const folder = doc.item.find((f) => f.name === DENIAL_PRECEDENCE_FOLDER);
    expect(folder?.item).toBeDefined();
    // Swap entries 1 and 2 — order check must catch it.
    const swapped = [...folder!.item!];
    const a = swapped[0]!;
    const b = swapped[1]!;
    swapped[0] = b;
    swapped[1] = a;
    folder!.item = swapped;
    const path = writeTemp('reordered-precedence.json', doc);
    const result = runValidate(path);
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/should reference/);
  });

  it('flags an unparseable collection', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cerniq-postman-'));
    const path = join(dir, 'bad.json');
    writeFileSync(path, '{ not valid json', 'utf8');
    const result = runValidate(path);
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(/did not parse/);
  });
});
