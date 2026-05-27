import { createHash } from 'node:crypto';

import { WEBHOOK_EVENT } from '@cerniq/types';
import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { AgentPolicy, Prisma } from '@prisma/client';
import { ulid } from 'ulid';

import { JwtUtil } from '../../common/crypto/jwt.util';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { AuditService } from '../audit/audit.service';
import { WebhooksService } from '../webhooks/webhooks.service';

import {
  type CreatePolicyDto,
  type CreatePolicyResponseDto,
  type PolicyResponseDto,
  type PolicyScopeDto,
} from './policy.dto';

/**
 * Phase 1 policy issuance.
 *
 * CERNIQ issues a JWT containing the policy claims and signs it with the
 * CERNIQ Ed25519 service key (loaded from env, ephemeral in dev). The signed
 * token is what relying parties can verify offline; per-request signing is
 * the agent's responsibility, referencing this policy by ID.
 */
@Injectable()
export class PolicyService {
  private readonly logger = new Logger(PolicyService.name);
  private cerniqPrivateKey?: Uint8Array;
  private cerniqPublicKeyB64?: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly jwt: JwtUtil,
    private readonly audit: AuditService,
    private readonly webhooks: WebhooksService,
  ) {}

  setSigningMaterial(privateKey: Uint8Array, publicKeyB64: string): void {
    this.cerniqPrivateKey = privateKey;
    this.cerniqPublicKeyB64 = publicKeyB64;
  }

  async create(
    principalId: string,
    agentId: string,
    dto: CreatePolicyDto,
  ): Promise<CreatePolicyResponseDto> {
    const agent = await this.prisma.agentIdentity.findFirst({
      where: { id: agentId, principalId },
      select: { id: true, status: true },
    });
    if (!agent)
      throw new NotFoundException({ error: 'AGENT_NOT_FOUND', message: 'Agent not found.' });
    if (agent.status === 'REVOKED') {
      throw new ForbiddenException({
        error: 'AGENT_REVOKED',
        message: 'Cannot create policies for a revoked agent.',
      });
    }

    if (!this.cerniqPrivateKey || !this.cerniqPublicKeyB64) {
      throw new Error('Policy signing material not initialised. Check JWT_ED25519_* env vars.');
    }

    const expiresAt = new Date(dto.expiresAt);
    if (expiresAt.getTime() <= Date.now()) {
      throw new ForbiddenException({
        error: 'INVALID_EXPIRY',
        message: 'expiresAt must be in the future.',
      });
    }

    const policyId = `pol_${ulid()}`;
    const nowSec = Math.floor(Date.now() / 1000);

    const tokenPayload = {
      sub: agentId,
      pid: policyId,
      iat: nowSec,
      exp: Math.floor(expiresAt.getTime() / 1000),
      jti: ulid(),
      // CERNIQ-policy-token shape (informational)
      scopes: dto.scopes,
      label: dto.label ?? null,
    };

    const signedToken = await this.jwt.sign(
      // The JwtUtil signs with the supplied key. We reuse the agent token shape
      // because relying parties only need to confirm CERNIQ' EdDSA signature.

      tokenPayload,
      this.cerniqPrivateKey,
    );

    const tokenHash = createHash('sha256').update(signedToken).digest('hex');

    const created = await this.prisma.agentPolicy.create({
      data: {
        id: policyId,
        agentId,
        label: dto.label,
        signedToken,
        tokenHash,
        scopes: dto.scopes as unknown as Prisma.InputJsonValue,
        expiresAt,
        status: 'ACTIVE',
      },
    });

    this.logger.log(
      `Policy created: ${created.id} agent=${agentId} expires=${expiresAt.toISOString()}`,
    );

    return {
      policyId: created.id,
      signedToken: created.signedToken,
      expiresAt: created.expiresAt.toISOString(),
    };
  }

  async list(
    principalId: string,
    agentId: string,
    filter: { status?: 'ACTIVE' | 'EXPIRED' | 'REVOKED' } = {},
  ): Promise<PolicyResponseDto[]> {
    await this.assertOwnership(principalId, agentId);
    const policies = await this.prisma.agentPolicy.findMany({
      where: { agentId, ...(filter.status ? { status: filter.status } : {}) },
      orderBy: { createdAt: 'desc' },
    });
    return policies.map((p) => this.toResponse(p));
  }

  async findOne(
    principalId: string,
    agentId: string,
    policyId: string,
  ): Promise<PolicyResponseDto> {
    await this.assertOwnership(principalId, agentId);
    const policy = await this.prisma.agentPolicy.findFirst({ where: { id: policyId, agentId } });
    if (!policy)
      throw new NotFoundException({ error: 'POLICY_NOT_FOUND', message: 'Policy not found.' });
    return this.toResponse(policy);
  }

  async revoke(
    principalId: string,
    agentId: string,
    policyId: string,
    reason?: string,
    apiKeyId?: string,
  ): Promise<void> {
    // Capture the agent's current trust state so the audit row records
    // the score/band as they stood at the moment the policy was revoked.
    // `assertOwnership` is replaced by an inline read that also returns
    // the columns we need for the audit append (one DB roundtrip instead
    // of two).
    const agent = await this.prisma.agentIdentity.findFirst({
      where: { id: agentId, principalId },
      select: { id: true, trustScore: true, trustBand: true },
    });
    if (!agent)
      throw new NotFoundException({ error: 'AGENT_NOT_FOUND', message: 'Agent not found.' });

    const policy = await this.prisma.agentPolicy.findFirst({ where: { id: policyId, agentId } });
    if (!policy)
      throw new NotFoundException({ error: 'POLICY_NOT_FOUND', message: 'Policy not found.' });

    // Snapshot pre-update fields into locals so the audit append below
    // records the policy state as it was *before* the revoke, regardless
    // of whether the underlying ORM returns a separate object instance
    // from `update` (defensive against aliasing).
    const snapshot = {
      previousStatus: policy.status,
      label: policy.label,
      scopes: policy.scopes,
      expiresAt: policy.expiresAt.toISOString(),
    };

    await this.prisma.agentPolicy.update({
      where: { id: policyId },
      data: { status: 'REVOKED', revokedAt: new Date(), revokedReason: reason ?? null },
    });
    await this.redis.del(`policy:${policyId}`);

    // OD-024 Phase A4 — append signed audit-chain event for the
    // revocation. Sync await after the state change commits (mirrors
    // `billing.plan_changed`). The chain entry preserves the pre-revoke
    // policy snapshot (label + scopes) so audit replay can reconstruct
    // what was revoked even after the row is later purged by retention.
    await this.audit.append({
      agentId: agent.id,
      claimedAgentId: agent.id,
      principalId,
      action: 'policy.revoked',
      decision: 'APPROVED',
      policyId: policy.id,
      policySnapshot: {
        reason: reason ?? null,
        ...snapshot,
        // OD-024 Phase A6 — SOC2 "who did this" evidence.
        revokedBy: apiKeyId ?? null,
      },
      trustScoreAtEvent: agent.trustScore,
      trustBandAtEvent: agent.trustBand,
    });

    // OD-024 Phase A5 — fan `cerniq.policy.revoked` webhook to active
    // subscribers. Sibling to the existing `cerniq.agent.policy_expired`
    // event (emitted by policy.expiry.worker) — same shape minus the
    // sweep-specific `sweptAt` field, plus the operator-supplied
    // `reason` and `previousStatus`. `webhooks.enqueue` swallows
    // fanout errors so a flaky subscriber doesn't break the manual
    // revoke path.
    await this.webhooks.enqueue(
      {
        type: WEBHOOK_EVENT.AGENT_POLICY_REVOKED,
        data: {
          policyId: policy.id,
          agentId,
          revokedAt: new Date().toISOString(),
          reason: reason ?? null,
          previousStatus: snapshot.previousStatus,
          revokedBy: apiKeyId ?? null,
        },
      },
      principalId,
    );

    this.logger.log(
      `Policy revoked: ${policyId}${reason ? ` reason=${JSON.stringify(reason)}` : ''}`,
    );
  }

  private async assertOwnership(principalId: string, agentId: string): Promise<void> {
    const agent = await this.prisma.agentIdentity.findFirst({
      where: { id: agentId, principalId },
      select: { id: true },
    });
    if (!agent)
      throw new NotFoundException({ error: 'AGENT_NOT_FOUND', message: 'Agent not found.' });
  }

  private toResponse(p: AgentPolicy): PolicyResponseDto {
    return {
      policyId: p.id,
      agentId: p.agentId,
      label: p.label,
      scopes: p.scopes as unknown as PolicyScopeDto[],
      status: p.status,
      createdAt: p.createdAt.toISOString(),
      expiresAt: p.expiresAt.toISOString(),
      revokedAt: p.revokedAt ? p.revokedAt.toISOString() : null,
      revokedReason: p.revokedReason,
    };
  }
}
