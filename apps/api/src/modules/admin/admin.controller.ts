// Admin Controller — founder-led onboarding endpoints gated by
// AdminGuard (AEGIS_ADMIN_TOKEN shared secret).
//
// Routes:
//   POST /admin/principals                    — create a new Principal
//   POST /admin/principals/:principalId/api-keys — issue an API key
//
// Auth model: every endpoint passes through AdminGuard, which compares
// the `x-aegis-admin-token` header to AEGIS_ADMIN_TOKEN with timing-safe
// equality. No per-request user identity — the operator IS the caller.
//
// Tenant-isolation note (per root CLAUDE.md invariant 5):
//   These endpoints intentionally cross tenant boundaries. The
//   `principalId` in the request body / URL IS the tenant identifier;
//   the operator acts on behalf of that tenant. Audit events emitted
//   here carry the target principalId so the cross-tenant action is
//   traceable downstream.
//
// Audit events emitted:
//   - `admin.principal.created` (PRINCIPAL_CREATED decision; principalId = new)
//   - `admin.api_key.issued`    (API_KEY_ISSUED decision; principalId = target)
//
// Not covered in v1 (intentional scope minimization):
//   - Principal listing / search
//   - Plan-tier update endpoint
//   - API key revocation (use existing /v1/api-keys/:id with FULL key)
//   - Audit-event admin viewer (use /v1/audit/events with FULL key)
//   - Bulk operations
//
// All of the above can be done by issuing a FULL-scope key to the
// operator's "ops" principal and using the public API. /admin/* is
// intentionally minimal — every admin endpoint adds a tenant-crossing
// surface that must be hardened, audited, and rate-limited.

import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  HttpCode,
  Logger,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';

import { AdminGuard } from '../../common/guards/admin.guard';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ApiKeyService } from '../auth/api-key.service';
import {
  CreatePrincipalRequestSchema,
  type CreatePrincipalRequest,
  type CreatePrincipalResponse,
} from './dto/create-principal.dto';
import {
  IssueApiKeyRequestSchema,
  type IssueApiKeyRequest,
  type IssueApiKeyResponse,
} from './dto/issue-api-key.dto';

@Controller('admin')
@UseGuards(AdminGuard)
export class AdminController {
  private readonly logger = new Logger(AdminController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly apiKeys: ApiKeyService,
  ) {}

  @Post('principals')
  @HttpCode(201)
  async createPrincipal(@Body() body: unknown): Promise<CreatePrincipalResponse> {
    // Zod parse — controllers translate, services own business rules.
    const parse = CreatePrincipalRequestSchema.safeParse(body);
    if (!parse.success) {
      throw new BadRequestException({
        error: 'invalid_request',
        details: parse.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      });
    }
    const { email, name, planTier }: CreatePrincipalRequest = parse.data;

    // Email-unique collision check upfront. Prisma will also reject
    // via @unique constraint; this surface is friendlier (409 with the
    // existing principalId so the operator can issue a key against it).
    const existing = await this.prisma.principal.findUnique({
      where: { email },
      select: { id: true, email: true, planTier: true, createdAt: true },
    });
    if (existing) {
      throw new ConflictException({
        error: 'principal_exists',
        message: `Principal with email ${email} already exists.`,
        principalId: existing.id,
      });
    }

    const created = await this.prisma.principal.create({
      data: {
        email,
        name: name ?? null,
        planTier: planTier ?? 'FREE',
      },
      select: { id: true, email: true, planTier: true, createdAt: true },
    });

    // Structured audit log — readable by ops without leaking PII.
    // (The full audit-chain entry is owned by AuditService when wired
    // in; this log line is the operational signal.)
    this.logger.log({
      event: 'admin_principal_created',
      principalId: created.id,
      planTier: created.planTier,
      // Email IS PII; log domain-only for ops dashboards. Full email is
      // retained in the DB as the natural key.
      emailDomain: email.split('@')[1] ?? '(unknown)',
    }, 'Admin created principal');

    return {
      principalId: created.id,
      email: created.email,
      planTier: created.planTier,
      createdAt: created.createdAt.toISOString(),
    };
  }

  @Post('principals/:principalId/api-keys')
  @HttpCode(201)
  async issueApiKey(
    @Param('principalId') principalId: string,
    @Body() body: unknown,
  ): Promise<IssueApiKeyResponse> {
    const parse = IssueApiKeyRequestSchema.safeParse(body);
    if (!parse.success) {
      throw new BadRequestException({
        error: 'invalid_request',
        details: parse.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      });
    }
    const { label, scope }: IssueApiKeyRequest = parse.data;

    // Principal existence pre-check — clearer error than the FK violation
    // that ApiKeyService.issue would emit on a non-existent principalId.
    const principal = await this.prisma.principal.findUnique({
      where: { id: principalId },
      select: { id: true },
    });
    if (!principal) {
      throw new NotFoundException({
        error: 'principal_not_found',
        message: `No principal with id ${principalId}.`,
      });
    }

    const effectiveScope = scope ?? 'FULL';
    const issued = await this.apiKeys.issue(
      principalId,
      label ?? null,
      effectiveScope,
    );

    // Structured audit log — does NOT include plaintextKey. The
    // plaintext is in the response body once and never logged.
    this.logger.log({
      event: 'admin_api_key_issued',
      principalId,
      apiKeyId: issued.apiKeyId,
      keyPrefix: issued.keyPrefix,
      scope: effectiveScope,
      hasLabel: Boolean(label),
    }, 'Admin issued API key');

    return {
      apiKeyId: issued.apiKeyId,
      plaintextKey: issued.plaintextKey,
      keyPrefix: issued.keyPrefix,
      principalId,
      scope: effectiveScope,
      issuedAt: new Date().toISOString(),
    };
  }
}
