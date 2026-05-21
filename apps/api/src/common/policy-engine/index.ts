// Public surface of the policy-engine package. Adapters are loaded by id
// at runtime; the verify path resolves which engine to use from
// `Principal.policyEngine` (see ADR-0012 §3).

export type {
  PolicyEngine,
  PolicyEngineId,
  PolicyEvaluationInput,
  PolicyEvaluationResult,
  PolicyObligation,
  PolicyScope,
  AgentSnapshot,
  PolicySnapshot,
  SpendContext,
  DenialReason,
} from './engine.interface.js';

export { BuiltinPolicyEngine } from './builtin.engine.js';
export { CedarPolicyEngine, type CedarEvaluatorLike } from './cedar.engine.js';
export { OpaPolicyEngine, type OpaEvaluatorLike } from './opa.engine.js';

import { BuiltinPolicyEngine } from './builtin.engine.js';
import { CedarPolicyEngine, type CedarEvaluatorLike } from './cedar.engine.js';
import type { PolicyEngine, PolicyEngineId } from './engine.interface.js';
import { OpaPolicyEngine, type OpaEvaluatorLike } from './opa.engine.js';

/**
 * Engine factories. Cedar and OPA require a runtime evaluator (cedar-wasm
 * or opa-wasm/sidecar) — those are constructed in `app.module.ts` where
 * the optional dependencies live. The factory below is the local default
 * (returns `null` if no evaluator was registered yet — caller errors).
 */
let cedarEvaluator: CedarEvaluatorLike | null = null;
let opaEvaluator: OpaEvaluatorLike | null = null;

/** Production wiring helper. Call once at AppModule init. */
export function registerCedarEvaluator(evaluator: CedarEvaluatorLike): void {
  cedarEvaluator = evaluator;
}
export function registerOpaEvaluator(evaluator: OpaEvaluatorLike): void {
  opaEvaluator = evaluator;
}

const REGISTRY = new Map<PolicyEngineId, () => PolicyEngine>([
  ['builtin', () => new BuiltinPolicyEngine()],
  ['cedar', () => {
    if (!cedarEvaluator) {
      throw new Error('cedar evaluator not registered — call registerCedarEvaluator() at boot');
    }
    return new CedarPolicyEngine(cedarEvaluator);
  }],
  ['opa', () => {
    if (!opaEvaluator) {
      throw new Error('opa evaluator not registered — call registerOpaEvaluator() at boot');
    }
    return new OpaPolicyEngine(opaEvaluator);
  }],
]);

export function resolvePolicyEngine(id: PolicyEngineId): PolicyEngine {
  const factory = REGISTRY.get(id);
  if (!factory) throw new Error(`Unknown policy engine: ${id}`);
  return factory();
}

/** Test helper. Production code MUST NOT call this. */
export function __resetPolicyEnginesForTests(): void {
  cedarEvaluator = null;
  opaEvaluator = null;
}
