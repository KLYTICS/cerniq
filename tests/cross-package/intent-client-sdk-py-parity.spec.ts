// Cross-package parity — @aegis/sdk IntentClient ↔ @aegis/sdk-py IntentClient.
//
// Why this exists (load-bearing):
//   Commit 81183bc landed the Python IntentClient with the message
//   "cross-language parity with TS IntentClient" — but no parity test
//   shipped alongside it. Without a regression gate, a Python user's
//   wire shape can drift silently from the TS user's:
//
//     - A TS-side path rename (`/intent` → `/v1/intent` or `/intents`)
//       without the matching Python change → Python users hit 404s.
//     - A TS-side header rename (`Idempotency-Key` → `idempotency_key`)
//       without the Python change → Python users hit 400s with no
//       obvious cause.
//     - A TS-side new required field added to IssueIntentRequest
//       without the Python `body[...]` construction picking it up →
//       Python users hit 400s from server-side Zod validation.
//     - A TS-side optional field becoming required without Python
//       update → Python users silently send incomplete requests.
//
//   The Python SDK deliberately accepts `intent: dict[str, Any]` for
//   the claim payload (no client-side pydantic enforcement in v1 — per
//   intent.py lines 60-66 docstring). This puts the burden on the
//   server to validate, which the API does via Zod. But the WRAPPER
//   shape (the surrounding request body fields that Python builds
//   manually) MUST stay byte-equivalent to what TS sends, or every
//   Python user breaks.
//
//   This spec locks that wrapper-shape agreement at the source-code
//   regex level — the same pattern used by intent-openapi-parity.spec.ts
//   (the existing OpenAPI ↔ Nest DTO ↔ kernel parity that this spec
//   extends to the third axis: TS SDK ↔ Py SDK).
//
// What this spec covers:
//   - Endpoint path equality (POST /intent, POST /intent/{id}/actuals,
//     GET /intent/{id}).
//   - HTTP method equality.
//   - Idempotency-Key header name parity across literal-TS vs
//     constant-Py form (and the Py constant resolves to the same string).
//   - Wire field name agreement for the required IssueIntentRequest
//     fields (camelCase on both sides — Py uses snake_case for KWARGS
//     but builds camelCase wire dict).
//   - Optional-field parity (reconciliation, ttlSeconds — optional on
//     both sides means BOTH must default the same way OR fail the same
//     way; here both default to None / undefined and server fills).
//   - Public method surface agreement (issue / reconcile / get on both).
//
// What this spec DOES NOT cover:
//   - Intent claim kind strings ('http-call', 'commerce-action',
//     'tool-invocation') — those are in @aegis/intent-manifest types,
//     mirrored by reference at the OpenAPI ↔ DTO layer (see
//     intent-openapi-parity.spec.ts).
//   - Server-side validation behavior (apps/api's Zod schemas).
//   - The HTTP transport semantics (Pydantic / @aegis/sdk's http
//     module both handle base URL + auth headers + retries).
//   - Python pydantic models for IntentClaim — not yet shipped (Py SDK
//     v1 punts to server validation per docstring).

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..', '..');

const TS_SRC = readFileSync(
  resolve(REPO_ROOT, 'packages/sdk-ts/src/intent.ts'),
  'utf8',
);
const PY_SRC = readFileSync(
  resolve(REPO_ROOT, 'packages/sdk-py/aegis/intent.py'),
  'utf8',
);
const PY_CONSTANTS = readFileSync(
  resolve(REPO_ROOT, 'packages/sdk-py/aegis/_shared_constants_generated.py'),
  'utf8',
);

describe('TS IntentClient ↔ Py IntentClient parity (ADR-0017 wire shape)', () => {
  describe('endpoint path equality', () => {
    it('issue() targets POST /intent on both sides', () => {
      // TS: this.http.request<IssueIntentResponse>('/intent', { method: 'POST', ... })
      expect(TS_SRC).toMatch(
        /this\.http\.request<[^>]+>\(\s*['"]\/intent['"]/u,
      );
      // Py: await self._http.request("POST", "/intent", body=body)
      expect(PY_SRC).toMatch(
        /self\._http\.request\(\s*['"]POST['"]\s*,\s*['"]\/intent['"]/u,
      );
    });

    it('reconcile() targets POST /intent/{id}/actuals on both sides', () => {
      // TS: `/intent/${encodeURIComponent(manifestId)}/actuals`
      expect(TS_SRC).toMatch(
        /`\/intent\/\$\{encodeURIComponent\(manifestId\)\}\/actuals`/u,
      );
      // Py: f"/intent/{_quote_path_segment(manifest_id)}/actuals"
      expect(PY_SRC).toMatch(
        /f["']\/intent\/\{_quote_path_segment\(manifest_id\)\}\/actuals["']/u,
      );
    });

    it('get() targets GET /intent/{id} on both sides', () => {
      // TS: `/intent/${encodeURIComponent(manifestId)}`
      expect(TS_SRC).toMatch(
        /`\/intent\/\$\{encodeURIComponent\(manifestId\)\}`/u,
      );
      // Py: f"/intent/{_quote_path_segment(manifest_id)}"
      expect(PY_SRC).toMatch(
        /f["']\/intent\/\{_quote_path_segment\(manifest_id\)\}["']/u,
      );
    });
  });

  describe('HTTP method equality', () => {
    it('issue() uses POST on both sides', () => {
      // TS in issue(): method: 'POST'
      expect(TS_SRC).toMatch(/issue\(input[\s\S]*?method:\s*['"]POST['"]/u);
      // Py in issue(): self._http.request("POST", "/intent", ...)
      expect(PY_SRC).toMatch(
        /async def issue\(\s*self[\s\S]*?self\._http\.request\(\s*['"]POST['"]/u,
      );
    });

    it('get() uses GET on both sides', () => {
      // TS in get(): { method: 'GET' }
      expect(TS_SRC).toMatch(
        /get\(manifestId:[\s\S]*?method:\s*['"]GET['"]/u,
      );
      // Py in get(): await self._http.request("GET", path)
      expect(PY_SRC).toMatch(
        /async def get\(\s*self[\s\S]*?self\._http\.request\(\s*['"]GET['"]/u,
      );
    });
  });

  describe('Idempotency-Key header — required on reconcile (ADR-0017)', () => {
    it('TS uses literal "Idempotency-Key" string', () => {
      // TS: headers: { 'Idempotency-Key': input.idempotencyKey }
      expect(TS_SRC).toMatch(/['"]Idempotency-Key['"]/u);
    });

    it('Py uses AEGIS_HEADER_IDEMPOTENCY constant from _shared_constants_generated', () => {
      // Py imports AEGIS_HEADER_IDEMPOTENCY and passes via extra_headers.
      expect(PY_SRC).toMatch(/from\s+\._constants\s+import\s+AEGIS_HEADER_IDEMPOTENCY/u);
      expect(PY_SRC).toMatch(/AEGIS_HEADER_IDEMPOTENCY:\s*idempotency_key/u);
    });

    it('AEGIS_HEADER_IDEMPOTENCY resolves to literal "Idempotency-Key"', () => {
      // This closes the indirection — even though Py uses a constant
      // and TS uses a literal, both must produce the same wire header.
      expect(PY_CONSTANTS).toMatch(
        /AEGIS_HEADER_IDEMPOTENCY:\s*Final\[str\]\s*=\s*["']Idempotency-Key["']/u,
      );
    });
  });

  describe('IssueIntentRequest wire-field agreement (camelCase on the wire)', () => {
    const REQUIRED_FIELDS = [
      'agentId',
      'verifyTokenJti',
      'verifyTokenSha256B64Url',
      'intent',
    ] as const;

    for (const field of REQUIRED_FIELDS) {
      it(`required field "${field}" present in TS interface AND Py body construction`, () => {
        // TS: declared in IssueIntentRequest interface.
        expect(TS_SRC).toMatch(new RegExp(`\\b${field}\\b`));
        // Py: builds body["agentId"] / body["verifyTokenJti"] / body["intent"] etc.
        // Field name appears as a string key in body dict.
        expect(PY_SRC).toMatch(new RegExp(`["']${field}["']`));
      });
    }

    it('optional field "reconciliation" is optional on both sides', () => {
      // TS: reconciliation?: ReconciliationPolicy
      expect(TS_SRC).toMatch(/reconciliation\?:\s*ReconciliationPolicy/u);
      // Py: reconciliation: dict[str, Any] | None = None
      expect(PY_SRC).toMatch(
        /reconciliation:\s*dict\[str,\s*Any\]\s*\|\s*None\s*=\s*None/u,
      );
      // Py: wire field name when set
      expect(PY_SRC).toMatch(/body\[["']reconciliation["']\]/u);
    });

    it('optional field "ttlSeconds" is optional on both sides with same wire name', () => {
      // TS: ttlSeconds?: number
      expect(TS_SRC).toMatch(/ttlSeconds\?:\s*number/u);
      // Py: ttl_seconds: int | None = None (snake_case kwarg, camelCase wire)
      expect(PY_SRC).toMatch(/ttl_seconds:\s*int\s*\|\s*None\s*=\s*None/u);
      // Py: wire field name body["ttlSeconds"]
      expect(PY_SRC).toMatch(/body\[["']ttlSeconds["']\]/u);
    });
  });

  describe('ReconcileIntentRequest wire-field agreement', () => {
    it('actuals[] is the request-body field on both sides', () => {
      // TS: body: { actuals: input.actuals }
      expect(TS_SRC).toMatch(/body:\s*\{\s*actuals:\s*input\.actuals\s*\}/u);
      // Py: body={"actuals": actuals}
      expect(PY_SRC).toMatch(/body=\{\s*["']actuals["']:\s*actuals\s*\}/u);
    });
  });

  describe('public class + method surface', () => {
    it('both packages export IntentClient class', () => {
      expect(TS_SRC).toMatch(/export class IntentClient/u);
      expect(PY_SRC).toMatch(/^class IntentClient:/mu);
    });

    it('both expose the same three methods: issue / reconcile / get', () => {
      // TS: public methods on IntentClient
      expect(TS_SRC).toMatch(/\bissue\(input:/u);
      expect(TS_SRC).toMatch(/\breconcile\(\s*manifestId:/u);
      expect(TS_SRC).toMatch(/\bget\(manifestId:/u);
      // Py: async methods on IntentClient
      expect(PY_SRC).toMatch(/async def issue\(/u);
      expect(PY_SRC).toMatch(/async def reconcile\(/u);
      expect(PY_SRC).toMatch(/async def get\(/u);
    });
  });

  describe('URL-encoding parity for manifestId path segment', () => {
    it('TS uses encodeURIComponent, Py uses urllib.parse.quote with safe=""', () => {
      // TS: encodeURIComponent(manifestId)
      expect(TS_SRC).toMatch(/encodeURIComponent\(manifestId\)/u);
      // Py: quote(value, safe="") — function _quote_path_segment
      expect(PY_SRC).toMatch(/def _quote_path_segment\(value:\s*str\)/u);
      expect(PY_SRC).toMatch(/quote\(value,\s*safe=["']{2}\)/u);
      // The safe="" choice matches encodeURIComponent semantics (vs
      // safe='/' which would match encodeURI). Comment in source confirms.
      expect(PY_SRC).toMatch(/matches encodeURIComponent/iu);
    });
  });
});
