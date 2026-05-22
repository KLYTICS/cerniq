import {
  Controller,
  Get,
  Header,
  Headers,
  HttpStatus,
  Res,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import { Public } from '../auth/api-key.guard';

import { OkoroConfigurationDto } from './dto/discovery.dto';
import { AuditSigningKeyDto, JwksDto } from './dto/jwks.dto';
import { PricingDto } from './dto/pricing.dto';
import { RetentionPolicyDto } from './dto/retention-policy.dto';
import { WellknownService } from './wellknown.service';

/**
 * Cache for one day at the edge, allow stale revalidation for a week.
 * The key only changes on rotation; a 1-day TTL is the right trade-off
 * between rotation freshness and cache hit rate at relying parties.
 */
const CACHE_CONTROL = 'public, max-age=86400, stale-while-revalidate=604800';

/**
 * Use VERSION_NEUTRAL so the route is mounted at `/.well-known/...` rather
 * than `/v1/.well-known/...`. The api global prefix in main.ts must also
 * exclude `.well-known/(.*)` for this controller to be reachable at the
 * canonical path — see README.md § "Wiring requirement".
 */
@ApiTags('Well-Known')
@Controller({ path: '.well-known', version: VERSION_NEUTRAL })
export class WellknownController {
  constructor(private readonly wellknown: WellknownService) {}

  @Public()
  @Get('audit-signing-key')
  @Header('Cache-Control', CACHE_CONTROL)
  @ApiOperation({
    summary: 'Public OKORO audit-event signing key (plain JSON helper).',
    description:
      'No auth. Cacheable. Relying parties / SOC2 auditors fetch this to verify the Ed25519 signature on every AuditEvent.',
  })
  auditSigningKey(
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): AuditSigningKeyDto | undefined {
    const etag = quotedEtag(this.wellknown.getKid());
    res.setHeader('ETag', etag);
    if (etagMatches(ifNoneMatch, etag)) {
      res.status(HttpStatus.NOT_MODIFIED);
      return undefined;
    }
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return this.wellknown.getAuditSigningKey();
  }

  @Public()
  @Get('jwks.json')
  @Header('Cache-Control', CACHE_CONTROL)
  @ApiOperation({
    summary: 'JWKS view of the OKORO audit-event signing key (RFC 8037).',
    description:
      'No auth. Cacheable. For tools that consume `application/jwk-set+json` (e.g. the `jose` library).',
  })
  jwks(
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): JwksDto | undefined {
    const etag = quotedEtag(this.wellknown.getKid());
    res.setHeader('ETag', etag);
    if (etagMatches(ifNoneMatch, etag)) {
      res.status(HttpStatus.NOT_MODIFIED);
      return undefined;
    }
    res.setHeader('Content-Type', 'application/jwk-set+json; charset=utf-8');
    return this.wellknown.getJwks();
  }

  /**
   * Discovery document — the OIDC-style configuration surface.
   * Lets a relying party fetch a single URL and auto-configure their
   * verifier without further documentation. Stable; additive evolution
   * only (see OkoroConfigurationDto).
   */
  @Public()
  @Get('okoro-configuration')
  @Header('Cache-Control', CACHE_CONTROL)
  @ApiOperation({
    summary: 'OKORO configuration discovery document (JSON).',
    description:
      'Single fetch yields every URL, the JWKS, the canonical denial-reason ' +
      'enum, the trust band ladder, supported runtimes, rate limits, build ' +
      'identity, and SDK package names. Modeled on /.well-known/openid-configuration.',
  })
  configuration(@Res({ passthrough: true }) res: Response): OkoroConfigurationDto {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return this.wellknown.getOkoroConfiguration();
  }

  /**
   * RFC 9116 security.txt — plain-text responsible-disclosure file.
   * Mandatory `Expires` is renewed at every deploy (1 year from build).
   */
  @Public()
  @Get('security.txt')
  @Header('Cache-Control', 'public, max-age=3600')
  @ApiOperation({
    summary: 'RFC 9116 security disclosure file (plain text).',
    description:
      'Standard contact + policy file for security researchers. Contains an ' +
      'Expires field renewed at every deploy.',
  })
  securityTxt(@Res({ passthrough: true }) res: Response): string {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return this.wellknown.getSecurityTxt();
  }

  /**
   * llms.txt — emerging convention (parallel to robots.txt) for
   * AI-agent-readable site descriptions. Markdown body.
   */
  @Public()
  @Get('llms.txt')
  @Header('Cache-Control', CACHE_CONTROL)
  @ApiOperation({
    summary: 'AI-agent-readable site description (Markdown).',
    description:
      'llms.txt — emerging convention. Lists every public surface an AI ' +
      'agent should hit when it wants to talk to OKORO.',
  })
  llmsTxt(@Res({ passthrough: true }) res: Response): string {
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    return this.wellknown.getLlmsTxt();
  }

  /**
   * `/.well-known/retention-policy.json` — per-tier audit retention
   * windows, redaction reason format, and operational defaults.
   *
   * No auth, no DB hit. Body is computed in-process from
   * `apps/api/src/modules/billing/plans.ts`. Cache for an hour at the
   * edge — a tier change requires a deploy anyway.
   */
  @Public()
  @Get('retention-policy.json')
  @Header('Cache-Control', 'public, max-age=3600')
  @ApiOperation({
    summary: 'Per-tier audit retention windows + redaction guarantees (JSON).',
    description:
      'No auth. Cacheable. SOC2 auditors and procurement teams fetch this to ' +
      'verify the retention story without reading source. Auto-derived from ' +
      'billing/plans.ts; never fabricated.',
  })
  retentionPolicy(@Res({ passthrough: true }) res: Response): RetentionPolicyDto {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return this.wellknown.getRetentionPolicy();
  }

  /**
   * `/.well-known/pricing.json` — public ADR-0014 tier table.
   *
   * No auth, no DB hit. Body is computed in-process from
   * `apps/api/src/modules/billing/plans.ts`. Cache for an hour at the
   * edge — a tier-table change requires a deploy anyway. The dashboard
   * pricing page (Round 20 Lane C) consumes this so it can stop
   * hand-mirroring `plans.ts`.
   */
  @Public()
  @Get('pricing.json')
  @Header('Cache-Control', 'public, max-age=3600')
  @ApiOperation({
    summary: 'Per-tier pricing table (JSON, ADR-0014).',
    description:
      'No auth. Cacheable. Public-facing pricing surfaces fetch this so the canonical table in ' +
      'billing/plans.ts is the only source of truth. Auto-derived; never fabricated.',
  })
  pricing(@Res({ passthrough: true }) res: Response): PricingDto {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return this.wellknown.getPricing();
  }
}

/** RFC 7232 § 2.3 — strong ETag is a quoted string. */
export function quotedEtag(kid: string): string {
  return `"${kid}"`;
}

/**
 * RFC 7232 § 3.2 — `If-None-Match` may be a comma-separated list of validators
 * or `*`. We do conservative exact / wildcard matching; weak validators (`W/`)
 * are accepted because the underlying resource is byte-stable for a given kid.
 */
export function etagMatches(ifNoneMatch: string | undefined, etag: string): boolean {
  if (!ifNoneMatch) return false;
  const candidates = ifNoneMatch.split(',').map((s) => s.trim());
  for (const c of candidates) {
    if (c === '*') return true;
    if (c === etag) return true;
    if (c.startsWith('W/') && c.slice(2) === etag) return true;
  }
  return false;
}
