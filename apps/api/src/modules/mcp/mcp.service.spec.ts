/**
 * McpService — unit tests
 *
 * Coverage:
 *   register()  — creates a RelyingParty row with kind=MCP_SERVER,
 *                 appends an audit event, returns McpServerDto
 *   list()      — scoped to principalId, returns only MCP_SERVER rows
 *   revoke()    — sets status=REVOKED, appends audit event,
 *                 throws NotFoundException for wrong principal / missing id
 *
 * Multi-tenant invariant: list() and revoke() must be scoped by principalId.
 */

import { NotFoundException } from '@nestjs/common';

import type { PrismaService } from '../../common/prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';

import type { RegisterMcpServerDto } from './mcp.dto';
import { McpService } from './mcp.service';

// ── Prisma stub ───────────────────────────────────────────────────────────────

interface RpRow {
  id: string;
  principalId: string | null;
  name: string;
  domain: string;
  kind: string;
  status: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
  apiKeyHash: string;
}

function makePrisma() {
  const rows: RpRow[] = [];
  let seq = 0;

  return {
    prisma: {
      relyingParty: {
        create: jest.fn(async ({ data, select }: { data: Omit<RpRow, 'createdAt'>; select?: unknown }) => {
          const row: RpRow = { ...data, createdAt: new Date() };
          rows.push(row);
          if (select && typeof select === 'object') {
            // Return only selected fields
            return { id: row.id, principalId: row.principalId, createdAt: row.createdAt };
          }
          return row;
        }),
        findMany: jest.fn(async ({ where }: { where: { principalId?: string; kind?: string } }) => {
          return rows.filter((r) =>
            (!where.principalId || r.principalId === where.principalId) &&
            (!where.kind || r.kind === where.kind),
          );
        }),
        findFirst: jest.fn(async ({ where }: { where: { id?: string; principalId?: string; kind?: string } }) => {
          return rows.find((r) =>
            (!where.id || r.id === where.id) &&
            (!where.principalId || r.principalId === where.principalId) &&
            (!where.kind || r.kind === where.kind),
          ) ?? null;
        }),
        update: jest.fn(async ({ where, data }: { where: { id: string }; data: Partial<RpRow> }) => {
          const r = rows.find((x) => x.id === where.id);
          if (r) Object.assign(r, data);
          return r;
        }),
      },
    },
    rows,
    seq: () => `mcp_${++seq}`,
  };
}

function makeAudit(): jest.Mocked<Pick<AuditService, 'append'>> {
  return { append: jest.fn().mockResolvedValue(undefined) };
}

function makeService() {
  const { prisma, rows } = makePrisma();
  const audit = makeAudit();
  const svc = new McpService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
  );
  return { svc, prisma, audit, rows };
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const REGISTER_DTO: RegisterMcpServerDto = {
  name: 'My MCP Server',
  endpoint: 'https://mcp.example.com',
  transport: 'streamable-http',
  actionPrefix: 'mcp.myserver.',
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('McpService', () => {
  describe('register()', () => {
    it('returns a McpServerDto with id starting with mcp_', async () => {
      const { svc } = makeService();
      const result = await svc.register('prn_A', REGISTER_DTO);
      expect(result.id).toMatch(/^mcp_/);
      expect(result.name).toBe('My MCP Server');
      expect(result.status).toBe('ACTIVE');
    });

    it('persists a RelyingParty row with kind=MCP_SERVER', async () => {
      const { svc, rows } = makeService();
      await svc.register('prn_A', REGISTER_DTO);
      expect(rows[0].kind).toBe('MCP_SERVER');
      expect(rows[0].principalId).toBe('prn_A');
    });

    it('uses the provided minTrustBand or defaults to VERIFIED', async () => {
      const { svc } = makeService();
      const r1 = await svc.register('prn_A', REGISTER_DTO);
      expect(r1.minTrustBand).toBe('VERIFIED');

      const r2 = await svc.register('prn_A', { ...REGISTER_DTO, endpoint: 'https://mcp2.com', minTrustBand: 'PLATINUM' });
      expect(r2.minTrustBand).toBe('PLATINUM');
    });

    it('appends an audit event with action=mcp.server.register', async () => {
      const { svc, audit } = makeService();
      await svc.register('prn_A', REGISTER_DTO);
      expect(audit.append).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'mcp.server.register',
          decision: 'APPROVED',
          principalId: 'prn_A',
        }),
      );
    });

    it('sets lastSeenAt to null and recentInvocations to 0 on registration', async () => {
      const { svc } = makeService();
      const result = await svc.register('prn_A', REGISTER_DTO);
      expect(result.lastSeenAt).toBeNull();
      expect(result.recentInvocations).toBe(0);
    });
  });

  describe('list()', () => {
    it('returns only MCP_SERVER rows for the given principalId', async () => {
      const { svc } = makeService();
      await svc.register('prn_A', REGISTER_DTO);
      await svc.register('prn_B', { ...REGISTER_DTO, endpoint: 'https://b.com' });

      const list = await svc.list('prn_A');
      expect(list.servers).toHaveLength(1);
      expect(list.servers[0].name).toBe('My MCP Server');
    });

    it('returns { servers: [], total: 0 } when principal has no servers', async () => {
      const { svc } = makeService();
      const result = await svc.list('prn_A');
      expect(result.servers).toHaveLength(0);
      expect(result.total).toBe(0);
    });

    it('total matches servers.length', async () => {
      const { svc } = makeService();
      await svc.register('prn_A', REGISTER_DTO);
      await svc.register('prn_A', { ...REGISTER_DTO, endpoint: 'https://mcp2.com', name: 'Second' });
      const result = await svc.list('prn_A');
      expect(result.total).toBe(result.servers.length);
    });
  });

  describe('revoke()', () => {
    it('sets the server status to REVOKED', async () => {
      const { svc, rows } = makeService();
      const { id } = await svc.register('prn_A', REGISTER_DTO);
      await svc.revoke('prn_A', id);
      expect(rows[0].status).toBe('REVOKED');
    });

    it('appends an audit event with action=mcp.server.revoke', async () => {
      const { svc, audit } = makeService();
      const { id } = await svc.register('prn_A', REGISTER_DTO);
      audit.append.mockClear();
      await svc.revoke('prn_A', id);
      expect(audit.append).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'mcp.server.revoke', decision: 'APPROVED' }),
      );
    });

    it('throws NotFoundException when server belongs to a different principal', async () => {
      const { svc } = makeService();
      const { id } = await svc.register('prn_A', REGISTER_DTO);
      await expect(svc.revoke('prn_B', id)).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when server id does not exist', async () => {
      const { svc } = makeService();
      await expect(svc.revoke('prn_A', 'mcp_does_not_exist')).rejects.toThrow(NotFoundException);
    });
  });
});
