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
import { WellknownService } from './wellknown.service';
import { AuditSigningKeyDto, JwksDto } from './dto/jwks.dto';

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
    summary: 'Public AEGIS audit-event signing key (plain JSON helper).',
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
    summary: 'JWKS view of the AEGIS audit-event signing key (RFC 8037).',
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
