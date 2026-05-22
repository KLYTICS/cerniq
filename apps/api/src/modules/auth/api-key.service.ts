import { createHash, randomBytes } from 'node:crypto';

import { Injectable, Logger, Optional } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';

import { AlreadyRotatedError, NotFoundError, AuthorizationError } from '../../common/errors/okoro-error';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { AppConfigService } from '../../config/config.service';
import { AuditService } from '../audit/audit.service';

export interface AuthenticatedKey {
  apiKeyId: string;
  principalId: string;
  scope: 'FULL' | 'VERIFY_ONLY';
}

export interface RotateResult {
  newKey: { id: string; plaintext: string; expiresAt: Date | null };
  oldKey: { id: string; expiresAt: Date };
}

// Auth cache — collapses the bcrypt-12 verify-path bottleneck (~250ms per
// request) into a sub-millisecond Redis lookup for repeat callers. SHA-256
// of the plaintext is the cache key — we never persist plaintext. The cache
// holds the resolved `AuthenticatedKey` for hits AND a sentinel for misses
// (anti-DoS: repeated bad keys also skip bcrypt). 60s positive TTL is short
// enough that revoke/rotation propagates within a minute (acceptable per
// industry norms; see SECURITY.md "Revocation propagation").
const AUTH_CACHE_TTL_SECONDS = 60;
const AUTH_NEG_CACHE_TTL_SECONDS = 30;
const AUTH_CACHE_PREFIX = 'auth:apikey:';
const AUTH_NEG_CACHE_PREFIX = 'auth:apikey:neg:';

function cacheKey(plaintext: string): string {
  return AUTH_CACHE_PREFIX + createHash('sha256').update(plaintext).digest('base64url');
}

function negCacheKey(plaintext: string): string {
  return AUTH_NEG_CACHE_PREFIX + createHash('sha256').update(plaintext).digest('base64url');
}

@Injectable()
export class ApiKeyService {
  private readonly logger = new Logger(ApiKeyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    // Optional: Redis cache. When absent (test harnesses without a Redis
    // module loaded), every resolve() pays bcrypt cost — same behavior as
    // the pre-cache implementation, so unit tests don't need to stand up
    // a Redis instance.
    @Optional()
    private readonly redis?: RedisService,
    // Optional: audit emit for rotation. The auth module is @Global and is
    // imported before AuditModule in app.module wiring; we accept a missing
    // service in test harnesses by making the parameter optional. Production
    // wiring (auth.module.ts) imports AuditModule explicitly.
    @Optional()
    private readonly audit?: AuditService,
  ) {}

  /**
   * Generate a fresh API key for a principal. Returns the plaintext exactly
   * once; only the bcrypt hash is persisted.
   *
   * Format: `okoro_sk_<26 char base58-ish>` (verify keys: `okoro_vk_…`).
   */
  async issue(principalId: string, label: string | null, scope: AuthenticatedKey['scope'] = 'FULL'): Promise<{
    apiKeyId: string;
    plaintextKey: string;
    keyPrefix: string;
  }> {
    const prefix = scope === 'VERIFY_ONLY' ? 'okoro_vk_' : 'okoro_sk_';
    const random = randomBytes(24).toString('base64url').replace(/[^a-zA-Z0-9]/g, '').slice(0, 26);
    const plaintext = `${prefix}${random}`;
    const keyPrefix = plaintext.slice(0, 12); // For dashboard display only.

    const hash = await bcrypt.hash(plaintext, this.config.apiKeyBcryptCost);

    const created = await this.prisma.apiKey.create({
      data: { keyHash: hash, keyPrefix, label, principalId, scope },
    });

    return { apiKeyId: created.id, plaintextKey: plaintext, keyPrefix };
  }

  /**
   * Resolve a presented plaintext key to a principal.
   *
   * NOTE: bcrypt comparison is intentionally constant-time. We narrow the
   * candidate set with `keyPrefix` (no secret leak — prefix is public).
   * For ~10s of thousands of keys this is fine; at >100k we shard by prefix.
   *
   * Filters out:
   *   - revoked keys (`revokedAt IS NOT NULL`)
   *   - expired keys (`expiresAt IS NOT NULL AND expiresAt <= now`).
   *
   * Note: returning `null` for an expired key collapses it to the same
   * "INVALID_API_KEY" surface as a never-existed key. The guard layer
   * disambiguates by re-checking the prefix-matching set when null is
   * returned, so customers can debug "rotation pain" with `expired_api_key`
   * instead of the more confusing `invalid_api_key`.
   */
  async resolve(plaintext: string): Promise<AuthenticatedKey | null> {
    if (!plaintext || (!plaintext.startsWith('okoro_sk_') && !plaintext.startsWith('okoro_vk_'))) {
      return null;
    }

    // Hot-path cache: SHA-256 of the plaintext keys a 60s positive cache.
    // Hits skip bcrypt entirely. Negative cache (30s) absorbs scanning /
    // brute-force attempts without paying bcrypt for each.
    if (this.redis) {
      const positive = await this.redis.get<AuthenticatedKey>(cacheKey(plaintext));
      if (positive && typeof positive === 'object' && 'apiKeyId' in positive) {
        return positive;
      }
      const negative = await this.redis.get<{ tombstone: true }>(negCacheKey(plaintext));
      if (negative) return null;
    }

    const keyPrefix = plaintext.slice(0, 12);
    const now = new Date();
    const candidates = await this.prisma.apiKey.findMany({
      where: {
        keyPrefix,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      select: { id: true, keyHash: true, principalId: true, scope: true },
    });

    for (const c of candidates) {
       
      const ok = await bcrypt.compare(plaintext, c.keyHash);
      if (ok) {
        const resolved: AuthenticatedKey = {
          apiKeyId: c.id,
          principalId: c.principalId,
          scope: c.scope,
        };
        // Write-through to cache. Don't await — hot path.
        if (this.redis) {
          this.redis
            .set(cacheKey(plaintext), resolved, AUTH_CACHE_TTL_SECONDS)
            .catch((err) => { this.logger.warn(`auth cache set failed: ${(err as Error).message}`); });
        }
        // Update lastUsedAt — fire and forget.
        this.prisma.apiKey
          .update({ where: { id: c.id }, data: { lastUsedAt: new Date() } })
          .catch((err: unknown) => { this.logger.warn(`apiKey lastUsedAt update failed: ${(err as Error).message}`); });
        return resolved;
      }
    }

    // Negative cache so brute-force scans don't keep paying bcrypt.
    if (this.redis) {
      this.redis
        .set(negCacheKey(plaintext), { tombstone: true }, AUTH_NEG_CACHE_TTL_SECONDS)
        .catch((err) => { this.logger.warn(`auth neg-cache set failed: ${(err as Error).message}`); });
    }
    return null;
  }

  /**
   * Evict cache entries for a plaintext key. Called from revoke / rotation
   * paths so the 60s TTL doesn't leak access to a just-revoked key.
   *
   * Best-effort — Redis errors are swallowed because the DB-side revoke is
   * the source of truth; the cache's worst case is one minute of stale auth
   * which is exactly the TTL we'd accept anyway.
   */
  async invalidateCache(plaintext: string): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.del(cacheKey(plaintext), negCacheKey(plaintext));
    } catch (err) {
      this.logger.warn(`auth cache invalidate failed: ${(err as Error).message}`);
    }
  }

  /**
   * Detect whether a presented plaintext maps to a key that exists but is
   * expired (overlap window has elapsed). Used by the guard to surface
   * `expired_api_key` instead of the generic `invalid_api_key`.
   *
   * Cheap: only invoked when `resolve()` already returned null, so this
   * runs at most once per failed auth attempt.
   */
  async isExpired(plaintext: string): Promise<boolean> {
    if (!plaintext || (!plaintext.startsWith('okoro_sk_') && !plaintext.startsWith('okoro_vk_'))) {
      return false;
    }
    const keyPrefix = plaintext.slice(0, 12);
    const now = new Date();
    const candidates = await this.prisma.apiKey.findMany({
      where: {
        keyPrefix,
        revokedAt: null,
        expiresAt: { not: null, lte: now },
      },
      select: { keyHash: true },
    });
    for (const c of candidates) {
       
      const ok = await bcrypt.compare(plaintext, c.keyHash);
      if (ok) return true;
    }
    return false;
  }

  /**
   * Rotate an API key with a configurable overlap window.
   *
   * Flow:
   *   1. Verify the calling key exists, belongs to the calling principal,
   *      is not revoked, and is not already inside an overlap (expiresAt
   *      already in the future → AlreadyRotatedError).
   *   2. Mint a fresh plaintext + hash, atomically:
   *        - INSERT new ApiKey row (scope inherited from old key).
   *        - UPDATE old ApiKey row, stamping `expiresAt = now + overlapHours`.
   *      Both run inside a single `prisma.$transaction` so partial state
   *      is impossible.
   *   3. Emit an audit event (`api_key.rotated`) with old/new key IDs.
   *      The plaintext is NEVER written to the audit chain.
   *
   * Returns the plaintext exactly once — caller must surface it to the
   * user immediately.
   *
   * @throws NotFoundError if the calling key id does not exist.
   * @throws AuthorizationError if the calling key belongs to a different principal.
   * @throws AlreadyRotatedError if the calling key is already inside an overlap.
   */
  async rotate(
    callingKeyId: string,
    principalId: string,
    overlapHours = 24,
  ): Promise<RotateResult> {
    if (!Number.isFinite(overlapHours) || overlapHours <= 0) {
      // No silent default: caller must pass a positive number.
      throw new Error(`overlapHours must be > 0 (got ${overlapHours}).`);
    }

    // Step 1: defensive read of the calling key — outside the transaction
    // so we throw the typed error before any write is attempted. The
    // transaction below re-checks the same row by id to keep atomicity
    // honest, but typed errors are clearer when they short-circuit early.
    const calling = await this.prisma.apiKey.findUnique({
      where: { id: callingKeyId },
      select: {
        id: true,
        principalId: true,
        scope: true,
        revokedAt: true,
        expiresAt: true,
      },
    });
    if (!calling) {
      throw new NotFoundError('ApiKey');
    }
    if (calling.principalId !== principalId) {
      // Cross-principal — guard should never let this through, but defence
      // in depth (CLAUDE.md invariant #5).
      throw new AuthorizationError('API key does not belong to the calling principal.');
    }
    if (calling.revokedAt !== null) {
      throw new NotFoundError('ApiKey');
    }
    const now = new Date();
    if (calling.expiresAt !== null && calling.expiresAt > now) {
      throw new AlreadyRotatedError();
    }

    // Step 2: mint plaintext (NOT Math.random — crypto.randomBytes).
    const scope: AuthenticatedKey['scope'] = calling.scope;
    const prefix = scope === 'VERIFY_ONLY' ? 'okoro_vk_' : 'okoro_sk_';
    const random = randomBytes(24).toString('base64url').replace(/[^a-zA-Z0-9]/g, '').slice(0, 26);
    const plaintext = `${prefix}${random}`;
    const keyPrefix = plaintext.slice(0, 12);
    const hash = await bcrypt.hash(plaintext, this.config.apiKeyBcryptCost);

    const overlapMs = overlapHours * 60 * 60 * 1000;
    const oldKeyExpiresAt = new Date(now.getTime() + overlapMs);

    // Step 3: atomic write — both rows or neither.
    const txResult = await this.prisma.$transaction(async (tx) => {
      // Re-check inside the transaction (race: a concurrent rotation could
      // have stamped expiresAt between the read above and here).
      const recheck = await tx.apiKey.findUnique({
        where: { id: callingKeyId },
        select: { expiresAt: true, revokedAt: true, principalId: true },
      });
      if (recheck?.revokedAt !== null) {
        throw new NotFoundError('ApiKey');
      }
      if (recheck.principalId !== principalId) {
        throw new AuthorizationError('API key does not belong to the calling principal.');
      }
      if (recheck.expiresAt !== null && recheck.expiresAt > now) {
        throw new AlreadyRotatedError();
      }

      const created = await tx.apiKey.create({
        data: {
          keyHash: hash,
          keyPrefix,
          label: null,
          principalId,
          scope,
        },
        select: { id: true, expiresAt: true },
      });

      await tx.apiKey.update({
        where: { id: callingKeyId },
        data: { expiresAt: oldKeyExpiresAt },
      });

      return { newKeyId: created.id, newKeyExpiresAt: created.expiresAt };
    });

    // Step 4: audit emit (post-commit). If the audit append fails we let
    // it surface — invariant #3 says every state change MUST land in the
    // chain. NEVER include the plaintext.
    if (this.audit) {
      try {
        await this.audit.append({
          agentId: null,
          principalId,
          action: 'api_key.rotated',
          decision: 'APPROVED',
          // Stash structured payload in policySnapshot — the existing
          // canonical place for non-policy event metadata in this schema.
          policySnapshot: {
            oldKeyId: callingKeyId,
            newKeyId: txResult.newKeyId,
            overlapHours,
            oldKeyExpiresAt: oldKeyExpiresAt.toISOString(),
            // NEVER plaintext.
          },
          trustScoreAtEvent: 0,
          trustBandAtEvent: 'VERIFIED',
        });
      } catch (err) {
        // No silent swallow: the rotation already committed. Surface a
        // distinct error so the caller knows the key is rotated but the
        // audit row is missing — operator must reconcile.
        this.logger.error(
          `Audit emit failed for api_key.rotated principal=${principalId} oldKey=${callingKeyId}: ${(err as Error).message}`,
        );
        throw err;
      }
    } else {
      this.logger.warn('AuditService not wired into ApiKeyService — rotation not audited.');
    }

    return {
      newKey: { id: txResult.newKeyId, plaintext, expiresAt: txResult.newKeyExpiresAt },
      oldKey: { id: callingKeyId, expiresAt: oldKeyExpiresAt },
    };
  }
}
