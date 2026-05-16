# n8n-nodes-aegis — n8n custom node for AEGIS verification

**Pattern:** B — Workflow node
**Status:** Stub
**Claim hook:** `aegis:int-n8n`
**Target npm name:** `n8n-nodes-aegis` (community node convention)

## What it does

Adds an **AEGIS Verify** node to n8n. Drop it into any workflow between an agent's tool invocation and the actual execution step. The node calls `POST /v1/verify` and either continues the workflow (success branch) or routes to a denial branch with the typed reason.

## Surface

A typical n8n workflow:

```
[Trigger]
   ↓
[Read agent context]
   ↓
[AEGIS Verify] ──── ✓ ────→ [Execute action]
       │
       └── ✗ ────→ [Notify operator / log denial]
```

Node parameters:

| Parameter | Type | Description |
|---|---|---|
| AEGIS API key | credentials | Stored as n8n credential `aegisApi` |
| Agent token | string (expression) | Usually `{{$json.aegis_token}}` |
| Action | string | e.g. `orders.create` |
| Amount | number? | For spend-bound policies |
| Min trust band | options | `FLAGGED` · `WATCH` · `VERIFIED` · `PLATINUM` |

## Why this matters

n8n is the dominant open-source workflow tool for SMBs and self-hosters. AEGIS-as-a-node lets a no-code operator gate any workflow step on cryptographic verification without writing TypeScript. Tier-A Phase-1.

## Implementation notes

- Follow n8n's community-node convention: `packages/aegis-n8n/` ships as `n8n-nodes-aegis` on npm.
- Two files in the published package: `nodes/AegisVerify/AegisVerify.node.ts` + `credentials/AegisApi.credentials.ts`.
- The node has two output branches (success / deny) — n8n routes the workflow based on `result.valid`.
- Stream the typed denial reason into the deny-branch's `$json.aegis_denial_reason`.

## TODO

- [ ] Node implementation (`AegisVerify.node.ts`)
- [ ] Credentials definition (`AegisApi.credentials.ts`)
- [ ] package.json with `"n8n": { "credentials": [...], "nodes": [...] }` registration
- [ ] Tests against `n8n-node-test` harness
- [ ] Submission to n8n's community-node directory
