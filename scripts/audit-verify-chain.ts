#!/usr/bin/env -S node --import=tsx
/**
 * AEGIS — audit-chain offline verifier.
 *
 * Reads `AuditEvent` rows from `DATABASE_URL`, fetches the AEGIS public
 * key from a configurable JWKS endpoint (default `/.well-known/jwks.json`
 * on `AEGIS_API_BASE`), and verifies every chain link.
 *
 * This is the third-party-verifier path. Auditors / restore drills run
 * it with just DATABASE_URL + JWKS URL — no AEGIS source code is
 * required to rebuild the chain.
 *
 * Output:
 *   stdout  — one line per event with PASS / FAIL.
 *   exit 0  — entire chain verified clean.
 *   exit 1  — chain break detected (first break logged).
 *   exit 2  — usage error.
 *   exit 3  — JWKS fetch error.
 *
 * The chain-link formula is byte-identical to `audit-chain.util.ts` in
 * the API; the spec at `audit-verify-chain.spec.ts` enforces parity by
 * re-using fixtures from the API's own spec set.
 */

import { createHash } from 'node:crypto';
import { stdout, stderr, exit, argv, env } from 'node:process';

import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';
import { Command, Option } from 'commander';
import { PrismaClient } from '@prisma/client';

ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

const enc = new TextEncoder();

// ── Shared canonicalization (must match audit-chain.util.ts) ────────

export function canonicalize(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(v: unknown): unknown {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(sortKeys);
  const obj = v as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    out[key] = sortKeys(obj[key]);
  }
  return out;
}

export function decodeB64Url(s: string): Uint8Array {
  return Uint8Array.from(Buffer.from(s, 'base64url'));
}

/** sha256 chain link — genesis variant when both prev are null. */
export function prevHash(
  prevEventId: string | null,
  prevSignatureB64Url: string | null,
): Buffer {
  if (prevEventId === null && prevSignatureB64Url === null) {
    return createHash('sha256').update('AEGIS-AUDIT-GENESIS-v1').digest();
  }
  if (prevEventId === null || prevSignatureB64Url === null) {
    throw new Error('prev id and signature must both be set or both be null');
  }
  const sigBytes = decodeB64Url(prevSignatureB64Url);
  return createHash('sha256').update(sigBytes).update(prevEventId, 'utf8').digest();
}

// ── JWKS fetch ────────────────────────────────────────────────────

interface Jwk {
  kty: 'OKP';
  crv: 'Ed25519';
  alg: 'EdDSA';
  use: 'sig';
  kid: string;
  x: string;
}
interface Jwks {
  keys: Jwk[];
}

export async function fetchJwks(jwksUrl: string): Promise<Jwks> {
  const res = await fetch(jwksUrl, { headers: { accept: 'application/jwk-set+json' } });
  if (!res.ok) {
    throw new Error(`JWKS fetch failed: ${res.status} ${res.statusText} — ${jwksUrl}`);
  }
  const body = (await res.json()) as Jwks;
  if (!body.keys || !Array.isArray(body.keys) || body.keys.length === 0) {
    throw new Error(`JWKS response has no keys: ${jwksUrl}`);
  }
  return body;
}

export function pickPublicKey(jwks: Jwks, kid: string | undefined): Jwk {
  if (kid) {
    const match = jwks.keys.find((k) => k.kid === kid);
    if (!match) throw new Error(`No JWKS key matches kid ${kid}`);
    return match;
  }
  // Phase 0 single-key path: use the first key in the set.
  return jwks.keys[0]!;
}

// ── Reconstruct the canonical signed payload from a DB row ─────────

export interface AuditEventRow {
  id: string;
  agentId: string | null;
  claimedAgentId: string | null;
  principalId: string;
  decision: 'APPROVED' | 'DENIED' | 'FLAGGED';
  denialReason: string | null;
  policyId: string | null;
  trustScoreAtEvent: number;
  trustBandAtEvent: 'PLATINUM' | 'VERIFIED' | 'WATCH' | 'FLAGGED';
  currency: string | null;
  timestamp: Date;
  actionHash: string;
  relyingPartyHash: string | null;
  requestedAmountHash: string | null;
  policySnapshotHash: string | null;
  payloadVersion: number;
  aegisSignature: string;
}

export function rebuildPayload(row: AuditEventRow): Record<string, unknown> {
  // Mirrors AuditChainPayload v2 from audit-chain.util.ts.
  // CRITICAL: the field set + names + nullability MUST match the signer.
  // If audit-chain.util.ts grows a field, add it here. Spec covers parity.
  return {
    agentId: row.agentId ?? '__no_agent__',
    claimedAgentId: row.claimedAgentId,
    principalId: row.principalId,
    decision: row.decision,
    denialReason: row.denialReason,
    policyId: row.policyId,
    trustScoreAtEvent: row.trustScoreAtEvent,
    trustBandAtEvent: row.trustBandAtEvent,
    currency: row.currency,
    timestamp: row.timestamp.toISOString(),
    actionHash: row.actionHash,
    relyingPartyHash: row.relyingPartyHash,
    requestedAmountHash: row.requestedAmountHash,
    policySnapshotHash: row.policySnapshotHash,
    v: 2,
  };
}

// ── Chain walk ────────────────────────────────────────────────────

export interface VerifyOutcome {
  totalEvents: number;
  passed: number;
  firstBreakAt: number | null; // 0-based index of the first failing event
  firstBreakReason: string | null;
}

export async function verifyChain(
  rows: AuditEventRow[],
  publicKeyB64Url: string,
  onEvent?: (idx: number, row: AuditEventRow, ok: boolean, reason?: string) => void,
): Promise<VerifyOutcome> {
  const pub = decodeB64Url(publicKeyB64Url);
  let prevId: string | null = null;
  let prevSig: string | null = null;
  let firstBreakAt: number | null = null;
  let firstBreakReason: string | null = null;
  let passed = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    if (row.payloadVersion !== 2) {
      const reason = `unsupported payloadVersion=${row.payloadVersion} at event ${row.id}`;
      onEvent?.(i, row, false, reason);
      if (firstBreakAt === null) {
        firstBreakAt = i;
        firstBreakReason = reason;
      }
      continue;
    }

    let ok = false;
    let reason: string | undefined;
    try {
      const prev = prevHash(prevId, prevSig);
      const canonical = enc.encode(canonicalize(rebuildPayload(row)));
      const message = Buffer.concat([prev, canonical]);
      const sig = decodeB64Url(row.aegisSignature);
      ok = await ed.verifyAsync(sig, message, pub);
      if (!ok) reason = 'signature failed';
    } catch (err) {
      ok = false;
      reason = (err as Error).message;
    }
    onEvent?.(i, row, ok, reason);
    if (ok) {
      passed++;
    } else if (firstBreakAt === null) {
      firstBreakAt = i;
      firstBreakReason = reason ?? 'unknown';
    }
    prevId = row.id;
    prevSig = row.aegisSignature;
  }

  return { totalEvents: rows.length, passed, firstBreakAt, firstBreakReason };
}

// ── CLI entry ─────────────────────────────────────────────────────

async function main(): Promise<void> {
  const program = new Command();
  program
    .name('audit-verify-chain')
    .description('Offline verifier for the AEGIS audit chain — for SOC2 auditors and restore drills.')
    .addOption(
      new Option('--api-base <url>', 'AEGIS API base URL — used for JWKS fetch')
        .default(env.AEGIS_API_BASE ?? 'http://localhost:4000'),
    )
    .addOption(
      new Option('--jwks <url>', 'override JWKS URL (otherwise <api-base>/.well-known/jwks.json)'),
    )
    .addOption(new Option('--agent <id>', 'verify only events for this agentId'))
    .addOption(new Option('--principal <id>', 'verify only events for this principalId'))
    .addOption(
      new Option('--limit <n>', 'cap number of events walked').argParser((v) => Number.parseInt(v, 10)),
    )
    .addOption(new Option('--json', 'machine-readable JSON output').default(false))
    .parse(argv);

  const opts = program.opts<{
    apiBase: string;
    jwks?: string;
    agent?: string;
    principal?: string;
    limit?: number;
    json: boolean;
  }>();

  if (!env.DATABASE_URL) {
    stderr.write('DATABASE_URL is required\n');
    exit(2);
  }

  const jwksUrl = opts.jwks ?? `${opts.apiBase.replace(/\/$/, '')}/.well-known/jwks.json`;

  let jwks: Jwks;
  try {
    jwks = await fetchJwks(jwksUrl);
  } catch (err) {
    stderr.write(`${(err as Error).message}\n`);
    exit(3);
  }
  const jwk = pickPublicKey(jwks, undefined);

  const prisma = new PrismaClient();
  try {
    const where: Record<string, unknown> = {};
    if (opts.agent) where.agentId = opts.agent;
    if (opts.principal) where.principalId = opts.principal;

    // Stable order = chain order. timestamp ASC, then id ASC for tie-break.
    const rows = (await prisma.auditEvent.findMany({
      where,
      orderBy: [{ timestamp: 'asc' }, { id: 'asc' }],
      take: opts.limit,
    })) as unknown as AuditEventRow[];

    const outcome = await verifyChain(rows, jwk.x, (idx, row, ok, reason) => {
      if (opts.json) return;
      const tag = ok ? 'PASS' : 'FAIL';
      const suffix = reason ? ` — ${reason}` : '';
      stdout.write(`${tag}  [${String(idx + 1).padStart(5, ' ')}] ${row.id} ${row.timestamp.toISOString()}${suffix}\n`);
    });

    if (opts.json) {
      stdout.write(`${JSON.stringify(outcome, null, 2)}\n`);
    } else {
      stdout.write(
        `\nverified ${outcome.passed} of ${outcome.totalEvents} events. ` +
          (outcome.firstBreakAt === null
            ? 'CHAIN INTACT.\n'
            : `BREAK at event #${outcome.firstBreakAt + 1} — ${outcome.firstBreakReason}\n`),
      );
    }
    exit(outcome.firstBreakAt === null ? 0 : 1);
  } finally {
    await prisma.$disconnect();
  }
}

// Only run when invoked directly, not when imported by the spec.
const isMain =
  argv[1] && (argv[1].endsWith('audit-verify-chain.ts') || argv[1].endsWith('audit-verify-chain.js'));
if (isMain) {
  main().catch((err) => {
    stderr.write(`fatal: ${(err as Error).message}\n`);
    exit(1);
  });
}
