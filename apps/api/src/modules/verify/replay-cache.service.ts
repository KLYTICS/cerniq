// JWT replay cache.
//
// Audit a38b6fd6 (CRIT-1) — `jti` was parsed but never persisted; an
// attacker who captured a valid token could replay it for the full 60s
// TTL. This service is the fix.
//
// Contract:
//   `consume(jti, ttlSeconds)` returns true the first time it is called for
//   a given `jti`, false on every subsequent call within `ttlSeconds`.
//   The verify hot path consumes the `jti` BEFORE returning approval.
//
// Failure mode:
//   - If Redis is down, `consume()` THROWS `ServiceUnavailableError`. The
//     verify path catches and returns `denialReason: ANOMALY_FLAGGED` — we
//     refuse rather than fall open. (Per CLAUDE.md invariant #4: no silent
//     failures.) An ops alarm fires on consume-failure rate > 0.1%.
//
// Replay window:
//   - We use the token's own `exp - iat` as the TTL (capped to 90 s for
//     defense-in-depth — a misissued token claiming a 24-hour exp is
//     guarded down to 90 s of replay protection).
//   - Keys naturally expire so memory doesn't grow without bound.

import { Injectable, Logger } from '@nestjs/common';

import { ServiceUnavailableError } from '../../common/errors';
import { RedisService } from '../../common/redis/redis.service';

const HARD_CEILING_SECONDS = 90;

@Injectable()
export class ReplayCacheService {
  private readonly logger = new Logger(ReplayCacheService.name);

  constructor(private readonly redis: RedisService) {}

  /**
   * Atomically consume a `jti` exactly once. Returns true on first sighting,
   * false on replay.
   *
   * Implementation: `SET key 1 NX EX <ttl>` — Redis returns "OK" iff the
   * key did not previously exist.
   */
  async consume(jti: string, ttlSeconds: number): Promise<boolean> {
    if (!jti || jti.length < 8 || jti.length > 128) {
      // Invalid jti — treat as replay (fail closed).
      return false;
    }
    const ttl = Math.max(1, Math.min(HARD_CEILING_SECONDS, Math.floor(ttlSeconds)));
    const key = `verify:jti:${jti}`;

    let result: string | null;
    try {
      // Use raw client for SET ... NX EX — RedisService doesn't expose this combo.
      result = await this.redis.raw().set(key, '1', 'EX', ttl, 'NX');
    } catch (err) {
      this.logger.error(`Replay-cache Redis SET failed jti=${jti}: ${(err as Error).message}`);
      throw new ServiceUnavailableError('Replay cache unavailable.', { cause: err });
    }

    // Redis returns "OK" on successful NX set, null on collision.
    return result === 'OK';
  }
}
