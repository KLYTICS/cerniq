# OKORO Public Type Contract Audit (2026 Q2)

**Scope of audit**

- `/Users/money/Desktop/OKORO/packages/types/src/schemas.ts` (Zod source of truth)
- `/Users/money/Desktop/OKORO/packages/types/src/constants.ts`
- `/Users/money/Desktop/OKORO/packages/types/src/errors.ts`
- `/Users/money/Desktop/OKORO/packages/sdk-ts/src/types.ts` (hand-written SDK types)
- `/Users/money/Desktop/OKORO/packages/sdk-ts/src/errors.ts` (OkoroError tree)
- `/Users/money/Desktop/OKORO/apps/api/src/modules/{identity,policy,verify}/*.dto.ts`
- `/Users/money/Desktop/OKORO/docs/spec/OKORO_API_SPEC.yaml`

Read-only; no source modified.

---

## 1. Ratings Table

| Dimension | Score (1-5) | One-line justification |
| --- | :---: | --- |
| **Encapsulation** (domain primitive distinguishability) | **1 / 5** | `AgentId`, `PolicyId`, `PrincipalId` are all bare `z.string().min(1).max(64)`. Nothing prevents passing a `policyId` where an `agentId` is required at compile or runtime. |
| **Invariant expression** (constraints visible in the type) | **2 / 5** | Numeric ranges and enums are expressed in Zod and survive into the inferred type only weakly. `.refine()` invariants (`SpendLimit` at-least-one-bound, `PolicyScope` field interactions, `expiresAt` future-only) are entirely invisible at the TS type level. |
| **Usefulness / wire-format alignment** with OpenAPI spec | **2 / 5** | Multiple drift points: `AgentRuntime` enum membership, `AgentStatus` casing (`active` vs `ACTIVE`), `PolicyStatus` casing (`active` vs `ACTIVE`), missing fields (`spendRemaining`, `auditEventId`, `principalId` on `RegisterAgentInput`), and case drift between TS (`merchantDomain`) and Python (`merchant_domain`) SDKs. |
| **Enforcement** (do TS guarantees match Zod's runtime) | **2 / 5** | Zod parses correctly at runtime, but every `.refine()` returns the unrefined object type — TS sees `number` for `trustScore`, `string` for `agentId`, and an unconstrained `SpendLimit` shape. Passing un-validated data through the SDK silently bypasses every invariant Zod checks. |
| **Overall design strength** | **2 / 5** | Solid Zod-first instinct and good shared-constants discipline, but the security model leans on invariants the type system never sees. For a product whose value prop is "strong, neutral identity," this is the highest-leverage gap. |

---

## 2. Per-Type Findings

Severity tags: **CRIT** (security-relevant or wire-incompatible) · **HIGH** (bug magnet) · **MED** (DX / maintainability) · **LOW** (cosmetic).

### 2.1 Domain primitives — `AgentIdSchema`, `PolicyIdSchema`, `PrincipalIdSchema`

`packages/types/src/schemas.ts:17-19`

```ts
export const PrincipalIdSchema = z.string().min(1).max(64);
export const AgentIdSchema     = z.string().min(1).max(64);
export const PolicyIdSchema    = z.string().min(1).max(64);
```

**Severity: CRIT**

- All three infer to plain `string`. They are mutually substitutable everywhere — argument order swaps, accidental cross-tenant lookups, and ID confusion bugs cannot be caught at compile time.
- The OpenAPI spec encodes a real prefix invariant (`agt_*`, `pol_*` — see spec lines 295, 302). Neither the schema nor the inferred type captures this.
- No regex; `z.string().min(1).max(64)` would happily accept the literal string `"; DROP TABLE agents; --"`.
- Comparable invariant strength is achievable cheaply with a Zod `.brand<"AgentId">()` plus a prefix regex (see proposal §4).

**Impact in this codebase:** `verify.controller.ts`, `policy.service.ts`, and the BATE pipeline all pass these IDs across module boundaries. A function that accidentally takes `(policyId, agentId)` instead of `(agentId, policyId)` typechecks today. For an API where audit attribution is part of the trust contract, this is a meaningful gap.

---

### 2.2 `trustScore` — numeric range invariant

`schemas.ts:98, 110, 119, 157, 170, 193`

```ts
trustScore: z.number().int().min(0).max(1000)
```

**Severity: HIGH**

- Zod runtime check is correct.
- Inferred type is plain `number`. A function that accepts `trustScore: number` will accept `-5`, `1500`, `Number.MAX_SAFE_INTEGER`, or `NaN` from any unparsed input source (DB read, Redis cache hydration, internal RPC).
- The thresholds in `constants.ts` (`TRUST_BAND_THRESHOLDS = { PLATINUM: 750, ... }`) are unrelated to the type — there's no compile-time guarantee that `trustScore >= 750 ⇒ trustBand === 'PLATINUM'`. This invariant is enforced only by whichever code path computes the band.

**Recommended fix:** brand as `TrustScore` (0..1000 integer) and expose a single constructor `TrustScore.from(n: number): TrustScore` that throws on out-of-range. Use `Brand<number, "TrustScore">` via Zod's `.brand()`.

---

### 2.3 `SpendLimit` — at-least-one-bound invariant

`schemas.ts:61-71`

**Severity: HIGH**

```ts
export const SpendLimitSchema = z.object({...})
  .refine((v) => v.maxPerTransaction !== undefined || v.maxPerDay !== undefined || v.maxPerMonth !== undefined,
          'At least one of maxPerTransaction / maxPerDay / maxPerMonth must be set.');
```

- Runtime invariant is correct.
- TS-inferred `SpendLimit` is `{ currency; maxPerTransaction?; maxPerDay?; maxPerMonth? }` — i.e. the empty-bounds case is *fully representable* in the type. The `verify-rp` package can construct an empty `SpendLimit` and not see any compile error.
- This is the canonical "make illegal states unrepresentable" miss. The discriminated-union form (see §4) eliminates it.
- The NestJS DTO `SpendLimitDto` does not replicate the `.refine()` at all — the DTO will accept `{ currency: "USD" }` with no bounds. Validation chain is inconsistent.

---

### 2.4 `PolicyScope.allowedDomains` — non-empty-when-present

`schemas.ts:73-81`

**Severity: MED**

- `allowedDomains: z.array(z.string().min(1).max(255)).max(64).optional()` — when `undefined`, "no allowlist" is meant, but when present, an empty array is allowed and silently denies all domains. This is exactly the SCOPE_NOT_GRANTED bug the spec calls out.
- Same applies to `merchantCategories` and `dataScopes`.
- Each per-element string is unconstrained: `allowedDomains: [""]` would fail (good — `min(1)`) but `["http://*"]` or `["DELTA.COM"]` (uppercase) is accepted with no normalization. There is no domain-format regex.

**Recommended fix:**

- `.array(...).min(1).max(64).optional()` (or use `nonempty()`).
- Add a domain regex (e.g. RFC 1123 hostname) and lowercase normalization at construction time.

---

### 2.5 `expiresAt` / `validUntil` / `validFrom` — future-only & ordering

`schemas.ts:79-80, 128, 135, 144`

**Severity: HIGH**

- `expiresAt: IsoDateTimeSchema` validates ISO format only — *not* future-ness.
- `validFrom < validUntil` is a natural invariant for a scope; there is no cross-field `.refine()`.
- `expiresAt > now() + POLICY_TTL_MAX_DAYS` is a hard cap in the constants (line 24) but not in the schema.
- `verifiedAt`, `registeredAt`, `lastSeenAt`, `createdAt` are all just typed `string`. No `Date` type, no monotonicity, no "must be in past" check.

**Recommended fix:** introduce a branded `IsoDateTime` (string), a `FutureIsoDateTime` (within `[now, now + cap]`), and a `PastOrPresentIsoDateTime`. Add cross-field `.refine()` for `validFrom < validUntil` and for `expiresAt > now`.

---

### 2.6 `JwtTokenSchema` — token format

`schemas.ts:30-32`

```ts
.regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/, 'must be a compact JWT')
```

**Severity: MED**

- Catches the gross "missing dot" / non-base64url-character cases.
- Does **not** catch:
  - empty segments (`a.b.c` will be accepted with the `+` quantifier — actually `+` requires one char, so empty is rejected, OK; but a 1-char header is accepted, which is never a valid JWT header).
  - segments that are syntactically base64url but not valid base64url-decoded JSON for header/payload.
  - signature length compatible with EdDSA (64 bytes / 86 chars b64url).
- The regex rejects padding (`=`) which is correct for compact-form JWS.
- Length should be bounded (`.max(2048)` like the DTO does — currently unbounded).

**Recommended fix:** add `.min(20).max(2048)`; consider a `.refine()` that base64url-decodes the header and asserts `alg ∈ {EdDSA}`.

---

### 2.7 `AgentRuntimeSchema` — open-vs-closed enum

`schemas.ts:36`

```ts
z.enum(['openai', 'anthropic', 'google', 'huggingface', 'custom'])
```

**Severity: MED — and a wire-spec mismatch (CRIT for compatibility)**

- Closed list including the literal `'custom'` is the worst of both worlds: customers using LangChain-only, Mistral, xAI, DeepSeek, vLLM, Ollama, Bedrock, Vertex (different from `google`) all collapse onto `'custom'` and lose telemetry granularity for BATE.
- Spec drift: `OKORO_API_SPEC.yaml:342` enumerates `[openai, anthropic, google, custom]` (no `huggingface`). Schema and spec disagree. SDK (`sdk-ts/src/types.ts:5`) uses **uppercase** values — three different surfaces, three different shapes.
- The DTO enum `AgentRuntimeDto` is also uppercase (`OPENAI`, `ANTHROPIC`, …) — the API request body would fail Zod validation if the DTO ever flowed through. The two systems are wired separately and only happen to coexist.

**Recommended fix:** model as a discriminated open enum:

```ts
const AgentRuntimeKnown = z.enum(['openai','anthropic','google','huggingface','mistral','meta','xai','deepseek','vertex','bedrock','ollama','vllm','langchain']);
const AgentRuntime = z.union([
  z.object({ kind: z.literal('known'), value: AgentRuntimeKnown }),
  z.object({ kind: z.literal('custom'), value: z.string().min(1).max(64).regex(/^[a-z0-9_-]+$/) }),
]);
```

This preserves enum precision for known runtimes, lets new entrants register without an SDK release, and keeps `custom` distinguishable from "unknown known."

---

### 2.8 `CurrencySchema` — `[USD, EUR, GBP]` only

`schemas.ts:41`

**Severity: HIGH** (in the agentic-commerce 2026 timeframe)

- Hard-coded fiat triple. Misses: JPY, CHF, AUD, CAD, CNY, INR, SGD, HKD (all top-15 fiat by agent commerce volume).
- Misses **stablecoins** (USDC, USDT, DAI, PYUSD, RLUSD) and **CBDCs** (e-CNY, eEUR pilots, Sand Dollar) — the latter are real settlement targets for autonomous agents in 2026.
- Once a non-USD/EUR/GBP merchant integrates, the only way to verify is to pass `currency: undefined` and lose spend-limit enforcement entirely. That is the silent-bypass class of bug we want types to prevent.
- ISO 4217 is the common compromise; an `ISO4217Code` regex (`^[A-Z]{3}$`) plus a registry of known codes (alphabetic, three-letter) covers fiat and stablecoins (USDC, USDT, DAI all conform). For CBDCs, prefer the IBAN-style `eXXX` pattern documented in BIS Project Agorá.

**Recommended fix:**

```ts
const FiatCurrency = z.enum([...ISO4217]);
const Stablecoin   = z.enum(['USDC','USDT','DAI','PYUSD','RLUSD','USDP','TUSD']);
const CBDC         = z.enum(['eCNY','eEUR','eGBP','eUSD','SAND']);
const Currency = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('fiat'), code: FiatCurrency }),
  z.object({ kind: z.literal('stablecoin'), code: Stablecoin, chain: z.string() }),
  z.object({ kind: z.literal('cbdc'), code: CBDC }),
]);
```

For backward compatibility, accept `string` and parse into the discriminated form server-side; expose only the discriminated form to new SDK consumers.

---

### 2.9 `DenialReason` — enum, but not bound to `OkoroError`

`constants.ts:53-65`, `errors.ts`, `sdk-ts/src/errors.ts`

**Severity: HIGH**

- `DenialReason` is a 9-variant string union driven by `DENIAL_REASON_PRECEDENCE`.
- The `OkoroError` tree (`sdk-ts/src/errors.ts`) tags errors by HTTP `code` (`AUTH_REQUIRED`, `FORBIDDEN`, …) — completely orthogonal to `DenialReason`. There is no `OkoroDeniedVerify` class, and no compile-time link between "this verify came back `valid: false`" and "the denial reason is one of the 9 documented values."
- A relying party doing `if (result.denialReason === 'ANOMALY_FLAGGED')` has zero protection against a typo, a stale enum, or a future renamed reason. The `precedence` order — which is part of the **public API contract** per `SECURITY.md` — is encoded only as array order, not as a partial-order type.

**Recommended fix:**

1. Add a sealed denial-reason class hierarchy:
   ```ts
   abstract class OkoroDenialReason {
     abstract readonly code: DenialReason;
     abstract readonly precedence: number; // from DENIAL_REASON_PRECEDENCE index
   }
   class AgentNotFound extends OkoroDenialReason { code = 'AGENT_NOT_FOUND' as const; precedence = 0; }
   // ... one class per reason
   ```
2. Make `VerifyResponse.denialReason` a discriminated union: `{ valid: true } | { valid: false, denialReason: DenialReason, ... }`. Today both `valid: true` and `valid: false` share the same shape, so consumers can read `agentId!` after a denial and crash.
3. Introduce a typed `OkoroDeniedVerifyError` that the SDK can throw if the caller used `client.verifyOrThrow()`.

---

### 2.10 `VerifyResponse` — discriminated union missed

`schemas.ts:166-178`

**Severity: HIGH**

```ts
export const VerifyResponseSchema = z.object({
  valid: z.boolean(),
  agentId: AgentIdSchema.nullable(),
  principalId: PrincipalIdSchema.nullable(),
  trustScore: z.number().int().min(0).max(1000),
  trustBand: TrustBandSchema.nullable(),
  scopesGranted: z.array(z.string()),
  spendRemaining: VerifySpendRemainingSchema.nullable().optional(),
  denialReason: DenialReasonSchema.nullable(),
  ...
});
```

- `valid: true` and `valid: false` are conflated into one type. Consumers must null-check `agentId` and `denialReason` independently. The state space allows the impossible `{ valid: true, denialReason: 'ANOMALY_FLAGGED' }` and `{ valid: false, denialReason: null }`.
- A `z.discriminatedUnion('valid', [Approved, Denied])` makes the impossible states unrepresentable, and Zod handles it cleanly.
- `scopesGranted: z.array(z.string())` — element type is unconstrained. A successful verify could return `scopesGranted: ['']`. Should be `PolicyCategorySchema | string` (for sub-scopes like `commerce.purchase`).

---

### 2.11 SDK-vs-types-vs-OpenAPI drift catalog

| Field / type | `packages/types` (Zod) | `sdk-ts/src/types.ts` (hand) | OpenAPI spec | NestJS DTO | Severity |
| --- | --- | --- | --- | --- | --- |
| `AgentRuntime` values | `'openai' \| 'anthropic' \| 'google' \| 'huggingface' \| 'custom'` | `'OPENAI' \| 'ANTHROPIC' \| 'GOOGLE' \| 'HUGGINGFACE' \| 'CUSTOM'` | `[openai, anthropic, google, custom]` (no huggingface) | `OPENAI \| ANTHROPIC \| GOOGLE \| HUGGINGFACE \| CUSTOM` | **CRIT** |
| `AgentStatus` values | `'pending_verification' \| 'active' \| 'suspended' \| 'revoked'` | `'PENDING_VERIFICATION' \| 'ACTIVE' \| 'SUSPENDED' \| 'REVOKED'` | `[active, suspended, revoked]` (no pending) | uppercase string | **CRIT** |
| `PolicyStatus` values | `'active' \| 'expired' \| 'revoked'` | (not exported) | `[active, expired, revoked]` | `'ACTIVE' \| 'EXPIRED' \| 'REVOKED'` | **HIGH** |
| `RegisterAgentInput.principalId` | required | **missing** | required | (DTO doesn't expose it) | **CRIT** |
| `VerifyResult.spendRemaining` | present (nullable) | **missing** | present | not on DTO | **HIGH** |
| `VerifyResult.auditEventId` | present | missing | not declared | not on DTO | MED |
| `SignContext.merchantDomain` | (TS) | `merchantDomain` | `merchantDomain` | `merchantDomain` | — |
| Python `SignContext.merchant_domain` | snake_case | (n/a) | (n/a) | (n/a) | **HIGH** (cross-SDK case drift; documented at `packages/sdk-py/okoro/crypto.py:56`) |
| `SignContext.ttlSeconds` | not in any schema | present (SDK-only) | not in spec | n/a | MED |
| `OkoroError` (SDK) | n/a | `interface OkoroError extends Error { status }` | `Error` schema | n/a | MED — SDK file `types.ts` declares an interface that conflicts with the abstract class in `errors.ts` |

The two `OkoroError` declarations (`sdk-ts/src/types.ts:105` interface vs `sdk-ts/src/errors.ts:7` abstract class) is itself a real-world bug: TypeScript will pick whichever import path is used. The interface is not assignable to the abstract class. **Severity: HIGH.**

---

### 2.12 Policy DTO inconsistencies

`apps/api/src/modules/policy/policy.dto.ts`

**Severity: HIGH**

- DTO uses `class-validator`; Zod uses `.refine()`. The two validation surfaces validate **different** invariants. `SpendLimitDto` does not enforce at-least-one-bound. `CreatePolicyDto` does not enforce `expiresAt` is in the future or under `POLICY_TTL_MAX_DAYS`.
- Enum casing diverges (e.g. `ScopeCategory.COMMERCE = 'commerce'` is lowercase value but `PolicyResponseDto.status` advertises `['ACTIVE','EXPIRED','REVOKED']` with uppercase values — the schema uses lowercase). Either the wire format is broken or the Swagger docs are wrong.
- `dataScopes` array max size is `64` in Zod but `32` in the DTO — these are direct contradictions.

---

### 2.13 Audit / report schemas

`schemas.ts:182-211`

**Severity: MED**

- `AuditEventSchema.eventId` is unconstrained `z.string()` — should be ULID-shaped (matches the `agt_*`/`pol_*` ID family).
- `AuditEventSchema.signature` is `z.string()` with no length / format — given this is a tamper-evidence proof per the spec (line 615), it should be `z.string().regex(/^[A-Za-z0-9_-]+$/).length(86)` (Ed25519 b64url) or similar.
- `ReportRequestSchema.evidence: z.record(z.unknown())` — accepts anything. Free-form is by design but currently has zero size cap; a malicious RP can DoS the BATE pipeline by reporting `evidence: <100MB blob>`. Add `.refine()` for serialised JSON byte-length cap (e.g. 16 KB).

---

## 3. Strengths Worth Preserving

- **Single source of truth via `@okoro/types`.** The Zod-first approach is the right call; runtime + compile-time validation in one place is a strong foundation.
- **Constants centralization** (`TRUST_BAND_THRESHOLDS`, `DENIAL_REASON_PRECEDENCE`, `WEBHOOK_EVENT`, `REDIS_KEY` builders) is exemplary — this is exactly how to keep API/worker/dashboard agreement.
- **Length caps are pervasive.** Most string fields have `.min(1).max(N)`. Compared to typical Node API codebases, this is unusually disciplined.
- **`PublicKeyB64UrlSchema` regex** is correctly tightened to base64url alphabet with size bounds, and length range (40–128) accommodates both raw and SPKI encodings.
- **Numeric ranges on `trustScore`, `ttl`, `min/max/finite`** are present at the Zod layer; the gap is purely TS-level lifting.
- **`ErrorEnvelope`** is small, stable, and aligned with the spec — good wire-protocol hygiene.

---

## 4. Branded-Types Proposal (highest-leverage change)

**Recommendation:** introduce branded primitives across `@okoro/types`. This is the single change with the largest ratio of bugs prevented to lines of code added.

### 4.1 Why branded types are the highest-leverage change

- Reuses the existing Zod machinery (`.brand<"Foo">()` is one method call per type).
- Costs ≈30 lines added to `schemas.ts` and zero changes to consumers that obtain values via `Schema.parse()` (the standard path).
- Catches at compile time:
  - argument-order swaps between IDs (`(agentId, policyId)` vs `(policyId, agentId)`),
  - cross-tenant ID leakage (`agentId` of tenant A used as lookup key for tenant B),
  - out-of-range numeric values (`trustScore`, `ttl`),
  - past `expiresAt` values,
  - empty-bound `SpendLimit`.
- Aligns the TS surface with the Zod runtime surface — eliminates the "Zod says yes / TS says yes / they don't agree" class of bug entirely.

### 4.2 Concrete refactor sketch

```ts
// packages/types/src/schemas.ts (proposed)

import { z } from 'zod';

const idShape = (prefix: string, brand: string) =>
  z.string()
    .min(prefix.length + 16)
    .max(64)
    .regex(new RegExp(`^${prefix}_[0-9A-HJKMNP-TV-Z]{16,40}$`)) // Crockford ULID body
    .brand(brand);

export const AgentIdSchema     = idShape('agt', 'AgentId');
export const PolicyIdSchema    = idShape('pol', 'PolicyId');
export const PrincipalIdSchema = idShape('prn', 'PrincipalId');

export type AgentId     = z.infer<typeof AgentIdSchema>;     // string & {__brand:'AgentId'}
export type PolicyId    = z.infer<typeof PolicyIdSchema>;
export type PrincipalId = z.infer<typeof PrincipalIdSchema>;

// Numeric ranges
export const TrustScoreSchema = z.number().int().min(0).max(1000).brand('TrustScore');
export type TrustScore = z.infer<typeof TrustScoreSchema>;

export const TtlSecondsSchema = z.number().int().min(0).max(300).brand('TtlSeconds');
export type TtlSeconds = z.infer<typeof TtlSecondsSchema>;

// Future-only ISO datetime
export const FutureIsoDateTimeSchema = IsoDateTimeSchema
  .refine(v => new Date(v).getTime() > Date.now(), 'must be in the future')
  .refine(v => new Date(v).getTime() < Date.now() + POLICY_TTL_MAX_DAYS * 86_400_000, 'exceeds POLICY_TTL_MAX_DAYS')
  .brand('FutureIsoDateTime');

// SpendLimit as discriminated union (the one-bound variants)
const SpendLimitTransaction = z.object({ kind: z.literal('per_transaction'), currency: CurrencySchema, max: z.number().positive() });
const SpendLimitDay         = z.object({ kind: z.literal('per_day'),         currency: CurrencySchema, max: z.number().positive() });
const SpendLimitMonth       = z.object({ kind: z.literal('per_month'),       currency: CurrencySchema, max: z.number().positive() });
export const SpendLimitSchema = z.array(z.discriminatedUnion('kind', [SpendLimitTransaction, SpendLimitDay, SpendLimitMonth])).min(1);

// VerifyResponse as discriminated union on `valid`
const VerifyApproved = z.object({
  valid: z.literal(true),
  agentId: AgentIdSchema,
  principalId: PrincipalIdSchema,
  trustScore: TrustScoreSchema,
  trustBand: TrustBandSchema,
  scopesGranted: z.array(z.string().min(1)),
  spendRemaining: VerifySpendRemainingSchema.nullable(),
  verifiedAt: IsoDateTimeSchema,
  ttl: TtlSecondsSchema,
});
const VerifyDenied = z.object({
  valid: z.literal(false),
  denialReason: DenialReasonSchema,
  trustScore: TrustScoreSchema,
  verifiedAt: IsoDateTimeSchema,
  ttl: TtlSecondsSchema,
});
export const VerifyResponseSchema = z.discriminatedUnion('valid', [VerifyApproved, VerifyDenied]);
```

### 4.3 Migration plan (no big-bang)

1. **Phase 1 (1 day):** add brands to ID primitives only. Inferred types become `string & Brand<...>` — assignable from `Schema.parse()` output but not from raw strings. Internal services that currently pass strings around will get type errors at the call site; fix by routing all entry points through `Schema.parse`.
2. **Phase 2 (2 days):** add `TrustScore`, `TtlSeconds`, `FutureIsoDateTime` brands. Same pattern.
3. **Phase 3 (3 days):** discriminated-union `VerifyResponse` and `SpendLimit`. This is the largest consumer-side change; do it behind a `VerifyResponseV2` while V1 is deprecated for one minor.
4. **Phase 4 (1 day):** delete `sdk-ts/src/types.ts` hand-written copies and re-export `@okoro/types` directly. (The hand-written file is currently the source of all the casing-drift bugs.)
5. **Phase 5 (parallel):** rewrite `apps/api/src/modules/*/*.dto.ts` as `nestjs-zod` DTOs derived from the schemas instead of class-validator. Eliminates the validation-divergence class of bug entirely.

Total estimate: ~7 engineer-days for the full rollout. ~1 day for the highest-impact ID-brand-only delta.

---

## 5. Recommended Improvements (prioritized)

| # | Change | Severity | Effort | Notes |
| - | --- | --- | --- | --- |
| 1 | Brand `AgentId`, `PolicyId`, `PrincipalId` with prefix regex | CRIT | S | §4. Single biggest invariant uplift. |
| 2 | Delete `sdk-ts/src/types.ts` hand-written copies; re-export `@okoro/types` | CRIT | S | Eliminates casing-drift bugs in §2.11 in one PR. |
| 3 | Resolve `OkoroError` interface-vs-class collision in SDK | HIGH | S | Pick the abstract class; remove the interface. |
| 4 | Brand `TrustScore`, `TtlSeconds`, `FutureIsoDateTime` | HIGH | S | §4. |
| 5 | Discriminated-union `VerifyResponse` on `valid` | HIGH | M | Eliminates the `{ valid: true, denialReason: 'X' }` impossible state. |
| 6 | Discriminated-union `SpendLimit` (or `.array().min(1)` of bound variants) | HIGH | M | Lift §2.3 `.refine()` into the type. |
| 7 | Open-vs-closed `AgentRuntime` (known + custom-string variant) | HIGH | S | §2.7. Aligns with 2026 LLM provider proliferation. |
| 8 | Currency: ISO 4217 + Stablecoin + CBDC discriminated union | HIGH | M | §2.8. |
| 9 | `DenialReason` → sealed class hierarchy in SDK with precedence numeric | HIGH | M | §2.9. |
| 10 | Sync OpenAPI spec ↔ Zod ↔ DTO casing (`AgentStatus`, `PolicyStatus`, `AgentRuntime`) | CRIT | M | Drift catalog §2.11. |
| 11 | Tighten `JwtTokenSchema` (length bounds, segment min length) | MED | S | §2.6. |
| 12 | `PolicyScope.allowedDomains` non-empty when present + hostname regex | MED | S | §2.4. |
| 13 | `validFrom < validUntil` and `expiresAt > now` cross-field refines | MED | S | §2.5. |
| 14 | `evidence` byte-length cap in `ReportRequestSchema` | MED | S | §2.13 — DoS hardening. |
| 15 | Audit `signature` length/regex; `eventId` ULID | MED | S | §2.13. |
| 16 | Migrate `apps/api` DTOs to `nestjs-zod`; retire `class-validator` for these surfaces | HIGH | L | Single validation surface = no cross-surface drift. |
| 17 | Resolve Python `merchant_domain` vs TS `merchantDomain` — pick one wire shape, alias on the Python side | HIGH | S | Cross-SDK case drift; the wire spec is `merchantDomain`, so Python should serialize via alias. |
| 18 | Add `dataScopes` size cap consistency (Zod 64 vs DTO 32) | LOW | S | Pick one. |

---

## 6. Closing Note

The OKORO type contract is well-organized and centralised but trusts Zod's runtime to do the work TypeScript could share. For a security-critical identity API, lifting invariants into the type system — especially via branded primitives, discriminated unions for `VerifyResponse`, and a single source-of-truth for DTOs — is high-leverage, low-risk, and aligns the codebase with its own security model.
