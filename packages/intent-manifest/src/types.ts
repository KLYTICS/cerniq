// Intent Manifest type contract.
//
// An IntentManifest is a signed declaration issued by AEGIS at verify-token
// time. It pre-binds the agent's *declared* intent for the next bounded
// window (typically 30-60s, matching TOKEN_TTL bounds). The relying party
// receives both the verify token AND the signed intent manifest; after the
// agent acts, the relying party (or AEGIS itself, asynchronously) calls
// `reconcileIntent(manifest, actual)` to detect deviation.
//
// Why this exists:
//   The May-2026 agentic-landscape audit (docs/SESSION_HANDOFF 2026-05-12)
//   flagged "intent-bound attestation" as gap #5: no platform vendor
//   (Anthropic, OpenAI, OAuth, MCP, SPIFFE) is structurally incentivized
//   to bind tokens to declared intent. AEGIS owns this surface because we
//   already sit at the tool-call checkpoint and already sign what we
//   observed (CLAUDE.md root invariant — Testament Book I §3).
//
// Invariant alignment:
//   #2 verify portability — pure types, no Node/Nest. Ports to CF Worker.
//   #3 audit append-only — manifests are signed at issuance and never
//      mutated; reconciliation outcomes are NEW audit rows referencing
//      the manifest's id, not edits to it.
//   #4 no silent failures — `IntentMismatch.kind` is a closed enum; no
//      `unknown` fallthrough; reconcile() returns typed result, never null.

// ────────────────────────────────────────────────────────────────────────
// SECTION 1 — Manifest envelope (stable)
// ────────────────────────────────────────────────────────────────────────

/** Wire schema version. Bump when the canonical pre-image shape changes. */
export const INTENT_MANIFEST_SCHEMA_V1 = 1 as const;

/** Anchored to the verify token's TTL — see packages/types TOKEN_TTL_*. */
export interface IntentManifestBody {
  schemaVersion: typeof INTENT_MANIFEST_SCHEMA_V1;
  /** Globally unique manifest id (ULID/UUIDv7). */
  manifestId: string;
  /** Unix seconds at issuance. */
  issuedAt: number;
  /** Unix seconds — must be ≤ issuedAt + TOKEN_TTL_MAX_SECONDS. */
  expiresAt: number;
  /** Principal that owns the agent (tenant boundary per invariant #5). */
  principalId: string;
  /** Agent whose intent this declares. */
  agentId: string;
  /**
   * The intent payload itself. Discriminated union over the three
   * shapes shipped in publish-1.0 (operator-locked 2026-05-15, ADR-0016):
   *   - `http-call` — exact URL + method
   *   - `commerce-action` — action verb + optional merchant + amount cap
   *   - `tool-invocation` — MCP tool name + canonical args hash
   */
  intent: IntentClaim;
  /** Reconciliation policy attached to this manifest at issuance. */
  reconciliation: ReconciliationPolicy;
  /**
   * Verify token binding — prevents replay across tokens. The relying
   * party MUST check these match the verify token they're about to honor.
   */
  verifyTokenJti: string;
  verifyTokenSha256B64Url: string;
}

/** Signed wrapper. Mirrors @aegis/audit-verifier SignedAuditCompressionManifest. */
export interface SignedIntentManifest {
  body: IntentManifestBody;
  signingKeyId: string;
  signatureB64Url: string;
}

// ────────────────────────────────────────────────────────────────────────
// SECTION 2 — Intent claim shape (locked: keep all three — ADR-0016)
// ────────────────────────────────────────────────────────────────────────

/**
 * Discriminated union over the three shipped intent shapes. Adding a
 * fourth member is a single switch arm in `reconcile.ts` + a single
 * test (the `assertNever` exhaustiveness check is compiler-enforced).
 *
 * Why all three: each maps to a distinct AEGIS adoption wedge —
 *   - `http-call`       → API-platform agents (Browserbase-class)
 *   - `commerce-action` → ACP merchants + treasury platforms (Testament IV §i-iii)
 *   - `tool-invocation` → MCP wedge (Testament I §3 — "three lines of code")
 * Operator may deprecate one member later in a 1.x release as
 * adoption telemetry settles; the kernel handles deprecation via
 * issuance-side rejection, never by removing the type member.
 */
export type IntentClaim = HttpCallClaim | CommerceActionClaim | ToolInvocationClaim;

export interface HttpCallClaim {
  kind: 'http-call';
  /** Exact URL OR URL-template (RFC 6570). One per claim. */
  url: string;
  /** HTTP method. UPPERCASE. */
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';
  /** Upper bound on call count within the manifest window. */
  maxCalls: number;
}

export interface CommerceActionClaim {
  kind: 'commerce-action';
  /** Action verb — mirrors policy scope vocabulary (e.g. 'stripe.charge'). */
  action: string;
  /** Optional merchant binding — when present, actuals MUST match. */
  merchantId?: string;
  merchantDomain?: string;
  /** Upper bound on call count within the manifest window. */
  maxCalls: number;
  /** Optional per-call spend cap. Both fields required if either present. */
  amountCap?: { amount: string; currency: string };
}

export interface ToolInvocationClaim {
  kind: 'tool-invocation';
  /** Tool name as advertised by the MCP server. */
  toolName: string;
  /** SHA-256 of the canonical arguments envelope, base64url. */
  argsSha256B64Url: string;
  /** Upper bound on call count within the manifest window. */
  maxCalls: number;
}

// ────────────────────────────────────────────────────────────────────────
// SECTION 3 — Reconciliation policy (locked: strict default — ADR-0016)
// ────────────────────────────────────────────────────────────────────────

/**
 * Reconciliation strictness — what happens when the agent's actual call
 * deviates from the declared intent.
 *
 * Locked behavior (ADR-0016 / operator 2026-05-15):
 *   - `strict` (default if `reconciliation` field is omitted at issuance)
 *     — ANY mismatch yields `INTENT_MISMATCH` denial.
 *   - `advisory` — mismatches recorded but no denial returned; emits
 *     audit event + BATE signal for forensic visibility.
 *   - `graduated` — over-call-count tolerated up to `floor(declared *
 *     (1 + tolerance/100))`. NON-count mismatches (wrong-merchant,
 *     over-amount-cap, wrong-method, wrong-endpoint, arg-shape-mismatch)
 *     are ALWAYS strict regardless of tolerance. Default tolerance: 20%.
 */
export type ReconciliationStrictness = 'strict' | 'advisory' | 'graduated';

/** Default tolerance for `graduated` mode when `tolerance` is omitted. */
export const DEFAULT_GRADUATED_TOLERANCE_PCT = 20 as const;

export interface ReconciliationPolicy {
  strictness: ReconciliationStrictness;
  /**
   * Only meaningful when strictness === 'graduated'. Percentage (0+) by
   * which over-call-count may exceed declared `maxCalls` before STRICT
   * semantics kick in. Non-count mismatches IGNORE this field.
   * e.g. tolerance=20, declared maxCalls=10 → 12 actuals advisory,
   * 13+ actuals deny.
   * Defaults to DEFAULT_GRADUATED_TOLERANCE_PCT when omitted.
   */
  tolerance?: number;
}

// ────────────────────────────────────────────────────────────────────────
// SECTION 4 — Reconciliation result (closed enum, no fallthrough)
// ────────────────────────────────────────────────────────────────────────

/** Single actual observation, supplied by the relying party. */
export interface ActualCallObservation {
  /** Wall-clock when AEGIS or the relying party recorded the actual. */
  observedAt: number;
  /** Discriminator MUST match the manifest's intent.kind. */
  kind: IntentClaim['kind'];
  /** Free-form observation payload — verifier-side schema. */
  payload: Record<string, unknown>;
}

export type IntentMismatchKind =
  | 'over-call-count' // exceeded maxCalls
  | 'wrong-endpoint' // URL/action/tool doesn't match
  | 'wrong-method' // method mismatch (http-call only)
  | 'wrong-merchant' // merchantId/Domain mismatch (commerce-action only)
  | 'over-amount-cap' // per-call amount > declared cap (commerce-action only)
  | 'arg-shape-mismatch' // argsSha256B64Url mismatch (tool-invocation only)
  | 'manifest-expired' // observedAt > expiresAt
  | 'manifest-not-yet-valid'; // observedAt < issuedAt (clock skew or replay)

export interface IntentMismatch {
  kind: IntentMismatchKind;
  /** Human-readable detail. NEVER include PII or secret material. */
  detail: string;
  /** When mismatch was detected. */
  detectedAt: number;
}

export interface ReconciliationResult {
  /** Manifest under reconciliation. */
  manifestId: string;
  /** Number of actuals walked. */
  actualCount: number;
  /** Mismatches found. Empty array = clean match. */
  mismatches: readonly IntentMismatch[];
  /**
   * The wire-level outcome — what the gateway (or relying party) should
   * do given strictness + mismatches.
   *
   * Locked (ADR-0016 / operator 2026-05-15): emits the literal string
   * `'INTENT_MISMATCH'` on denial, `null` on clean match or advisory mode.
   * The literal is byte-identical to the `INTENT_MISMATCH` member appended
   * to `DENIAL_REASON_PRECEDENCE` in `@aegis/types`. We use a string
   * (not an imported constant) so this package stays zero-dependency on
   * `@aegis/types` and remains edge-runtime portable.
   */
  recommendedDenialReason: 'INTENT_MISMATCH' | null;
}
