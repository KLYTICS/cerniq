// CedarWasmEvaluator — production wiring of `@cedar-policy/cedar-wasm`
// behind the `CedarEvaluatorLike` shape used by `CedarPolicyEngine`.
//
// Why a separate file: `cedar.engine.ts` MUST stay framework-free and
// CF-Worker-portable (ADR-0003). Pulling `cedar-wasm` directly into
// it would drag a WASM dependency onto the verify hot path — fine on
// Node, problematic on Cloudflare Workers (the WASM blob is ~3 MB).
//
// AppModule wires this evaluator at boot:
//
//   import { CedarWasmEvaluator } from '.../cedar-wasm.evaluator';
//   import { registerCedarEvaluator } from '.../policy-engine';
//   registerCedarEvaluator(new CedarWasmEvaluator());
//
// Until `pnpm install @cedar-policy/cedar-wasm` is run in apps/api, the
// constructor throws clearly so misconfigured deployments fail loud
// instead of falling through to a silent "no engine" hot-path bug.

import type { CedarEvaluatorLike } from './cedar.engine.js';

/**
 * Minimal shape of the `cedar-wasm` GA module — defined locally so the
 * evaluator builds (and unit-tests pass) even when the WASM dep isn't
 * installed. The real package's actual export shape is documented at
 * https://github.com/cedar-policy/cedar/tree/main/cedar-wasm and matches
 * the shape below.
 */
interface CedarWasmModule {
  isAuthorized(input: {
    principal: string;
    action: string;
    resource: string;
    context: Record<string, unknown>;
    policies: string;
    entities: string;
  }): Promise<{
    decision: 'Allow' | 'Deny';
    diagnostics: { reason?: string; errors?: string[] };
  }>;
}

export class CedarWasmEvaluator implements CedarEvaluatorLike {
  private readonly cedar: CedarWasmModule;

  constructor(cedarModule?: CedarWasmModule) {
    if (cedarModule) {
      this.cedar = cedarModule;
      return;
    }
    // Lazy load the real WASM module.
    try {
      // require() to avoid TS pulling cedar-wasm into the type-graph until
      // the dep is installed; production AppModule should pre-construct
      // and pass cedarModule in.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      this.cedar = require('@cedar-policy/cedar-wasm') as CedarWasmModule;
    } catch (err) {
      throw new Error(
        `cedar-wasm not installed (${(err as Error).message}). ` +
          `Run \`pnpm install @cedar-policy/cedar-wasm\` in apps/api or ` +
          `inject a pre-loaded module into the constructor.`,
      );
    }
  }

  async isAuthorized(input: {
    principal: string;
    action: string;
    resource: string;
    context: Record<string, unknown>;
    artifact: unknown;
  }): Promise<{
    decision: 'Allow' | 'Deny';
    diagnostics?: { reason?: string; errors?: string[] };
    obligations?: { kind: string; data: Record<string, unknown> }[];
  }> {
    // The compiled artifact in our `AgentPolicy` is a JSON object holding
    // the policy text + a flat entities catalog. Cedar-wasm operates on
    // strings (policy text) and the entity store; we serialize at the
    // boundary.
    const a = input.artifact as { policies?: string; entities?: unknown };
    if (typeof a?.policies !== 'string') {
      throw new Error('CedarWasmEvaluator: artifact.policies (string) required');
    }

    const result = await this.cedar.isAuthorized({
      principal: input.principal,
      action: input.action,
      resource: input.resource,
      context: input.context,
      policies: a.policies,
      entities: JSON.stringify(a.entities ?? []),
    });

    // Cedar's diagnostics surface the matched-policy id when Allow,
    // and the failing-condition reason when Deny. We pass it straight
    // through to `engineMetadata.diagnostics` for audit forensics.
    return {
      decision: result.decision,
      diagnostics: result.diagnostics,
      // Cedar 3.0+ supports policy "obligations" through annotations
      // (e.g. `@aegis_deny_reason("SPEND_LIMIT_EXCEEDED")`). We extract
      // them from the diagnostics if present.
      obligations: extractObligations(result.diagnostics),
    };
  }
}

/**
 * Cedar exposes obligations through annotation diagnostics in its 3.x
 * series. We look for `@aegis_deny_reason("<DenialReason>")` style
 * annotations and surface them as engine obligations the
 * `CedarPolicyEngine` can map to the locked AEGIS denial enum.
 */
function extractObligations(
  diagnostics: { reason?: string; errors?: string[] } | undefined,
): { kind: string; data: Record<string, unknown> }[] | undefined {
  if (!diagnostics?.reason) return undefined;
  const m = /aegis_deny_reason\("([A-Z_]+)"\)/.exec(diagnostics.reason);
  if (!m) return undefined;
  return [{ kind: 'aegis.deny_reason', data: { reason: m[1] } }];
}

/**
 * Compile a customer-authored Cedar policy + entity store into the
 * artifact shape our `CedarPolicyEngine` expects. Called from the
 * policy-create controller. Returns `{ policies, entities }` ready for
 * `AgentPolicy.compiledArtifact` storage.
 *
 * Static-analysis errors (parse fail, type mismatch) surface as 422 at
 * the controller layer, NEVER at verify time (ADR-0012 §6).
 */
export interface CedarCompiledArtifact {
  policies: string;
  entities: unknown[];
}

export function compileCedarPolicy(
  source: { policiesText: string; entities?: unknown[] },
  validator?: (text: string) => { ok: true } | { ok: false; errors: string[] },
): CedarCompiledArtifact {
  if (validator) {
    const v = validator(source.policiesText);
    if (!v.ok) {
      throw new Error(`cedar policy invalid: ${v.errors.join('; ')}`);
    }
  }
  return { policies: source.policiesText, entities: source.entities ?? [] };
}
