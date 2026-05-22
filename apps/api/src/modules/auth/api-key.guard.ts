import { CanActivate, ExecutionContext, Injectable, SetMetadata, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { ApiKeyService, type AuthenticatedKey } from './api-key.service';

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);

export const VERIFY_KEY_ONLY = 'verifyKeyOnly';
export const VerifyKeyOnly = (): MethodDecorator & ClassDecorator => SetMetadata(VERIFY_KEY_ONLY, true);

declare module 'express' {
  interface Request {
    auth?: AuthenticatedKey;
  }
}

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly apiKeys: ApiKeyService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (isPublic) return true;

    const verifyKeyOnly = this.reflector.getAllAndOverride<boolean>(VERIFY_KEY_ONLY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);

    const req = ctx.switchToHttp().getRequest<Request>();
    const headerName = verifyKeyOnly ? 'x-okoro-verify-key' : 'x-okoro-api-key';
    const presented = req.headers[headerName];
    const plaintext = Array.isArray(presented) ? presented[0] : presented;

    if (!plaintext) {
      throw new UnauthorizedException({ error: 'MISSING_API_KEY', message: `Header ${headerName} is required.` });
    }

    const auth = await this.apiKeys.resolve(plaintext);
    if (!auth) {
      // Distinguish "expired (rotation overlap elapsed)" from "never existed"
      // so customers debugging post-rotation pain see a clear signal.
      const expired = await this.apiKeys.isExpired(plaintext);
      if (expired) {
        throw new UnauthorizedException({
          error: 'EXPIRED_API_KEY',
          message: 'API key has expired. Use the rotated replacement key.',
        });
      }
      throw new UnauthorizedException({ error: 'INVALID_API_KEY', message: 'API key not recognised.' });
    }

    if (verifyKeyOnly && auth.scope !== 'VERIFY_ONLY' && auth.scope !== 'FULL') {
      throw new UnauthorizedException({ error: 'WRONG_KEY_SCOPE', message: 'Verify keys required for this endpoint.' });
    }

    req.auth = auth;
    return true;
  }
}
