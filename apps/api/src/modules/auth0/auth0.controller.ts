import { timingSafeEqual } from 'node:crypto';

import { Body, Controller, Headers, HttpCode, Post, UnauthorizedException } from '@nestjs/common';

import { AppConfigService } from '../../config/config.service';

import type {
  Auth0ActionLoginDto,
  Auth0ActionLoginResultDto,
  Auth0ExchangeDto,
  Auth0ExchangeResultDto,
} from './auth0.dto';
import { Auth0Service } from './auth0.service';

/**
 * Public surface for the Auth0 bridge.
 *
 *   POST /v1/idp/auth0/action      — webhook from the Auth0 Action.
 *                                    Authenticated by shared secret in
 *                                    `X-Auth0-Action-Secret` header.
 *   POST /v1/idp/auth0/exchange    — dashboard hands an Auth0 token,
 *                                    receives an AEGIS API key.
 *
 * Per ADR-0009, both are decoupled from the agent-verify hot path and
 * live behind their own URL prefix. They are NEVER reached on the
 * Cloudflare Worker (Phase 3) — Auth0 traffic stays at the Railway origin.
 */
@Controller('v1/idp/auth0')
export class Auth0Controller {
  constructor(
    private readonly auth0: Auth0Service,
    private readonly config: AppConfigService,
  ) {}

  @Post('action')
  @HttpCode(200)
  async actionLogin(
    @Headers('x-auth0-action-secret') secret: string | undefined,
    @Body() dto: Auth0ActionLoginDto,
  ): Promise<Auth0ActionLoginResultDto> {
    this.assertActionSecret(secret);
    return await this.auth0.handleActionLogin(dto);
  }

  @Post('exchange')
  @HttpCode(200)
  async exchange(@Body() dto: Auth0ExchangeDto): Promise<Auth0ExchangeResultDto> {
    return await this.auth0.exchangeToken(dto);
  }

  private assertActionSecret(provided: string | undefined): void {
    const expected = this.config.auth0ActionSecret;
    if (!expected) throw new UnauthorizedException('auth0_action_secret_unset');
    if (!provided) throw new UnauthorizedException('auth0_action_secret_missing');
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException('auth0_action_secret_invalid');
    }
  }
}
