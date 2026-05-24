import { randomBytes } from 'node:crypto';

import {
  ForbiddenException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import * as ed from '@noble/ed25519';
import type { AgentIdentity, Prisma } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { AuditService } from '../audit/audit.service';

import {
  type ListAgentsQueryDto,
  type RegisterAgentDto,
  AgentListResponseDto,
  AgentResponseDto,
  AgentStatusDto,
  HandshakeChallengeDto,
  HandshakeStatusDto,
  HandshakeVerifiedDto,
} from './identity.dto';

const MAX_LIST_LIMIT = 100;
const DEFAULT_LIST_LIMIT = 25;

// Handshake protocol — ED25519 proof-of-possession for the registered key.
// Domain separator prevents the agent's signing key from being abused via
// challenge-response replay against other CERNIQ sub-protocols (e.g. the JWT
// signing path used by /v1/verify). Bumping this string is a protocol
// version bump and requires SDK coordination.
const HANDSHAKE_PROTOCOL_VERSION = 'cerniq-handshake-v1';
const CHALLENGE_TTL_SECONDS = 300;
const HANDSHAKE_RECORD_TTL_SECONDS = 30 * 86_400;
const HANDSHAKE_MIN_TRUST_SCORE = 600;
const TEXT_ENCODER = new TextEncoder();

interface StoredHandshakeRecord {
  verifiedAt: string;
  protocolVersion: string;
}

function b64UrlEncode(buf: Buffer | Uint8Array): string {
  return Buffer.from(buf).toString('base64url');
}

function b64UrlDecode(input: string): Uint8Array {
  return new Uint8Array(Buffer.from(input, 'base64url'));
}

function buildHandshakeMessage(
  agentId: string,
  challengeB64Url: string,
): {
  bytes: Uint8Array;
  utf8: string;
} {
  const utf8 = `${HANDSHAKE_PROTOCOL_VERSION}::${agentId}::${challengeB64Url}`;
  return { bytes: TEXT_ENCODER.encode(utf8), utf8 };
}

function challengeKey(agentId: string): string {
  return `agent:challenge:${agentId}`;
}

function handshakeRecordKey(agentId: string): string {
  return `agent:handshake-completed:${agentId}`;
}

@Injectable()
export class IdentityService {
  private readonly logger = new Logger(IdentityService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
  ) {}

  async register(principalId: string, dto: RegisterAgentDto): Promise<AgentResponseDto> {
    const created = await this.prisma.agentIdentity.create({
      data: {
        principalId,
        publicKey: dto.publicKey,
        runtime: dto.runtime,
        model: dto.model,
        label: dto.label,
        status: 'ACTIVE',
        trustScore: 500,
        trustBand: 'VERIFIED',
      },
    });
    this.logger.log(`Agent registered: ${created.id} principal=${principalId}`);
    return this.toResponse(created);
  }

  async list(principalId: string, query: ListAgentsQueryDto): Promise<AgentListResponseDto> {
    const limit = Math.min(Math.max(query.limit ?? DEFAULT_LIST_LIMIT, 1), MAX_LIST_LIMIT);
    const where: Prisma.AgentIdentityWhereInput = { principalId };
    if (query.status) where.status = query.status;
    if (query.runtime) where.runtime = query.runtime;
    if (query.search) {
      where.OR = [
        { id: { contains: query.search, mode: 'insensitive' } },
        { label: { contains: query.search, mode: 'insensitive' } },
        { model: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const cursor = query.cursor ? { id: query.cursor } : undefined;
    const rows = await this.prisma.agentIdentity.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(cursor ? { cursor, skip: 1 } : {}),
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? (page[page.length - 1]?.id ?? null) : null;

    const total = await this.prisma.agentIdentity.count({ where: { principalId } });

    return {
      agents: page.map((a) => this.toResponse(a)),
      nextCursor,
      total,
    };
  }

  async findOne(principalId: string, agentId: string): Promise<AgentResponseDto> {
    const agent = await this.prisma.agentIdentity.findFirst({
      where: { id: agentId, principalId },
    });
    if (!agent)
      throw new NotFoundException({ error: 'AGENT_NOT_FOUND', message: 'Agent not found.' });
    return this.toResponse(agent);
  }

  /**
   * Read the cached handshake-completed record for an agent. Read-only; does
   * not mutate or refresh the TTL. Used by dashboard + CLI to surface
   * "this agent has proven its key" without forcing a fresh handshake.
   *
   * Returns `verified: false` when no record exists (or it has expired).
   * Cross-principal calls return `AGENT_NOT_FOUND` (multi-tenant invariant 5).
   */
  async getHandshakeStatus(principalId: string, agentId: string): Promise<HandshakeStatusDto> {
    const agent = await this.prisma.agentIdentity.findFirst({
      where: { id: agentId, principalId },
      select: { id: true },
    });
    if (!agent) {
      throw new NotFoundException({ error: 'AGENT_NOT_FOUND', message: 'Agent not found.' });
    }

    const record = await this.redis.get<StoredHandshakeRecord>(handshakeRecordKey(agentId));
    if (!record) {
      return { agentId, verified: false };
    }
    return {
      agentId,
      verified: true,
      verifiedAt: record.verifiedAt,
      protocolVersion: record.protocolVersion,
    };
  }

  /**
   * Issue a single-use Ed25519 challenge for proof-of-possession of the agent's
   * private key. The challenge is a 256-bit cryptographically-random nonce
   * stored in Redis with a 5-minute TTL. The caller signs
   * `cerniq-handshake-v1::{agentId}::{challenge}` (UTF-8) with the agent's
   * private key and posts the signature back to `verifyHandshake`.
   *
   * Protocol invariants (M-003 acceptance):
   *  - Domain-separated message prefix prevents cross-protocol signature replay
   *    against the JWT verify path (which signs different bytes).
   *  - One-shot semantics: every issuance overwrites the previous nonce; verify
   *    deletes the nonce regardless of outcome — no replay window.
   *  - Fail-closed on Redis miss (CLAUDE.md invariant 4): a lost nonce surfaces
   *    as `CHALLENGE_EXPIRED`, never as a silent pass.
   */
  async issueChallenge(principalId: string, agentId: string): Promise<HandshakeChallengeDto> {
    const agent = await this.prisma.agentIdentity.findFirst({
      where: { id: agentId, principalId },
      select: { id: true, status: true },
    });
    if (!agent) {
      throw new NotFoundException({ error: 'AGENT_NOT_FOUND', message: 'Agent not found.' });
    }
    if (agent.status === 'REVOKED') {
      throw new ForbiddenException({
        error: 'AGENT_REVOKED',
        message: 'Cannot issue handshake challenge for a revoked agent.',
      });
    }

    const challenge = b64UrlEncode(randomBytes(32));
    const message = buildHandshakeMessage(agentId, challenge);

    await this.redis.set(challengeKey(agentId), challenge, CHALLENGE_TTL_SECONDS);
    this.logger.log(
      `Handshake challenge issued: agent=${agentId} principal=${principalId} ttl=${CHALLENGE_TTL_SECONDS}s`,
    );

    return {
      agentId,
      challenge,
      expiresIn: CHALLENGE_TTL_SECONDS,
      protocolVersion: HANDSHAKE_PROTOCOL_VERSION,
      message: message.utf8,
    };
  }

  /**
   * Verify a signed handshake response. Consumes the stored nonce on every
   * call (success OR failure) so a leaked challenge cannot be retried with
   * a new signature.
   *
   * On success: writes a 30-day handshake-completed record to Redis and lifts
   * the agent's trust score to `HANDSHAKE_MIN_TRUST_SCORE` if it was lower —
   * proof-of-possession is genuinely informative for cold-start risk.
   *
   * On failure: throws `INVALID_HANDSHAKE` (401). The caller must request a
   * fresh challenge before retrying.
   */
  async verifyHandshake(
    principalId: string,
    agentId: string,
    signatureB64Url: string,
  ): Promise<HandshakeVerifiedDto> {
    const agent = await this.prisma.agentIdentity.findFirst({
      where: { id: agentId, principalId },
      select: { id: true, publicKey: true, status: true, trustScore: true },
    });
    if (!agent) {
      throw new NotFoundException({ error: 'AGENT_NOT_FOUND', message: 'Agent not found.' });
    }
    if (agent.status === 'REVOKED') {
      throw new ForbiddenException({
        error: 'AGENT_REVOKED',
        message: 'Cannot verify handshake for a revoked agent.',
      });
    }

    const stored = await this.redis.get<string>(challengeKey(agentId));
    // One-shot: delete the nonce up front. From here on, any retry must
    // request a fresh challenge — even if signature verification throws.
    await this.redis.del(challengeKey(agentId));

    if (typeof stored !== 'string' || stored.length === 0) {
      throw new GoneException({
        error: 'CHALLENGE_EXPIRED',
        message: 'No active challenge for this agent. Issue a new challenge before verifying.',
      });
    }

    const message = buildHandshakeMessage(agentId, stored);
    let valid = false;
    try {
      const signatureBytes = b64UrlDecode(signatureB64Url);
      const publicKeyBytes = b64UrlDecode(agent.publicKey);
      // Length checks short-circuit obviously-malformed inputs before noble
      // throws — keeps the failure path observable without an exception trace.
      if (signatureBytes.length === 64 && publicKeyBytes.length === 32) {
        valid = await ed.verifyAsync(signatureBytes, message.bytes, publicKeyBytes);
      }
    } catch (err) {
      this.logger.warn(
        `Handshake verify decode error: agent=${agentId} principal=${principalId} err=${
          (err as Error).message
        }`,
      );
      valid = false;
    }

    if (!valid) {
      this.logger.warn(`Handshake FAILED: agent=${agentId} principal=${principalId}`);
      throw new UnauthorizedException({
        error: 'INVALID_HANDSHAKE',
        message: 'Signature did not verify against the agent public key.',
      });
    }

    const verifiedAt = new Date();
    const record: StoredHandshakeRecord = {
      verifiedAt: verifiedAt.toISOString(),
      protocolVersion: HANDSHAKE_PROTOCOL_VERSION,
    };
    await this.redis.set(handshakeRecordKey(agentId), record, HANDSHAKE_RECORD_TTL_SECONDS);

    // Reward verified key ownership with a small trust bump — exactly once
    // per agent (only lifts a score below the threshold; never lowers, never
    // double-bumps). Persistent change so it survives the Redis TTL.
    let trustScore = agent.trustScore;
    if (trustScore < HANDSHAKE_MIN_TRUST_SCORE) {
      const updated = await this.prisma.agentIdentity.update({
        where: { id: agentId },
        data: { trustScore: HANDSHAKE_MIN_TRUST_SCORE },
        select: { trustScore: true },
      });
      trustScore = updated.trustScore;
      // Drop hot caches that may carry the pre-handshake score.
      await this.redis.del(`agent:public-status:${agentId}`, `agent:status:${agentId}`);
    }

    this.logger.log(
      `Handshake VERIFIED: agent=${agentId} principal=${principalId} trustScore=${trustScore}`,
    );

    return {
      agentId,
      verifiedAt: verifiedAt.toISOString(),
      protocolVersion: HANDSHAKE_PROTOCOL_VERSION,
      trustScore,
      recordTtlSeconds: HANDSHAKE_RECORD_TTL_SECONDS,
    };
  }

  async revoke(principalId: string, agentId: string, reason?: string): Promise<void> {
    // Capture pre-revoke state so the audit row records what the agent
    // looked like at the moment of revocation. Audit replay relies on
    // these fields being the *prior* values, not the post-update ones.
    const agent = await this.prisma.agentIdentity.findFirst({
      where: { id: agentId, principalId },
      select: { id: true, status: true, trustScore: true, trustBand: true },
    });
    if (!agent)
      throw new NotFoundException({ error: 'AGENT_NOT_FOUND', message: 'Agent not found.' });

    // Snapshot pre-update fields so the audit append records the agent
    // state as it was *before* the revoke, regardless of whether the
    // underlying ORM returns a separate object instance from `update`.
    const previousStatus = agent.status;
    const previousTrustScore = agent.trustScore;
    const previousTrustBand = agent.trustBand;

    await this.prisma.agentIdentity.update({
      where: { id: agentId },
      data: { status: 'REVOKED', revokedAt: new Date(), revokedReason: reason ?? null },
    });

    // Invalidate hot caches so the verify path stops serving the stale "ACTIVE".
    await this.redis.del(`agent:status:${agentId}`);

    // OD-024 Phase A4 — append signed audit-chain event for the revocation.
    // Mirrors the `billing.plan_changed` pattern (sync await, after the
    // state change commits). CLAUDE.md invariant #3 requires every
    // security-significant state change to be auditable; this closes the
    // gap OD-024 noted ("audit-chain capture") between the row-level
    // `revokedReason` column and the signed chain.
    await this.audit.append({
      agentId: agent.id,
      claimedAgentId: agent.id,
      principalId,
      action: 'agent.revoked',
      decision: 'APPROVED',
      policySnapshot: {
        reason: reason ?? null,
        previousStatus,
      },
      trustScoreAtEvent: previousTrustScore,
      trustBandAtEvent: previousTrustBand,
    });

    this.logger.log(`Agent revoked: ${agentId} reason=${reason ?? 'n/a'}`);
  }

  async publicStatus(agentId: string): Promise<AgentStatusDto> {
    const cached = await this.redis.get<AgentStatusDto>(`agent:public-status:${agentId}`);
    if (cached) return cached;

    const agent = await this.prisma.agentIdentity.findUnique({
      where: { id: agentId },
      select: { id: true, status: true, trustScore: true, trustBand: true, lastSeenAt: true },
    });
    if (!agent)
      throw new NotFoundException({ error: 'AGENT_NOT_FOUND', message: 'Agent not found.' });

    const dto: AgentStatusDto = {
      agentId: agent.id,
      status: agent.status,
      trustScore: agent.trustScore,
      trustBand: agent.trustBand,
      lastSeenAt: agent.lastSeenAt?.toISOString() ?? null,
    };
    await this.redis.set(`agent:public-status:${agentId}`, dto, 30);
    return dto;
  }

  private toResponse(a: AgentIdentity): AgentResponseDto {
    return {
      agentId: a.id,
      publicKey: a.publicKey,
      principalId: a.principalId,
      runtime: a.runtime as AgentResponseDto['runtime'],
      model: a.model,
      label: a.label,
      status: a.status,
      trustScore: a.trustScore,
      trustBand: a.trustBand,
      registeredAt: a.createdAt.toISOString(),
      lastSeenAt: a.lastSeenAt?.toISOString() ?? null,
    };
  }
}
