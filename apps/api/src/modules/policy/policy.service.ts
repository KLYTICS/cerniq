import { createHash } from 'node:crypto';

import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { AgentPolicy, Prisma } from '@prisma/client';
import { ulid } from 'ulid';

import { JwtUtil } from '../../common/crypto/jwt.util';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';

import {
  type CreatePolicyDto,
  type CreatePolicyResponseDto,
  type PolicyResponseDto,
  type PolicyScopeDto,
} from './policy.dto';

/**
 * Phase 1 policy issuance.
 *
 * AEGIS issues a JWT containing the policy claims and signs it with the
 * AEGIS Ed25519 service key (loaded from env, ephemeral in dev). The signed
 * token is what relying parties can verify offline; per-request signing is
 * the agent's responsibility, referencing this policy by ID.
 */
@Injectable()
export class PolicyService {
  private readonly logger = new Logger(PolicyService.name);
  private aegisPrivateKey?: Uint8Array;
  private aegisPublicKeyB64?: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly jwt: JwtUtil,
  ) {}

  setSigningMaterial(privateKey: Uint8Array, publicKeyB64: string): void {
    this.aegisPrivateKey = privateKey;
    this.aegisPublicKeyB64 = publicKeyB64;
  }

  async create(principalId: string, agentId: string, dto: CreatePolicyDto): Promise<CreatePolicyResponseDto> {
    const agent = await this.prisma.agentIdentity.findFirst({
      where: { id: agentId, principalId },
      select: { id: true, status: true },
    });
    if (!agent) throw new NotFoundException({ error: 'AGENT_NOT_FOUND', message: 'Agent not found.' });
    if (agent.status === 'REVOKED') {
      throw new ForbiddenException({ error: 'AGENT_REVOKED', message: 'Cannot create policies for a revoked agent.' });
    }

    if (!this.aegisPrivateKey || !this.aegisPublicKeyB64) {
      throw new Error('Policy signing material not initialised. Check JWT_ED25519_* env vars.');
    }

    const expiresAt = new Date(dto.expiresAt);
    if (expiresAt.getTime() <= Date.now()) {
      throw new ForbiddenException({ error: 'INVALID_EXPIRY', message: 'expiresAt must be in the future.' });
    }

    const policyId = `pol_${ulid()}`;
    const nowSec = Math.floor(Date.now() / 1000);

    const tokenPayload = {
      sub: agentId,
      pid: policyId,
      iat: nowSec,
      exp: Math.floor(expiresAt.getTime() / 1000),
      jti: ulid(),
      // AEGIS-policy-token shape (informational)
      scopes: dto.scopes,
      label: dto.label ?? null,
    };

    const signedToken = await this.jwt.sign(
      // The JwtUtil signs with the supplied key. We reuse the agent token shape
      // because relying parties only need to confirm AEGIS' EdDSA signature.
       
      tokenPayload,
      this.aegisPrivateKey,
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

    this.logger.log(`Policy created: ${created.id} agent=${agentId} expires=${expiresAt.toISOString()}`);

    return {
      policyId: created.id,
      signedToken: created.signedToken,
      expiresAt: created.expiresAt.toISOString(),
    };
  }

  async list(principalId: string, agentId: string): Promise<PolicyResponseDto[]> {
    await this.assertOwnership(principalId, agentId);
    const policies = await this.prisma.agentPolicy.findMany({
      where: { agentId },
      orderBy: { createdAt: 'desc' },
    });
    return policies.map((p) => this.toResponse(p));
  }

  async revoke(principalId: string, agentId: string, policyId: string): Promise<void> {
    await this.assertOwnership(principalId, agentId);
    const policy = await this.prisma.agentPolicy.findFirst({ where: { id: policyId, agentId } });
    if (!policy) throw new NotFoundException({ error: 'POLICY_NOT_FOUND', message: 'Policy not found.' });

    await this.prisma.agentPolicy.update({
      where: { id: policyId },
      data: { status: 'REVOKED', revokedAt: new Date() },
    });
    await this.redis.del(`policy:${policyId}`);
    this.logger.log(`Policy revoked: ${policyId}`);
  }

  private async assertOwnership(principalId: string, agentId: string): Promise<void> {
    const agent = await this.prisma.agentIdentity.findFirst({
      where: { id: agentId, principalId },
      select: { id: true },
    });
    if (!agent) throw new NotFoundException({ error: 'AGENT_NOT_FOUND', message: 'Agent not found.' });
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
    };
  }
}
