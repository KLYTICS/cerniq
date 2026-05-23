// Changelog registry — typed entries surfaced on /changelog. Peers add
// new entries here when their work lands; the marketing site renders
// them in newest-first order. Each entry is one append, no editing of
// past entries (changelog is append-only, mirroring the audit chain).

export type EntryType = 'feature' | 'breaking' | 'security' | 'fix' | 'docs' | 'release';

export interface ChangelogEntry {
  /** ISO date YYYY-MM-DD. */
  date: string;
  type: EntryType;
  title: string;
  /** Markdown-light: backticks for code, double-newline for paragraphs. */
  body: string;
  /** Scope tags — package names or surface areas. */
  scope: string[];
  /** Optional ADR / commit / issue references. */
  refs?: string[];
}

// Newest first. Append at the top when work lands.
export const CHANGELOG: ChangelogEntry[] = [
  {
    date: '2026-05-15',
    type: 'feature',
    title: 'OAuth 2.0 Rich Authorization Requests (RFC 9396) — implemented',
    body: 'Promoted RFC-9396 from standards_aligned to standards_implemented. POST /v1/verify/rar/evaluate is live as a stateless evaluator. Four detail types registered: trading_order, payment_initiation, data_access, agent_action. Express agent permissions as authorization_details with per-order caps, per-day caps, trading-hours constraints.',
    scope: ['apps/api', 'standards', 'wellknown'],
    refs: ['docs/spec/05_FAPI_2_0_PROFILE.md', 'POST /v1/verify/rar/evaluate'],
  },
  {
    date: '2026-05-15',
    type: 'release',
    title: 'Marketing site launched — apps/marketing',
    body: 'Cinematic landing site shipped: hero verify-burst, animated audit-chain + trust-gauge, 80-integration ecosystem showcase, FAPI 2.0 standards page, 10 use-case verticals, 6-step quickstart, public changelog. Static-rendered Next.js 16 + React 19, zero new runtime dependencies.',
    scope: ['apps/marketing', 'docs'],
    refs: ['docs/INTEGRATION_ROADMAP.md', 'docs/LAUNCH_RUNBOOK.md'],
  },
  {
    date: '2026-05-15',
    type: 'feature',
    title: 'Intent Manifest Phase 2 — runtime issuance + reconciliation',
    body: 'apps/api/src/modules/intent/** landed (12 files, 1.9K LOC). POST /v1/intent issues a signed intent manifest at request time; POST /v1/intent/{id}/actuals reconciles declared-vs-actual asynchronously. Memory adapter only (Phase 2.0); Prisma adapter is Phase 2.1 gated on OD-018/019/020. Algorithm framework-free per CLAUDE.md invariant #2.',
    scope: ['apps/api', 'intent-manifest'],
    refs: ['ADR-0017', 'AEGIS_INTENT_MANIFEST_ENABLED flag'],
  },
  {
    date: '2026-05-15',
    type: 'feature',
    title: 'FAPI 2.0 discovery profile',
    body: 'DISCOVERY_SPEC_VERSION 1.0.0 → 1.2.0. /.well-known/openid-configuration now publishes fapi_profile, fapi_profile_spec_uri, standards_implemented, standards_aligned, signing_alg_values_supported, agent_signing_alg_values_supported, agent_authentication_methods_supported, op_policy_uri, op_tos_uri, authorization_details_types_supported. Marketing claims policed by published binding contract (FAPI profile §5).',
    scope: ['apps/api', 'wellknown', 'standards'],
    refs: ['docs/spec/05_FAPI_2_0_PROFILE.md'],
  },
  {
    date: '2026-05-14',
    type: 'feature',
    title: 'Audit compression Phase 0 — manifest verifier + corpus walker',
    body: 'ADR-0015 Phase 0 kernel landed: dep-free, schema-free, framework-free manifest signing in apps/api/src/modules/audit/compression/. Portable @aegis/audit-verifier exports: verifyManifest, walkManifestChain, verifyManifestCorpus, hashManifestBody, rowChainAnchor. CLI subcommand: aegis-audit-verify verify-manifests <dir>. 95 tests guarding integrity (41 jest + 33 vitest + 21 cross-package parity).',
    scope: ['apps/api', '@aegis/audit-verifier'],
    refs: ['ADR-0015', 'OD-017 (Phases 1-3 gated)'],
  },
  {
    date: '2026-05-14',
    type: 'breaking',
    title: 'MCP bridge action shape — per-tool, not per-method',
    body: 'BREAKING: For tools/call, the verify action is now actionPrefix + toolName (e.g. mcp.fs.read_file), not actionPrefix + method (e.g. mcp.fs.tools/call). Customers with policy strings like "mcp.fs.tools/call" must update to per-tool scope. Also: bridge metadata (_aegis_token, _aegis_headers) strips before handler dispatch; X-AEGIS-Token header normalizes case.',
    scope: ['@aegis/mcp-bridge'],
    refs: ['Changeset major bump pending'],
  },
  {
    date: '2026-05-14',
    type: 'security',
    title: 'SDK cache key — reject NUL-byte cross-context poisoning',
    body: 'Both @aegis/sdk (TS) and aegis (Py) now reject NUL bytes in any cache-key field before canonicalization. Threat: a malformed token containing \\x00 could otherwise collide canonically with a different (token, ctx) tuple in a shared backend (Redis / CF KV). Paired tests across TS + Py assert identical error contracts.',
    scope: ['@aegis/sdk', 'aegis (py)'],
    refs: ['packages/sdk-ts/src/cache.ts', 'packages/sdk-py/aegis/verify_cache.py'],
  },
  {
    date: '2026-05-14',
    type: 'security',
    title: 'Pre-commit hook — split path vs content blocking',
    body: '.husky/pre-commit split monolithic BLOCKED regex into BLOCKED_PATH (filename) + BLOCKED_CONTENT (file body). Eliminates false positives on lines like `process.env.FOO`. Test files exempt from content blocking; never exempt from path blocking. Hook script self-exempted from its own key-shape patterns.',
    scope: ['.husky', 'tooling'],
  },
  {
    date: '2026-05-13',
    type: 'feature',
    title: 'SDK VerifyGateway — Redis adapter + Python mirror',
    body: 'TypeScript SDK ships @aegis/sdk/adapters/redis subpath export with a production-grade circuit-breaker + cache pattern. Python SDK mirrors the same surface via sync facade. Half-open contention state messages are state-accurate. CLI scaffold closes a credential file-mode race.',
    scope: ['@aegis/sdk', 'aegis (py)'],
    refs: ['packages/sdk-ts/src/cache.ts', 'packages/sdk-py/aegis/verify_cache.py'],
  },
  {
    date: '2026-05-12',
    type: 'fix',
    title: 'OpenAPI ↔ Zod ↔ Prisma parity reconciled (M-038)',
    body: 'Closed pre-existing structural drift across the three contract surfaces. AgentStatus Zod schema added (was missing 5 fields). AgentIdentity OpenAPI fields backfilled. AuditEvent additional security-critical fields surfaced (denialReason, policySnapshot, actionHash, relyingPartyHash, redactionReason, trustBandAtEvent). Discovery promotion via OD-017 legacy-kid handling.',
    scope: ['docs/spec', 'packages/types', 'OpenAPI', 'Prisma'],
    refs: ['OD-017'],
  },
  {
    date: '2026-05-11',
    type: 'docs',
    title: 'OD-017 — Audit compression operator decision',
    body: 'Eight interlocking sub-decisions packaged: Parquet writer (@dsnp/parquetjs), zstd codec (@mongodb-js/zstd N-API), object store (S3-compat behind adapter), AuditEvent.seq BIGSERIAL, hybrid slice strategy, retention floor = max(seal-time, sweep-time), operator-gated manifest publication, PQ-hybrid signing deferred to ADR-0013 flip.',
    scope: ['OPERATOR_DECISIONS.md', 'ADR-0015'],
  },
  {
    date: '2026-05-09',
    type: 'release',
    title: 'AEGIS repo public on GitHub — KLYTICS/aegis (private)',
    body: 'Bootstrap commit 6cf2fcd promotes rounds 8-15 to the canonical repo. Branch protection on main, secret scanning, push protection enabled. Polish commit 7dd265f tightens repo metadata + pre-commit secrets allowlist.',
    scope: ['repo', 'github'],
    refs: ['6cf2fcd', '7dd265f'],
  },
  {
    date: '2026-05-09',
    type: 'security',
    title: 'GHSA dependency sweep — 16+ commits',
    body: 'next 16.2.6 (closes 12 GHSAs), jose2go 1.7.0 (GHSA-9mj6 + GHSA-6294), trivy-action pinned to SHA, pnpm.overrides for 11 transitive packages, golangci-lint v1.64.8, Go toolchain 1.24. OTel sdk-node 0.55 → 0.217 with v2 Resource API. Contract pinned in tests.',
    scope: ['deps', 'security'],
  },
  {
    date: '2026-05-06',
    type: 'feature',
    title: 'Auth-cache perf — k6 50 RPS p99 22.64s → 17.36ms',
    body: '1300× faster verify hot path via Redis positive + negative auth cache. Eliminates bcrypt-12 bottleneck. Local stack validated end-to-end on 2026-05-06 with 16_quickstart 10/10. Fail-closed semantics preserved when Redis is down.',
    scope: ['apps/api', 'cache'],
  },
  {
    date: '2026-05-05',
    type: 'release',
    title: 'Phase 1 GA gates closed — G-1 through G-4',
    body: 'G-1: /.well-known/audit-signing-key JWKS endpoint live. G-2: Free-tier quota enforcement + Stripe billing wired. G-3: BATE anomaly detector wired to recompute worker. G-4: Webhook subscription endpoints. 18 NestJS modules in app.module.ts. 0 tsc errors fourth consecutive round.',
    scope: ['apps/api'],
    refs: ['ADR-0014 (pricing)', 'docs/AEGIS_MASTER_STATE_2026_05.md'],
  },
];

export const TYPE_LABEL: Record<EntryType, string> = {
  release: 'Release',
  feature: 'Feature',
  breaking: 'Breaking',
  security: 'Security',
  fix: 'Fix',
  docs: 'Docs',
};

export const TYPE_COLOR: Record<EntryType, string> = {
  release: 'var(--accent-vivid)',
  feature: 'var(--accent)',
  breaking: 'var(--danger)',
  security: 'var(--ok)',
  fix: 'var(--warn)',
  docs: 'var(--text-dim)',
};

export function entryCount(): Record<EntryType, number> {
  return CHANGELOG.reduce<Record<EntryType, number>>((acc, e) => {
    acc[e.type] = (acc[e.type] ?? 0) + 1;
    return acc;
  }, { release: 0, feature: 0, breaking: 0, security: 0, fix: 0, docs: 0 });
}
