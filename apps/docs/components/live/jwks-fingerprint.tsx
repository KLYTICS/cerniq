import 'server-only';
import { createHash } from 'node:crypto';

// RFC 7638 JWK Thumbprint computation. For OKP/EdDSA keys, the required
// members in lexicographic order are: crv, kty, x. SHA-256 the canonical
// JSON encoding, then hex-encode for display (with colon separators, like
// SSH key fingerprints).
//
// This component renders the live thumbprints of every key currently
// published at /.well-known/audit-signing-key, so an external auditor can
// compare them against the fingerprint in their evidence package without
// downloading the JWKS themselves.

interface Jwk {
  kid: string;
  kty: string;
  crv?: string;
  x?: string;
  use?: string;
  alg?: string;
}

interface Jwks { keys: Jwk[] }

type FetchResult =
  | { source: 'api'; jwks: Jwks; fetchedAt: string }
  | { source: 'fallback'; reason: string };

function rfc7638Thumbprint(jwk: Jwk): string | null {
  if (jwk.kty !== 'OKP' || !jwk.crv || !jwk.x) return null;
  // Canonical JSON: members in lexicographic order, no whitespace.
  const canonical = JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x });
  return createHash('sha256').update(canonical).digest('hex');
}

function colonHex(hex: string): string {
  return (hex.match(/.{2}/g) ?? []).join(':');
}

async function fetchJwks(): Promise<FetchResult> {
  const base = process.env.OKORO_API_BASE_URL;
  if (!base) return { source: 'fallback', reason: 'OKORO_API_BASE_URL unset' };
  try {
    const res = await fetch(
      `${base.replace(/\/$/, '')}/.well-known/audit-signing-key`,
      { next: { revalidate: 3600 } },
    );
    if (!res.ok) return { source: 'fallback', reason: `HTTP ${res.status}` };
    const jwks = (await res.json()) as Jwks;
    if (!Array.isArray(jwks?.keys) || jwks.keys.length === 0) {
      return { source: 'fallback', reason: 'JWKS missing keys[]' };
    }
    return { source: 'api', jwks, fetchedAt: new Date().toISOString() };
  } catch (err) {
    return {
      source: 'fallback',
      reason: err instanceof Error ? err.message : 'fetch error',
    };
  }
}

export async function JwksFingerprint() {
  const result = await fetchJwks();
  const rows =
    result.source === 'api'
      ? result.jwks.keys.map((k) => ({
          kid: k.kid,
          use: k.use ?? 'sig',
          alg: k.alg ?? (k.crv === 'Ed25519' ? 'EdDSA' : k.crv ?? 'unknown'),
          thumbprint: rfc7638Thumbprint(k),
        }))
      : [];

  return (
    <div
      className="my-6 overflow-hidden rounded-lg border border-[var(--okoro-mist)] bg-[var(--okoro-ink)]"
      data-source={result.source}
      data-testid="jwks-fingerprint"
    >
      <div className="flex items-center justify-between border-b border-[var(--okoro-mist)] bg-[var(--okoro-steel)] px-4 py-3">
        <p className="text-xs uppercase tracking-wider text-[var(--okoro-fog)]">
          Audit signing keys · RFC 7638 thumbprints (SHA-256)
        </p>
        {result.source === 'api' ? (
          <span className="font-mono text-xs text-[var(--okoro-verified)]">
            live · {rows.length} {rows.length === 1 ? 'key' : 'keys'}
          </span>
        ) : (
          <span className="font-mono text-xs text-[var(--okoro-pending)]">
            fallback
          </span>
        )}
      </div>
      {result.source === 'fallback' ? (
        <div className="px-4 py-4 text-sm text-[var(--okoro-shadow)]">
          Unable to fetch the live JWKS ({result.reason}). When this site is
          deployed with <code className="font-mono">OKORO_API_BASE_URL</code>{' '}
          set, the live signing-key thumbprints render here so auditors can
          verify they match the fingerprint in their SOC2 evidence package
          without trusting OKORO infrastructure.
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-xs uppercase tracking-wider text-[var(--okoro-fog)]">
            <tr>
              <th className="px-4 py-3 text-left">kid</th>
              <th className="px-4 py-3 text-left">use</th>
              <th className="px-4 py-3 text-left">alg</th>
              <th className="px-4 py-3 text-left">
                SHA-256 thumbprint (RFC 7638)
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.kid} className="border-t border-[var(--okoro-mist)]">
                <td className="px-4 py-3 font-mono text-[var(--okoro-cyan)]">
                  {r.kid}
                </td>
                <td className="px-4 py-3 font-mono text-[var(--okoro-fog)]">
                  {r.use}
                </td>
                <td className="px-4 py-3 font-mono text-[var(--okoro-fog)]">
                  {r.alg}
                </td>
                <td className="px-4 py-3 font-mono text-xs leading-snug text-[var(--okoro-halo)] break-all">
                  {r.thumbprint
                    ? colonHex(r.thumbprint)
                    : '—  (non-OKP key, thumbprint format differs per kty)'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="border-t border-[var(--okoro-mist)] bg-[var(--okoro-graphite)] px-4 py-2 text-xs text-[var(--okoro-shadow)]">
        Live source:{' '}
        <code className="font-mono">/.well-known/audit-signing-key</code>{' '}
        · algorithm:{' '}
        <code className="font-mono">SHA-256(canonical_JSON(crv, kty, x))</code>{' '}
        per RFC 7638
      </div>
    </div>
  );
}
