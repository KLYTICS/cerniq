// OpaPolicyEngine — Open Policy Agent (Rego) evaluation behind the
// PolicyEngine interface (ADR-0012, M-034).
//
// Why OPA: Kubernetes / CNCF shops standardize on OPA. Rego is mature,
// has rich tooling (`opa test`, `opa fmt`, `regal` linter), and runs
// either as a sidecar HTTP service or as a WASM module embedded in the
// process. We support both; the `OpaEvaluatorLike` interface absorbs
// the difference.
//
// Embedded WASM (preferred for the hot path):
//   - Customer compiles their Rego at policy-create time:
//       opa build -t wasm -e "data.cerniq.authz.allow" policy.rego -o policy.wasm
//   - We store the WASM bytes on `AgentPolicy.compiledArtifact`.
//   - At verify time, instantiate a `@open-policy-agent/opa-wasm`
//     instance per request (or pool) and evaluate against the input
//     document.
//
// Sidecar HTTP (fallback for shops with a central OPA fleet):
//   - We POST `{ input: ... }` to `OPA_SIDECAR_URL/v1/data/cerniq/authz/allow`
//   - Response: `{ result: true }` for Allow, `{ result: false }` for Deny.
//
// Mapping CERNIQ → OPA input document:
//   {
//     "agent":         { id, status, trustScore, trustBand, principalId },
//     "action":        "<verify-input.action>",
//     "amount":        <number, optional>,
//     "currency":      "<iso, optional>",
//     "merchant":      "<domain, optional>",
//     "trust":         { band, score },
//     "spend":         { window, limit, currency, optional },
//     "now_unix":      <epoch seconds>
//   }
//
// Rego conventions:
//   - `package cerniq.authz`
//   - `default allow = false`
//   - `allow { ... }` — Allow path.
//   - `deny_reason["<DenialReason>"] { ... }` — emits a denial reason
//     from the locked CERNIQ enum (ADR-0004). When `allow == false` AND
//     a `deny_reason` rule is true, the engine surfaces that reason;
//     otherwise it defaults to SCOPE_NOT_GRANTED.

import type {
  DenialReason,
  PolicyEngine,
  PolicyEvaluationInput,
  PolicyEvaluationResult,
} from './engine.interface.js';

/**
 * Minimal OPA evaluator surface — intentionally engine-agnostic so unit
 * tests can mock without pulling in either `opa-wasm` or HTTP.
 */
export interface OpaEvaluatorLike {
  /**
   * Evaluate the policy against the input document. Returns:
   *   - `allow`: boolean — was the request allowed?
   *   - `deny_reasons`: array of strings — names of triggered deny_reason
   *     rules (when allow=false).
   *   - `metadata`: free-form, audited.
   */
  evaluate(input: { artifact: unknown; document: Record<string, unknown> }): Promise<{
    allow: boolean;
    deny_reasons?: string[];
    metadata?: Record<string, unknown>;
  }>;
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

export class OpaPolicyEngine implements PolicyEngine {
  readonly id = 'opa' as const;

  constructor(private readonly evaluator: OpaEvaluatorLike) {}

  async evaluate(input: PolicyEvaluationInput): Promise<PolicyEvaluationResult> {
    const artifact = (
      input.policy as PolicyEvaluationInput['policy'] & { compiledArtifact?: unknown }
    ).compiledArtifact;
    if (!artifact) return deny('POLICY_REVOKED', 'opa_artifact_missing');

    const document = buildDocument(input);

    let result: Awaited<ReturnType<OpaEvaluatorLike['evaluate']>>;
    try {
      result = await this.evaluator.evaluate({ artifact, document });
    } catch (err) {
      return deny('POLICY_REVOKED', `opa_eval_error:${(err as Error).message.slice(0, 64)}`);
    }

    if (!result.allow) {
      const claimed = (result.deny_reasons ?? [])[0] as DenialReason | undefined;
      const reason: DenialReason =
        claimed && KNOWN_REASONS.has(claimed) ? claimed : 'SCOPE_NOT_GRANTED';
      return {
        decision: 'DENY',
        denialReason: reason,
        subReason: result.deny_reasons?.join(',') ?? undefined,
        obligations: [],
        engineMetadata: { opaResult: 'deny', metadata: result.metadata },
      };
    }

    // Allow path — apply spend gate independently (Rego policies don't
    // hold spend windows; the engine does).
    if (input.amount && input.spend) {
      if (input.spend.currency !== input.currency) {
        return deny('SCOPE_NOT_GRANTED', 'currency_mismatch');
      }
      const requested = Number.parseFloat(input.amount);
      const already = Number.parseFloat(input.spend.windowSpend);
      const limit = Number.parseFloat(input.spend.limit);
      if (Number.isFinite(requested) && Number.isFinite(already) && Number.isFinite(limit)) {
        if (requested + already > limit) return deny('SPEND_LIMIT_EXCEEDED');
      }
    }

    return {
      decision: 'APPROVE',
      obligations: [],
      engineMetadata: { opaResult: 'allow', metadata: result.metadata },
    };
  }
}

function buildDocument(input: PolicyEvaluationInput): Record<string, unknown> {
  const a = input.agent;
  const doc: Record<string, unknown> = {
    agent: {
      id: a.id,
      status: a.status,
      trustScore: a.trustScore,
      trustBand: a.trustBand,
      principalId: a.principalId,
    },
    action: input.action,
    trust: { band: a.trustBand, score: a.trustScore },
    now_unix: Math.floor(input.now.getTime() / 1000),
  };
  if (input.amount) doc.amount = Number.parseFloat(input.amount);
  if (input.currency) doc.currency = input.currency;
  if (input.merchantDomain) doc.merchant = input.merchantDomain;
  if (input.spend) {
    doc.spend = {
      window: Number.parseFloat(input.spend.windowSpend),
      limit: Number.parseFloat(input.spend.limit),
      currency: input.spend.currency,
    };
  }
  return doc;
}

function deny(reason: DenialReason, sub?: string): PolicyEvaluationResult {
  return { decision: 'DENY', denialReason: reason, subReason: sub, obligations: [] };
}
