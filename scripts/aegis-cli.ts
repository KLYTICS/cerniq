#!/usr/bin/env -S node --import=tsx
/**
 * AEGIS — operator CLI.
 *
 * One-binary commander entry point that drives the full agent lifecycle:
 *   - principal registration  (requires POST /v1/principals/register; not
 *     yet wired in apps/api — flagged at runtime, see REQUIRES_ENDPOINT)
 *   - agent register / list / revoke / status
 *   - policy create / list / revoke
 *   - verify (signs locally with the agent private key)
 *   - audit tail (--follow polls every 2s)
 *   - trust score
 *   - health
 *
 * Mirrors the style of seed-dev.ts: commander, structured stdout, exit codes.
 *
 * Exit codes:
 *   0 ok
 *   1 generic error
 *   2 usage error
 *   3 auth error  (401/403 from API)
 *   4 network error
 *   5 verify denied  (non-fatal — the verify call returned valid:false cleanly)
 *
 * Flags (global):
 *   --api-base   (default: $AEGIS_API_BASE or http://localhost:4000)
 *   --api-key    (default: $AEGIS_API_KEY or read from ./.aegisrc.json)
 *   --json       (raw JSON, default human-readable)
 *
 * Local state: ./.aegisrc.json (cwd-relative — gitignored project state)
 *              ./.local/keys/<agentId>.private  (mode 0600)
 *
 * NOTE: ./.local/ is currently *not* covered by repo .gitignore. The repo
 * gitignore has `.env*` (which protects keys-as-env) but not `.local/`.
 * Operators should add `.local/` to .gitignore at repo root before committing.
 * Documented in scripts/README.md.
 */

import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { stdout, stderr, exit, argv, env } from 'node:process';
import { setTimeout as sleep } from 'node:timers/promises';

import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';
import { Command, Option } from 'commander';

ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

// ── Shared helpers ────────────────────────────────────────────────

const RC_PATH = resolve('./.aegisrc.json');
const KEYS_DIR = resolve('./.local/keys');
const DEFAULT_BASE = env.AEGIS_API_BASE ?? 'http://localhost:4000';

interface Rc {
  apiKey?: string;
  principalId?: string;
  agents?: Record<string, { keyPath: string; publicKey: string }>;
  policies?: Record<string, string>; // policyId -> agentId
}

async function readRc(): Promise<Rc> {
  try {
    const txt = await readFile(RC_PATH, 'utf8');
    return JSON.parse(txt) as Rc;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw err;
  }
}

async function writeRc(rc: Rc): Promise<void> {
  await mkdir(dirname(RC_PATH), { recursive: true });
  await writeFile(RC_PATH, `${JSON.stringify(rc, null, 2)}\n`, { mode: 0o600 });
}

function toB64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

function fromB64Url(s: string): Uint8Array {
  return Uint8Array.from(Buffer.from(s, 'base64url'));
}

// ── Denial reason → human-readable map (no LLM, no fabrication) ──

export const DENIAL_DESCRIPTIONS: Readonly<Record<string, string>> = Object.freeze({
  AGENT_NOT_FOUND: 'No agent identity matches that ID.',
  AGENT_REVOKED: 'The agent has been revoked.',
  INVALID_SIGNATURE: 'The request token signature did not verify.',
  POLICY_REVOKED: 'The policy was revoked.',
  POLICY_EXPIRED: 'The policy has expired (or was never found).',
  SCOPE_NOT_GRANTED: 'The action / domain is outside the policy scope.',
  SPEND_LIMIT_EXCEEDED: 'The amount exceeds the policy spend limit.',
  TRUST_SCORE_TOO_LOW: 'The agent trust score is below the threshold for this action.',
  ANOMALY_FLAGGED: 'BATE flagged this request as anomalous.',
});

// ── Errors ────────────────────────────────────────────────────────

class CliError extends Error {
  constructor(
    message: string,
    readonly code: number,
  ) {
    super(message);
  }
}

// ── HTTP client ───────────────────────────────────────────────────

interface HttpOpts {
  baseUrl: string;
  apiKey?: string;
}

interface HttpResp<T> {
  status: number;
  body: T;
}

async function http<T = unknown>(
  opts: HttpOpts,
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  body?: unknown,
  query?: Record<string, string | undefined>,
): Promise<HttpResp<T>> {
  const url = new URL(`${opts.baseUrl.replace(/\/+$/, '')}${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined) url.searchParams.set(k, v);
    }
  }
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'user-agent': 'aegis-cli/0.1',
  };
  if (opts.apiKey) headers['x-aegis-api-key'] = opts.apiKey;

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new CliError(
      `network error reaching ${url.host}: ${(err as Error).message}`,
      4,
    );
  }
  const ct = res.headers.get('content-type') ?? '';
  // type-rationale: API may return non-JSON on errors; we surface raw text.
  const payload: unknown = ct.includes('application/json')
    ? await res.json()
    : await res.text();

  if (res.status === 401 || res.status === 403) {
    throw new CliError(
      `auth error ${res.status}: ${typeof payload === 'string' ? payload : JSON.stringify(payload)}`,
      3,
    );
  }
  if (!res.ok) {
    throw new CliError(
      `request failed ${res.status} ${method} ${path}: ${typeof payload === 'string' ? payload : JSON.stringify(payload)}`,
      1,
    );
  }
  return { status: res.status, body: payload as T };
}

// ── Output helpers ────────────────────────────────────────────────

interface GlobalOpts {
  apiBase: string;
  apiKey?: string;
  json: boolean;
}

function emit(opts: GlobalOpts, human: () => string, structured: unknown): void {
  if (opts.json) {
    stdout.write(`${JSON.stringify(structured, null, 2)}\n`);
  } else {
    stdout.write(`${human()}\n`);
  }
}

// ── Commands ──────────────────────────────────────────────────────

interface PrincipalRegisterResp {
  principalId: string;
  apiKey: string;
}

async function cmdRegister(g: GlobalOpts, email: string): Promise<void> {
  // POST /v1/principals/register — REQUIRES_ENDPOINT. apps/api currently
  // exposes no principals controller (verified in modules/principals). This
  // verb stays to keep CLI parity with the planned surface; it will fail with
  // 404 until the endpoint lands.
  const resp = await http<PrincipalRegisterResp>(
    { baseUrl: g.apiBase },
    'POST',
    '/v1/principals/register',
    { email },
  );
  const rc = await readRc();
  rc.apiKey = resp.body.apiKey;
  rc.principalId = resp.body.principalId;
  await writeRc(rc);
  emit(
    g,
    () =>
      `principal registered\n  principalId: ${resp.body.principalId}\n  apiKey:      ${resp.body.apiKey}\n  (saved to ${RC_PATH})`,
    resp.body,
  );
}

interface AgentRegisterResp {
  agentId: string;
  publicKey: string;
}

async function cmdAgentRegister(
  g: GlobalOpts,
  runtime: string,
  label: string | undefined,
): Promise<void> {
  const priv = ed.utils.randomPrivateKey();
  const pub = await ed.getPublicKeyAsync(priv);
  const publicKey = toB64Url(pub);
  const resp = await http<AgentRegisterResp>(
    { baseUrl: g.apiBase, apiKey: g.apiKey },
    'POST',
    '/v1/agents/register',
    { publicKey, runtime, ...(label ? { label } : {}) },
  );
  const agentId = resp.body.agentId;
  const keyPath = resolve(KEYS_DIR, `${agentId}.private`);
  await mkdir(KEYS_DIR, { recursive: true });
  await writeFile(keyPath, `${toB64Url(priv)}\n`, { mode: 0o600 });
  const rc = await readRc();
  rc.agents = { ...(rc.agents ?? {}), [agentId]: { keyPath, publicKey } };
  await writeRc(rc);
  emit(
    g,
    () =>
      `agent registered\n  agentId:   ${agentId}\n  publicKey: ${publicKey}\n  privKey:   ${keyPath} (mode 0600)`,
    { agentId, publicKey, privateKeyPath: keyPath },
  );
}

async function cmdAgentList(g: GlobalOpts): Promise<void> {
  // No GET /v1/agents collection endpoint exists (verified against
  // identity.controller.ts). Fall back to RC + per-agent GET.
  const rc = await readRc();
  const ids = Object.keys(rc.agents ?? {});
  if (ids.length === 0) {
    emit(g, () => 'no agents in ./.aegisrc.json (run `aegis agent register`)', { agents: [] });
    return;
  }
  const agents: unknown[] = [];
  for (const id of ids) {
    try {
      const r = await http(
        { baseUrl: g.apiBase, apiKey: g.apiKey },
        'GET',
        `/v1/agents/${encodeURIComponent(id)}`,
      );
      agents.push(r.body);
    } catch (err) {
      agents.push({ agentId: id, error: (err as Error).message });
    }
  }
  emit(
    g,
    () => agents.map((a) => JSON.stringify(a)).join('\n'),
    { agents },
  );
}

async function cmdAgentRevoke(g: GlobalOpts, agentId: string): Promise<void> {
  await http(
    { baseUrl: g.apiBase, apiKey: g.apiKey },
    'DELETE',
    `/v1/agents/${encodeURIComponent(agentId)}`,
  );
  emit(g, () => `agent revoked: ${agentId}`, { agentId, revoked: true });
}

async function cmdAgentStatus(g: GlobalOpts, agentId: string): Promise<void> {
  const r = await http(
    { baseUrl: g.apiBase, apiKey: g.apiKey },
    'GET',
    `/v1/agents/${encodeURIComponent(agentId)}/status`,
  );
  emit(g, () => JSON.stringify(r.body, null, 2), r.body);
}

interface PolicyCreateResp {
  policyId: string;
  signedToken: string;
  expiresAt: string;
}

interface PolicyOpts {
  agent: string;
  scope: string;
  maxPerTx: string;
  currency: string;
  expiresIn: string;
}

function parseDurationDays(s: string): number {
  const m = /^(\d+)([dhm])$/.exec(s);
  if (!m) throw new CliError(`bad --expires-in: ${s} (use 30d, 12h, 60m)`, 2);
  // type-rationale: regex match groups are typed as string | undefined; we
  // null-checked the match above so [1] and [2] are present.
  const n = Number(m[1]);
  const unit = m[2];
  const ms = unit === 'd' ? n * 86400_000 : unit === 'h' ? n * 3600_000 : n * 60_000;
  return ms;
}

async function cmdPolicyCreate(g: GlobalOpts, p: PolicyOpts): Promise<void> {
  const expiresAt = new Date(Date.now() + parseDurationDays(p.expiresIn));
  const body = {
    scopes: [
      {
        category: p.scope,
        spendLimit: {
          currency: p.currency,
          maxPerTransaction: Number(p.maxPerTx),
        },
      },
    ],
    expiresAt: expiresAt.toISOString(),
  };
  const r = await http<PolicyCreateResp>(
    { baseUrl: g.apiBase, apiKey: g.apiKey },
    'POST',
    `/v1/agents/${encodeURIComponent(p.agent)}/policies`,
    body,
  );
  const rc = await readRc();
  rc.policies = { ...(rc.policies ?? {}), [r.body.policyId]: p.agent };
  await writeRc(rc);
  emit(
    g,
    () =>
      `policy created\n  policyId:  ${r.body.policyId}\n  expiresAt: ${r.body.expiresAt}`,
    r.body,
  );
}

async function cmdPolicyList(g: GlobalOpts, agentId: string): Promise<void> {
  const r = await http(
    { baseUrl: g.apiBase, apiKey: g.apiKey },
    'GET',
    `/v1/agents/${encodeURIComponent(agentId)}/policies`,
  );
  emit(g, () => JSON.stringify(r.body, null, 2), r.body);
}

async function cmdPolicyRevoke(
  g: GlobalOpts,
  agentId: string,
  policyId: string,
): Promise<void> {
  await http(
    { baseUrl: g.apiBase, apiKey: g.apiKey },
    'DELETE',
    `/v1/agents/${encodeURIComponent(agentId)}/policies/${encodeURIComponent(policyId)}`,
  );
  emit(g, () => `policy revoked: ${policyId}`, { policyId, revoked: true });
}

interface VerifyOpts {
  agent: string;
  policy: string;
  action: string;
  amount?: string;
  domain?: string;
}

interface VerifyResponse {
  valid: boolean;
  agentId: string | null;
  principalId: string | null;
  trustScore: number;
  trustBand: string | null;
  scopesGranted: string[];
  denialReason: string | null;
  verifiedAt: string;
  ttl: number;
}

async function loadAgentPrivateKey(agentId: string): Promise<Uint8Array> {
  const rc = await readRc();
  const entry = rc.agents?.[agentId];
  const path = entry?.keyPath ?? resolve(KEYS_DIR, `${agentId}.private`);
  let raw: string;
  try {
    raw = (await readFile(path, 'utf8')).trim();
  } catch {
    throw new CliError(
      `private key not found at ${path} — register the agent first with \`aegis agent register\``,
      2,
    );
  }
  const st = await stat(path);
  // 0600 check (mask only the perm bits; bit 6 = group/other read/write).
  if ((st.mode & 0o077) !== 0) {
    stderr.write(`warning: ${path} is not 0600 (mode=${(st.mode & 0o777).toString(8)})\n`);
  }
  return fromB64Url(raw);
}

async function signRequestToken(
  privateKey: Uint8Array,
  agentId: string,
  policyId: string,
  ctx: { action: string; amount?: number; merchantDomain?: string; ttlSeconds?: number },
): Promise<string> {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + (ctx.ttlSeconds ?? 60);
  const header = { alg: 'EdDSA', typ: 'JWT' };
  const claims: Record<string, unknown> = {
    sub: agentId,
    pid: policyId,
    iat,
    exp,
    jti: crypto.randomUUID(),
    act: ctx.action,
  };
  if (ctx.amount !== undefined) claims.amt = ctx.amount;
  if (ctx.merchantDomain) claims.dom = ctx.merchantDomain;
  const enc = new TextEncoder();
  const headerB64 = toB64Url(enc.encode(JSON.stringify(header)));
  const payloadB64 = toB64Url(enc.encode(JSON.stringify(claims)));
  const signingInput = enc.encode(`${headerB64}.${payloadB64}`);
  const sig = await ed.signAsync(signingInput, privateKey);
  return `${headerB64}.${payloadB64}.${toB64Url(sig)}`;
}

async function cmdVerify(g: GlobalOpts, v: VerifyOpts): Promise<void> {
  const priv = await loadAgentPrivateKey(v.agent);
  const token = await signRequestToken(priv, v.agent, v.policy, {
    action: v.action,
    amount: v.amount !== undefined ? Number(v.amount) : undefined,
    merchantDomain: v.domain,
  });
  const body: Record<string, unknown> = { token, action: v.action };
  if (v.amount !== undefined) body.amount = Number(v.amount);
  if (v.domain) body.merchantDomain = v.domain;

  const r = await http<VerifyResponse>(
    { baseUrl: g.apiBase, apiKey: g.apiKey },
    'POST',
    '/v1/verify',
    body,
  );
  if (g.json) {
    stdout.write(`${JSON.stringify(r.body, null, 2)}\n`);
  } else if (r.body.valid) {
    stdout.write(
      `✓ verify approved\n  agentId:    ${r.body.agentId}\n  trustBand:  ${r.body.trustBand} (${r.body.trustScore})\n  scopes:     ${r.body.scopesGranted.join(', ')}\n  ttl:        ${r.body.ttl}s\n`,
    );
  } else {
    const reason = r.body.denialReason ?? 'UNKNOWN';
    const desc = DENIAL_DESCRIPTIONS[reason] ?? 'denied (no description registered)';
    stdout.write(`✗ ${reason}: ${desc}\n`);
  }
  if (!r.body.valid) throw new CliError('verify denied', 5);
}

interface AuditOpts {
  agent: string;
  since?: string;
  follow?: boolean;
}

interface AuditEvent {
  id: string;
  agentId: string;
  action: string;
  decision: string;
  denialReason: string | null;
  timestamp: string;
}

interface AuditPage {
  events: AuditEvent[];
  nextCursor: string | null;
  count: number;
}

function fmtAudit(e: AuditEvent): string {
  const reason = e.denialReason ? ` reason=${e.denialReason}` : '';
  return `${e.timestamp} ${e.decision.padEnd(8)} ${e.action}${reason}  id=${e.id}`;
}

async function cmdAuditTail(g: GlobalOpts, o: AuditOpts): Promise<void> {
  let since = o.since;
  // First page (--since or beginning).
  const seen = new Set<string>();
  const fetchPage = async (from?: string): Promise<AuditPage> => {
    const r = await http<AuditPage>(
      { baseUrl: g.apiBase, apiKey: g.apiKey },
      'GET',
      `/v1/agents/${encodeURIComponent(o.agent)}/audit`,
      undefined,
      from ? { from, limit: '50' } : { limit: '50' },
    );
    return r.body;
  };

  const initial = await fetchPage(since);
  for (const e of initial.events) {
    seen.add(e.id);
    if (g.json) stdout.write(`${JSON.stringify(e)}\n`);
    else stdout.write(`${fmtAudit(e)}\n`);
  }
  if (initial.events.length > 0) {
    since = initial.events[initial.events.length - 1]?.timestamp ?? since;
  }

  if (!o.follow) return;

  // Poll loop. SIGINT exits cleanly.
  for (;;) {
    await sleep(2000);
    const page = await fetchPage(since);
    for (const e of page.events) {
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      if (g.json) stdout.write(`${JSON.stringify(e)}\n`);
      else stdout.write(`${fmtAudit(e)}\n`);
      since = e.timestamp;
    }
  }
}

async function cmdTrustScore(g: GlobalOpts, agentId: string): Promise<void> {
  // GET /v1/agents/:id/bate — REQUIRES_ENDPOINT. bate.controller is currently
  // POST-only at /agents/:agentId/report. We fall back to the status endpoint
  // (which carries trustScore + trustBand) and document.
  try {
    const r = await http<{ score: number; band: string; signals?: unknown[] }>(
      { baseUrl: g.apiBase, apiKey: g.apiKey },
      'GET',
      `/v1/agents/${encodeURIComponent(agentId)}/bate`,
    );
    emit(
      g,
      () =>
        `trust score: ${r.body.score} (${r.body.band})${r.body.signals ? `\n  recent signals: ${r.body.signals.length}` : ''}`,
      r.body,
    );
  } catch (err) {
    if (err instanceof CliError && err.code === 1) {
      const r = await http<{ trustScore: number; trustBand: string }>(
        { baseUrl: g.apiBase, apiKey: g.apiKey },
        'GET',
        `/v1/agents/${encodeURIComponent(agentId)}/status`,
      );
      emit(
        g,
        () =>
          `trust score (via /status fallback — /bate not yet implemented):\n  score: ${r.body.trustScore}\n  band:  ${r.body.trustBand}`,
        { ...r.body, source: 'status-fallback' },
      );
    } else {
      throw err;
    }
  }
}

async function cmdHealth(g: GlobalOpts): Promise<void> {
  const r = await http({ baseUrl: g.apiBase }, 'GET', '/v1/health/ready');
  emit(g, () => JSON.stringify(r.body), r.body);
}

// ── CLI builder ───────────────────────────────────────────────────

export function buildCli(): Command {
  const program = new Command();
  program
    .name('aegis')
    .description('AEGIS operator CLI')
    .version('0.1.0')
    .addOption(new Option('--api-base <url>', 'AEGIS API base URL').default(DEFAULT_BASE))
    .addOption(new Option('--api-key <key>', 'AEGIS API key (mgmt)').env('AEGIS_API_KEY'))
    .option('--json', 'emit JSON instead of human output', false)
    .exitOverride();

  async function resolveGlobals(): Promise<GlobalOpts> {
    const opts = program.opts<{ apiBase: string; apiKey?: string; json: boolean }>();
    let apiKey = opts.apiKey;
    if (!apiKey) {
      const rc = await readRc();
      apiKey = rc.apiKey;
    }
    return { apiBase: opts.apiBase, apiKey, json: opts.json };
  }

  program
    .command('register')
    .description('Register a new principal (account) and persist its API key')
    .requiredOption('--email <email>', 'principal email')
    .action(async (o: { email: string }) => {
      await cmdRegister(await resolveGlobals(), o.email);
    });

  const agent = program.command('agent').description('Agent identity commands');
  agent
    .command('register')
    .description('Generate Ed25519 keypair and register an agent')
    .requiredOption('--runtime <runtime>', 'agent runtime: OPENAI|ANTHROPIC|GOOGLE|HUGGINGFACE|CUSTOM')
    .option('--label <label>', 'optional human label')
    .action(async (o: { runtime: string; label?: string }) => {
      await cmdAgentRegister(await resolveGlobals(), o.runtime, o.label);
    });
  agent
    .command('list')
    .description('List agents (from local rc, GETs each)')
    .action(async () => {
      await cmdAgentList(await resolveGlobals());
    });
  agent
    .command('revoke <agentId>')
    .description('Revoke an agent')
    .action(async (agentId: string) => {
      await cmdAgentRevoke(await resolveGlobals(), agentId);
    });
  agent
    .command('status <agentId>')
    .description('Get agent status (no auth)')
    .action(async (agentId: string) => {
      await cmdAgentStatus(await resolveGlobals(), agentId);
    });

  const policy = program.command('policy').description('Policy commands');
  policy
    .command('create')
    .description('Create an ACTIVE policy for an agent')
    .requiredOption('--agent <agentId>', 'agent id')
    .requiredOption('--scope <scope>', 'scope category, e.g. commerce')
    .requiredOption('--max-per-tx <n>', 'max amount per transaction')
    .option('--currency <iso>', 'currency code', 'USD')
    .option('--expires-in <duration>', 'duration like 30d, 12h, 60m', '30d')
    .action(
      async (o: {
        agent: string;
        scope: string;
        maxPerTx: string;
        currency: string;
        expiresIn: string;
      }) => {
        await cmdPolicyCreate(await resolveGlobals(), o);
      },
    );
  policy
    .command('list')
    .description('List policies for an agent')
    .requiredOption('--agent <agentId>', 'agent id')
    .action(async (o: { agent: string }) => {
      await cmdPolicyList(await resolveGlobals(), o.agent);
    });
  policy
    .command('revoke')
    .description('Revoke a policy')
    .requiredOption('--agent <agentId>', 'agent id')
    .requiredOption('--policy <policyId>', 'policy id')
    .action(async (o: { agent: string; policy: string }) => {
      await cmdPolicyRevoke(await resolveGlobals(), o.agent, o.policy);
    });

  program
    .command('verify')
    .description('Sign a request locally and submit to /v1/verify')
    .requiredOption('--agent <agentId>', 'agent id')
    .requiredOption('--policy <policyId>', 'policy id')
    .requiredOption('--action <action>', 'requested action, e.g. commerce.purchase')
    .option('--amount <n>', 'transaction amount')
    .option('--domain <domain>', 'merchant domain')
    .action(
      async (o: { agent: string; policy: string; action: string; amount?: string; domain?: string }) => {
        await cmdVerify(await resolveGlobals(), o);
      },
    );

  const audit = program.command('audit').description('Audit log commands');
  audit
    .command('tail')
    .description('Tail audit events for an agent (--follow polls every 2s)')
    .requiredOption('--agent <agentId>', 'agent id')
    .option('--since <iso>', 'ISO-8601 lower bound')
    .option('--follow', 'poll for new events', false)
    .action(async (o: { agent: string; since?: string; follow?: boolean }) => {
      await cmdAuditTail(await resolveGlobals(), o);
    });

  const trust = program.command('trust').description('Trust / BATE commands');
  trust
    .command('score <agentId>')
    .description('Get trust score (falls back to /status when /bate not wired)')
    .action(async (agentId: string) => {
      await cmdTrustScore(await resolveGlobals(), agentId);
    });

  program
    .command('health')
    .description('GET /v1/health/ready')
    .action(async () => {
      await cmdHealth(await resolveGlobals());
    });

  return program;
}

// ── Entry ─────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const program = buildCli();
  try {
    await program.parseAsync(argv);
  } catch (err) {
    if (err instanceof CliError) {
      stderr.write(`${err.message}\n`);
      exit(err.code);
    }
    // commander exitOverride throws CommanderError with exitCode set.
    const e = err as { exitCode?: number; code?: string; message?: string };
    if (typeof e.exitCode === 'number') {
      // commander already wrote help/error; map to 2 for usage errors.
      exit(e.exitCode === 0 ? 0 : 2);
    }
    stderr.write(`${(err as Error).message ?? String(err)}\n`);
    exit(1);
  }
}

const invokedDirectly = (() => {
  if (typeof process === 'undefined' || !process.argv[1]) return false;
  try {
    const entryUrl = new URL(`file://${process.argv[1]}`).href;
    return import.meta.url === entryUrl;
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  void main();
}
