import { Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import { AuthenticationError, AuthorizationError } from '../../common/errors/aegis-error';

import { ApiKeyGuard } from './api-key.guard';
import { ApiKeyService } from './api-key.service';

interface RotateResponse {
  id: string;
  key: string;
  expiresAt: string;
  oldKey: {
    id: string;
    expiresAt: string;
  };
}

/**
 * Self-service API-key rotation.
 *
 * Flow:
 *   1. Caller authenticates with their CURRENT key in `x-aegis-api-key`.
 *   2. We generate a new key (scope inherited), return the plaintext ONCE,
 *      and stamp the OLD key with a 24 h `expiresAt` so deployed
 *      integrations have time to swap.
 *   3. After the overlap window, the old key is rejected by ApiKeyGuard
 *      with `expired_api_key`.
 *
 * Audit: every successful rotation appends an `api_key.rotated` event to
 * the chain (CLAUDE.md invariant #3) — payload carries old + new key IDs
 * but NEVER the plaintext.
 */
@ApiTags('auth')
@Controller('v1/principals/me/api-keys')
@UseGuards(ApiKeyGuard)
export class ApiKeyRotationController {
  // 24h is the operator default; future work could expose this as a
  // per-tenant setting once we have a story for "rotate immediately"
  // (overlapHours = 0) for the breach-response case.
  private static readonly DEFAULT_OVERLAP_HOURS = 24;

  constructor(private readonly apiKeys: ApiKeyService) {}

  @Post('rotate')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Rotate the calling API key with a 24-hour overlap window.',
    description:
      'Generates a new API key for the calling principal. The new plaintext is returned EXACTLY ONCE in the response — store it securely; it will never be shown again. The CALLING key remains valid for 24 hours, then is rejected by the guard with `expired_api_key`. Both keys carry the same scope as the original.',
  })
  @ApiResponse({ status: 200, description: 'New plaintext key returned exactly once.' })
  @ApiResponse({ status: 401, description: 'Missing or invalid API key.' })
  @ApiResponse({ status: 409, description: 'Calling key is already inside its rotation overlap window.' })
  async rotate(@Req() req: Request): Promise<RotateResponse> {
    const auth = req.auth;
    if (!auth) {
      // Guard contract violation — should never reach here.
      throw new AuthenticationError('No authenticated principal on request.');
    }

    // Defence-in-depth cross-principal check (CLAUDE.md invariant #5):
    // the ApiKeyService.rotate() will re-verify, but throwing here gives
    // a clearer stack trace if the guard is ever misconfigured.
    if (!auth.principalId || !auth.apiKeyId) {
      throw new AuthorizationError('Authenticated key is missing principal or apiKeyId.');
    }

    const result = await this.apiKeys.rotate(
      auth.apiKeyId,
      auth.principalId,
      ApiKeyRotationController.DEFAULT_OVERLAP_HOURS,
    );

    // Round-24 cache wire-up: drop the OLD plaintext from the auth Redis
    // cache so the next request re-reads the freshly-stamped `expiresAt`
    // from Postgres. Without this, a hot cache entry could outlive the
    // explicit lifecycle event by up to the cache TTL (60s). Best-effort —
    // failures swallow inside invalidateCache because the rotation row is
    // already committed and the 60s TTL is a soft upper bound anyway.
    const callingPlaintext = req.headers['x-aegis-api-key'];
    if (typeof callingPlaintext === 'string') {
      await this.apiKeys.invalidateCache(callingPlaintext);
    }

    return {
      id: result.newKey.id,
      key: result.newKey.plaintext,
      // New key has no native expiry (null); we surface ISO empty-string-safe.
      expiresAt: result.newKey.expiresAt ? result.newKey.expiresAt.toISOString() : '',
      oldKey: {
        id: result.oldKey.id,
        expiresAt: result.oldKey.expiresAt.toISOString(),
      },
    };
  }
}
