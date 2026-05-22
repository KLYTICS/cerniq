// Wraps @okoro/audit-verifier so the CLI can produce `chain-verification.json`
// — a small, auditor-readable summary that saves them the 30 minutes it takes
// to install Node, the verifier, and run a stream walk themselves.
//
// We import the published API (`verifyChain`, `parseAuditNdjson`) verbatim
// rather than reimplementing — every divergence between this file and the
// reference verifier is a SEV-1 risk. If `@okoro/audit-verifier` is not yet
// built (`dist/` missing), we surface that gap explicitly rather than
// silently producing a "skipped" verdict — see CLAUDE.md invariant #4.

import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

import {
  parseAuditNdjson,
  verifyChain,
  type AuditEventRow,
  type ChainReport,
  type JwksDocument,
} from '@okoro/audit-verifier';

import type { ChainVerificationFileShape } from './types.js';

export interface VerifyArgs {
  ndjsonPath: string;
  jwks: unknown;
}

function isJwksDocument(x: unknown): x is JwksDocument {
  if (!x || typeof x !== 'object') return false;
  const keys = (x as { keys?: unknown }).keys;
  return Array.isArray(keys);
}

export async function runChainVerification(
  args: VerifyArgs,
): Promise<ChainVerificationFileShape> {
  if (!isJwksDocument(args.jwks)) {
    throw new Error(
      'verify-chain: JWKS document is missing the `keys` array — cannot verify',
    );
  }

  const text = await readFile(args.ndjsonPath, 'utf8');
  const rows: AuditEventRow[] = parseAuditNdjson(text);

  const t0 = performance.now();
  const report: ChainReport = await verifyChain(rows, {
    jwks: args.jwks,
    failFast: false, // forensic mode: we want a complete verdict
    maxRowDetail: 100,
  });
  const durationMs = performance.now() - t0;

  return {
    status: report.valid ? 'pass' : 'fail',
    totalRows: report.totalRows,
    signingKeys: report.signingKeys,
    rotationEvents: report.rotationEvents.map((r) => ({
      atIndex: r.atIndex,
      fromKid: r.fromKid,
      toKid: r.toKid,
    })),
    firstFailureAt: report.firstBreak ? report.firstBreak.eventId : null,
    firstFailureReason: report.firstBreak?.reason ?? null,
    durationMs: Math.round(durationMs),
    verifierPackage: '@okoro/audit-verifier',
    verifierVersion: '0.1.0',
  };
}

export function buildSkippedVerdict(): ChainVerificationFileShape {
  return {
    status: 'skipped',
    totalRows: 0,
    signingKeys: [],
    rotationEvents: [],
    firstFailureAt: null,
    firstFailureReason: null,
    durationMs: 0,
    verifierPackage: '@okoro/audit-verifier',
    verifierVersion: '0.1.0',
  };
}
