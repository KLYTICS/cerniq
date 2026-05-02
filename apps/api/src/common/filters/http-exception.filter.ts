import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ulid } from 'ulid';

interface ErrorEnvelope {
  error: string;
  message: string;
  statusCode: number;
  requestId: string;
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

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
        error = exception.constructor.name.replace(/Exception$/, '').toUpperCase();
      } else if (body && typeof body === 'object') {
        const b = body as Record<string, unknown>;
        message = (b['message'] as string) ?? message;
        error = (b['error'] as string) ?? exception.constructor.name.replace(/Exception$/, '').toUpperCase();
        if (b['details']) details = b['details'];
      }
    } else if (exception instanceof Error) {
      this.logger.error(`Unhandled error [${requestId}]: ${exception.message}`, exception.stack);
      message = process.env.NODE_ENV === 'production' ? 'Internal server error' : exception.message;
    }

    const envelope: ErrorEnvelope = {
      error,
      message,
      statusCode: status,
      requestId,
      ...(details ? { details } : {}),
    };

    res.setHeader('X-Request-Id', requestId);
    res.status(status).json(envelope);
  }
}
