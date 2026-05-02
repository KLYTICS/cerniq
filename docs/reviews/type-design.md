# AEGIS Type Design Review

Scope: `packages/types/src/{schemas,constants,errors,index}.ts`,
`apps/api/src/common/errors/{aegis-error,index}.ts`,
`apps/api/src/modules/{verify,policy}/*.dto.ts`.

---

## Type: `@aegis/types` (Zod schema surface)

### Invariants identified
- All identifier strings (`agentId`, `principalId`, `policyId`) are bounded length and non-empty.
- `PublicKeyB64UrlSchema` enforces base64url charset and a length window roughly consistent with raw Ed25519 (32 B).
- `JwtTokenSchema` enforces three base64url segments separated by dots.
- `SpendLimitSchema` requires at least one of `maxPerTransaction | maxPerDay | maxPerMonth` (cross-field refinement).
- Trust score is bounded `[0,1000]` integer; TTL bounded `[0,300]` seconds.
- `DenialReasonSchema` is derived from `DENIAL_REASON_PRECEDENCE` so the enum literally is the precedence list.
- `WebhookEventNameSchema` enumerates only the values defined in `WEBHOOK_EVENT`.

### Concerns
- **No discriminated union on `VerifyResponse`** (`schemas.ts:166–178`). `valid: z.boolean()` is independent of `denialReason` and `agentId/principalId/trustBand` nullability. The shape "`valid: true` but `denialReason: 'POLICY_EXPIRED'`" is fully representable; consumers must trust the server. Same for `valid: false, denialReason: null`.
- **Identifiers are not branded.** `AgentIdSchema` infers to plain `string`, so an SDK caller can pass a `principalId` where an `agentId` is required. Brands (`z.string().brand<'AgentId'>()`) would catch this at compile time without runtime cost.
- **No invariant `validFrom <= validUntil`** on `PolicyScopeSchema` (`schemas.ts:73–81`); a policy scope with `validFrom > validUntil` validates fine. Same omission for `expiresAt` vs. now on `PolicyCreateRequestSchema`.
- **No invariant linking `amount` and `currency`** on `VerifyRequestSchema` (`schemas.ts:150–159`) — currency without amount and amount without currency both pass.
- **`scopesGranted: z.array(z.string())`** is an unconstrained string array; it should be `z.array(PolicyCategorySchema)` or a typed scope schema, otherwise downstream code re-parses strings.
- **`PublicKeyB64UrlSchema` length window is loose** (`min(40)..max(128)`). Raw Ed25519 b64url is exactly 43 chars (44 with padding). A tight `length(43)` would make malformed keys fail at the schema instead of at the verifier.
- **`DenialReason` precedence is "by convention".** The list ordering in `DENIAL_REASON_PRECEDENCE` (`constants.ts:53–63`) is what `CLAUDE.md` declares as the contract, but no type or function in `packages/types` exposes the *ordering* — only the set of names. A consumer importing `DenialReason` cannot ask "is X higher precedence than Y?". Worth a `denialReasonRank(reason): number` helper exported alongside.

### Ratings
- **Encapsulation**: 6/10 — most primitives are well-bounded, but `VerifyResponse` exposes a denormalized boolean+reason instead of a tagged variant; impossible states are representable.
- **Invariant Expression**: 6/10 — bounded numerics and refinements are good; missing brands, missing cross-field refinements (date order, amount/currency pairing), and a stringly-typed `scopesGranted`.
- **Usefulness**: 8/10 — the schemas correctly model the protocol and are shared across runtimes (Node, Workers, Python via OpenAPI), eliminating a whole class of cross-language drift bugs. The denial-reason precedence-as-tuple trick is genuinely clever.
- **Enforcement**: 7/10 — Zod parses are runtime-strong; refinements catch cross-field gaps where they exist. But the API DTOs (next section) bypass Zod entirely, so enforcement on the wire is class-validator's, not Zod's.

---

## Type: NestJS DTOs (`verify.dto.ts`, `policy.dto.ts`)

### Invariants identified
- class-validator decorators on each field.
- `class-transformer` `@Type` for nested objects.
- Local `enum ScopeCategory`/`ScopeCurrency` re-declarations.
- A locally-declared `DenialReason` union (`verify.dto.ts:46–55`).

### Concerns
- **DTOs are hand-duplicated, not derived from Zod.** Every constraint exists twice: once in `packages/types` and once in `*.dto.ts`. Drift is not theoretical, it is already present:
  - `VerifyRequestDto.action` allows `MaxLength(80)` (`verify.dto.ts:13`); Zod allows `max(64)` (`schemas.ts:152`).
  - `VerifyRequestDto.merchantDomain` allows `253`; Zod allows `255`.
  - `VerifyRequestDto.amount` allows `Min(0)` (zero permitted); Zod requires `.positive()` (zero rejected).
  - `VerifyRequestDto.currency` is an unbounded `IsString` length-8; Zod restricts to enum `{USD, EUR, GBP}`.
  - `VerifyRequestDto` is missing `minTrustScore` entirely (present in Zod at `schemas.ts:157`).
  - `CreatePolicyDto` allows `ArrayMaxSize(8)` scopes; Zod allows `max(10)`.
  - `PolicyScopeDto.dataScopes` allows `ArrayMaxSize(32)`; Zod allows `64`.
  - `CreatePolicyDto.label` allows `MaxLength(200)`; Zod allows `120`.
  - `PolicyResponseDto.status` enum is `['ACTIVE','EXPIRED','REVOKED']` (uppercase); Zod is `['active','expired','revoked']` (lowercase). Live wire-level mismatch.
  - `verify.dto.ts:46–55` redeclares `DenialReason` as a local union, divergent from `DENIAL_REASON_PRECEDENCE` (the order differs: POLICY_EXPIRED/POLICY_REVOKED swapped vs. precedence). Renaming a value in one place silently breaks the other.
  - `VerifyResponseDto` lacks `spendRemaining` and `auditEventId` that exist in `VerifyResponseSchema`.
- **`trustBand!: string | null`** (`verify.dto.ts:71`) is typed as raw `string`, throwing away the `TrustBand` literal union from Zod.

### Ratings
- **Encapsulation**: 4/10 — DTOs are anemic data bags whose invariants live in decorators that disagree with the published contract.
- **Invariant Expression**: 4/10 — class-validator decorators express constraints, but the absence of derivation from Zod means the contract is split-brain.
- **Usefulness**: 5/10 — Swagger docs are generated, request validation works, but the divergence is actively misleading SDK consumers reading either source.
- **Enforcement**: 5/10 — runtime validation is enforced; the *correct* invariants are not.

---

## Type: `AegisError` hierarchy

### Invariants identified
- `AegisError` is `abstract` and declares `abstract readonly code: ErrorCode`, so every subclass must bind a code.
- Subclasses bind a fixed `HttpStatus` and a fixed `code`, ensuring the (status, code) pair is consistent per error type.
- Construction always routes message + optional details through `HttpException`'s response object.

### Concerns
- **`details` is `unknown`** at the base. Programmatic consumers cannot rely on a shape — e.g., `RateLimitedError`'s `{ retryAfterSeconds }` is documented only by reading the constructor (`aegis-error.ts:75–78`). A generic `AegisError<TDetails>` or per-subclass `details` typing would let SDK callers do `if (e instanceof RateLimitedError) { e.details.retryAfterSeconds }` safely.
- **No `requestId` on the thrown error.** `ErrorEnvelope` requires `requestId` (`errors.ts:6–12`), but it is injected by the HTTP filter, not carried by the error. SDK consumers catching an `AegisError` cannot read it without re-parsing the response.
- **`ErrorCode` is a single flat union** without sub-categorisation (transient vs. terminal, retryable vs. not). SDKs commonly want `error.isRetryable` — currently they must `instanceof RateLimitedError || instanceof ServiceUnavailableError`. A `readonly retryable: boolean` on the base, defaulted false, set true on the right subclasses, would help.
- **No subclass for the primary domain failure: verification denial.** Denials are returned as 200 + body, not thrown — consistent with the spec — but there is no typed `VerifyDenial` result class either; SDKs will pattern-match strings on `denialReason`.
- **`cause` is typed `unknown`** at the options interface, then cast to `Error | undefined`. Tightening the parameter to `Error | undefined` removes the cast.

### Ratings
- **Encapsulation**: 8/10 — abstract base + `as const` codes prevent miswiring; subclasses cannot drift from their HTTP status.
- **Invariant Expression**: 7/10 — class-per-code is clear and self-documenting; missing typed `details` and missing retryability flag.
- **Usefulness**: 7/10 — `instanceof` discrimination works today; SDK ergonomics are one notch below where they could be (no typed details, no requestId on the error).
- **Enforcement**: 8/10 — abstract method forces every concrete error to declare its code; HttpException base prevents accidental status drift.

---

## Top 3 concrete improvements

1. **Eliminate the DTO/Zod split-brain.** Replace the hand-written class-validator DTOs in `apps/api/src/modules/verify/verify.dto.ts:1–84` and `apps/api/src/modules/policy/policy.dto.ts:1–150` with a `ZodValidationPipe` (or `nestjs-zod`) that derives request validation directly from `VerifyRequestSchema`/`PolicyCreateRequestSchema`. The current divergences (positive vs. non-negative amount, 80 vs. 64 char action, 8 vs. 10 max scopes, uppercase vs. lowercase status enum, missing `minTrustScore`/`spendRemaining`/`auditEventId`, redundant local `DenialReason` union at `verify.dto.ts:46`) are evidence the duplication is unmaintainable. Keep `@nestjs/swagger` integration via `zod-to-openapi`.

2. **Make `VerifyResponse` a discriminated union and brand identifiers.** In `packages/types/src/schemas.ts:166–178`, split into `z.discriminatedUnion('valid', [VerifyApprovedSchema, VerifyDeniedSchema])` so `denialReason` is required when `valid: false` and forbidden when `valid: true`, and `agentId/principalId/trustBand` are non-null only on the approved branch. At `schemas.ts:17–19` add `.brand<'AgentId'>()`, `.brand<'PrincipalId'>()`, `.brand<'PolicyId'>()` so callers cannot pass a principal id where an agent id is expected. Both changes are pure type-level wins with no runtime cost.

3. **Make denial precedence and error retryability first-class.** Export a `denialReasonRank(reason: DenialReason): number` from `packages/types/src/constants.ts` (alongside `DENIAL_REASON_PRECEDENCE` at line 53) and have the verify service call it instead of relying on if/else order in code. In `apps/api/src/common/errors/aegis-error.ts:17–25`, add `abstract readonly retryable: boolean` and `readonly requestId?: string` to `AegisError`, plus a typed `details` generic (`AegisError<TDetails = undefined>`) so `RateLimitedError extends AegisError<{ retryAfterSeconds: number }>`. SDK consumers then write `if (err.retryable) backoff()` instead of three `instanceof` checks.
