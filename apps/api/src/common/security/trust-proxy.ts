// CERNIQ — trust proxy configuration (S-5 fix).
//
// When CERNIQ sits behind Cloudflare → Railway, the request `req.ip`
// is the Cloudflare edge IP, not the real client. The throttler buckets
// per `req.ip`, so without `app.set('trust proxy', ...)` configured,
// 1000 req/min from one attacker counts the same as 1000 req/min from
// 1000 distinct customers — both share a single Cloudflare edge IP.
//
// Worse: rate-limit-bypass attacks become trivial because the attacker
// can reach the same edge from many CF zones, distributing across our
// per-IP buckets.
//
// Three configuration modes:
//
//   1. 'loopback' — dev only. trust no proxies; req.ip = TCP src.
//   2. 'cloudflare' — production behind CF. Trust the CF IP ranges
//      (https://www.cloudflare.com/ips/). req.ip becomes the
//      `CF-Connecting-IP` header value.
//   3. CIDR list — Railway internal network or other custom topology.
//
// We do NOT use `trust proxy: true` (trust everything) because that
// allows any client to spoof their IP via X-Forwarded-For.

import type { Request } from 'express';

// type-rationale: 'loopback' | 'cloudflare' are the canonical short-codes; arbitrary
// strings are valid forward-proxy IP lists (Express `trust proxy` semantics).
// eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
export type TrustProxyMode = 'loopback' | 'cloudflare' | string;

/**
 * Cloudflare's published IP ranges (2025 list — refresh quarterly via
 * `scripts/refresh-cf-ips.ts`). Both v4 and v6.
 */
const CLOUDFLARE_IP_RANGES_V4 = [
  '173.245.48.0/20',
  '103.21.244.0/22',
  '103.22.200.0/22',
  '103.31.4.0/22',
  '141.101.64.0/18',
  '108.162.192.0/18',
  '190.93.240.0/20',
  '188.114.96.0/20',
  '197.234.240.0/22',
  '198.41.128.0/17',
  '162.158.0.0/15',
  '104.16.0.0/13',
  '104.24.0.0/14',
  '172.64.0.0/13',
  '131.0.72.0/22',
];

const CLOUDFLARE_IP_RANGES_V6 = [
  '2400:cb00::/32',
  '2606:4700::/32',
  '2803:f800::/32',
  '2405:b500::/32',
  '2405:8100::/32',
  '2a06:98c0::/29',
  '2c0f:f248::/32',
];

const CF_ALL = [...CLOUDFLARE_IP_RANGES_V4, ...CLOUDFLARE_IP_RANGES_V6];

/**
 * Resolve a TrustProxyMode into the value passed to `app.set('trust proxy', ...)`.
 *
 * The Express trust-proxy setting accepts:
 *   - boolean (true = trust all hops; false = trust nothing)
 *   - 'loopback' | 'linklocal' | 'uniquelocal' (named ranges)
 *   - IP / CIDR (string or array)
 *   - integer (number of hops to trust)
 *   - function (req, depth) => boolean
 *
 * Cloudflare-mode returns the CF CIDR list. Custom mode passes through.
 */
export function resolveTrustProxy(mode: TrustProxyMode): string | string[] {
  if (mode === 'loopback') return 'loopback';
  if (mode === 'cloudflare') return CF_ALL;
  // Custom CIDR list, comma-separated.
  return mode
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Given a request, return the real client IP for rate-limiting + audit
 * purposes. Prefers `CF-Connecting-IP` (Cloudflare's authoritative client
 * IP header — only set by CF, not forgeable from a CF-fronted request).
 * Falls back to req.ip (which honors trust-proxy config).
 */
export function realClientIp(req: Request): string {
  const cf = req.headers['cf-connecting-ip'];
  if (typeof cf === 'string' && cf.length > 0) return cf;
  if (Array.isArray(cf) && cf[0]) return cf[0];
  return req.ip ?? 'unknown';
}
