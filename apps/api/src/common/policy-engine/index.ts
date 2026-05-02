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

import type { PolicyEngine, PolicyEngineId } from './engine.interface.js';
import { BuiltinPolicyEngine } from './builtin.engine.js';

const REGISTRY = new Map<PolicyEngineId, () => PolicyEngine>([
  ['builtin', () => new BuiltinPolicyEngine()],
  // ['cedar', () => new CedarPolicyEngine()],   // M-033
  // ['opa',   () => new OpaPolicyEngine()],     // M-034
]);

export function resolvePolicyEngine(id: PolicyEngineId): PolicyEngine {
  const factory = REGISTRY.get(id);
  if (!factory) throw new Error(`Unknown policy engine: ${id}`);
  return factory();
}
