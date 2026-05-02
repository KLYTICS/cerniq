// Idempotency-Key enforcement.
//
// Industry-standard pattern (Stripe, PayPal, SQS): client supplies an
// `Idempotency-Key` header on POST endpoints; the server caches the
// response body keyed by `(principalId, route, idempotencyKey)`. Replay
// of the SAME key returns the original response (200/201/4xx/5xx alike).
// Replay with the same key but a DIFFERENT body returns 409
// IDEMPOTENCY_CONFLICT (per @aegis/types `ERROR_CODE.IDEMPOTENCY_CONFLICT`).
//
// What this protects against:
//   - Network retries causing duplicate agent registrations.
//   - Webhook redelivery causing duplicate billing actions.
//   - Browser double-clicks creating two policies with one click.
//
// Storage: Redis with 24-hour TTL (Stripe parity). Keys expire naturally;
// no GC daemon required.
//
// Hash: SHA-256 over the *normalized* request body (RFC 8785-lite from
// AuditChainUtil) — not the raw body, since clients legitimately resend
// with different whitespace or key ordering.

import { createHash } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';

import { IdempotencyConflictError, ServiceUnavailableError } from '../errors';
import { RedisService } from '../redis/redis.service';

const TTL_SECONDS = 60 * 60 * 24; // 24 hours

export interface IdempotencyHit {
  status: number;
  body: unknown;
  /** ISO timestamp of the first response we recorded. */
  firstSeenAt: string;
}

@Injectable()
export class IdempotencyService {
  private readonly logger = new Logger(IdempotencyService.name);

  constructor(private readonly redis: RedisService) {}

  /**
   * Look up a prior response for `(principalId, route, idempotencyKey)`.
   * Returns the recorded response if the body hash matches; throws
   * IdempotencyConflictError if a different body was sent under the same
   * key; returns null if this is the first time we've seen this key.
   */
  async lookup(
    principalId: string,
    route: string,
    key: string,
    body: unknown,
  ): Promise<IdempotencyHit | null> {
    const cacheKey = this.composeKey(principalId, route, key);
    const bodyHash = this.hashBody(body);

    let stored: { hash: string; status: number; body: unknown; firstSeenAt: string } | null;
    try {
      stored = await this.redis.get<typeof stored>(cacheKey);
    } catch (err) {
      this.logger.error(`Idempotency lookup failed: ${(err as Error).message}`);
      throw new ServiceUnavailableError('Idempotency store unavailable.', { cause: err });
    }
    if (!stored) return null;

    if (stored.hash !== bodyHash) {
      throw new IdempotencyConflictError({
        details: {
          firstSeenAt: stored.firstSeenAt,
          presentedKey: key,
        },
      });
    }
    return { status: stored.status, body: stored.body, firstSeenAt: stored.firstSeenAt };
  }

  /**
   * Persist a response so subsequent calls with the same key + body see
   * the recorded result. Best-effort write; failures are logged and the
   * caller continues. (We never reject a successful operation because we
   * couldn't cache its idempotency record — the operation already
   * happened.)
   */
  async record(
    principalId: string,
    route: string,
    key: string,
    body: unknown,
    status: number,
    responseBody: unknown,
  ): Promise<void> {
    const cacheKey = this.composeKey(principalId, route, key);
    const payload = {
      hash: this.hashBody(body),
      status,
      body: responseBody,
      firstSeenAt: new Date().toISOString(),
    };
    try {
      await this.redis.set(cacheKey, payload, TTL_SECONDS);
    } catch (err) {
      this.logger.warn(`Idempotency record failed for ${cacheKey}: ${(err as Error).message}`);
    }
  }

  private composeKey(principalId: string, route: string, key: string): string {
    // SHA-1 over the user-supplied portion to bound key length and protect
    // against pathological inputs. Hash is not security-sensitive (the
    // principalId scopes the namespace).
    const userPart = createHash('sha1').update(`${route}|${key}`).digest('hex');
    return `idem:${principalId}:${userPart}`;
  }

  private hashBody(body: unknown): string {
    return createHash('sha256').update(this.canonicalize(body)).digest('hex');
  }

  private canonicalize(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map((v) => this.canonicalize(v)).join(',')}]`;
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${this.canonicalize(obj[k])}`).join(',')}}`;
  }
}
