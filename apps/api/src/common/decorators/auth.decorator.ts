import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedKey } from '../../modules/auth/api-key.service';

export const Auth = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthenticatedKey => {
  const req = ctx.switchToHttp().getRequest<Request>();
  if (!req.auth) {
    throw new Error('Auth decorator used on an unprotected route');
  }
  return req.auth;
});
