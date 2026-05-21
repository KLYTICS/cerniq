import { client } from '../client.js';
import { emitTable, ok, info, warn } from '../output.js';

/**
 * `aegis kms list <purpose>` — shows the JWKS for a signing purpose.
 * `aegis kms rotate <purpose>` — provider-side; the CLI initiates a
 *   rotation request that the operator must confirm in the cloud KMS
 *   console (we do NOT auto-rotate cloud KMS keys from the CLI).
 *
 * Per ADR-0011 §5, rotation cadence:
 *   - AUDIT key: every 12 months
 *   - JWT key:   every 6 months
 *   - on suspected compromise: immediate
 */
export async function kmsList(opts: { purpose?: string }): Promise<void> {
  const aegis = await client();
  const purposeQs = opts.purpose ? `?purpose=${opts.purpose}` : '';
  // @ts-expect-error - http accessor
  const jwks = (await aegis.http.get(`/v1/.well-known/audit-signing-key${purposeQs}`)) as {
    keys: Array<{ kid: string; alg: string; use: string; validFrom?: string; validUntil?: string | null }>;
  };
  emitTable(jwks.keys.map((k) => ({
    kid: k.kid,
    alg: k.alg,
    use: k.use,
    validFrom: k.validFrom ?? '',
    validUntil: k.validUntil ?? '(active)',
  })));
}

export async function kmsRotate(purpose: string): Promise<void> {
  warn(`kms rotate is a privileged operation. Confirm via the cloud KMS console.`);
  info(`Steps:`);
  info(`  1. In your cloud KMS console, create a new key version for purpose=${purpose}.`);
  info(`  2. Update AEGIS_${purpose.toUpperCase()}_ACTIVE_KID env to the new kid.`);
  info(`  3. Restart the API. Old kid stays in the verify set until natural expiry.`);
  info(`  4. Run \`aegis audit verify\` once new signed events appear to confirm.`);
  ok('rotation runbook printed.');
}
