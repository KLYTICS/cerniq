import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { AgentIdentity } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { type RegisterAgentDto, AgentResponseDto, AgentStatusDto } from './identity.dto';

@Injectable()
export class IdentityService {
  private readonly logger = new Logger(IdentityService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
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

  async findOne(principalId: string, agentId: string): Promise<AgentResponseDto> {
    const agent = await this.prisma.agentIdentity.findFirst({
      where: { id: agentId, principalId },
    });
    if (!agent) throw new NotFoundException({ error: 'AGENT_NOT_FOUND', message: 'Agent not found.' });
    return this.toResponse(agent);
  }

  async revoke(principalId: string, agentId: string, reason?: string): Promise<void> {
    const agent = await this.prisma.agentIdentity.findFirst({
      where: { id: agentId, principalId },
      select: { id: true },
    });
    if (!agent) throw new NotFoundException({ error: 'AGENT_NOT_FOUND', message: 'Agent not found.' });

    await this.prisma.agentIdentity.update({
      where: { id: agentId },
      data: { status: 'REVOKED', revokedAt: new Date(), revokedReason: reason ?? null },
    });

    // Invalidate hot caches so the verify path stops serving the stale "ACTIVE".
    await this.redis.del(`agent:status:${agentId}`);
    this.logger.log(`Agent revoked: ${agentId} reason=${reason ?? 'n/a'}`);
  }

  async publicStatus(agentId: string): Promise<AgentStatusDto> {
    const cached = await this.redis.get<AgentStatusDto>(`agent:public-status:${agentId}`);
    if (cached) return cached;

    const agent = await this.prisma.agentIdentity.findUnique({
      where: { id: agentId },
      select: { id: true, status: true, trustScore: true, trustBand: true, lastSeenAt: true },
    });
    if (!agent) throw new NotFoundException({ error: 'AGENT_NOT_FOUND', message: 'Agent not found.' });

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
