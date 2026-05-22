#!/usr/bin/env -S node --import=tsx
/**
 * OKORO — contract drift gate.
 *
 * Compares three declarations of the same contract:
 *
 *   docs/spec/OKORO_API_SPEC.yaml      (publicly committed)
 *   packages/types/src/schemas.ts      (runtime Zod source of truth)
 *   apps/api/prisma/schema.prisma      (persistence enums)
 *
 * For every $ref'd request/response component in OpenAPI, locate a Zod
 * schema with the matching name and confirm its top-level keys cover the
 * OpenAPI properties (loose) or match exactly (--strict). For every Prisma
 * `enum`, confirm the corresponding Zod enum has identical members
 * (case-insensitive).
 *
 * Exit code 0 = full parity; 1 = drift. CI gates merges on this.
 *
 *   pnpm --filter @okoro/scripts verify-spec -- --strict --json
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { stdout, stderr, exit, argv } from 'node:process';

import { Command } from 'commander';
import yaml from 'yaml';
import { z, ZodObject, ZodEnum, type ZodTypeAny } from 'zod';

import * as TypeSchemas from '@okoro/types/schemas';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');
const SPEC_PATH = join(REPO_ROOT, 'docs/spec/OKORO_API_SPEC.yaml');
const PRISMA_PATH = join(REPO_ROOT, 'apps/api/prisma/schema.prisma');

// ── Types ─────────────────────────────────────────────────────────

type Direction = 'request' | 'response';

interface SpecRef {
  endpoint: string; // e.g. "POST /v1/agents"
  direction: Direction;
  schemaName: string; // resolved component name
  properties: string[]; // top-level prop names from the OpenAPI schema
}

interface RowReport {
  endpoint: string;
  direction: Direction;
  schemaName: string;
  status: 'ok' | 'drift' | 'missing';
  delta: string;
}

interface EnumReport {
  prismaEnum: string;
  zodEnum: string | null;
  status: 'ok' | 'drift' | 'missing';
  delta: string;
}

// ── Spec parsing ──────────────────────────────────────────────────

interface OpenApiSchemaNode {
  type?: string;
  properties?: Record<string, unknown>;
  $ref?: string;
  required?: string[];
  enum?: unknown[];
  items?: OpenApiSchemaNode;
}

interface OpenApiDoc {
  paths: Record<string, Record<string, OpenApiOperation>>;
  components: { schemas: Record<string, OpenApiSchemaNode> };
}

interface OpenApiOperation {
  requestBody?: {
    content?: { 'application/json'?: { schema?: OpenApiSchemaNode } };
  };
  responses?: Record<string, { content?: { 'application/json'?: { schema?: OpenApiSchemaNode } } }>;
}

const REF_PREFIX = '#/components/schemas/';

export function resolveSchemaName(
  node: OpenApiSchemaNode | undefined,
  components: Record<string, OpenApiSchemaNode>,
): { name: string | null; resolved: OpenApiSchemaNode | null } {
  if (!node) return { name: null, resolved: null };
  if (node.$ref?.startsWith(REF_PREFIX)) {
    const name = node.$ref.slice(REF_PREFIX.length);
    const resolved = components[name];
    return { name, resolved: resolved ?? null };
  }
  return { name: null, resolved: node };
}

export async function loadSpec(path: string = SPEC_PATH): Promise<OpenApiDoc> {
  const raw = await readFile(path, 'utf8');
  return yaml.parse(raw) as OpenApiDoc;
}

export function collectSpecRefs(doc: OpenApiDoc): SpecRef[] {
  const out: SpecRef[] = [];
  const components = doc.components?.schemas ?? {};

  for (const [route, methods] of Object.entries(doc.paths ?? {})) {
    for (const [method, op] of Object.entries(methods)) {
      if (typeof op !== 'object' || op === null) continue;
      const endpoint = `${method.toUpperCase()} ${route}`;

      const reqNode = op.requestBody?.content?.['application/json']?.schema;
      if (reqNode) {
        const { name, resolved } = resolveSchemaName(reqNode, components);
        if (name && resolved) {
          out.push({
            endpoint,
            direction: 'request',
            schemaName: name,
            properties: Object.keys(resolved.properties ?? {}),
          });
        }
      }

      for (const [_status, resp] of Object.entries(op.responses ?? {})) {
        const respNode = resp.content?.['application/json']?.schema;
        if (!respNode) continue;
        const { name, resolved } = resolveSchemaName(respNode, components);
        if (name && resolved) {
          out.push({
            endpoint,
            direction: 'response',
            schemaName: name,
            properties: Object.keys(resolved.properties ?? {}),
          });
        }
      }
    }
  }
  return out;
}

// ── Zod introspection ─────────────────────────────────────────────

/**
 * Returns the top-level property names of a Zod schema. We only look at
 * ZodObject — array/union/etc. are out of scope because the OpenAPI request
 * bodies and response bodies we care about are objects.
 *
 * Strips a trailing `Schema` suffix when matching by name (Zod source of
 * truth uses `AgentRegistrationRequestSchema`, OpenAPI uses
 * `AgentRegistrationRequest`).
 */
export function zodObjectKeys(schema: ZodTypeAny | undefined): string[] | null {
  if (!schema) return null;
  // Unwrap optional/nullable wrappers if present.
  let cur: ZodTypeAny = schema;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  // type-rationale: Zod's runtime _def.typeName is the only stable check
  // across optional/nullable/effects wrappers; the public types omit it.
  while (cur && typeof (cur as any)._def === 'object') {
    const tn = (cur as { _def: { typeName?: string; innerType?: ZodTypeAny } })._def.typeName;
    if (tn === 'ZodOptional' || tn === 'ZodNullable' || tn === 'ZodEffects') {
      const inner = (cur as { _def: { innerType?: ZodTypeAny; schema?: ZodTypeAny } })._def;
      const next = inner.innerType ?? inner.schema;
      if (!next) break;
      cur = next;
      continue;
    }
    break;
  }
  if (!(cur instanceof ZodObject)) return null;
  return Object.keys((cur as ZodObject<z.ZodRawShape>).shape);
}

export function findZodSchema(name: string): ZodTypeAny | undefined {
  const exportsMap = TypeSchemas as Record<string, unknown>;
  const candidate = exportsMap[`${name}Schema`];
  // Zod schemas are objects with a `_def` runtime property; checking for it
  // is the most reliable way to differentiate from plain TS type aliases.
  if (
    candidate &&
    typeof candidate === 'object' &&
    '_def' in (candidate as Record<string, unknown>)
  ) {
    return candidate as ZodTypeAny;
  }
  return undefined;
}

export interface DiffResult {
  status: 'ok' | 'drift' | 'missing';
  delta: string;
}

export function compareKeys(
  specProps: string[],
  zodKeys: string[] | null,
  strict: boolean,
): DiffResult {
  if (zodKeys === null) {
    return { status: 'missing', delta: 'no Zod object schema found' };
  }
  const specSet = new Set(specProps);
  const zodSet = new Set(zodKeys);
  const missingInZod = specProps.filter((p) => !zodSet.has(p));
  const extraInZod = zodKeys.filter((p) => !specSet.has(p));
  if (missingInZod.length === 0 && (!strict || extraInZod.length === 0)) {
    return { status: 'ok', delta: '' };
  }
  const parts: string[] = [];
  if (missingInZod.length) parts.push(`missingInZod=[${missingInZod.join(',')}]`);
  if (extraInZod.length) parts.push(`extraInZod=[${extraInZod.join(',')}]`);
  return { status: 'drift', delta: parts.join(' ') };
}

// ── Prisma enum extraction ────────────────────────────────────────

const RE_ENUM = /enum\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{([^}]*)\}/g;

export function parsePrismaEnums(source: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const match of source.matchAll(RE_ENUM)) {
    const name = match[1];
    const body = match[2];
    if (!name || !body) continue;
    const members = body
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('//'))
      .map((l) => {
        const idx = l.indexOf('//');
        return (idx >= 0 ? l.slice(0, idx) : l).trim();
      })
      .filter(Boolean);
    out.set(name, members);
  }
  return out;
}

/**
 * Matches a Prisma enum to a Zod enum. Convention:
 *   Prisma `AgentRuntime`    → Zod `AgentRuntimeSchema`
 *   Prisma `PolicyStatus`    → Zod `PolicyStatusSchema`
 *   Prisma `AgentStatus`     → Zod `AgentStatusSchema`  (note: collides with
 *                              the response schema of the same Zod name)
 * Returns null if no matching ZodEnum is found in @okoro/types/schemas.
 */
export function findZodEnum(prismaName: string): ZodEnum<[string, ...string[]]> | null {
  const exportsMap = TypeSchemas as Record<string, unknown>;
  const candidate = exportsMap[`${prismaName}Schema`];
  if (candidate instanceof ZodEnum) return candidate as ZodEnum<[string, ...string[]]>;
  return null;
}

export function compareEnums(
  prismaMembers: string[],
  zodMembers: string[],
): DiffResult {
  const norm = (s: string): string => s.toUpperCase();
  const p = new Set(prismaMembers.map(norm));
  const z = new Set(zodMembers.map(norm));
  const missingInZod = [...p].filter((m) => !z.has(m));
  const extraInZod = [...z].filter((m) => !p.has(m));
  if (missingInZod.length === 0 && extraInZod.length === 0) {
    return { status: 'ok', delta: '' };
  }
  const parts: string[] = [];
  if (missingInZod.length) parts.push(`missingInZod=[${missingInZod.join(',')}]`);
  if (extraInZod.length) parts.push(`extraInZod=[${extraInZod.join(',')}]`);
  return { status: 'drift', delta: parts.join(' ') };
}

// ── Reporting ─────────────────────────────────────────────────────

interface RunResult {
  rows: RowReport[];
  enums: EnumReport[];
  ok: boolean;
}

export async function runVerify(opts: { strict: boolean }): Promise<RunResult> {
  const doc = await loadSpec();
  const refs = collectSpecRefs(doc);

  const rows: RowReport[] = [];
  for (const ref of refs) {
    const zod = findZodSchema(ref.schemaName);
    const keys = zodObjectKeys(zod);
    const diff = compareKeys(ref.properties, keys, opts.strict);
    rows.push({
      endpoint: ref.endpoint,
      direction: ref.direction,
      schemaName: ref.schemaName,
      status: diff.status,
      delta: diff.delta,
    });
  }

  const prismaSrc = await readFile(PRISMA_PATH, 'utf8');
  const prismaEnums = parsePrismaEnums(prismaSrc);
  const enumReports: EnumReport[] = [];
  for (const [pname, pmembers] of prismaEnums) {
    const ze = findZodEnum(pname);
    if (!ze) {
      enumReports.push({
        prismaEnum: pname,
        zodEnum: null,
        status: 'missing',
        delta: `no Zod enum named ${pname}Schema`,
      });
      continue;
    }
    const diff = compareEnums(pmembers, [...ze.options]);
    enumReports.push({
      prismaEnum: pname,
      zodEnum: `${pname}Schema`,
      status: diff.status,
      delta: diff.delta,
    });
  }

  const ok =
    rows.every((r) => r.status === 'ok') && enumReports.every((r) => r.status === 'ok');

  return { rows, enums: enumReports, ok };
}

// ── CLI ───────────────────────────────────────────────────────────

interface CliOpts {
  strict: boolean;
  json: boolean;
}

function parseCli(args: string[]): CliOpts {
  const program = new Command()
    .name('verify-spec')
    .description('OpenAPI ↔ Zod ↔ Prisma parity check.')
    .option('--strict', 'fail on extra Zod keys not in spec', false)
    .option('--json', 'machine-readable output', false)
    .exitOverride();
  program.parse(args, { from: 'user' });
  return program.opts<CliOpts>();
}

function formatTable(result: RunResult): string {
  const lines: string[] = [];
  lines.push('[ENDPOINT]                          [DIR]      [SCHEMA]                    [STATUS]  [DELTA]');
  for (const r of result.rows) {
    lines.push(
      [
        r.endpoint.padEnd(35),
        r.direction.padEnd(9),
        r.schemaName.padEnd(27),
        r.status.padEnd(9),
        r.delta,
      ].join(' '),
    );
  }
  lines.push('');
  lines.push('[PRISMA ENUM]               [ZOD ENUM]                 [STATUS]  [DELTA]');
  for (const e of result.enums) {
    lines.push(
      [
        e.prismaEnum.padEnd(27),
        (e.zodEnum ?? '-').padEnd(26),
        e.status.padEnd(9),
        e.delta,
      ].join(' '),
    );
  }
  return lines.join('\n');
}

async function main(): Promise<void> {
  const opts = parseCli(argv.slice(2));
  const result = await runVerify({ strict: opts.strict });
  if (opts.json) {
    stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    stdout.write(`${formatTable(result)}\n`);
  }
  if (!result.ok) {
    stderr.write('drift detected — failing.\n');
    exit(1);
  }
  stdout.write(`ok: ${result.rows.length} schema row(s), ${result.enums.length} enum(s) — full parity.\n`);
}

const invokedDirectly = (() => {
  if (typeof process === 'undefined' || !process.argv[1]) return false;
  try {
    const entryUrl = new URL(`file://${process.argv[1]}`).href;
    return import.meta.url === entryUrl;
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  main().catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    stderr.write(`${JSON.stringify({ ok: false, error: msg })}\n`);
    exit(1);
  });
}
