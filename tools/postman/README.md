# OKORO Postman Collection

Postman v2.1 collection for the OKORO public API. Drop-in for **Postman**,
**Insomnia** (which imports v2.1 directly), **Bruno** (via the v2.1
importer), or any client that speaks the schema. Every authenticated
request reads its credential from a Postman variable — there is **zero**
key material baked into the JSON.

## What this gives you

A partner engineer should be able to (a) import the collection, (b) drop
their `api_key` and `verify_key` into the environment, and (c) click
**Send** on `Verify → Verify (happy path)` inside two minutes — the
collection auto-populates `agent_id`, `policy_id`, and `policy_token` as
you walk the prerequisite requests, and the **Denial Precedence
Walk-through** folder gives you a reproducible tour through every
`denialReason` OKORO can emit, in canonical precedence order.

## 60-second setup

1. Open Postman → **Import** → drag in:
   - `tools/postman/okoro.collection.json`
   - `tools/postman/okoro.environment.json`
2. Top-right environment dropdown → select **OKORO Local**.
3. Click the eye icon next to the dropdown → fill in:
   - `base_url` — e.g. `http://localhost:3000` for `pnpm dev`, or
     `https://api.okoroapp.com` for production.
   - `api_key` — your full-scope API key (`okoro_…`). Used everywhere
     except `/v1/verify`.
   - `verify_key` — your verify-only key (`okorov_…`). Used **only** by
     `/v1/verify` and the **Denial Precedence Walk-through** folder.
   - `principal_id` — optional, useful for grepping local logs.
4. Walk the happy-path order:
   1. `Identity → Register agent` (auto-stashes `agent_id`)
   2. `Policy → Create policy` (auto-stashes `policy_id`, `policy_token`)
   3. `Verify → Verify (happy path)` (asserts `valid: true`)

You're done.

## What the collection enforces for you

- **Auto-rotated `X-Idempotency-Key`** on every POST/PUT/PATCH (via the
  collection-level pre-request script — uses Postman's `{{$guid}}`).
- **Auto-rotated `X-Request-Id`** on every request, for end-to-end
  tracing through the OKORO audit chain.
- **2xx JSON responses** are parsed once at the test layer.
- **4xx responses** are asserted to carry a `code` field — this matches
  the Round-15 error catalog contract and lets SDKs switch on the code
  rather than the message.
- **Verify denials** assert that `denialReason` is one of the canonical
  9 enum members (CLAUDE.md invariant 6 / ADR-0004).

## Insomnia / Bruno notes

- **Insomnia**: File → Import → Postman → pick the collection. The
  v2.1 schema imports cleanly. Pre-request and test scripts run
  unmodified under Insomnia's `pm.*` shim.
- **Bruno**: `bru import postman okoro.collection.json` produces a
  `.bru` tree. The pre-request scripts will need a manual port — Bruno
  uses its own `req.setHeader(…)` API.

## Validation

```bash
pnpm --filter @okoro/postman run validate   # static collection lint
pnpm --filter @okoro/postman exec vitest run  # validator unit tests
```

The validator (`scripts/validate.ts`) walks the entire collection tree
and asserts:

- top-level schema is exactly the v2.1 collection schema URL
- every request has a `name` and a `request.url.raw`
- every URL starts with `{{base_url}}` (catches any literal hosts)
- no literal API keys in any header value (catches `okoro_…` /
  `okorov_…` / `whsec_…` / `Bearer …` slip-ups)
- the **Denial Precedence Walk-through** folder has exactly 9
  requests, in the canonical order

## Known drift vs. `docs/spec/OKORO_API_SPEC.yaml`

This collection is built against the **wired controllers** in
`apps/api/src/modules/*/*.controller.ts` — when those diverge from
the OpenAPI, the controllers win. Specific deltas captured in this
collection but not yet in the OpenAPI:

- `POST /v1/principals/me/api-keys/rotate` — self-service key rotation
  (Auth folder).
- `GET /v1/audit-events/export` — tenant-wide NDJSON streaming
  (Audit folder).
- `POST /v1/compliance/audit/redact-event` and `…/redact-by-agent` —
  GDPR Art. 17 surface (Compliance folder).
- `GET /v1/me/onboarding` and `PATCH /v1/me/onboarding/step` —
  activation checklist (Onboarding folder).
- `POST/GET/DELETE /v1/webhooks` — subscription management (Webhooks
  folder).
- `GET /.well-known/okoro-configuration`, `/.well-known/jwks.json`,
  `/.well-known/audit-signing-key`, `/.well-known/security.txt`,
  `/.well-known/llms.txt` — discovery surface (Health & Discovery
  folder).
- `GET /.well-known/retention-policy.json` — listed in the discovery
  document but **not yet wired** in `wellknown.controller.ts` as of
  2026-05. The request is captured here so partners can pin against
  the canonical URL once it lands.

## Layout

```
tools/postman/
├── okoro.collection.json     # the collection (v2.1)
├── okoro.environment.json    # variable template
├── package.json              # @okoro/postman (private)
├── README.md                 # you are here
└── scripts/
    ├── validate.ts           # static collection lint
    └── validate.spec.ts      # unit tests for validate.ts
```
