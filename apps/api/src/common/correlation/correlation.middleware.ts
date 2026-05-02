// HTTP middleware that opens a CorrelationContext for every inbound request.
//
// Mounted in app.module.ts BEFORE the global ApiKeyGuard so the guard can
// patch `principalId` / `apiKeyId` into the same context once it resolves
// the API key.

import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { ulid } from 'ulid';

import { AEGIS_HEADER_REQUEST_ID } from '@aegis/types';

import { CorrelationContext, type CorrelationState } from './correlation.context';

const HEADER_LOWER = AEGIS_HEADER_REQUEST_ID.toLowerCase();
const TX_PREFIX = 'tx_';
const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/i;

/**
 * Accept inbound `X-Request-Id` only when it looks like one of:
 *   - `tx_<ulid>` (our preferred shape)
 *   - a bare 26-char ULID
 *   - any short-ish opaque token <= 128 chars matching [A-Za-z0-9_.-]+
 *
 * Anything else (control chars, header injection attempts, oversized
 * payloads) is dropped silently and we mint a fresh id. We never echo
 * untrusted bytes into our own response header.
 */
const SAFE_OPAQUE_RE = /^[A-Za-z0-9_.-]{1,128}$/;

function sanitizeIncoming(raw: string | string[] | undefined): string | null {
  if (!raw) return null;
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith(TX_PREFIX)) {
    const tail = trimmed.slice(TX_PREFIX.length);
    return ULID_RE.test(tail) ? trimmed : null;
  }
  if (ULID_RE.test(trimmed)) return `${TX_PREFIX}${trimmed}`;
  return SAFE_OPAQUE_RE.test(trimmed) ? trimmed : null;
}

@Injectable()
export class CorrelationMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = sanitizeIncoming(req.headers[HEADER_LOWER]);
    const txId = incoming ?? `${TX_PREFIX}${ulid()}`;

    // Be explicit about UA (single-string only — Express normalises to
    // string in practice but the type allows array).
    const uaRaw = req.headers['user-agent'];
    const userAgent = typeof uaRaw === 'string' ? uaRaw.slice(0, 256) : undefined;

    // `req.ip` honours `trust proxy`. Fall back to the socket address so we
    // never end up with `undefined` in the audit log when running behind a
    // mis-configured reverse proxy.
    const originIp = req.ip ?? req.socket?.remoteAddress ?? undefined;

    const state: CorrelationState = {
      txId,
      ...(originIp ? { originIp } : {}),
      ...(userAgent ? { userAgent } : {}),
    };

    res.setHeader(AEGIS_HEADER_REQUEST_ID, txId);

    CorrelationContext.run(state, () => next());
  }
}
