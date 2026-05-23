// McpService — registry of trusted MCP servers per principal.
//
// Each MCP server registered here gets a `relyingPartyId` row that the
// verify path uses to slice audit events. When a tool call comes through
// `@cerniq/mcp-bridge`, the bridge identifies itself with the server id;
// the verify endpoint stamps `relyingPartyId` on the audit event, and
// the dashboard can surface "your MCP server X invoked Y tools."
//
// Scope discipline (peer holds verify path): this module ONLY does CRUD
// on the registry. It does NOT touch the verify algorithm. The wiring
// from `relyingPartyId → audit.relyingPartyId` is delivered by M-022.

import { Injectable, NotFoundException } from '@nestjs/common';
import { ulid } from 'ulid';

import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

import type { ListMcpServersDto, McpServerDto, RegisterMcpServerDto } from './mcp.dto';

const DEFAULT_MIN_TRUST_BAND: McpServerDto['minTrustBand'] = 'VERIFIED';

@Injectable()
export class McpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async register(principalId: string, dto: RegisterMcpServerDto): Promise<McpServerDto> {
    const id = `mcp_${ulid()}`;
    // RelyingPartyKind.MCP_SERVER landed in the schema (peer 7a07798e's
    // 20260502000400_idp_federation_and_rp_ownership migration). The
    // earlier `as never` cast is no longer needed — Prisma types are real.
    const created = await this.prisma.relyingParty.create({
      data: {
        id,
        principalId,
        name: dto.name,
        domain: dto.endpoint, // RelyingParty.domain is unique; reuse endpoint as the canonical identifier.
        apiKeyHash: `mcp:${id}`, // Placeholder — MCP servers don't need API keys (they call CERNIQ via the user's principal).
        kind: 'MCP_SERVER',
        status: 'ACTIVE',
        metadata: {
          endpoint: dto.endpoint,
          transport: dto.transport,
          manifestUrl: dto.manifestUrl ?? null,
          actionPrefix: dto.actionPrefix,
          minTrustBand: dto.minTrustBand ?? DEFAULT_MIN_TRUST_BAND,
        },
      },
      select: { id: true, principalId: true, createdAt: true },
    });

    await this.audit.append({
      agentId: id,
      principalId,
      action: 'mcp.server.register',
      decision: 'APPROVED',
      relyingParty: dto.name,
      trustScoreAtEvent: 0,
      trustBandAtEvent: 'VERIFIED',
    });

    return this.toDto({
      id: created.id,
      // RelyingParty.principalId is nullable (FK SetNull on principal-delete),
      // but the row we just minted is owned by `principalId` (the function
      // arg), so we can return it without a null-check.
      principalId,
      name: dto.name,
      endpoint: dto.endpoint,
      transport: dto.transport,
      manifestUrl: dto.manifestUrl ?? null,
      actionPrefix: dto.actionPrefix,
      minTrustBand: dto.minTrustBand ?? DEFAULT_MIN_TRUST_BAND,
      status: 'ACTIVE',
      createdAt: created.createdAt.toISOString(),
      lastSeenAt: null,
      recentInvocations: 0,
    });
  }

  async list(principalId: string): Promise<ListMcpServersDto> {
    const rows = await this.prisma.relyingParty.findMany({
      where: { principalId, kind: 'MCP_SERVER' },
      orderBy: { createdAt: 'desc' },
    });
    const servers = rows
      .filter((r): r is typeof r & { principalId: string } => r.principalId !== null)
      .map((r) => {
        const m = (r.metadata as Record<string, unknown>) ?? {};
        return this.toDto({
          id: r.id,
          principalId: r.principalId,
          name: r.name,
          endpoint: typeof m.endpoint === 'string' ? m.endpoint : '',
          transport: (m.transport as McpServerDto['transport']) ?? 'streamable-http',
          manifestUrl: typeof m.manifestUrl === 'string' ? m.manifestUrl : null,
          actionPrefix: typeof m.actionPrefix === 'string' ? m.actionPrefix : '',
          minTrustBand: (m.minTrustBand as McpServerDto['minTrustBand']) ?? DEFAULT_MIN_TRUST_BAND,
          status: (r.status as McpServerDto['status']) ?? 'ACTIVE',
          createdAt: r.createdAt.toISOString(),
          // lastSeenAt + recentInvocations derived from audit events when
          // M-022 wires `relyingPartyId` on AuditEvent. Stub for now.
          lastSeenAt: null,
          recentInvocations: 0,
        });
      });
    return { servers, total: servers.length };
  }

  async revoke(principalId: string, mcpServerId: string): Promise<void> {
    const existing = await this.prisma.relyingParty.findFirst({
      where: { id: mcpServerId, principalId, kind: 'MCP_SERVER' },
    });
    if (!existing) throw new NotFoundException('mcp_server_not_found');
    await this.prisma.relyingParty.update({
      where: { id: mcpServerId },
      data: { status: 'REVOKED' },
    });
    await this.audit.append({
      agentId: mcpServerId,
      principalId,
      action: 'mcp.server.revoke',
      decision: 'APPROVED',
      relyingParty: existing.name,
      trustScoreAtEvent: 0,
      trustBandAtEvent: 'VERIFIED',
    });
  }

  private toDto(d: McpServerDto): McpServerDto {
    return d;
  }
}
