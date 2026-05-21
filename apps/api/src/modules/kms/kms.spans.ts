// Manual OTel span wrapper for KMS adapter operations.
//
// Each adapter's `sign` / `getActiveKey` callback wraps its KMS round-trip
// in a span named `aegis.kms.<provider>.<op>`. Latency, error rate, and
// `kid` distribution are queryable per-provider in the trace store.
//
// Why a sibling helper rather than calling `withSpan` directly: the
// attribute set (`kms.provider`, `kms.op`, `kid`, `kms.purpose`) is a
// uniform shape across providers, so this helper is the source of truth
// for the convention.
//
// SECURITY (CLAUDE.md invariant + spans.ts): never tag a KMS span with
// the message bytes, the wrapped key, or any signature output. Only kid +
// purpose + provider + op.

import type { KmsKeyPurpose } from '../../common/crypto/crypto.bootstrap';
import { withSpan } from '../../common/observability/spans';

export type KmsProvider = 'aws-kms' | 'gcp-kms' | 'vault-transit' | 'in-memory';
export type KmsOp = 'sign' | 'getActiveKey' | 'getKeyByKid' | 'init' | 'decrypt';

export async function withKmsSpan<T>(
  provider: KmsProvider,
  op: KmsOp,
  kid: string | undefined,
  purpose: KmsKeyPurpose | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  return await withSpan(`aegis.kms.${provider}.${op}`, fn, {
    'kms.provider': provider,
    'kms.op': op,
    kid,
    'kms.purpose': purpose,
  });
}
