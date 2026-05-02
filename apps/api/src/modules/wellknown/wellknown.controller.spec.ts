import { HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import { WellknownController, etagMatches, quotedEtag } from './wellknown.controller';
import { WellknownService } from './wellknown.service';
import { encodeBase64Url } from '../../common/crypto/ed25519.util';
import type { AppConfigService } from '../../config/config.service';

const ZERO_KEY_B64 = encodeBase64Url(new Uint8Array(32));
const FIXED_ROTATED_AT = '2026-01-01T00:00:00.000Z';

function buildService(): WellknownService {
  const config = {
    aegisSigningPublicKey: ZERO_KEY_B64,
    aegisSigningKeyRotatedAt: FIXED_ROTATED_AT,
  } as unknown as AppConfigService;
  const svc = new WellknownService(config);
  svc.onModuleInit();
  return svc;
}

interface FakeRes {
  res: Response;
  headers: Record<string, string>;
  status: jest.Mock;
}

function fakeResponse(): FakeRes {
  const headers: Record<string, string> = {};
  const status = jest.fn();
  const res = {
    setHeader: jest.fn((k: string, v: string) => {
      headers[k.toLowerCase()] = v;
    }),
    status,
  } as unknown as Response;
  return { res, headers, status };
}

describe('WellknownController', () => {
  describe('GET /.well-known/audit-signing-key', () => {
    it('returns the full payload + ETag matching kid on first hit', () => {
      const svc = buildService();
      const ctl = new WellknownController(svc);
      const { res, headers } = fakeResponse();

      const out = ctl.auditSigningKey(undefined, res);

      expect(out).toBeDefined();
      expect(out!.kid).toBe(svc.getKid());
      expect(out!.publicKey).toBe(ZERO_KEY_B64);
      expect(out!.algorithm).toBe('EdDSA');
      expect(out!.curve).toBe('Ed25519');
      expect(out!.issuer).toBe('https://aegislabs.io');
      expect(out!.purpose).toBe('audit-event-signing');
      expect(out!.rotatedAt).toBe(FIXED_ROTATED_AT);
      expect(headers.etag).toBe(`"${svc.getKid()}"`);
      expect(headers['content-type']).toMatch(/application\/json/);
    });

    it('returns 304 when If-None-Match matches the current kid', () => {
      const svc = buildService();
      const ctl = new WellknownController(svc);
      const { res, status } = fakeResponse();

      const out = ctl.auditSigningKey(`"${svc.getKid()}"`, res);

      expect(out).toBeUndefined();
      expect(status).toHaveBeenCalledWith(HttpStatus.NOT_MODIFIED);
    });

    it('returns 200 when If-None-Match does not match', () => {
      const svc = buildService();
      const ctl = new WellknownController(svc);
      const { res, status } = fakeResponse();

      const out = ctl.auditSigningKey('"some-other-kid"', res);

      expect(out).toBeDefined();
      expect(status).not.toHaveBeenCalledWith(HttpStatus.NOT_MODIFIED);
    });

    it('honours the wildcard If-None-Match: *', () => {
      const svc = buildService();
      const ctl = new WellknownController(svc);
      const { res, status } = fakeResponse();

      ctl.auditSigningKey('*', res);

      expect(status).toHaveBeenCalledWith(HttpStatus.NOT_MODIFIED);
    });

    it('honours weak validators (W/"<kid>")', () => {
      const svc = buildService();
      const ctl = new WellknownController(svc);
      const { res, status } = fakeResponse();

      ctl.auditSigningKey(`W/"${svc.getKid()}"`, res);

      expect(status).toHaveBeenCalledWith(HttpStatus.NOT_MODIFIED);
    });
  });

  describe('GET /.well-known/jwks.json', () => {
    it('returns RFC 8037-shaped JWKS + jwk-set+json content-type', () => {
      const svc = buildService();
      const ctl = new WellknownController(svc);
      const { res, headers } = fakeResponse();

      const out = ctl.jwks(undefined, res);

      expect(out).toBeDefined();
      expect(out!.keys).toHaveLength(1);
      expect(out!.keys[0]).toMatchObject({
        kty: 'OKP',
        crv: 'Ed25519',
        alg: 'EdDSA',
        use: 'sig',
        kid: svc.getKid(),
        x: ZERO_KEY_B64,
      });
      expect(headers.etag).toBe(`"${svc.getKid()}"`);
      expect(headers['content-type']).toMatch(/application\/jwk-set\+json/);
    });

    it('returns 304 on If-None-Match match', () => {
      const svc = buildService();
      const ctl = new WellknownController(svc);
      const { res, status } = fakeResponse();

      const out = ctl.jwks(`"${svc.getKid()}"`, res);

      expect(out).toBeUndefined();
      expect(status).toHaveBeenCalledWith(HttpStatus.NOT_MODIFIED);
    });

    it('uses the same kid as audit-signing-key (single source of truth)', () => {
      const svc = buildService();
      const ctl = new WellknownController(svc);

      const a = ctl.auditSigningKey(undefined, fakeResponse().res);
      const b = ctl.jwks(undefined, fakeResponse().res);

      expect(a!.kid).toBe(b!.keys[0]!.kid);
    });
  });

  describe('etagMatches helper', () => {
    const etag = quotedEtag('abc123');

    it('returns false when If-None-Match is undefined or empty', () => {
      expect(etagMatches(undefined, etag)).toBe(false);
      expect(etagMatches('', etag)).toBe(false);
    });

    it('matches exact and wildcard', () => {
      expect(etagMatches(etag, etag)).toBe(true);
      expect(etagMatches('*', etag)).toBe(true);
    });

    it('matches comma-separated lists', () => {
      expect(etagMatches(`"old", ${etag}, "newer"`, etag)).toBe(true);
    });

    it('matches weak validators', () => {
      expect(etagMatches(`W/${etag}`, etag)).toBe(true);
    });

    it('does NOT match unrelated tags', () => {
      expect(etagMatches('"different"', etag)).toBe(false);
    });
  });
});
