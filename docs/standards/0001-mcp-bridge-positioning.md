# 0001 — `@okoro/mcp-bridge` as the Phase 1 distribution wedge

> **Status:** Proposal — for operator review
> **Author:** session foundation-audit-q2 · 2026-05-01
> **Companion:** `docs/audit_2026q2/landscape.md` § 3
> **Decision sought:** Ship `@okoro/mcp-bridge` (Node + Python) as a
> Phase 1 deliverable, *parallel* to (not blocking) M-001 SDK and the
> Phase 1 MVP launch.
>
> **Sourcing note:** Live web access was unavailable in this session.
> Facts about MCP draw on the public spec at
> https://modelcontextprotocol.io/specification through the model's
> Jan 2026 cutoff. Verify spec rev before external commitment.

---

## Recommendation: **YES — ship.**

Ship `@okoro/mcp-bridge` as a Phase 1 distribution wedge with a
deliberately narrow scope (~1–2 engineer-weeks). The package is small,
the upside is asymmetric, and the cost of *not* shipping it grows fast
through 2026.

The rest of this document is the rationale.

---

## 1. What the package actually is

A drop-in middleware/wrapper for any MCP server (HTTP-transport or
stdio) that adds **OKORO agent identity verification** to every tool
call, *in addition to* the MCP server's existing OAuth user
authentication. It does not replace MCP auth; it composes with it.

### Wire shape (Node, illustrative)

```ts
// Before (existing MCP server)
import { McpServer } from "@modelcontextprotocol/sdk";
const server = new McpServer({ /* ... */ });

// After
import { McpServer } from "@modelcontextprotocol/sdk";
import { withOkoro } from "@okoro/mcp-bridge";

const server = withOkoro(
  new McpServer({ /* ... */ }),
  {
    apiKey: process.env.OKORO_VERIFY_KEY,
    // Optional:
    minTrustScore: 600,
    requireScope: "data-read",
    onDeny: (reason, ctx) => { /* logging hook */ },
  }
);
```

The wrapper:

1. Reads `X-OKORO-Agent-Token` from the inbound MCP request headers
   (or stdio metadata frame).
2. Calls `POST /v1/verify` on OKORO using the verify-only key.
3. Applies denial-precedence rules from `docs/SECURITY.md` § 6.
4. On approval, attaches `okoro: { agentId, principalId, trustScore,
   trustBand, scopesGranted }` to the per-call context, where tool
   handlers can read it.
5. Emits an OKORO audit event with the MCP `tool_name` as the action.

That's it. Two functions: `withOkoro()` (Node) and the equivalent
`OkoroMiddleware` (Python ASGI / fastmcp middleware). No new MCP spec.
No new wire formats.

### Python sketch (illustrative)

```python
from fastmcp import FastMCP
from okoro_mcp_bridge import okoro_middleware

mcp = FastMCP("my-server")
mcp.add_middleware(okoro_middleware(
    api_key=os.environ["OKORO_VERIFY_KEY"],
    min_trust_score=600,
))
```

---

## 2. Why this is the highest-leverage Phase 1 surface

### 2a. The MCP ecosystem is the only surface where OKORO can be picked up *passively*

To adopt OKORO via the SDK (M-001), a developer must:

1. Decide they want agent identity verification.
2. Sign up at `okorolabs.io`.
3. Install `@okoro/sdk`.
4. Modify outbound code to sign requests.
5. Modify inbound (relying-party) code to verify.

That is a five-step active sale. Conversion rates on five-step active
sales for indie developers are <1%.

To adopt OKORO via the MCP bridge:

1. The MCP server author adds two lines.
2. Every downstream agent automatically has its identity
   verified — the agent author does **nothing**.

This converts OKORO from a *thing developers must opt in to* into a
*thing the underlying server requires*. The 95% of agent developers
who would never read the OKORO docs now interact with OKORO by virtue
of using a popular MCP server.

### 2b. The MCP server long tail is exactly the right adoption surface

The MCP server registry (and the popular community lists) lists
hundreds of MCP servers as of late 2025: Slack, GitHub, Notion,
Postgres, Filesystem, Sentry, Linear, Stripe, etc. [VERIFY current
count Q2 2026]

Each MCP server is, structurally, a relying party — exactly the
audience OKORO has been struggling to reach via direct enterprise
sales (per `docs/spec/04_COMMERCIAL_STRATEGY.md` § F1, the chicken-
and-egg problem). MCP server authors are the *low-cost relying-party
funnel* the GTM doc has been looking for.

### 2c. It compounds with everything else on the backlog

- **OAuth 2.1 / DPoP (M-140, M-141):** the bridge is the natural place
  to demonstrate DPoP-bound OKORO tokens being verified inside an
  OAuth-2.1-compliant flow.
- **DID (M-130):** the bridge can resolve `did:web` agent identities
  before falling back to `agentId`-keyed lookup, demoing the standards
  story.
- **NIST trust framework (M-120):** "here is a working open-source
  bridge that implements per-agent identity, least privilege, and
  audit" is the *demonstration* a NIST IR draft will look for.

### 2d. The cost is bounded

The bridge does not introduce new product surface area inside OKORO.
It is a thin wrapper around `POST /v1/verify`, which already exists.
The work is:

- 1 engineer-week: Node package + tests + 2 examples.
- 0.5 engineer-week: Python package mirror.
- 0.5 engineer-week: docs page + 1 reference repo (`okoro-mcp-example`)
  hosting an "OKORO-verified Postgres MCP server."

Total: **≤ 2 engineer-weeks**, parallelisable across two sessions.

---

## 3. Why this is *not* a trap

A reasonable objection: "MCP is one ecosystem; chasing it ties OKORO
to MCP." Three reasons that's wrong.

1. **The bridge only depends on OKORO's existing
   `/v1/verify`.** If MCP fades, the bridge is a 300-line dead
   package; OKORO continues unchanged. There is no architectural
   coupling, only marketing coupling.
2. **The bridge is a demonstration, not a dependency.** OKORO's
   neutrality story explicitly lists "MCP / non-MCP / custom" as the
   point. Shipping a *bridge* (one of N integrations) reinforces
   neutrality; shipping an *MCP-native OKORO* would weaken it.
3. **Every alternative wedge is heavier.** The realistic alternatives
   are:
   - LangChain / CrewAI / AutoGen integration (these change every 6
     months — high maintenance burden).
   - Direct enterprise sales to relying parties (slow, sales-led).
   - Free-tier developer SDK adoption (the M-001 path — important but
     active-sale, see § 2a).

   The MCP bridge is the lowest-cost, highest-leverage option of the
   four. Ship it *in addition to* the SDK, not instead of.

---

## 4. Counter-argument considered: "MCP auth already covers identity"

It does not. MCP auth covers **the user's authorisation to call the
tool** via OAuth 2.1. It does not cover:

- *Which agent* is acting on behalf of that user.
- Whether the agent has been seen behaving anomalously elsewhere.
- Whether the agent's policy permits this specific dollar amount /
  domain / data scope.
- A signed audit trail attributing the action to a specific agent
  identity for non-repudiation.

These are OKORO's primitives. They compose cleanly with MCP auth —
OKORO sits *above* the OAuth layer, not inside it.

---

## 5. Counter-argument considered: "We should wait for MCP auth to
stabilise"

The MCP authorisation spec was finalised in March 2025 and updated for
remote servers in June 2025. By 2026 Q2 it has been stable for ~9
months. Waiting longer trades certainty for missed adoption.

---

## 6. Specific scope — what the v0.1 bridge ships with

### In scope (v0.1)

- Node package `@okoro/mcp-bridge` (TS, ESM + CJS).
- Python package `okoro-mcp-bridge` (PyPI).
- `withOkoro()` Node wrapper for `@modelcontextprotocol/sdk` HTTP
  transport.
- `okoro_middleware()` Python wrapper for `fastmcp` ASGI.
- Configuration: API key, min trust score, required scope, deny hook.
- Audit event emission (one event per tool call, decision-tagged).
- README with quickstart + 1 worked example.
- Unit tests for the middleware logic.
- A reference repo `okoro-mcp-example` on GitHub showing an OKORO-
  verified Postgres MCP server.

### Explicitly out of scope (v0.1)

- Stdio MCP transport (HTTP first; stdio is a v0.2).
- Any agent-runtime SDK changes (the bridge sits on the *server* side).
- DPoP enforcement (M-141 ships first; bridge picks it up free).
- Commerce-specific scope (this is an MCP server bridge, not an ACP
  bridge — keep it boring).

### Acceptance criteria

- Wrapping an existing MCP server requires ≤ 3 lines of code change.
- Verification adds < 30 ms p99 to a tool call (warm OKORO path).
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

*End of standards-positioning brief 0001. Next standards brief expected
on `did:web` issuer document and JWKS layout.*
