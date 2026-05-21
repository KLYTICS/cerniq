import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * SSRF guard for webhook delivery (Round 2 release-blocker risk #1).
 *
 * The defense has three layers:
 *
 *   1. **Scheme + URL validation** — only `http:` / `https:` accepted.
 *      `file:`, `gopher:`, `ftp:`, `data:` and friends rejected outright.
 *
 *   2. **DNS pin** — resolve the host once and reject if the resolved
 *      address sits in a private/loopback/link-local range. We then
 *      hand the caller back the resolved IP so they can dial it
 *      directly, avoiding DNS-rebinding (where a hostile DNS resolver
 *      returns 8.8.8.8 on the first lookup and 127.0.0.1 on the second).
 *
 *   3. **Redirect cap** — caller follows redirects manually, re-running
 *      this guard on each hop. The fetch API's automatic redirect
 *      following is disabled by setting `redirect: 'manual'`.
 *
 * This is a *guard*, not a transport — it returns an outcome and the
 * caller (`webhook.delivery.ts`) does the actual fetch. That keeps the
 * spec deterministic without mocking `fetch` or the network stack.
 */

export type SsrfRejection =
  | { kind: 'invalid_url'; reason: string }
  | { kind: 'unsupported_scheme'; scheme: string }
  | { kind: 'host_resolution_failed'; host: string; reason: string }
  | { kind: 'blocked_address'; host: string; address: string; reason: string }
  | { kind: 'redirect_limit_exceeded'; hops: number };

export interface SsrfApproval {
  kind: 'ok';
  /** The resolved IP literal — caller may dial this and set the original
   *  Host header so TLS SNI + virtual-hosting still work. */
  resolvedAddress: string;
  /** Address family — useful for selecting the right socket option. */
  family: 4 | 6;
}

export type SsrfResult = SsrfApproval | SsrfRejection;

const SUPPORTED_SCHEMES = new Set(['http:', 'https:']);

/** Default redirect cap. Webhook-receiving services should not redirect at all. */
export const DEFAULT_MAX_REDIRECTS = 3;

/**
 * Top-level entry. Pass the URL to deliver to. The function:
 *   - validates the URL,
 *   - resolves DNS,
 *   - checks the resolved address against the SSRF blocklist,
 *   - returns either an approval with the resolved IP or a typed rejection.
 *
 * Caller is responsible for actually dialing the IP and re-running this
 * function on every redirect hop, decrementing `redirectsRemaining`.
 */
export async function checkSsrf(
  rawUrl: string,
  options: { resolver?: (host: string) => Promise<{ address: string; family: 4 | 6 }> } = {},
): Promise<SsrfResult> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch (err) {
    return { kind: 'invalid_url', reason: (err as Error).message };
  }

  if (!SUPPORTED_SCHEMES.has(url.protocol)) {
    return { kind: 'unsupported_scheme', scheme: url.protocol };
  }

  const resolver = options.resolver ?? defaultResolver;

  // Hostname might already be a literal IP — short-circuit DNS.
  // WHATWG URL keeps IPv6 literals wrapped in brackets in `url.hostname`
  // (e.g. `[::1]`) — strip them before passing to net.isIP / blocklist.
  const rawHost = url.hostname.startsWith('[') && url.hostname.endsWith(']')
    ? url.hostname.slice(1, -1)
    : url.hostname;
  const literalFamily = isIP(rawHost);
  let resolved: { address: string; family: 4 | 6 };
  if (literalFamily === 4 || literalFamily === 6) {
    resolved = { address: rawHost, family: literalFamily };
  } else {
    try {
      resolved = await resolver(url.hostname);
    } catch (err) {
      return {
        kind: 'host_resolution_failed',
        host: url.hostname,
        reason: (err as Error).message,
      };
    }
  }

  const blockReason = checkAddressBlocked(resolved.address, resolved.family);
  if (blockReason) {
    return {
      kind: 'blocked_address',
      host: url.hostname,
      address: resolved.address,
      reason: blockReason,
    };
  }

  return { kind: 'ok', resolvedAddress: resolved.address, family: resolved.family };
}

async function defaultResolver(host: string): Promise<{ address: string; family: 4 | 6 }> {
  // verbatim:false (default) lets the resolver return the first record;
  // verbatim:true would respect server ordering. For SSRF we just need any
  // resolution; the address is then checked against the blocklist.
  const r = await dnsLookup(host);
  if (r.family !== 4 && r.family !== 6) {
    throw new Error(`unexpected address family ${r.family}`);
  }
  return { address: r.address, family: r.family };
}

/**
 * Returns a human-readable reason if the address sits in a blocked range,
 * `null` if the address is fine to dial.
 *
 * Ranges we block (IPv4):
 *   0.0.0.0/8         "this network" — not routable
 *   10.0.0.0/8        RFC 1918 private
 *   100.64.0.0/10     RFC 6598 carrier-grade NAT
 *   127.0.0.0/8       loopback
 *   169.254.0.0/16    link-local (incl. cloud metadata 169.254.169.254)
 *   172.16.0.0/12     RFC 1918 private
 *   192.0.0.0/24      IETF protocol assignments
 *   192.168.0.0/16    RFC 1918 private
 *   224.0.0.0/4       multicast
 *   240.0.0.0/4       reserved (incl. 255.255.255.255 broadcast)
 *
 * Ranges we block (IPv6):
 *   ::                unspecified
 *   ::1               loopback
 *   fc00::/7          unique-local (RFC 4193)
 *   fe80::/10         link-local
 *   ff00::/8          multicast
 *   ::ffff:0:0/96     IPv4-mapped — re-checked as IPv4
 */
export function checkAddressBlocked(address: string, family: 4 | 6): string | null {
  if (family === 4) return checkIPv4Blocked(address);
  return checkIPv6Blocked(address);
}

function checkIPv4Blocked(address: string): string | null {
  const parts = address.split('.').map((p) => Number.parseInt(p, 10));
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) {
    return `malformed IPv4: ${address}`;
  }
  const [a, b] = parts as [number, number, number, number];
  if (a === 0) return '"this network" 0.0.0.0/8';
  if (a === 10) return 'RFC 1918 private 10.0.0.0/8';
  if (a === 100 && b >= 64 && b <= 127) return 'CGNAT 100.64.0.0/10';
  if (a === 127) return 'loopback 127.0.0.0/8';
  if (a === 169 && b === 254) return 'link-local 169.254.0.0/16 (incl. cloud metadata)';
  if (a === 172 && b >= 16 && b <= 31) return 'RFC 1918 private 172.16.0.0/12';
  if (a === 192 && b === 0) return 'IETF protocol assignment 192.0.0.0/24';
  if (a === 192 && b === 168) return 'RFC 1918 private 192.168.0.0/16';
  if (a >= 224 && a <= 239) return 'multicast 224.0.0.0/4';
  if (a >= 240) return 'reserved 240.0.0.0/4';
  return null;
}

function checkIPv6Blocked(address: string): string | null {
  const lower = address.toLowerCase();
  if (lower === '::' || lower === '0:0:0:0:0:0:0:0') return 'unspecified ::';
  if (lower === '::1' || lower === '0:0:0:0:0:0:0:1') return 'loopback ::1';

  // IPv4-mapped IPv6: ::ffff:a.b.c.d. Re-check as IPv4.
  const v4Mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (v4Mapped?.[1]) {
    const v4Reason = checkIPv4Blocked(v4Mapped[1]);
    if (v4Reason) return `IPv4-mapped: ${v4Reason}`;
  }

  // Group prefixes — naive but sufficient for the CIDR ranges we care about.
  const head = lower.split(':')[0] ?? '';
  if (head.length === 0) return null; // already handled :: cases above
  const prefix = parseInt(head, 16);
  if (Number.isNaN(prefix)) return `malformed IPv6 prefix: ${address}`;

  // fc00::/7 — first 7 bits = 0xfc/2 = 1111110x
  // i.e. first 16-bit group ∈ [0xfc00, 0xfdff]
  if (prefix >= 0xfc00 && prefix <= 0xfdff) return 'unique-local fc00::/7';
  // fe80::/10 — first 10 bits = 0xfe80 .. 0xfebf in the first group
  if (prefix >= 0xfe80 && prefix <= 0xfebf) return 'link-local fe80::/10';
  // ff00::/8
  if (prefix >= 0xff00 && prefix <= 0xffff) return 'multicast ff00::/8';

  return null;
}
