import { SetMetadata } from '@nestjs/common';

/**
 * Mark a controller method as idempotent. The `IdempotencyInterceptor`
 * will:
 *   - Cache the response body keyed by (principalId, route, Idempotency-Key)
 *     for 24 hours.
 *   - Replay cached responses verbatim when the same key + body arrives.
 *   - Return 409 IDEMPOTENCY_CONFLICT when the same key arrives with a
 *     different body.
 *
 * Apply to: every POST that creates a side effect — agent register,
 * policy create, agent revoke (already idempotent semantically),
 * webhook redeliveries, billing webhook handler.
 */
export const IDEMPOTENT_KEY = 'okoro:idempotent';
export const Idempotent = (): MethodDecorator => SetMetadata(IDEMPOTENT_KEY, true);
