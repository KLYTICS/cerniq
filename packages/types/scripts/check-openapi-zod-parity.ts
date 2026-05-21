#!/usr/bin/env -S node --import=tsx
// AEGIS — OpenAPI ↔ Zod parity gate (workspace-scoped to @aegis/types).
//
// CI entry point: spec-sync.yml job-1 invokes this exact path:
//   pnpm -F @aegis/types exec tsx scripts/check-openapi-zod-parity.ts
//
// Why a workspace-scoped script (separate from the broader root
// scripts/verify-spec.ts): @aegis/types must be self-validating against
// the OpenAPI spec without dragging Prisma or @aegis/api into its
// dependency graph. The wire contract lives here; this script is the
// gate that says "this package and the OpenAPI document still agree".
//
// What we check:
//   1. For every OpenAPI request/response component referenced from a
//      path operation, the corresponding Zod schema (`<Name>Schema`)
//      exists and exposes every top-level property the spec lists.
//   2. The DenialReason enum order in OpenAPI is byte-identical to
//      DENIAL_REASON_PRECEDENCE in constants.ts. ADR-0004 / CLAUDE.md
//      invariant 6 lock this order at the wire level.
//
// Exit code 0 = parity. Exit code 1 = drift; a JSON report is written
// to spec-sync.json at the repo root for CI annotation upload.
//
// Strict mode (--strict): reject extra properties on the Zod side.
// Default mode is forgiving — Zod may have additional internal fields
// (e.g. principalId injected by the auth guard) so long as every
// OpenAPI-listed property is covered.

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { argv, exit, stderr, stdout } from 'node:process';

import yaml from 'yaml';
import { z, ZodObject, type ZodTypeAny } from 'zod';

import * as TypesIndex from '../src/index.js';
import { DENIAL_REASON_PRECEDENCE } from '../src/constants.js';

// ── Constants ────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const PACKAGE_ROOT = resolve(dirname(__filename), '..');
const REPO_ROOT = resolve(PACKAGE_ROOT, '..', '..');
const SPEC_PATH = join(REPO_ROOT, 'docs', 'spec', 'AEGIS_API_SPEC.yaml');
const REPORT_PATH = join(REPO_ROOT, 'spec-sync.json');

const REF_PREFIX = '#/components/schemas/';

// ── Spec types ───────────────────────────────────────────────────────

interface SchemaNode {
  type?: string;
  properties?: Record<string, SchemaNode>;
  $ref?: string;
  required?: string[];
  enum?: string[];
  items?: SchemaNode;
  oneOf?: SchemaNode[];
  allOf?: SchemaNode[];
  anyOf?: SchemaNode[];
}

interface MediaType {
  schema?: SchemaNode;
}

interface RequestBody {
  content?: Record<string, MediaType>;
}

interface Response {
  content?: Record<string, MediaType>;
}

interface Operation {
  operationId?: string;
  requestBody?: RequestBody;
  responses?: Record<string, Response>;
}

interface OpenApiDoc {
  paths?: Record<string, Record<string, Operation>>;
  components?: { schemas?: Record<string, SchemaNode> };
}

// ── Drift report types ───────────────────────────────────────────────

type Status = 'ok' | 'drift' | 'missing';

interface ComponentReport {
  schema: string;
  status: Status;
  missingInZod: string[];
  extraInZod: string[];
  endpoints: string[];
}

interface EnumReport {
  name: string;
  status: Status;
  detail: string;
}

interface DriftReport {
  generatedAt: string;
  specPath: string;
  strictMode: boolean;
  components: ComponentReport[];
  enums: EnumReport[];
}

// ── Walk the spec ────────────────────────────────────────────────────

/** Collect every component name referenced by a path operation, with the
 *  endpoints that touch it. Recursive — chases `$ref`, `items`, and
 *  `allOf/oneOf/anyOf`. */
function collectReferencedComponents(
  doc: OpenApiDoc,
): Map<string, Set<string>> {
  const refs = new Map<string, Set<string>>();
  const addRef = (name: string, endpoint: string): void => {
    let endpoints = refs.get(name);
    if (!endpoints) {
      endpoints = new Set();
      refs.set(name, endpoints);
    }
    endpoints.add(endpoint);
  };

  const components = doc.components?.schemas ?? {};
  const visit = (node: SchemaNode | undefined, endpoint: string, seen: Set<string>): void => {
    if (!node) return;
    if (node.$ref?.startsWith(REF_PREFIX)) {
      const name = node.$ref.slice(REF_PREFIX.length);
      addRef(name, endpoint);
      if (seen.has(name)) return; // cycle break
      seen.add(name);
      visit(components[name], endpoint, seen);
      return;
    }
    if (node.properties) {
      for (const child of Object.values(node.properties)) {
        visit(child, endpoint, seen);
      }
    }
    if (node.items) visit(node.items, endpoint, seen);
    for (const variant of node.allOf ?? []) visit(variant, endpoint, seen);
    for (const variant of node.oneOf ?? []) visit(variant, endpoint, seen);
    for (const variant of node.anyOf ?? []) visit(variant, endpoint, seen);
  };

  for (const [path, methods] of Object.entries(doc.paths ?? {})) {
    for (const [method, operation] of Object.entries(methods)) {
      const endpoint = `${method.toUpperCase()} ${path}`;
      visit(operation.requestBody?.content?.['application/json']?.schema, endpoint, new Set());
      for (const response of Object.values(operation.responses ?? {})) {
        visit(response.content?.['application/json']?.schema, endpoint, new Set());
      }
    }
  }
  return refs;
}

/** Resolve an OpenAPI schema to its concrete top-level property set,
 *  following `$ref` and merging `allOf` branches. Returns `null` for
 *  primitive (non-object) shapes. */
function resolveProperties(
  node: SchemaNode | undefined,
  components: Record<string, SchemaNode>,
  seen: Set<string> = new Set(),
): string[] | null {
  if (!node) return null;
  if (node.$ref?.startsWith(REF_PREFIX)) {
    const name = node.$ref.slice(REF_PREFIX.length);
    if (seen.has(name)) return null;
    seen.add(name);
    return resolveProperties(components[name], components, seen);
  }
  if (node.allOf?.length) {
    const acc = new Set<string>();
    for (const variant of node.allOf) {
      const props = resolveProperties(variant, components, new Set(seen));
      if (props) for (const p of props) acc.add(p);
    }
    return Array.from(acc);
  }
  if (!node.properties) return null;
  return Object.keys(node.properties);
}

// ── Zod-side resolution ──────────────────────────────────────────────

/** A component name maps to `<name>Schema` exported from index.ts. We
 *  also accept `<base>RecordSchema` (used for AuditEvent → AuditEventRecord)
 *  to honor the existing naming reality without forcing a rename.
 *
 *  Preference: ZodObject candidates win over non-object candidates
 *  (z.enum, primitives). `AgentStatus` is the motivating case —
 *  `AgentStatusSchema` is the value enum, `AgentStatusResponseSchema`
 *  is the wire response object; field-by-field parity needs the object. */
function findZodSchema(componentName: string): ZodTypeAny | null {
  const candidates = [
    `${componentName}Schema`,
    `${componentName}RequestSchema`,
    `${componentName}ResponseSchema`,
    `${componentName}RecordSchema`,
  ];
  let fallback: ZodTypeAny | null = null;
  for (const candidate of candidates) {
    const exported = (TypesIndex as Record<string, unknown>)[candidate];
    if (exported && typeof exported === 'object' && '_def' in (exported as object)) {
      const schema = exported as ZodTypeAny;
      if (schema instanceof ZodObject) return schema;
      if (!fallback) fallback = schema;
    }
  }
  return fallback;
}

/** Drill through `.refine`/`.transform`/`.optional` wrappers to find the
 *  underlying ZodObject and return its top-level keys. Returns null when
 *  the schema is non-object (a Zod enum, primitive, etc.). */
function zodObjectKeys(schema: ZodTypeAny): string[] | null {
  let current: ZodTypeAny = schema;
  for (let i = 0; i < 8; i++) {
    if (current instanceof ZodObject) {
      return Object.keys(current.shape);
    }
    const def = (current as { _def?: { schema?: ZodTypeAny; innerType?: ZodTypeAny } })._def;
    if (def?.schema) {
      current = def.schema;
      continue;
    }
    if (def?.innerType) {
      current = def.innerType;
      continue;
    }
    break;
  }
  return null;
}

// ── Diff ─────────────────────────────────────────────────────────────

function diffComponent(
  componentName: string,
  endpoints: string[],
  specProps: string[] | null,
  zodKeys: string[] | null,
  strict: boolean,
): ComponentReport {
  if (specProps === null) {
    // The component is a primitive / enum / sentinel — nothing to diff
    // structurally. Caller handles enum order separately.
    return {
      schema: componentName,
      status: 'ok',
      missingInZod: [],
      extraInZod: [],
      endpoints,
    };
  }
  if (zodKeys === null) {
    return {
      schema: componentName,
      status: 'missing',
      missingInZod: specProps,
      extraInZod: [],
      endpoints,
    };
  }
  const specSet = new Set(specProps);
  const zodSet = new Set(zodKeys);
  const missingInZod = specProps.filter((p) => !zodSet.has(p));
  const extraInZod = zodKeys.filter((p) => !specSet.has(p));
  let status: Status = 'ok';
  if (missingInZod.length > 0) status = 'drift';
  if (strict && extraInZod.length > 0) status = 'drift';
  return { schema: componentName, status, missingInZod, extraInZod, endpoints };
}

function checkDenialEnumOrder(spec: OpenApiDoc): EnumReport {
  const node = spec.components?.schemas?.VerifyResponse?.properties?.denialReason;
  const specOrder = node?.enum ?? [];
  const canonical = [...DENIAL_REASON_PRECEDENCE];

  if (specOrder.length === 0) {
    return {
      name: 'VerifyResponse.denialReason',
      status: 'missing',
      detail: 'enum not declared inline on VerifyResponse.denialReason',
    };
  }
  for (let i = 0; i < canonical.length; i++) {
    if (specOrder[i] !== canonical[i]) {
      return {
        name: 'VerifyResponse.denialReason',
        status: 'drift',
        detail: `expected[${i}]=${canonical[i]} got[${i}]=${specOrder[i] ?? '(missing)'} — full canonical: ${canonical.join(' → ')}`,
      };
    }
  }
  if (specOrder.length !== canonical.length) {
    return {
      name: 'VerifyResponse.denialReason',
      status: 'drift',
      detail: `length mismatch — spec has ${specOrder.length}, canonical has ${canonical.length}`,
    };
  }
  return { name: 'VerifyResponse.denialReason', status: 'ok', detail: 'byte-identical to DENIAL_REASON_PRECEDENCE' };
}

// ── Main ─────────────────────────────────────────────────────────────

async function main(): Promise<number> {
  const strict = argv.includes('--strict');
  const json = argv.includes('--json');

  const raw = await readFile(SPEC_PATH, 'utf8');
  const doc = yaml.parse(raw) as OpenApiDoc;
  const components = doc.components?.schemas ?? {};

  const referenced = collectReferencedComponents(doc);

  // Sanity check: if the OpenAPI file exists and is non-trivial but we
  // resolved zero referenced components, that's an extractor bug (or a
  // gutted spec), not a parity success. Make the failure loud instead
  // of silently emitting an empty success report. Mirror of the
  // extractor sanity-check in .github/workflows/spec-sync.yml.
  if (raw.length > 0 && referenced.size === 0) {
    stderr.write(
      `\nspec-sync: ERROR — extracted zero referenced components from a non-empty OpenAPI ` +
        `document at ${SPEC_PATH}. Likely an extractor bug in collectReferencedComponents() ` +
        `(see paths/operations walk), not real parity. Failing loud.\n`,
    );
    return 1;
  }

  const reports: ComponentReport[] = [];

  for (const [name, endpointSet] of Array.from(referenced.entries()).sort()) {
    const node = components[name];
    if (!node) {
      reports.push({
        schema: name,
        status: 'missing',
        missingInZod: [],
        extraInZod: [],
        endpoints: Array.from(endpointSet),
      });
      continue;
    }
    const specProps = resolveProperties(node, components);
    const zod = findZodSchema(name);
    const zodKeys = zod ? zodObjectKeys(zod) : null;
    reports.push(diffComponent(name, Array.from(endpointSet), specProps, zodKeys, strict));
  }

  const enumReport = checkDenialEnumOrder(doc);
  const driftCount = reports.filter((r) => r.status !== 'ok').length;
  const enumDrift = enumReport.status !== 'ok';
  const failed = driftCount > 0 || enumDrift;

  const report: DriftReport = {
    generatedAt: new Date().toISOString(),
    specPath: SPEC_PATH,
    strictMode: strict,
    components: reports,
    enums: [enumReport],
  };

  if (json) {
    stdout.write(JSON.stringify(report, null, 2) + '\n');
  } else {
    stdout.write(formatTable(report));
  }

  if (failed) {
    await writeFile(REPORT_PATH, JSON.stringify(report, null, 2) + '\n', 'utf8');
    stderr.write(`\nspec-sync: drift detected — wrote ${REPORT_PATH}\n`);
  }
  return failed ? 1 : 0;
}

function formatTable(report: DriftReport): string {
  const lines: string[] = [];
  lines.push('component                                 status   missing-in-zod / extra-in-zod');
  lines.push('─'.repeat(96));
  for (const r of report.components) {
    const tag = r.status === 'ok' ? '   ✓ ok' : r.status === 'missing' ? ' ✗ MISSING' : ' ✗ DRIFT';
    const detail =
      r.missingInZod.length > 0
        ? `missing: ${r.missingInZod.join(', ')}`
        : r.extraInZod.length > 0
          ? `extra:   ${r.extraInZod.join(', ')}`
          : '';
    lines.push(`${r.schema.padEnd(42)}${tag.padEnd(11)}${detail}`);
  }
  lines.push('');
  lines.push('enum check');
  lines.push('─'.repeat(96));
  for (const e of report.enums) {
    const tag = e.status === 'ok' ? '   ✓ ok' : e.status === 'missing' ? ' ✗ MISSING' : ' ✗ DRIFT';
    lines.push(`${e.name.padEnd(42)}${tag.padEnd(11)}${e.detail}`);
  }
  lines.push('');
  return lines.join('\n');
}

// Vitest imports this file but we don't want to execute under test.
const isMain = import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('check-openapi-zod-parity.ts');
if (isMain) {
  main()
    .then(exit)
    .catch((err: unknown) => {
      stderr.write(`spec-sync: fatal — ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
      exit(2);
    });
}

// Test surface — re-export for unit tests.
export {
  collectReferencedComponents,
  resolveProperties,
  findZodSchema,
  zodObjectKeys,
  diffComponent,
  checkDenialEnumOrder,
};
export type { OpenApiDoc, ComponentReport, EnumReport, DriftReport };
