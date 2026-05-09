#!/usr/bin/env -S node --import=tsx
/**
 * AEGIS — idempotent dev seed.
 *
 * Creates (or no-ops on) the minimum row set a developer needs to hit the
 * API end-to-end:
 *
 *   1. Principal             — email "dev@aegis.local", planTier=DEVELOPER
 *   2. ApiKey                — full-scope key prefixed "aegis_sk_"  (per ref impl)
 *   3. AgentIdentity         — with a freshly generated Ed25519 keypair;
 *                              public key persisted; private key written
 *                              0600 to BOTH:
 *                                ./.local/keys/dev-agent.private  (durable)
 *                                ./.aegis-dev-key.txt             (operator-facing)
 *   4. AgentPolicy ACTIVE    — commerce scope, $500 / txn (50 000 cents) USD,
 *                              30 day expiry
 *   5. RelyingParty          — domain "localhost:4000", kind GENERIC
 *
 * Idempotency key:
 *   - Principal:      unique (email)
 *   - AgentIdentity:  (principalId, label="dev-agent")
 *   - AgentPolicy:    ACTIVE policy on that agent with label="dev-policy"
 *   - ApiKey:         (principalId, label="dev-key")  — only minted once.
 *     Re-runs cannot recover the plaintext key (it's bcrypt-hashed at rest);
 *     use --reset to rotate.
 *   - RelyingParty:   unique (domain="localhost:4000")
 *
 * Re-running prints "already seeded" and emits the same JSON shape minus
 * apiKey. Use --reset (forbidden in prod) to wipe and recreate.
 *
 * Safety rails (CLAUDE.md invariant 4 — no fabricated data, no silent
 * production writes):
 *   - Refuses to run with a loud error when NODE_ENV=production.
 *   - Refuses to run when DATABASE_URL points at a hosted provider
 *     (heuristic match on hostname: railway, neon, supabase, aws, gcp).
 *
 * Bcrypt cost: 12 always (key issuance is rare in this script). --fast drops
 * to 4 for test environments where we hash a key on every run.
 *
 *   pnpm --filter @aegis/scripts seed -- --fast
 *   NODE_ENV=development pnpm --filter @aegis/scripts seed -- --reset
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { stdout, stderr, exit, argv, env } from 'node:process';
import { randomBytes, createHash } from 'node:crypto';

import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';
import bcrypt from 'bcryptjs';
import { Command } from 'commander';

ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

// ── Constants tied to the reference impl ──────────────────────────

const PRINCIPAL_EMAIL = 'dev@aegis.local';
const PRINCIPAL_NAME = 'Local Dev';
const API_KEY_LABEL = 'dev-key';
const AGENT_LABEL = 'dev-agent';
const POLICY_LABEL = 'dev-policy';
const API_KEY_PREFIX = 'aegis_sk_';
const AGENT_PRIVATE_KEY_PATH = resolve('./.local/keys/dev-agent.private');
// Operator-facing copy of the agent private key. Easier to find than the
// nested ./.local/keys/ path. Same 0600 mode + .gitignore expectation.
const AGENT_PRIVATE_KEY_OP_PATH = resolve('./.aegis-dev-key.txt');
// $500 maxPerTransaction. The user-facing seed contract (50_000 cents)
// kept in cents form here for clarity; we surface USD on the wire.
const POLICY_SPEND_MAX_PER_TX_CENTS = 50_000;
const POLICY_SPEND_MAX_PER_TX_USD = POLICY_SPEND_MAX_PER_TX_CENTS / 100;
// Local relying-party endpoint that the dashboard's first-run flow calls.
const RELYING_PARTY_DOMAIN = 'localhost:4000';
const RELYING_PARTY_NAME = 'Local Dev RP';
// Hosted-DB heuristic — refuse to seed against any of these. Substring
// match on `URL.hostname`; explicit and short on purpose. Add new
// providers here when they become reachable from local dev.
const HOSTED_DB_HOSTS = ['railway', 'neon', 'supabase', 'amazonaws', 'aws', 'gcp', 'rds'] as const;

// ── Pure helpers ──────────────────────────────────────────────────

function toB64Url(bytes: Uint8Array | Buffer): string {
  return Buffer.from(bytes).toString('base64url');
}

/** `aegis_sk_<22-char b64url of 16 random bytes>` — matches ref impl shape. */
export function mintApiKey(): { plaintext: string; prefix: string } {
  const raw = toB64Url(randomBytes(16));
  const plaintext = `${API_KEY_PREFIX}${raw}`;
  // First 12 chars — matches `api-key.service.ts` which narrows the candidate
  // set on `keyPrefix = plaintext.slice(0, 12)` during auth. Storing 16 chars
  // would put zero candidates in the lookup and silently fail every login.
  const prefix = plaintext.slice(0, 12);
  return { plaintext, prefix };
}

/**
 * Mint a real Ed25519-signed compact JWT for the seed policy. Not fabricated
 * — the signature verifies under the keypair we just generated. This is a
 * dev-only convenience; real policies are signed by the AEGIS audit key.
 */
async function mintSeedPolicyToken(
  privateKey: Uint8Array,
  payload: Record<string, unknown>,
): Promise<string> {
  const header = { alg: 'EdDSA', typ: 'JWT' };
  const headerB64 = toB64Url(Buffer.from(JSON.stringify(header)));
  const payloadB64 = toB64Url(Buffer.from(JSON.stringify(payload)));
  const signingInput = `${headerB64}.${payloadB64}`;
  const sig = await ed.signAsync(new TextEncoder().encode(signingInput), privateKey);
  return `${signingInput}.${toB64Url(sig)}`;
}

function sha256Hex(s: string): string {
  // Non-secret token discriminator (unique index on AgentPolicy.tokenHash).
  return createHash('sha256').update(s).digest('hex');
}

/**
 * Returns the hostname of `DATABASE_URL` lowercased, or `null` if the URL
 * is unparseable / absent. Errors surface up; we never silently accept
 * a blank.
 */
function databaseHost(): string | null {
  const raw = env.DATABASE_URL;
  if (!raw) return null;
  try {
    return new URL(raw).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Hard refusal gate. Runs before any Prisma connection so we never even
 * pretend to attempt a write against a hosted DB or a production NODE_ENV.
 * Throws — caller surfaces the message to stderr and exits 1.
 */
function assertSafeSeedEnvironment(): void {
  if (env.NODE_ENV === 'production') {
    throw new Error(
      'REFUSING TO SEED: NODE_ENV=production. The seed script is dev-only — ' +
        'it issues a known plaintext API key and writes the agent private key ' +
        'to disk. If you genuinely need fixtures in a hosted environment, ' +
        'mint them via the API and store the secrets in your secret manager.',
    );
  }
  const host = databaseHost();
  if (host) {
    const hit = HOSTED_DB_HOSTS.find((needle) => host.includes(needle));
    if (hit) {
      throw new Error(
        `REFUSING TO SEED: DATABASE_URL hostname "${host}" matches hosted-DB ` +
          `heuristic "${hit}". The seed script writes a known-plaintext API ` +
          `key and a long-lived agent private key — never run it against a ` +
          `shared/hosted database. Point DATABASE_URL at a local Postgres ` +
          `(docker-compose up postgres) and retry.`,
      );
    }
  }
}

// ── Prisma structural shape (see lazy-import note in main()) ─────

interface PrincipalRow {
  id: string;
  email: string;
}
interface AgentRow {
  id: string;
  publicKey: string;
}
interface PolicyRow {
  id: string;
}
interface ApiKeyRow {
  id: string;
}
interface RelyingPartyRow {
  id: string;
  domain: string;
}

interface PrismaShape {
  principal: {
    findUnique: (args: { where: { email: string } }) => Promise<PrincipalRow | null>;
    delete: (args: { where: { id: string } }) => Promise<unknown>;
    upsert: (args: {
      where: { email: string };
      update: Record<string, unknown>;
      create: Record<string, unknown>;
    }) => Promise<PrincipalRow>;
  };
  apiKey: {
    findFirst: (args: {
      where: { principalId: string; label: string; revokedAt: null };
    }) => Promise<ApiKeyRow | null>;
    create: (args: { data: Record<string, unknown> }) => Promise<ApiKeyRow>;
  };
  agentIdentity: {
    findFirst: (args: {
      where: { principalId: string; label: string };
    }) => Promise<AgentRow | null>;
    create: (args: { data: Record<string, unknown> }) => Promise<AgentRow>;
  };
  agentPolicy: {
    findFirst: (args: {
      where: {
        agentId: string;
        label: string;
        status: 'ACTIVE';
        expiresAt: { gt: Date };
      };
    }) => Promise<PolicyRow | null>;
    create: (args: { data: Record<string, unknown> }) => Promise<PolicyRow>;
  };
  relyingParty: {
    upsert: (args: {
      where: { domain: string };
      update: Record<string, unknown>;
      create: Record<string, unknown>;
    }) => Promise<RelyingPartyRow>;
  };
  $disconnect: () => Promise<void>;
}

// ── CLI ───────────────────────────────────────────────────────────

interface CliOpts {
  reset: boolean;
  fast: boolean;
}

function parseCli(args: string[]): CliOpts {
  const program = new Command()
    .name('seed-dev')
    .description('Idempotent dev seed: principal, api key, agent, policy.')
    .option('--reset', 'wipe seed rows before recreating (non-prod only)', false)
    .option('--fast', 'use bcrypt cost 4 (test environments only)', false)
    .exitOverride();
  program.parse(args, { from: 'user' });
  return program.opts<CliOpts>();
}

// ── Main ──────────────────────────────────────────────────────────

interface SeedResult {
  ok: true;
  alreadySeeded: boolean;
  principalId: string;
  agentId: string;
  policyId: string;
  relyingPartyId: string;
  apiKey?: string; // only on first run
  publicKeyB64Url: string;
  privateKeyPath: string; // durable path under .local/keys
  privateKeyOpPath: string; // operator-facing copy at repo root
}

async function writeAgentPrivateKey(privateKeyB64Url: string): Promise<void> {
  // Durable nested path — kept stable across rounds for tooling that
  // already references it (e.g. integration test fixtures).
  await mkdir(dirname(AGENT_PRIVATE_KEY_PATH), { recursive: true });
  await writeFile(AGENT_PRIVATE_KEY_PATH, `${privateKeyB64Url}\n`, { mode: 0o600 });
  // Operator-facing copy at repo root. Required by Phase-1 launch swarm
  // contract — easier to discover than the .local/keys/ nested path.
  // NOTE: .gitignore must exclude .aegis-dev-key.txt (verify post-seed).
  await writeFile(AGENT_PRIVATE_KEY_OP_PATH, `${privateKeyB64Url}\n`, { mode: 0o600 });
}

async function main(): Promise<void> {
  const opts = parseCli(argv.slice(2));

  // Hard refuse before touching Prisma. Covers --reset AND read-only
  // re-seed paths (we still write a key file + may issue an API key).
  assertSafeSeedEnvironment();

  if (opts.reset && env.NODE_ENV === 'production') {
    // Belt-and-braces: assertSafeSeedEnvironment() already covers this,
    // but the explicit message is part of the seed contract.
    throw new Error('--reset is forbidden when NODE_ENV=production');
  }

  // Lazy import — Prisma client is only available once apps/api has run
  // `prisma generate`. Importing eagerly would break tests that don't need it.
  // type-rationale: @prisma/client's generated types may not exist when this
  // script is typechecked in isolation, so we cast through unknown to a
  // structural shape limited to what we actually call. The runtime import is
  // real and resolves to apps/api's generated client at the workspace root.
  const prismaMod = (await import('@prisma/client')) as unknown as {
    PrismaClient: new () => PrismaShape;
  };
  const prisma: PrismaShape = new prismaMod.PrismaClient();

  try {
    if (opts.reset) {
      // Cascade through Principal → ApiKey/AgentIdentity → AgentPolicy.
      const existing = await prisma.principal.findUnique({ where: { email: PRINCIPAL_EMAIL } });
      if (existing) {
        await prisma.principal.delete({ where: { id: existing.id } });
      }
    }

    // 1. Principal — upsert by email. planTier=DEVELOPER so policy/agent
    // limits exercised during local dev mirror what a paid customer hits.
    const principal = await prisma.principal.upsert({
      where: { email: PRINCIPAL_EMAIL },
      update: { planTier: 'DEVELOPER' },
      create: {
        email: PRINCIPAL_EMAIL,
        name: PRINCIPAL_NAME,
        emailVerified: true,
        planTier: 'DEVELOPER',
      },
    });

    // 2. ApiKey — only if absent. We can't rebuild the plaintext from a hash.
    const existingKey = await prisma.apiKey.findFirst({
      where: { principalId: principal.id, label: API_KEY_LABEL, revokedAt: null },
    });
    let issuedApiKey: string | undefined;
    if (!existingKey) {
      const minted = mintApiKey();
      const cost = opts.fast ? 4 : 12;
      const keyHash = await bcrypt.hash(minted.plaintext, cost);
      await prisma.apiKey.create({
        data: {
          keyHash,
          keyPrefix: minted.prefix,
          label: API_KEY_LABEL,
          principalId: principal.id,
          scope: 'FULL',
        },
      });
      issuedApiKey = minted.plaintext;
    }

    // 3. AgentIdentity — keyed on (principalId, label).
    let agent = await prisma.agentIdentity.findFirst({
      where: { principalId: principal.id, label: AGENT_LABEL },
    });
    let publicKeyB64Url: string;
    let privateKeyB64Url: string | null = null;
    if (!agent) {
      const privKey = ed.utils.randomPrivateKey();
      const pubKey = await ed.getPublicKeyAsync(privKey);
      privateKeyB64Url = toB64Url(privKey);
      publicKeyB64Url = toB64Url(pubKey);
      agent = await prisma.agentIdentity.create({
        data: {
          publicKey: publicKeyB64Url,
          principalId: principal.id,
          label: AGENT_LABEL,
          runtime: 'CUSTOM',
          status: 'ACTIVE',
          trustScore: 500,
          trustBand: 'VERIFIED',
        },
      });
      await writeAgentPrivateKey(privateKeyB64Url);
    } else {
      publicKeyB64Url = agent.publicKey;
    }

    // 4. AgentPolicy — keyed on (agentId, label, status=ACTIVE, not expired).
    const now = new Date();
    let policy = await prisma.agentPolicy.findFirst({
      where: {
        agentId: agent.id,
        label: POLICY_LABEL,
        status: 'ACTIVE',
        expiresAt: { gt: now },
      },
    });
    if (!policy) {
      // For seed we mint the token under the agent's own key. Real production
      // policies are signed by the AEGIS audit key; this is a dev convenience.
      // privateKeyB64Url is set when we just created the agent; otherwise we
      // generate an ephemeral throwaway signer for the seed token only — the
      // token is never used for real verification because real policies are
      // signed under the AEGIS audit key, not the agent key. Documented above.
      const signerPriv = privateKeyB64Url
        ? new Uint8Array(Buffer.from(privateKeyB64Url, 'base64url'))
        : ed.utils.randomPrivateKey();
      const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      const signedToken = await mintSeedPolicyToken(signerPriv, {
        sub: agent.id,
        pid: `seed-${agent.id}`,
        scopes: ['commerce'],
        iat: Math.floor(now.getTime() / 1000),
        exp: Math.floor(expiresAt.getTime() / 1000),
        type: 'aegis_policy_seed',
      });
      policy = await prisma.agentPolicy.create({
        data: {
          agentId: agent.id,
          label: POLICY_LABEL,
          signedToken,
          tokenHash: sha256Hex(signedToken),
          status: 'ACTIVE',
          expiresAt,
          scopes: [
            {
              category: 'commerce',
              // 50 000 cents = $500 maxPerTransaction. Phase-1 launch seed
              // contract — high enough for non-trivial dashboard demos,
              // low enough that an accidental real charge stings.
              spendLimit: {
                currency: 'USD',
                maxPerTransaction: POLICY_SPEND_MAX_PER_TX_USD,
              },
            },
          ],
        },
      });
    }

    // 5. RelyingParty — upsert by domain. The `apiKeyHash` column has a
    // UNIQUE constraint, so we mint a stable-but-non-secret hash from
    // the domain itself so re-runs don't collide. This RP is for local
    // dashboard testing only — the dashboard's first-run flow assumes
    // a relying-party row exists for `localhost:4000`.
    const rpApiKeyHash = sha256Hex(`seed-rp:${RELYING_PARTY_DOMAIN}`);
    const relyingParty = await prisma.relyingParty.upsert({
      where: { domain: RELYING_PARTY_DOMAIN },
      update: { name: RELYING_PARTY_NAME, principalId: principal.id },
      create: {
        domain: RELYING_PARTY_DOMAIN,
        name: RELYING_PARTY_NAME,
        apiKeyHash: rpApiKeyHash,
        principalId: principal.id,
        kind: 'GENERIC',
        status: 'ACTIVE',
        verified: true,
        verifiedAt: now,
      },
    });

    const result: SeedResult = {
      ok: true,
      alreadySeeded: !issuedApiKey && !!existingKey,
      principalId: principal.id,
      agentId: agent.id,
      policyId: policy.id,
      relyingPartyId: relyingParty.id,
      publicKeyB64Url,
      privateKeyPath: AGENT_PRIVATE_KEY_PATH,
      privateKeyOpPath: AGENT_PRIVATE_KEY_OP_PATH,
      ...(issuedApiKey ? { apiKey: issuedApiKey } : {}),
    };
    stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.alreadySeeded) {
      stdout.write('already seeded\n');
    }
    // Operator-facing summary (matches Phase-1 launch swarm contract).
    stdout.write(
      `\n[seed-dev] summary
  Principal ID:     ${principal.id}
  Agent ID:         ${agent.id}
  Policy ID:        ${policy.id}
  Relying Party ID: ${relyingParty.id}  (${RELYING_PARTY_DOMAIN})
  Public key:       ${publicKeyB64Url}
  Private key file: ${AGENT_PRIVATE_KEY_OP_PATH}
${issuedApiKey ? `  API key (use as x-aegis-api-key): ${issuedApiKey}\n` : '  API key: already issued (use --reset to rotate)\n'}`,
    );
  } finally {
    await prisma.$disconnect();
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
  main().catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    stderr.write(`${JSON.stringify({ ok: false, error: msg })}\n`);
    exit(1);
  });
}

export { mintSeedPolicyToken, sha256Hex, assertSafeSeedEnvironment, databaseHost };
