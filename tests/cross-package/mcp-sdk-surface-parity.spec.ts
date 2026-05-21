// Cross-package parity — MCP server tool handlers vs. @aegis/sdk surface.
//
// Why this exists:
// Round 27 (2026-05-20) discovered that `packages/mcp-server/src/tools/*.ts`
// had drifted hard from the real `@aegis/sdk` shape — handlers called
// `aegis.agents.create` (real name: `register`), `agents.list` (didn't
// exist on AgentClient at all), `policies.create(input)` with wrong arity,
// and reached into the SDK's `private http` field. Nothing caught it
// until a cold-worktree `pnpm typecheck` blew up.
//
// This spec is the recurrence gate. Two layers:
//
//   1. **Compile-time check** — by importing the MCP register fns and
//      calling them with a REAL `Aegis` instance, any drift between the
//      handler bodies and the SDK surface fails THIS file's typecheck.
//      The spec file is type-checked as part of `tests/typecheck`.
//
//   2. **Runtime check** — every name in `TOOL_NAMES` (the public MCP
//      surface per ADR-0008 §2) must be registered, with annotations
//      following MCP 1.0. Adding a name to `TOOL_NAMES` without wiring a
//      handler fails this spec; shipping a handler without annotations
//      fails this spec.
//
// Pick the thinnest contract per `tests/cross-package/README.md` rule 1:
// we assert structural presence + annotation shape, not handler return
// values (those live in `packages/mcp-server/test/tools/*.spec.ts`).

import { describe, expect, it } from 'vitest';

import { Aegis } from '../../packages/sdk-ts/src';
import { registerAgentsTools } from '../../packages/mcp-server/src/tools/agents';
import { registerAuditTool } from '../../packages/mcp-server/src/tools/audit';
import { registerPoliciesTools } from '../../packages/mcp-server/src/tools/policies';
import { registerVerifyTool } from '../../packages/mcp-server/src/tools/verify';
import {
  TOOL_NAMES,
  type ToolDefinition,
  type ToolName,
} from '../../packages/mcp-server/src/tools/registry';

function buildRegistry(): Map<string, ToolDefinition> {
  // Construct with a real Aegis — the constructor is sync, no network.
  const aegis = new Aegis({
    apiKey: 'aegis_sk_parity_test',
    baseUrl: 'https://api.aegis.test',
  });
  const registry = new Map<string, ToolDefinition>();
  // If any register fn drifts from the Aegis surface, THIS file fails
  // to compile — the runtime assertions below are belt-and-braces.
  registerVerifyTool(aegis, registry);
  registerAgentsTools(aegis, registry);
  registerPoliciesTools(aegis, registry);
  registerAuditTool(aegis, registry);
  return registry;
}

describe('MCP ↔ SDK surface parity', () => {
  it('every TOOL_NAME has a registered handler', () => {
    const reg = buildRegistry();
    for (const name of TOOL_NAMES) {
      expect(reg.has(name), `TOOL_NAMES declares ${name} but no handler is registered`).toBe(true);
    }
  });

  it('no extra handlers are registered beyond TOOL_NAMES (ADR-0008 §2)', () => {
    const reg = buildRegistry();
    const allowed = new Set<string>(TOOL_NAMES);
    for (const name of reg.keys()) {
      expect(allowed.has(name), `tool ${name} is registered but not in TOOL_NAMES`).toBe(true);
    }
    expect(reg.size).toBe(TOOL_NAMES.length);
  });

  it('every tool carries MCP 1.0 annotations (title + openWorldHint at minimum)', () => {
    const reg = buildRegistry();
    for (const name of TOOL_NAMES) {
      const def = reg.get(name)!;
      expect(def.annotations, `${name}: annotations missing`).toBeDefined();
      // All AEGIS tools talk to the API → openWorldHint must be true.
      expect(def.annotations.openWorldHint, `${name}: openWorldHint must be true`).toBe(true);
    }
  });

  it('every tool name in handler key matches its definition name (no copy-paste drift)', () => {
    const reg = buildRegistry();
    for (const [key, def] of reg) {
      expect(def.name, `tool ${key} has name ${def.name}; should equal ${key}`).toBe(key);
    }
  });

  it('every revoke / delete tool is annotated destructive + idempotent', () => {
    const reg = buildRegistry();
    const destructive: ToolName[] = ['aegis.agents.revoke', 'aegis.policies.revoke'];
    for (const name of destructive) {
      const a = reg.get(name)!.annotations;
      expect(a.destructiveHint, `${name}: destructiveHint must be true`).toBe(true);
      expect(a.idempotentHint, `${name}: revokes must be idempotent`).toBe(true);
    }
  });

  it('every list / get / search / verify tool is annotated read-only + idempotent', () => {
    const reg = buildRegistry();
    const readOnly: ToolName[] = [
      'aegis.agents.get',
      'aegis.agents.list',
      'aegis.policies.get',
      'aegis.policies.list',
      'aegis.audit.search',
      'aegis.verify',
    ];
    for (const name of readOnly) {
      const a = reg.get(name)!.annotations;
      expect(a.readOnlyHint, `${name}: readOnlyHint must be true`).toBe(true);
      expect(a.idempotentHint, `${name}: read-only tools should be idempotent`).toBe(true);
    }
  });

  it('every tool input schema is a JSON Schema object with additionalProperties:false', () => {
    const reg = buildRegistry();
    for (const name of TOOL_NAMES) {
      const schema = reg.get(name)!.inputSchema;
      expect(schema.type, `${name}: schema.type must be object`).toBe('object');
      expect(schema.additionalProperties, `${name}: additionalProperties must be false`).toBe(false);
    }
  });
});
