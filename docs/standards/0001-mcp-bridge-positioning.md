# 0001 — `@cerniq/mcp-bridge` as the Phase 1 distribution wedge

> **Status:** Proposal — for operator review
> **Author:** session foundation-audit-q2 · 2026-05-01
> **Companion:** `docs/audit_2026q2/landscape.md` § 3
> **Decision sought:** Ship `@cerniq/mcp-bridge` (Node + Python) as a
> Phase 1 deliverable, _parallel_ to (not blocking) M-001 SDK and the
> Phase 1 MVP launch.
>
> **Sourcing note:** Live web access was unavailable in this session.
> Facts about MCP draw on the public spec at
> https://modelcontextprotocol.io/specification through the model's
> Jan 2026 cutoff. Verify spec rev before external commitment.

---

## Recommendation: **YES — ship.**

Ship `@cerniq/mcp-bridge` as a Phase 1 distribution wedge with a
deliberately narrow scope (~1–2 engineer-weeks). The package is small,
the upside is asymmetric, and the cost of _not_ shipping it grows fast
through 2026.

The rest of this document is the rationale.

---

## 1. What the package actually is

A drop-in middleware/wrapper for any MCP server (HTTP-transport or
stdio) that adds **CERNIQ agent identity verification** to every tool
call, _in addition to_ the MCP server's existing OAuth user
authentication. It does not replace MCP auth; it composes with it.

### Wire shape (Node, illustrative)

```ts
// Before (existing MCP server)
import { McpServer } from '@modelcontextprotocol/sdk';
const server = new McpServer({
  /* ... */
});

// After
import { McpServer } from '@modelcontextprotocol/sdk';
import { withCerniq } from '@cerniq/mcp-bridge';

const server = withCerniq(
  new McpServer({
    /* ... */
  }),
  {
    apiKey: process.env.CERNIQ_VERIFY_KEY,
    // Optional:
    minTrustScore: 600,
    requireScope: 'data-read',
    onDeny: (reason, ctx) => {
      /* logging hook */
    },
  },
);
```

The wrapper:

1. Reads `X-CERNIQ-Agent-Token` from the inbound MCP request headers
   (or stdio metadata frame).
2. Calls `POST /v1/verify` on CERNIQ using the verify-only key.
3. Applies denial-precedence rules from `docs/SECURITY.md` § 6.
4. On approval, attaches `cerniq: { agentId, principalId, trustScore,
trustBand, scopesGranted }` to the per-call context, where tool
   handlers can read it.
5. Emits an CERNIQ audit event with the MCP `tool_name` as the action.

That's it. Two functions: `withCerniq()` (Node) and the equivalent
`CerniqMiddleware` (Python ASGI / fastmcp middleware). No new MCP spec.
No new wire formats.

### Python sketch (illustrative)

```python
from fastmcp import FastMCP
from cerniq_mcp_bridge import cerniq_middleware

mcp = FastMCP("my-server")
mcp.add_middleware(cerniq_middleware(
    api_key=os.environ["CERNIQ_VERIFY_KEY"],
    min_trust_score=600,
))
```

---

## 2. Why this is the highest-leverage Phase 1 surface

### 2a. The MCP ecosystem is the only surface where CERNIQ can be picked up _passively_

To adopt CERNIQ via the SDK (M-001), a developer must:

1. Decide they want agent identity verification.
2. Sign up at `cerniq.io`.
3. Install `@cerniq/sdk`.
4. Modify outbound code to sign requests.
5. Modify inbound (relying-party) code to verify.

That is a five-step active sale. Conversion rates on five-step active
sales for indie developers are <1%.

To adopt CERNIQ via the MCP bridge:

1. The MCP server author adds two lines.
2. Every downstream agent automatically has its identity
   verified — the agent author does **nothing**.

This converts CERNIQ from a _thing developers must opt in to_ into a
_thing the underlying server requires_. The 95% of agent developers
who would never read the CERNIQ docs now interact with CERNIQ by virtue
of using a popular MCP server.

### 2b. The MCP server long tail is exactly the right adoption surface

The MCP server registry (and the popular community lists) lists
hundreds of MCP servers as of late 2025: Slack, GitHub, Notion,
Postgres, Filesystem, Sentry, Linear, Stripe, etc. [VERIFY current
count Q2 2026]

Each MCP server is, structurally, a relying party — exactly the
audience CERNIQ has been struggling to reach via direct enterprise
sales (per `docs/spec/04_COMMERCIAL_STRATEGY.md` § F1, the chicken-
and-egg problem). MCP server authors are the _low-cost relying-party
funnel_ the GTM doc has been looking for.

### 2c. It compounds with everything else on the backlog

- **OAuth 2.1 / DPoP (M-140, M-141):** the bridge is the natural place
  to demonstrate DPoP-bound CERNIQ tokens being verified inside an
  OAuth-2.1-compliant flow.
- **DID (M-130):** the bridge can resolve `did:web` agent identities
  before falling back to `agentId`-keyed lookup, demoing the standards
  story.
- **NIST trust framework (M-120):** "here is a working open-source
  bridge that implements per-agent identity, least privilege, and
  audit" is the _demonstration_ a NIST IR draft will look for.

### 2d. The cost is bounded

The bridge does not introduce new product surface area inside CERNIQ.
It is a thin wrapper around `POST /v1/verify`, which already exists.
The work is:

- 1 engineer-week: Node package + tests + 2 examples.
- 0.5 engineer-week: Python package mirror.
- 0.5 engineer-week: docs page + 1 reference repo (`cerniq-mcp-example`)
  hosting an "CERNIQ-verified Postgres MCP server."

Total: **≤ 2 engineer-weeks**, parallelisable across two sessions.

---

## 3. Why this is _not_ a trap

A reasonable objection: "MCP is one ecosystem; chasing it ties CERNIQ
to MCP." Three reasons that's wrong.

1. **The bridge only depends on CERNIQ's existing
   `/v1/verify`.** If MCP fades, the bridge is a 300-line dead
   package; CERNIQ continues unchanged. There is no architectural
   coupling, only marketing coupling.
2. **The bridge is a demonstration, not a dependency.** CERNIQ's
   neutrality story explicitly lists "MCP / non-MCP / custom" as the
   point. Shipping a _bridge_ (one of N integrations) reinforces
   neutrality; shipping an _MCP-native CERNIQ_ would weaken it.
3. **Every alternative wedge is heavier.** The realistic alternatives
   are:
   - LangChain / CrewAI / AutoGen integration (these change every 6
     months — high maintenance burden).
   - Direct enterprise sales to relying parties (slow, sales-led).
   - Free-tier developer SDK adoption (the M-001 path — important but
     active-sale, see § 2a).

   The MCP bridge is the lowest-cost, highest-leverage option of the
   four. Ship it _in addition to_ the SDK, not instead of.

---

## 4. Counter-argument considered: "MCP auth already covers identity"

It does not. MCP auth covers **the user's authorisation to call the
tool** via OAuth 2.1. It does not cover:

- _Which agent_ is acting on behalf of that user.
- Whether the agent has been seen behaving anomalously elsewhere.
- Whether the agent's policy permits this specific dollar amount /
  domain / data scope.
- A signed audit trail attributing the action to a specific agent
  identity for non-repudiation.

These are CERNIQ's primitives. They compose cleanly with MCP auth —
CERNIQ sits _above_ the OAuth layer, not inside it.

---

## 5. Counter-argument considered: "We should wait for MCP auth to

stabilise"

The MCP authorisation spec was finalised in March 2025 and updated for
remote servers in June 2025. By 2026 Q2 it has been stable for ~9
months. Waiting longer trades certainty for missed adoption.

---

## 6. Specific scope — what the v0.1 bridge ships with

### In scope (v0.1)

- Node package `@cerniq/mcp-bridge` (TS, ESM + CJS).
- Python package `cerniq-mcp-bridge` (PyPI).
- `withCerniq()` Node wrapper for `@modelcontextprotocol/sdk` HTTP
  transport.
- `cerniq_middleware()` Python wrapper for `fastmcp` ASGI.
- Configuration: API key, min trust score, required scope, deny hook.
- Audit event emission (one event per tool call, decision-tagged).
- README with quickstart + 1 worked example.
- Unit tests for the middleware logic.
- A reference repo `cerniq-mcp-example` on GitHub showing an CERNIQ-
  verified Postgres MCP server.

### Explicitly out of scope (v0.1)

- Stdio MCP transport (HTTP first; stdio is a v0.2).
- Any agent-runtime SDK changes (the bridge sits on the _server_ side).
- DPoP enforcement (M-141 ships first; bridge picks it up free).
- Commerce-specific scope (this is an MCP server bridge, not an ACP
  bridge — keep it boring).

### Acceptance criteria

- Wrapping an existing MCP server requires ≤ 3 lines of code change.
- Verification adds < 30 ms p99 to a tool call (warm CERNIQ path).
- Denial reasons map cleanly to MCP error responses.
- Reference repo runs end-to-end in < 5 minutes for a new developer
  (Postgres + 1 example tool + a curl-based agent).

---

## 7. Decision

**Recommend: SHIP.** Add the work to `WORK_BOARD.md` as **M-110**
under SPRINT S1, paths `packages/mcp-bridge-ts/**` and
`packages/mcp-bridge-py/**`. Estimate 2 engineer-weeks.

If the operator declines, document the decision rationale in
`docs/decisions/` (peer-locked — operator ack only) and reroute the
distribution wedge to the LangChain integration path described in
`docs/spec/02_GTM.md`.

---

_End of standards-positioning brief 0001. Next standards brief expected
on `did:web` issuer document and JWKS layout._
