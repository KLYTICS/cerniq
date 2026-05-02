// Idempotency interceptor.
//
// Wraps any controller method that opts in via `@Idempotent()`. Reads
// `Idempotency-Key` header; if present, looks up cache before invoking
// the handler. On a hit with matching body, short-circuits with the
// recorded response. On a hit with mismatched body, throws 409. On a
// miss, runs the handler and records the response on the way out.
//
// We don't cache by route alone — the principal scopes the namespace so
// principal A and principal B can use the same idempotency key without
// collision.

import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { type Observable, of, tap } from 'rxjs';

import { AEGIS_HEADER_IDEMPOTENCY } from '@aegis/types';

import type { AuthenticatedKey } from '../../modules/auth/api-key.service';
import { IDEMPOTENT_KEY } from './idempotent.decorator';
import { IdempotencyService } from './idempotency.service';

interface RequestWithAuth extends Request {
  auth?: AuthenticatedKey;
}

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly idempotency: IdempotencyService,
    private readonly reflector: Reflector,
  ) {}

  async intercept(ctx: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const idempotent = this.reflector.getAllAndOverride<boolean>(IDEMPOTENT_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!idempotent) return next.handle();

    const req = ctx.switchToHttp().getRequest<RequestWithAuth>();
    const res = ctx.switchToHttp().getResponse<Response>();
    const headerName = AEGIS_HEADER_IDEMPOTENCY.toLowerCase();
    const key = req.headers[headerName];
    const idempotencyKey = Array.isArray(key) ? key[0] : key;
    if (!idempotencyKey) return next.handle();

    const principalId = req.auth?.principalId;
    if (!principalId) {
      // Idempotency requires authentication — without principal scoping,
      // an unauthenticated key namespace collides across callers.
      return next.handle();
    }

    const route = `${req.method} ${req.route?.path ?? req.path}`;
    const body = (req.body ?? null) as unknown;

    const hit = await this.idempotency.lookup(principalId, route, idempotencyKey, body);
    if (hit) {
      res.status(hit.status);
      res.setHeader('Idempotent-Replay', 'true');
      res.setHeader('Idempotent-First-Seen', hit.firstSeenAt);
      return of(hit.body);
    }

    return next.handle().pipe(
      tap((responseBody: unknown) => {
        const status = res.statusCode;
        // Fire-and-forget — don't block the response on cache write.
        this.idempotency
          .record(principalId, route, idempotencyKey, body, status, responseBody)
          .catch(() => undefined);
      }),
    );
  }
}
