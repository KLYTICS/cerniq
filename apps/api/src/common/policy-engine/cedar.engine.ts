// CedarPolicyEngine — Cedar/WASM evaluation behind the PolicyEngine
// interface (ADR-0012, M-033).
//
// Why Cedar: AWS-native shops standardize on Cedar (Verified Permissions
// uses it). Cedar has a peer-reviewed formal model, a SMT-backed static
// analyzer, and a WASM build with no Node-specific dependencies — making
// it CF-Worker portable per ADR-0003.
//
// Compile vs evaluate:
//   - At policy-create time, the controller compiles the customer's Cedar
//     policy to its parsed form, runs the static analyzer, and stores the
//     compiled artifact on `AgentPolicy.compiledArtifact` (column added in
//     M-026 schema work — currently `engineMetadata` JSON column reuse).
//   - At verify time, the engine deserializes the artifact and evaluates
//     against (principal, action, resource, context) attributes.
//
// Mapping OKORO → Cedar:
//   principal = Agent::"<agent.id>"
//   action    = Action::"<verify-input.action>"     e.g. Action::"commerce.purchase"
//   resource  = MerchantDomain::"<verify-input.merchantDomain>" || Wildcard
//   context   = { trustBand, trustScore, amount, currency, windowSpend, limit }
//
// OKORO denial reasons are NOT one-to-one with Cedar's `Allow`/`Deny`.
// We map:
//   Cedar Allow + spend within limit → APPROVE
//   Cedar Deny                       → DENY (denialReason from `obligation.okoro_reason`
//                                           if present, else POLICY_VIOLATION)
//   Cedar Allow + spend exceeded     → DENY (SPEND_LIMIT_EXCEEDED)
//   Cedar evaluation error           → DENY (POLICY_REVOKED with subReason)

import type {
  AgentSnapshot,
  DenialReason,
  PolicyEngine,
  PolicyEvaluationInput,
  PolicyEvaluationResult,
} from './engine.interface.js';

/**
 * Minimal `cedar-wasm`-shaped surface — keeps the package optional in the
 * unit-test bundle. Production wiring constructs the real adapter.
 */
export interface CedarEvaluatorLike {
  /**
   * Evaluate a compiled artifact against (principal, action, resource, context).
   * Returns Cedar's authorization decision plus any obligations.
   */
  isAuthorized(input: {
    principal: string;
    action: string;
    resource: string;
    context: Record<string, unknown>;
    artifact: unknown;
  }): Promise<{
    decision: 'Allow' | 'Deny';
    diagnostics?: { reason?: string; errors?: string[] };
    obligations?: { kind: string; data: Record<string, unknown> }[];
  }>;
}

export class CedarPolicyEngine implements PolicyEngine {
  readonly id = 'cedar' as const;

  constructor(private readonly evaluator: CedarEvaluatorLike) {}

  async evaluate(input: PolicyEvaluationInput): Promise<PolicyEvaluationResult> {
    const artifact = (input.policy as PolicyEvaluationInput['policy'] & { compiledArtifact?: unknown }).compiledArtifact;
    if (!artifact) {
      // No compiled Cedar artifact on the policy — operator misconfigured.
      // Fail closed.
      return deny('POLICY_REVOKED', 'cedar_artifact_missing');
    }

    let result: Awaited<ReturnType<CedarEvaluatorLike['isAuthorized']>>;
    try {
      result = await this.evaluator.isAuthorized({
        principal: `Agent::"${input.agent.id}"`,
        action: `Action::"${input.action}"`,
        resource: input.merchantDomain
          ? `MerchantDomain::"${input.merchantDomain}"`
          : 'Wildcard::"*"',
        context: buildContext(input),
        artifact,
      });
    } catch (err) {
      return deny('POLICY_REVOKED', `cedar_eval_error:${(err as Error).message.slice(0, 64)}`);
    }

    if (result.decision === 'Deny') {
      const reasonClaim = result.obligations?.find((o) => o.kind === 'okoro.deny_reason');
      const claimedReason = reasonClaim?.data.reason as DenialReason | undefined;
      const reason: DenialReason =
        claimedReason && KNOWN_REASONS.has(claimedReason)
          ? claimedReason
          : 'SCOPE_NOT_GRANTED';
      return {
        decision: 'DENY',
        denialReason: reason,
        subReason: result.diagnostics?.reason,
        obligations: [],
        engineMetadata: { cedarDecision: 'Deny', diagnostics: result.diagnostics },
      };
    }

    // Allow path — Cedar said yes; OKORO still applies the spend gate
    // because Cedar policies are state-less re: spend windows. Spend is
    // a runtime computation that lives outside the policy.
    if (input.amount && input.spend) {
      if (input.spend.currency !== input.currency) {
        return deny('SCOPE_NOT_GRANTED', 'currency_mismatch');
      }
      const requested = Number.parseFloat(input.amount);
      const already = Number.parseFloat(input.spend.windowSpend);
      const limit = Number.parseFloat(input.spend.limit);
      if (Number.isFinite(requested) && Number.isFinite(already) && Number.isFinite(limit)) {
        if (requested + already > limit) {
          return deny('SPEND_LIMIT_EXCEEDED');
        }
      }
    }

    // Cedar obligations are free-form `kind: string`; narrow to the
    // PolicyEngine vocabulary, dropping unknown kinds (including the
    // sentinel `okoro.deny_reason` we already consumed above).
    const KNOWN_OBLIGATION_KINDS = new Set(['audit_extra', 'webhook_notify', 'bate_signal']);
    const narrowedObligations = (result.obligations ?? [])
      .filter((o): o is { kind: 'audit_extra' | 'webhook_notify' | 'bate_signal'; data: Record<string, unknown> } =>
        KNOWN_OBLIGATION_KINDS.has(o.kind),
      );
    return {
      decision: 'APPROVE',
      obligations: narrowedObligations,
      engineMetadata: { cedarDecision: 'Allow' },
    };
  }
}

const KNOWN_REASONS = new Set<DenialReason>([
  'AGENT_NOT_FOUND',
  'AGENT_REVOKED',
  'INVALID_SIGNATURE',
  'POLICY_REVOKED',
  'POLICY_EXPIRED',
  'SCOPE_NOT_GRANTED',
  'SPEND_LIMIT_EXCEEDED',
  'TRUST_SCORE_TOO_LOW',
  'ANOMALY_FLAGGED',
]);

function buildContext(input: PolicyEvaluationInput): Record<string, unknown> {
  const a: AgentSnapshot = input.agent;
  const ctx: Record<string, unknown> = {
    trustBand: a.trustBand,
    trustScore: a.trustScore,
    nowEpochSeconds: Math.floor(input.now.getTime() / 1000),
  };
  if (input.amount) ctx.amount = Number.parseFloat(input.amount);
  if (input.currency) ctx.currency = input.currency;
  if (input.merchantDomain) ctx.merchantDomain = input.merchantDomain;
  if (input.spend) {
    ctx.windowSpend = Number.parseFloat(input.spend.windowSpend);
    ctx.spendLimit = Number.parseFloat(input.spend.limit);
  }
  return ctx;
}

function deny(reason: DenialReason, sub?: string): PolicyEvaluationResult {
  return { decision: 'DENY', denialReason: reason, subReason: sub, obligations: [] };
}
