// Browser-safe AEGIS engine for /try. Self-contained: real @noble/ed25519
// + canonical JSON + CLAUDE.md §6 denial precedence. Identical semantics
// to tests/scenarios/lib/harness.ts but trimmed for playground use (no
// intent reconciliation in v1 — keep the surface focused).
//
// Runs entirely in the browser. No network calls. No localStorage (the
// keypair is secret-shaped and lives only in component state).

import * as ed from '@noble/ed25519';
import { sha256 } from '@noble/hashes/sha2';

// ── Types ────────────────────────────────────────────────────────────

export type DenialReason =
  | 'AGENT_NOT_FOUND'
  | 'AGENT_REVOKED'
  | 'INVALID_SIGNATURE'
  | 'POLICY_REVOKED'
  | 'POLICY_EXPIRED'
  | 'SCOPE_NOT_GRANTED'
  | 'SPEND_LIMIT_EXCEEDED'
  | 'TRUST_SCORE_TOO_LOW'
  | 'ANOMALY_FLAGGED'
  | 'RAR_CONSTRAINT_FAILED';

export type TrustBand = 'PLATINUM' | 'VERIFIED' | 'WATCH' | 'FLAGGED';

export interface RarDetail {
  type: 'trading_order' | 'payment_initiation' | 'data_access' | 'agent_action';
  actions: string[];
  limits?: {
    per_order_usd?: number;
    per_day_usd?: number;
    trading_hours_utc?: [number, number];
  };
}

export interface Agent {
  id: string;
  publicKey: Uint8Array;
  privateKey: Uint8Array;
  trustScore: number;
  anomalyCount: number;
  revoked: boolean;
}

export interface Policy {
  actions: string[];
  amountMax?: number;
  authorizationDetails?: RarDetail[];
  revoked: boolean;
}

export interface AuditRow {
  seq: number;
  agentId: string;
  action: string;
  amount?: number;
  result: 'VALID' | 'DENIED';
  reason?: DenialReason;
  trustScore: number;
  trustBand: TrustBand;
  timestamp: number;
  prevHash: string;
  signatureB64Url: string;
}

export interface VerifyResult {
  valid: boolean;
  reason?: DenialReason;
  trustScore: number;
  trustBand: TrustBand;
  auditSeq: number;
}

// ── Helpers ──────────────────────────────────────────────────────────

export function trustBandFor(score: number): TrustBand {
  if (score >= 900) return 'PLATINUM';
  if (score >= 600) return 'VERIFIED';
  if (score >= 300) return 'WATCH';
  return 'FLAGGED';
}

export function b64UrlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64UrlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const bin = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function hexFromBytes(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function canonicalize(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map((v) => (v === undefined ? 'null' : canonicalize(v))).join(',') + ']';
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalize(obj[k])).join(',') + '}';
}

const GENESIS_PREV_HASH = '0'.repeat(64);

function buildAuditMessage(row: Omit<AuditRow, 'signatureB64Url'>): Uint8Array {
  return new TextEncoder().encode(canonicalize({
    seq: row.seq,
    agentId: row.agentId,
    action: row.action,
    amount: row.amount,
    result: row.result,
    reason: row.reason,
    trustScore: row.trustScore,
    trustBand: row.trustBand,
    timestamp: row.timestamp,
    prevHash: row.prevHash,
  }));
}

// ── Engine ───────────────────────────────────────────────────────────

export class AegisBrowser {
  private agent: Agent | null = null;
  private policy: Policy | null = null;
  private auditChain: AuditRow[] = [];
  private signingPrivate: Uint8Array;
  private signingPublic: Uint8Array;

  private constructor(signingPrivate: Uint8Array, signingPublic: Uint8Array) {
    this.signingPrivate = signingPrivate;
    this.signingPublic = signingPublic;
  }

  static async create(): Promise<AegisBrowser> {
    const sk = ed.utils.randomPrivateKey();
    const pk = await ed.getPublicKeyAsync(sk);
    return new AegisBrowser(sk, pk);
  }

  async generateAgent(): Promise<Agent> {
    const privateKey = ed.utils.randomPrivateKey();
    const publicKey = await ed.getPublicKeyAsync(privateKey);
    this.agent = {
      id: 'agt_' + b64UrlEncode(publicKey).slice(0, 6).toLowerCase(),
      publicKey,
      privateKey,
      trustScore: 750,
      anomalyCount: 0,
      revoked: false,
    };
    return this.agent;
  }

  getAgent(): Agent | null {
    return this.agent;
  }

  attachPolicy(policy: Omit<Policy, 'revoked'>): Policy {
    this.policy = { ...policy, revoked: false };
    return this.policy;
  }

  getPolicy(): Policy | null {
    return this.policy;
  }

  revokeAgent(): void {
    if (this.agent) this.agent.revoked = true;
  }

  revokePolicy(): void {
    if (this.policy) this.policy.revoked = true;
  }

  flagAnomaly(count = 1): void {
    if (!this.agent) return;
    this.agent.anomalyCount += count;
    this.agent.trustScore = Math.max(0, this.agent.trustScore - 100 * count);
  }

  boostTrust(delta: number): void {
    if (!this.agent) return;
    this.agent.trustScore = Math.min(1000, this.agent.trustScore + delta);
  }

  async signAction(action: string, amount?: number): Promise<string> {
    if (!this.agent) throw new Error('no agent — call generateAgent() first');
    const payload = {
      agentId: this.agent.id,
      action,
      amount,
      expiresAt: Date.now() + 60_000,
    };
    const message = new TextEncoder().encode(canonicalize(payload));
    const sigBytes = await ed.signAsync(message, this.agent.privateKey);
    const token = { ...payload, signatureB64Url: b64UrlEncode(sigBytes) };
    return b64UrlEncode(new TextEncoder().encode(canonicalize(token)));
  }

  async verify(wireToken: string, ctx: { action: string; amount?: number }): Promise<VerifyResult> {
    if (!this.agent) {
      return this.appendAndReturn({
        agentId: 'unknown',
        action: ctx.action,
        amount: ctx.amount,
        result: 'DENIED',
        reason: 'AGENT_NOT_FOUND',
        trustScore: 0,
        trustBand: 'FLAGGED',
      });
    }

    let token: { agentId: string; action: string; amount?: number; expiresAt: number; signatureB64Url: string };
    try {
      const json = new TextDecoder().decode(b64UrlDecode(wireToken));
      token = JSON.parse(json);
    } catch {
      return this.appendAndReturn({
        agentId: this.agent.id,
        action: ctx.action,
        amount: ctx.amount,
        result: 'DENIED',
        reason: 'INVALID_SIGNATURE',
        trustScore: this.agent.trustScore,
        trustBand: trustBandFor(this.agent.trustScore),
      });
    }

    if (this.agent.revoked) {
      return this.appendAndReturn({
        agentId: this.agent.id,
        action: ctx.action,
        amount: ctx.amount,
        result: 'DENIED',
        reason: 'AGENT_REVOKED',
        trustScore: this.agent.trustScore,
        trustBand: trustBandFor(this.agent.trustScore),
      });
    }

    // Verify signature
    const { signatureB64Url, ...payload } = token;
    const msg = new TextEncoder().encode(canonicalize(payload));
    const ok = await ed.verifyAsync(b64UrlDecode(signatureB64Url), msg, this.agent.publicKey);
    if (!ok) {
      return this.appendAndReturn({
        agentId: this.agent.id,
        action: ctx.action,
        amount: ctx.amount,
        result: 'DENIED',
        reason: 'INVALID_SIGNATURE',
        trustScore: this.agent.trustScore,
        trustBand: trustBandFor(this.agent.trustScore),
      });
    }

    if (token.expiresAt < Date.now()) {
      return this.appendAndReturn({
        agentId: this.agent.id,
        action: ctx.action,
        amount: ctx.amount,
        result: 'DENIED',
        reason: 'POLICY_EXPIRED',
        trustScore: this.agent.trustScore,
        trustBand: trustBandFor(this.agent.trustScore),
      });
    }

    // Token's claimed action must match the verify ctx action
    if (token.action !== ctx.action) {
      return this.appendAndReturn({
        agentId: this.agent.id,
        action: ctx.action,
        amount: ctx.amount,
        result: 'DENIED',
        reason: 'INVALID_SIGNATURE',
        trustScore: this.agent.trustScore,
        trustBand: trustBandFor(this.agent.trustScore),
      });
    }

    if (!this.policy) {
      return this.appendAndReturn({
        agentId: this.agent.id,
        action: ctx.action,
        amount: ctx.amount,
        result: 'DENIED',
        reason: 'SCOPE_NOT_GRANTED',
        trustScore: this.agent.trustScore,
        trustBand: trustBandFor(this.agent.trustScore),
      });
    }

    if (this.policy.revoked) {
      return this.appendAndReturn({
        agentId: this.agent.id,
        action: ctx.action,
        amount: ctx.amount,
        result: 'DENIED',
        reason: 'POLICY_REVOKED',
        trustScore: this.agent.trustScore,
        trustBand: trustBandFor(this.agent.trustScore),
      });
    }

    if (!this.policy.actions.some((a) => a === ctx.action || a === '*')) {
      return this.appendAndReturn({
        agentId: this.agent.id,
        action: ctx.action,
        amount: ctx.amount,
        result: 'DENIED',
        reason: 'SCOPE_NOT_GRANTED',
        trustScore: this.agent.trustScore,
        trustBand: trustBandFor(this.agent.trustScore),
      });
    }

    if (this.policy.amountMax !== undefined && ctx.amount !== undefined && ctx.amount > this.policy.amountMax) {
      return this.appendAndReturn({
        agentId: this.agent.id,
        action: ctx.action,
        amount: ctx.amount,
        result: 'DENIED',
        reason: 'SPEND_LIMIT_EXCEEDED',
        trustScore: this.agent.trustScore,
        trustBand: trustBandFor(this.agent.trustScore),
      });
    }

    if (this.agent.trustScore < 100) {
      return this.appendAndReturn({
        agentId: this.agent.id,
        action: ctx.action,
        amount: ctx.amount,
        result: 'DENIED',
        reason: 'TRUST_SCORE_TOO_LOW',
        trustScore: this.agent.trustScore,
        trustBand: trustBandFor(this.agent.trustScore),
      });
    }

    if (this.agent.anomalyCount >= 5) {
      return this.appendAndReturn({
        agentId: this.agent.id,
        action: ctx.action,
        amount: ctx.amount,
        result: 'DENIED',
        reason: 'ANOMALY_FLAGGED',
        trustScore: this.agent.trustScore,
        trustBand: trustBandFor(this.agent.trustScore),
      });
    }

    return this.appendAndReturn({
      agentId: this.agent.id,
      action: ctx.action,
      amount: ctx.amount,
      result: 'VALID',
      trustScore: this.agent.trustScore,
      trustBand: trustBandFor(this.agent.trustScore),
    });
  }

  evaluateRAR(authDetails: RarDetail[], candidate: { type: RarDetail['type']; action: string; amount_usd?: number; day_total_usd?: number; utc_hour?: number }): { ok: boolean; reason?: string; matched_detail_type?: string; binding_version?: string } {
    for (const detail of authDetails) {
      if (detail.type !== candidate.type) continue;
      if (!detail.actions.includes(candidate.action)) continue;

      if (detail.limits?.per_order_usd !== undefined && candidate.amount_usd !== undefined) {
        if (candidate.amount_usd > detail.limits.per_order_usd) {
          return { ok: false, reason: 'RAR_PER_ORDER_EXCEEDED', matched_detail_type: detail.type };
        }
      }
      if (detail.limits?.per_day_usd !== undefined && candidate.day_total_usd !== undefined) {
        if (candidate.day_total_usd + (candidate.amount_usd ?? 0) > detail.limits.per_day_usd) {
          return { ok: false, reason: 'RAR_PER_DAY_EXCEEDED', matched_detail_type: detail.type };
        }
      }
      if (detail.limits?.trading_hours_utc !== undefined && candidate.utc_hour !== undefined) {
        const [start, end] = detail.limits.trading_hours_utc;
        if (candidate.utc_hour < start || candidate.utc_hour >= end) {
          return { ok: false, reason: 'RAR_OUTSIDE_TRADING_HOURS', matched_detail_type: detail.type };
        }
      }
      return { ok: true, matched_detail_type: detail.type, binding_version: 'aegis-rar-1.0' };
    }
    return { ok: false, reason: 'RAR_NO_MATCH' };
  }

  getAuditChain(): readonly AuditRow[] {
    return this.auditChain;
  }

  async verifyAuditChainOffline(): Promise<{ valid: boolean; brokenAt?: number; reason?: string }> {
    let prevHash = GENESIS_PREV_HASH;
    for (const row of this.auditChain) {
      if (row.prevHash !== prevHash) {
        return { valid: false, brokenAt: row.seq, reason: 'prev_hash_mismatch' };
      }
      const { signatureB64Url, ...body } = row;
      const msg = buildAuditMessage(body);
      const ok = await ed.verifyAsync(b64UrlDecode(signatureB64Url), msg, this.signingPublic);
      if (!ok) {
        return { valid: false, brokenAt: row.seq, reason: 'invalid_signature' };
      }
      prevHash = hexFromBytes(sha256(msg));
    }
    return { valid: true };
  }

  tamperWithRow(seq: number, newAction: string): void {
    const idx = this.auditChain.findIndex((r) => r.seq === seq);
    if (idx < 0) return;
    this.auditChain[idx] = { ...this.auditChain[idx]!, action: newAction };
  }

  reset(): void {
    this.agent = null;
    this.policy = null;
    this.auditChain = [];
  }

  private async appendAndReturn(evt: Omit<AuditRow, 'seq' | 'timestamp' | 'prevHash' | 'signatureB64Url'>): Promise<VerifyResult> {
    const seq = this.auditChain.length + 1;
    const last = this.auditChain[this.auditChain.length - 1];
    const prevHash = last ? hexFromBytes(sha256(buildAuditMessage(last))) : GENESIS_PREV_HASH;
    const body: Omit<AuditRow, 'signatureB64Url'> = { seq, timestamp: Date.now(), prevHash, ...evt };
    const sigBytes = await ed.signAsync(buildAuditMessage(body), this.signingPrivate);
    const row: AuditRow = { ...body, signatureB64Url: b64UrlEncode(sigBytes) };
    this.auditChain.push(row);
    return {
      valid: evt.result === 'VALID',
      reason: evt.reason,
      trustScore: evt.trustScore,
      trustBand: evt.trustBand,
      auditSeq: seq,
    };
  }
}
