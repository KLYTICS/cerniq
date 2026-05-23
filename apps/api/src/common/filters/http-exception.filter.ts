import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ulid } from 'ulid';

import { CerniqError } from '../errors/cerniq-error.js';
import {
  getCatalogEntry,
  getInternalFallback,
  type ErrorCatalogEntry,
} from '../errors/error-catalog.js';

/**
 * Public error envelope. The `error` + `message` + `statusCode` +
 * `requestId` fields are the round-1 contract that SDK and dashboard
 * code already depend on. Round 15 adds `code` (stable lower-snake-case
 * identifier) and `retryable` so SDKs can match without parsing prose.
 *
 * `details` is preserved for CerniqError subclasses that explicitly opt
 * in (e.g. RateLimitedError exposes `retryAfterSeconds`); it is NEVER
 * populated for unknown exceptions, which would risk leaking internals.
 */
interface ErrorEnvelope {
  error: string;
  message: string;
  statusCode: number;
  requestId: string;
  code: string;
  retryable: boolean;
  details?: unknown;
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    const requestId = (req.headers['x-request-id'] as string | undefined) ?? ulid();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let error = 'INTERNAL_SERVER_ERROR';
    let message = 'An unexpected error occurred.';
    let details: unknown;
    let catalogEntry: ErrorCatalogEntry | null = null;

    if (exception instanceof CerniqError) {
      // First-party typed error: trust the catalog, return customer-safe wording.
      status = exception.getStatus();
      const body = exception.getResponse();
      if (body && typeof body === 'object') {
        const b = body as Record<string, unknown>;
        if (b.details !== undefined) details = b.details;
      }
      catalogEntry = exception.getCatalogEntry();
      if (catalogEntry !== null) {
        message = catalogEntry.customerMessage;
        error = catalogEntry.code.toUpperCase();
      } else {
        // Subclass missing from catalog — log it but never leak. The audit
        // script catches this in CI; here we behave defensively.
        this.logger.warn(
          `CerniqError subclass "${exception.constructor.name}" is not in ERROR_CATALOG [${requestId}]`,
        );
        const fb = getInternalFallback();
        message = fb.customerMessage;
        error = fb.code.toUpperCase();
        catalogEntry = fb;
      }
    } else if (exception instanceof HttpException) {
      // NestJS-native HttpException (NotFoundException, ForbiddenException, etc.).
      // Honor the framework status + body shape but do not invent retryability.
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
        error = exception.constructor.name.replace(/Exception$/, '').toUpperCase();
      } else if (body && typeof body === 'object') {
        const b = body as Record<string, unknown>;
        message = (b.message as string) ?? message;
        error =
          (b.error as string) ?? exception.constructor.name.replace(/Exception$/, '').toUpperCase();
        if (b.details) details = b.details;
      }
    } else if (exception instanceof Error) {
      // Unknown error → consult catalog by class name (CircuitOpenError lands here),
      // otherwise redact to a generic internal envelope.
      const entry = getCatalogEntry(exception);
      if (entry !== null) {
        catalogEntry = entry;
        status = entry.httpStatus;
        message = entry.customerMessage;
        error = entry.code.toUpperCase();
        this.logger.error(
          `Cataloged non-Cerniq error [${requestId}] ${exception.constructor.name}: ${exception.message}`,
          exception.stack,
        );
      } else {
        this.logger.error(`Unhandled error [${requestId}]: ${exception.message}`, exception.stack);
        const fb = getInternalFallback();
        catalogEntry = fb;
        status = fb.httpStatus;
        message = fb.customerMessage;
        error = fb.code.toUpperCase();
      }
    }

    const code = catalogEntry?.code ?? 'internal_error';
    const retryable = catalogEntry?.retryable ?? false;

    const envelope: ErrorEnvelope = {
      error,
      message,
      statusCode: status,
      requestId,
      code,
      retryable,
      ...(details ? { details } : {}),
    };

    res.setHeader('X-Request-Id', requestId);
    res.status(status).json(envelope);
  }
}
