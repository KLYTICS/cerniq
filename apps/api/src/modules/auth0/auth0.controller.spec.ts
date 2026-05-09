/**
 * Auth0Controller — unit tests
 *
 * Coverage:
 *   actionLogin()  — rejects missing/wrong shared secret (timing-safe),
 *                    delegates to Auth0Service.handleActionLogin when valid
 *   exchange()     — delegates to Auth0Service.exchangeToken (no auth gate)
 */

import { UnauthorizedException } from '@nestjs/common';
import { Auth0Controller } from './auth0.controller';
import { Auth0Service } from './auth0.service';
import { AppConfigService } from '../../config/config.service';
import type { Auth0ActionLoginDto, Auth0ExchangeDto } from './auth0.dto';

// ── Stubs ─────────────────────────────────────────────────────────────────────

function makeService(): jest.Mocked<Pick<Auth0Service, 'handleActionLogin' | 'exchangeToken'>> {
  return {
    handleActionLogin: jest.fn().mockResolvedValue({ principalId: 'prn_A', apiKey: 'aegis_...' }),
    exchangeToken: jest.fn().mockResolvedValue({ api_key_id: 'key_123', principal_id: 'prn_A', roles: [], expires_at: '2026-01-01T00:00:00.000Z' }),
  } as unknown as jest.Mocked<Pick<Auth0Service, 'handleActionLogin' | 'exchangeToken'>>;
}

function makeConfig(secret = 'correct_secret'): jest.Mocked<Pick<AppConfigService, 'auth0ActionSecret'>> {
  return {
    auth0ActionSecret: secret,
  } as unknown as jest.Mocked<Pick<AppConfigService, 'auth0ActionSecret'>>;
}

function makeController(secret?: string) {
  const service = makeService();
  const config = makeConfig(secret ?? 'correct_secret');
  const controller = new Auth0Controller(
    service as unknown as Auth0Service,
    config as unknown as AppConfigService,
  );
  return { controller, service, config };
}

const ACTION_DTO: Auth0ActionLoginDto = {
  sub: 'auth0|user123',
  email: 'user@example.com',
} as unknown as Auth0ActionLoginDto;

const EXCHANGE_DTO: Auth0ExchangeDto = {
  token: 'eyJhbGciOiJSUzI1NiJ9.example',
} as unknown as Auth0ExchangeDto;

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Auth0Controller', () => {
  describe('actionLogin()', () => {
    it('throws UnauthorizedException when auth0ActionSecret is not configured', async () => {
      const service = makeService();
      const config = { auth0ActionSecret: undefined } as unknown as AppConfigService;
      const controller = new Auth0Controller(
        service as unknown as Auth0Service,
        config,
      );
      await expect(controller.actionLogin('any_secret', ACTION_DTO)).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when secret header is missing', async () => {
      const { controller } = makeController();
      await expect(controller.actionLogin(undefined, ACTION_DTO)).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when secret does not match', async () => {
      const { controller } = makeController('correct_secret');
      await expect(controller.actionLogin('wrong_secret', ACTION_DTO)).rejects.toThrow(UnauthorizedException);
    });

    it('delegates to auth0.handleActionLogin when secret is valid', async () => {
      const { controller, service } = makeController('my_secret');
      await controller.actionLogin('my_secret', ACTION_DTO);
      expect(service.handleActionLogin).toHaveBeenCalledWith(ACTION_DTO);
    });

    it('returns the service result when secret is valid', async () => {
      const { controller } = makeController('my_secret');
      const result = await controller.actionLogin('my_secret', ACTION_DTO);
      expect(result).toBeDefined();
    });

    it('rejects a secret that is different length (timing-safe comparison)', async () => {
      const { controller } = makeController('short');
      await expect(controller.actionLogin('a_much_longer_incorrect_secret', ACTION_DTO)).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('exchange()', () => {
    it('delegates to auth0.exchangeToken with the DTO (no secret required)', async () => {
      const { controller, service } = makeController();
      await controller.exchange(EXCHANGE_DTO);
      expect(service.exchangeToken).toHaveBeenCalledWith(EXCHANGE_DTO);
    });

    it('returns the service result', async () => {
      const { controller } = makeController();
      const result = await controller.exchange(EXCHANGE_DTO);
      expect((result as unknown as { api_key_id: string }).api_key_id).toBeDefined();
    });
  });
});
