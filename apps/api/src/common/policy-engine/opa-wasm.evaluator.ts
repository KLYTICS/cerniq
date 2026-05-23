// OpaWasmEvaluator — production wiring of `@open-policy-agent/opa-wasm`
// behind the `OpaEvaluatorLike` shape used by `OpaPolicyEngine`.
//
// Sibling to `cedar-wasm.evaluator.ts`. Same separation rationale:
// `opa.engine.ts` stays framework + WASM free for CF-Worker portability;
// the WASM module lives here.
//
// One Rego file per AGENT_POLICY → one compiled WASM blob stored on
// `AgentPolicy.compiledArtifact`. The blob is the output of:
//
//   opa build -t wasm -e "data.cerniq.authz" policy.rego -o policy.wasm
//
// At verify time we instantiate the WASM module with the CERNIQ input
// document (built by `OpaPolicyEngine.buildDocument`) and read both
// `data.cerniq.authz.allow` (boolean) and `data.cerniq.authz.deny_reasons`
// (array of strings) from the result.

import type { OpaEvaluatorLike } from './opa.engine.js';

interface OpaWasmModule {
  /**
   * Load a compiled .wasm policy. Returns a per-policy evaluator
   * instance. opa-wasm's `loadPolicy()` is the canonical name.
   */
  loadPolicy(buffer: Uint8Array | ArrayBuffer): Promise<{
    evaluate(input: unknown): { result: unknown }[];
    setData(data: unknown): void;
  }>;
}

export class OpaWasmEvaluator implements OpaEvaluatorLike {
  private readonly opa: OpaWasmModule;
  /**
   * Cache of loaded policies, keyed by an artifact-derived hash. Each
   * customer policy gets compiled once at `policy.create` time and
   * loaded once per process; subsequent verify calls re-use the same
   * loaded instance. Cache size capped to prevent unbounded growth on
   * principals with thousands of distinct policies.
   */
  private readonly loaded = new Map<string, Awaited<ReturnType<OpaWasmModule['loadPolicy']>>>();
  private readonly maxLoaded = 256;

  constructor(opaModule?: OpaWasmModule) {
    if (opaModule) {
      this.opa = opaModule;
      return;
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      this.opa = require('@open-policy-agent/opa-wasm') as OpaWasmModule;
    } catch (err) {
      throw new Error(
        `opa-wasm not installed (${(err as Error).message}). ` +
          `Run \`pnpm install @open-policy-agent/opa-wasm\` in apps/api or ` +
          `inject a pre-loaded module into the constructor.`,
      );
    }
  }

  async evaluate(args: { artifact: unknown; document: Record<string, unknown> }): Promise<{
    allow: boolean;
    deny_reasons?: string[];
    metadata?: Record<string, unknown>;
  }> {
    const a = args.artifact as { wasmBytes?: string; cacheKey?: string };
    if (!a?.wasmBytes || typeof a.wasmBytes !== 'string') {
      throw new Error('OpaWasmEvaluator: artifact.wasmBytes (base64 string) required');
    }
    const cacheKey = a.cacheKey ?? a.wasmBytes.slice(0, 32);

    let policy = this.loaded.get(cacheKey);
    if (!policy) {
      const bytes = Uint8Array.from(Buffer.from(a.wasmBytes, 'base64'));
      policy = await this.opa.loadPolicy(bytes);
      // LRU-style eviction: drop the oldest if at capacity. For the
      // mid-2026 scale (~thousands of customers, dozens of policies each)
      // this stays O(1) on hits.
      if (this.loaded.size >= this.maxLoaded) {
        const oldestKey = this.loaded.keys().next().value;
        if (oldestKey !== undefined) this.loaded.delete(oldestKey);
      }
      this.loaded.set(cacheKey, policy);
    }

    const out = policy.evaluate(args.document);
    if (!Array.isArray(out) || out.length === 0) {
      // OPA-WASM returns an empty array when no rule matched; treat as
      // implicit deny (no `allow` rule fired).
      return { allow: false, deny_reasons: [] };
    }
    const result = (out[0]?.result ?? {}) as {
      allow?: boolean;
      deny_reasons?: string[];
      metadata?: Record<string, unknown>;
    };
    return {
      allow: Boolean(result.allow),
      deny_reasons: Array.isArray(result.deny_reasons)
        ? result.deny_reasons.filter((s) => typeof s === 'string')
        : [],
      metadata: result.metadata ?? undefined,
    };
  }
}

/**
 * Compile a Rego source file into the artifact shape our `OpaPolicyEngine`
 * expects. Called from the policy-create controller.
 *
 * NOTE: we do NOT shell out to `opa build` from within the API. Customers
 * upload pre-compiled WASM (see ADR-0012 §6) so that:
 *   1. The API has no Go runtime dependency.
 *   2. Static-analysis errors are caught client-side before policy create.
 *   3. The verify hot path is decoupled from a heavy compiler.
 *
 * The compile artifact format: `{ wasmBytes: <base64>, cacheKey: <stable id> }`.
 */
export interface OpaCompiledArtifact {
  wasmBytes: string; // base64
  cacheKey: string;
}

export function buildOpaArtifact(input: {
  wasmBytes: Uint8Array;
  cacheKey: string;
}): OpaCompiledArtifact {
  return {
    wasmBytes: Buffer.from(input.wasmBytes).toString('base64'),
    cacheKey: input.cacheKey,
  };
}
