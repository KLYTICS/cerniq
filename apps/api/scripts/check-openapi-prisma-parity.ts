#!/usr/bin/env -S node --import=tsx
// CERNIQ — OpenAPI ↔ Prisma parity gate (workspace-scoped to @cerniq/api).
//
// CI entry point: spec-sync.yml job-2 invokes this exact path:
//   pnpm -F @cerniq/api exec tsx scripts/check-openapi-prisma-parity.ts
//
// What we check (high-signal, low-noise):
//   1. Every Prisma `enum` whose name maps to an OpenAPI component (or to
//      a same-named enum on a property) lists the same set of members.
//      Case-folding tolerated — the wire enum may be lowercase
//      (`anthropic`) while the Prisma enum is uppercase (`ANTHROPIC`).
//   2. For the few Prisma models that DO surface on the wire
//      (AgentIdentity, AgentPolicy, AuditEvent), every non-internal field
//      has a corresponding OpenAPI property. Internal fields are listed
//      explicitly per model so adding a field forces a deliberate
//      classification (internal vs public) at PR time.
//
// What we DO NOT check (deliberately):
//   - Field types — Prisma's optional/nullable/relation rules don't map
//     1:1 to OpenAPI. Type checking lives in the @cerniq/types Zod
//     parity script.
//   - Internal models (Principal, ApiKey, BateSignal, OutboxEvent, …).
//     They are not part of the public surface; they ship through
//     dedicated DTOs.
//
// Exit code 0 = parity. Exit code 1 = drift (writes spec-sync.json).

import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { argv, exit, stderr, stdout } from 'node:process';

import yaml from 'yaml';

// ── Paths ────────────────────────────────────────────────────────────
// Resolved lazily inside getScriptPaths() to stay CJS-compatible when
// imported by Jest/ts-jest (which compiles to CommonJS and does not
// support `import.meta`). The exported pure helpers never touch these
// paths; only main() does, and main() is only called when the file is
// executed directly.

function getScriptPaths() {
  // In CJS (Jest / ts-jest), the runtime injects `__dirname`.
  // When run natively as an ESM script (tsx / node --import=tsx),
  // __dirname is undefined so we fall back to cwd — which is always
  // apps/api/ when invoked via `pnpm -F @cerniq/api exec tsx scripts/...`
  const scriptDir: string = typeof __dirname !== 'undefined' ? resolve(__dirname) : process.cwd();
  const APP_ROOT = resolve(scriptDir, '..');
  const REPO_ROOT = resolve(APP_ROOT, '..', '..');
  return {
    APP_ROOT,
    REPO_ROOT,
    PRISMA_PATH: join(APP_ROOT, 'prisma', 'schema.prisma'),
    SPEC_PATH: join(REPO_ROOT, 'docs', 'spec', 'CERNIQ_API_SPEC.yaml'),
    REPORT_PATH: join(REPO_ROOT, 'spec-sync.json'),
  };
}

// ── OpenAPI types (loose) ────────────────────────────────────────────

interface SchemaNode {
  type?: string;
  properties?: Record<string, SchemaNode>;
  $ref?: string;
  required?: string[];
  enum?: string[];
  items?: SchemaNode;
  allOf?: SchemaNode[];
}

interface OpenApiDoc {
  components?: { schemas?: Record<string, SchemaNode> };
}

// ── Prisma parsing — light-touch, regex-based.
//
// We do NOT use @prisma/internals or the full Prisma DMMF here; we only
// need names, enum members, and field names. A focused regex parser is
// dependency-free, fast, and easy to audit. ──────────────────────────

interface PrismaEnum {
  name: string;
  members: string[];
}

interface PrismaField {
  name: string;
  raw: string; // raw line for downstream classification (e.g. detect @relation)
  isRelation: boolean;
}

interface PrismaModel {
  name: string;
  fields: PrismaField[];
}

export function parsePrismaSchema(source: string): {
  enums: Map<string, PrismaEnum>;
  models: Map<string, PrismaModel>;
} {
  const enums = new Map<string, PrismaEnum>();
  const models = new Map<string, PrismaModel>();

  const stripComment = (line: string): string => {
    const idx = line.indexOf('//');
    return idx === -1 ? line : line.slice(0, idx);
  };

  const lines = source.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    const enumMatch = /^\s*enum\s+([A-Z][A-Za-z0-9_]*)\s*\{/.exec(line);
    const modelMatch = /^\s*model\s+([A-Z][A-Za-z0-9_]*)\s*\{/.exec(line);

    if (enumMatch) {
      const name = enumMatch[1]!;
      const members: string[] = [];
      i++;
      while (i < lines.length && !(lines[i] ?? '').match(/^\s*\}/)) {
        const member = stripComment(lines[i] ?? '').trim();
        if (member.length > 0) members.push(member);
        i++;
      }
      enums.set(name, { name, members });
      i++;
      continue;
    }
    if (modelMatch) {
      const name = modelMatch[1]!;
      const fields: PrismaField[] = [];
      i++;
      while (i < lines.length && !(lines[i] ?? '').match(/^\s*\}/)) {
        const raw = lines[i] ?? '';
        const stripped = stripComment(raw).trim();
        if (stripped.length > 0 && !stripped.startsWith('@@')) {
          // Field syntax: `name Type [modifiers] @attrs`. Block attributes
          // start with `@@` (skipped above).
          const fieldMatch = /^([A-Za-z_][A-Za-z0-9_]*)\s+/.exec(stripped);
          if (fieldMatch) {
            const fieldName = fieldMatch[1]!;
            const isRelation = /@relation\b/.test(stripped);
            fields.push({ name: fieldName, raw: stripped, isRelation });
          }
        }
        i++;
      }
      models.set(name, { name, fields });
      i++;
      continue;
    }
    i++;
  }
  return { enums, models };
}

// ── Mapping table — Prisma → public OpenAPI surface.
//
// Adding a row here is the deliberate classification "this Prisma model
// is also a public wire shape". Models not listed are internal.
// `internalFields` is the per-model exclusion list — fields not surfaced
// on the public component (FK ids, hashes, internal counters). ──────

interface ModelMapping {
  prismaModel: string;
  openapiComponent: string;
  /** Field renames between Prisma and OpenAPI (Prisma → OpenAPI). */
  renames: Record<string, string>;
  /** Prisma fields excluded from the public surface (internal columns). */
  internalFields: ReadonlySet<string>;
}

const MODEL_MAPPINGS: readonly ModelMapping[] = [
  {
    prismaModel: 'AgentIdentity',
    openapiComponent: 'AgentIdentity',
    renames: { id: 'agentId', registeredAt: 'registeredAt' },
    internalFields: new Set([
      'pendingChallenge',
      'pendingChallengeExpiresAt',
      'lastScoredAt',
      'principal',
      'policies',
      'auditEvents',
      'signals',
      'scoreHistory',
      'delegationsAsPrincipal',
      'delegationsAsAgent',
      'delegationsFrom',
      'delegationsTo',
      'spendRecords',
      'verifyCount',
      'verifyCountDay',
      'bateSignals',
      'revokedAt',
      'revokedReason',
      'updatedAt',
      'createdAt',
    ]),
  },
  {
    prismaModel: 'AgentPolicy',
    openapiComponent: 'AgentPolicy',
    renames: { id: 'policyId' },
    internalFields: new Set([
      'agent',
      'principal',
      'principalId',
      'signedToken',
      'signedTokenKeyId',
      'tokenHash',
      'verifyCount',
      'revokedAt',
      'auditEvents',
      'spendRecords',
      'createdAt',
      'updatedAt',
    ]),
  },
  {
    prismaModel: 'AuditEvent',
    openapiComponent: 'AuditEvent',
    // Wire renames: the API DTO (apps/api/src/modules/audit/audit.dto.ts)
    // surfaces these Prisma columns under different names. `denialReason`
    // is the Prisma storage column; the wire calls it `decisionReason`
    // (broader semantic — covers approve/flag context too). `cerniqSignature`
    // is the storage column; the wire calls it `signature` (consumer-facing).
    renames: {
      id: 'eventId',
      createdAt: 'timestamp',
      denialReason: 'decisionReason',
      cerniqSignature: 'signature',
    },
    internalFields: new Set([
      'agent',
      'policy',
      'principal',
      'prevHash',
      'signingKeyId',
      'policyEngineId',
      'engineMetadata',
      'relyingPartyId',
      'relyingParty',
      'payloadVersion',
      'decisionReasonHash',
      'redactedAt',
      'principalIdHash',
      'agentIdHash',
      // Wire-narrower than storage: these Prisma columns are not exposed
      // on the AuditEventDto and so should not be expected in the OpenAPI
      // AuditEvent component. Storage-side hashes (the `*Hash` columns)
      // back the GDPR-redactable raw fields per docs/decisions/0006-audit-redactability.md;
      // they are committed to in the signed chain but never surfaced as
      // wire fields. The raw amount/currency/policy snapshot context
      // remains queryable via the operator-only export endpoint.
      'requestedAmount',
      'currency',
      'policyId',
      'policySnapshot',
      'redactionReason',
      'trustBandAtEvent',
      'relyingPartyHash',
      'requestedAmountHash',
      'policySnapshotHash',
    ]),
  },
] as const;

// Prisma enum → OpenAPI component name (for enum-only components like
// AgentStatus). The enum check below is run by name-match across both
// directions, so this map is for assertion clarity.
const ENUM_MAPPINGS: Readonly<Record<string, string>> = {
  AgentStatus: 'AgentStatus', // member values transformed: ACTIVE → active
  TrustBand: 'TrustBand',
  PolicyStatus: 'PolicyStatus',
  AgentRuntime: 'AgentRuntime',
  AuditDecision: 'AuditDecision',
  SignalSeverity: 'SignalSeverity',
};

// ── Diff ─────────────────────────────────────────────────────────────

type Status = 'ok' | 'drift' | 'missing';

interface ModelReport {
  prismaModel: string;
  openapiComponent: string;
  status: Status;
  missingInOpenApi: string[];
  detail: string;
}

interface EnumReport {
  prismaEnum: string;
  openapiComponentOrProperty: string | null;
  status: Status;
  detail: string;
}

interface DriftReport {
  generatedAt: string;
  prismaPath: string;
  specPath: string;
  models: ModelReport[];
  enums: EnumReport[];
}

function resolveOpenApiProperties(
  node: SchemaNode | undefined,
  components: Record<string, SchemaNode>,
  seen: Set<string> = new Set(),
): string[] {
  if (!node) return [];
  if (node.$ref?.startsWith('#/components/schemas/')) {
    const refName = node.$ref.slice('#/components/schemas/'.length);
    if (seen.has(refName)) return [];
    seen.add(refName);
    return resolveOpenApiProperties(components[refName], components, seen);
  }
  if (node.allOf?.length) {
    const acc = new Set<string>();
    for (const variant of node.allOf) {
      for (const p of resolveOpenApiProperties(variant, components, new Set(seen))) acc.add(p);
    }
    return Array.from(acc);
  }
  return Object.keys(node.properties ?? {});
}

function diffModel(
  mapping: ModelMapping,
  prismaModel: PrismaModel | undefined,
  components: Record<string, SchemaNode>,
): ModelReport {
  if (!prismaModel) {
    return {
      prismaModel: mapping.prismaModel,
      openapiComponent: mapping.openapiComponent,
      status: 'missing',
      missingInOpenApi: [],
      detail: `Prisma model ${mapping.prismaModel} not found`,
    };
  }
  const component = components[mapping.openapiComponent];
  if (!component) {
    return {
      prismaModel: mapping.prismaModel,
      openapiComponent: mapping.openapiComponent,
      status: 'missing',
      missingInOpenApi: [],
      detail: `OpenAPI component ${mapping.openapiComponent} not found`,
    };
  }

  const apiProps = new Set(resolveOpenApiProperties(component, components));
  const missingInOpenApi: string[] = [];
  for (const field of prismaModel.fields) {
    if (mapping.internalFields.has(field.name)) continue;
    if (field.isRelation) continue;
    const expectedName = mapping.renames[field.name] ?? field.name;
    if (!apiProps.has(expectedName)) missingInOpenApi.push(expectedName);
  }

  return {
    prismaModel: mapping.prismaModel,
    openapiComponent: mapping.openapiComponent,
    status: missingInOpenApi.length === 0 ? 'ok' : 'drift',
    missingInOpenApi,
    detail:
      missingInOpenApi.length === 0
        ? 'every public Prisma field has an OpenAPI property'
        : `OpenAPI is missing properties for: ${missingInOpenApi.join(', ')}`,
  };
}

function diffEnum(prismaEnum: PrismaEnum, components: Record<string, SchemaNode>): EnumReport {
  const apiName = ENUM_MAPPINGS[prismaEnum.name];
  if (!apiName) {
    return {
      prismaEnum: prismaEnum.name,
      openapiComponentOrProperty: null,
      status: 'ok',
      detail: 'no public mapping (internal enum)',
    };
  }
  const component = components[apiName];
  const apiMembers = component?.enum ?? extractEnumFromProperty(components, apiName);
  if (!apiMembers || apiMembers.length === 0) {
    return {
      prismaEnum: prismaEnum.name,
      openapiComponentOrProperty: apiName,
      status: 'missing',
      detail: `OpenAPI has no enum at component ${apiName}`,
    };
  }
  const norm = (s: string): string => s.toLowerCase().replace(/[_-]/g, '');
  const prismaSet = new Set(prismaEnum.members.map(norm));
  const apiSet = new Set(apiMembers.map(norm));
  const missingInApi = prismaEnum.members.filter((m) => !apiSet.has(norm(m)));
  const extraInApi = apiMembers.filter((m) => !prismaSet.has(norm(m)));
  if (missingInApi.length === 0 && extraInApi.length === 0) {
    return {
      prismaEnum: prismaEnum.name,
      openapiComponentOrProperty: apiName,
      status: 'ok',
      detail: `${prismaEnum.members.length} members match (case-folded)`,
    };
  }
  return {
    prismaEnum: prismaEnum.name,
    openapiComponentOrProperty: apiName,
    status: 'drift',
    detail: [
      missingInApi.length > 0 ? `missing in OpenAPI: ${missingInApi.join(', ')}` : '',
      extraInApi.length > 0 ? `extra in OpenAPI: ${extraInApi.join(', ')}` : '',
    ]
      .filter(Boolean)
      .join('; '),
  };
}

/** When the OpenAPI spec inlines an enum on a property of a same-named
 *  component (e.g. `AgentStatus` is a wrapper object whose `status`
 *  property holds the enum), peel it out so we can still compare. */
function extractEnumFromProperty(
  components: Record<string, SchemaNode>,
  componentName: string,
): string[] | null {
  const component = components[componentName];
  if (!component?.properties) return null;
  for (const prop of Object.values(component.properties)) {
    if (prop.enum && prop.enum.length > 0) return prop.enum;
  }
  return null;
}

// ── Main ─────────────────────────────────────────────────────────────

async function main(): Promise<number> {
  const json = argv.includes('--json');
  const { PRISMA_PATH, SPEC_PATH, REPORT_PATH } = getScriptPaths();

  const [prismaSrc, specRaw] = await Promise.all([
    readFile(PRISMA_PATH, 'utf8'),
    readFile(SPEC_PATH, 'utf8'),
  ]);
  const { enums, models } = parsePrismaSchema(prismaSrc);
  const doc = yaml.parse(specRaw) as OpenApiDoc;
  const components = doc.components?.schemas ?? {};

  // Sanity check: if the Prisma schema is non-empty but the parser
  // returned zero models / enums, that's almost certainly a regex bug
  // in parsePrismaSchema, not a "schema is empty" state. Same for an
  // OpenAPI document with zero components.schemas. Make the failure
  // mode loud — the M-056 regression masqueraded as drift for 5+ SHAs
  // precisely because an extractor silently returned nothing.
  if (prismaSrc.length > 0 && models.size === 0 && enums.size === 0) {
    stderr.write(
      `\nspec-sync: ERROR — parsePrismaSchema returned zero models AND zero enums from a ` +
        `non-empty schema at ${PRISMA_PATH}. Likely a regex bug in parsePrismaSchema(), not parity. Failing loud.\n`,
    );
    return 1;
  }
  if (specRaw.length > 0 && Object.keys(components).length === 0) {
    stderr.write(
      `\nspec-sync: ERROR — OpenAPI document at ${SPEC_PATH} parsed but has zero ` +
        `components.schemas. Likely a YAML structure regression (or gutted spec). Failing loud.\n`,
    );
    return 1;
  }

  const modelReports: ModelReport[] = MODEL_MAPPINGS.map((m) =>
    diffModel(m, models.get(m.prismaModel), components),
  );
  const enumReports: EnumReport[] = Array.from(enums.values()).map((e) => diffEnum(e, components));

  const failed =
    modelReports.some((r) => r.status !== 'ok') || enumReports.some((r) => r.status === 'drift'); // 'missing' is informational

  const report: DriftReport = {
    generatedAt: new Date().toISOString(),
    prismaPath: PRISMA_PATH,
    specPath: SPEC_PATH,
    models: modelReports,
    enums: enumReports,
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
  lines.push('Prisma model → OpenAPI component');
  lines.push('─'.repeat(96));
  for (const r of report.models) {
    const tag = r.status === 'ok' ? '   ✓ ok' : r.status === 'missing' ? ' ✗ MISSING' : ' ✗ DRIFT';
    lines.push(
      `${(r.prismaModel + ' → ' + r.openapiComponent).padEnd(50)}${tag.padEnd(11)}${r.detail}`,
    );
  }
  lines.push('');
  lines.push('Prisma enum → OpenAPI enum (case-folded)');
  lines.push('─'.repeat(96));
  for (const e of report.enums) {
    const tag = e.status === 'ok' ? '   ✓ ok' : e.status === 'missing' ? ' ⓘ no map' : ' ✗ DRIFT';
    lines.push(
      `${(e.prismaEnum + (e.openapiComponentOrProperty ? ' → ' + e.openapiComponentOrProperty : '')).padEnd(50)}${tag.padEnd(11)}${e.detail}`,
    );
  }
  lines.push('');
  return lines.join('\n');
}

// `import.meta` is ESM-only — unavailable when compiled to CJS by ts-jest.
// Detecting "is this the entry point?" via process.argv works in both modes.
const isMain =
  process.argv[1]?.endsWith('check-openapi-prisma-parity.ts') ||
  process.argv[1]?.endsWith('check-openapi-prisma-parity.js');
if (isMain) {
  main()
    .then(exit)
    .catch((err: unknown) => {
      stderr.write(
        `spec-sync: fatal — ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
      );
      exit(2);
    });
}

// Test surface
export { diffModel, diffEnum, MODEL_MAPPINGS, ENUM_MAPPINGS };
export type { ModelMapping, ModelReport, EnumReport, DriftReport, PrismaEnum, PrismaModel };
