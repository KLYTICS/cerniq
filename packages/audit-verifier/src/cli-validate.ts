// Manifest input-shape validation for the audit-verifier CLI.
//
// Why this is a sibling file (and not inlined in cli.ts):
//   - cli.ts has a top-level `main()` invocation and a process.exit
//     wired into its `fail()` helper. Unit-testing the validator from
//     cli.ts would require either importing it (and running main()) or
//     spawning a subprocess. Both are unnecessary friction.
//   - The validator runs against attacker-controlled input (a manifest
//     file from disk). Per CLAUDE.md invariant #4 ("no silent failures")
//     and the packages-level rule "Errors are typed and cataloged",
//     validation failures should be a typed error class, not raw strings.
//
// Threat model:
//   `validateSignedManifest` runs BEFORE signature verification. Anything
//   that gets past this function is then passed to `verifyManifest`,
//   which catches tampered fields via the Ed25519 signature. The job of
//   this validator is therefore narrow: prevent the verifier from
//   crashing on malformed input, and prevent attacker-controlled bytes
//   in identifier fields from reaching the terminal printer (where
//   ANSI escapes would otherwise inject color/cursor sequences).

import type { SignedAuditCompressionManifest } from './manifest.js';

/**
 * Safe-identifier charset for manifest body identifier fields
 * (`manifestId`, `tenantSliceId`, `signingKeyId`).
 *
 * Permits: ASCII alphanumerics, dot, underscore, colon, hyphen.
 * Rejects: control chars (incl. ANSI `\x1b`), whitespace, shell
 * metacharacters, non-ASCII codepoints.
 *
 * Capped at 128 chars — enough for tenant slice IDs of the form
 * `tenant-<ulid>:bucket-<int>` (~50 chars) with headroom, but bounded
 * so a malicious manifest cannot dump a megabyte into the terminal.
 *
 * If the production kid format ever grows beyond this (e.g. base64url
 * with `=` padding), widen this regex AND update the JWKS validator at
 * the same time so the contract stays symmetric.
 */
export const SAFE_MANIFEST_IDENTIFIER = /^[A-Za-z0-9._:-]{1,128}$/;

/** Identifier fields on the manifest body that get printed verbatim by
 *  the CLI's report formatter — must pass `SAFE_MANIFEST_IDENTIFIER`. */
const IDENTIFIER_FIELDS = ['manifestId', 'tenantSliceId', 'signingKeyId'] as const;

/** Numeric fields the corpus verifier touches before signature check. */
const NUMERIC_FIELDS = ['firstSeq', 'lastSeq', 'rowCount'] as const;

/**
 * Typed error for manifest input-shape failures.
 *
 * The CLI translates this to a `fail(msg, 2)` (exit code 2 = argument /
 * IO error). Library consumers can catch it and surface the structured
 * `source`/`field`/`reason` instead of parsing a string.
 */
export class ManifestValidationError extends Error {
  override readonly name = 'ManifestValidationError';
  constructor(
    public readonly source: string,
    public readonly field: string,
    public readonly reason: string,
  ) {
    super(`${source}: ${field} ${reason}`);
  }
}

/**
 * Shape-validate a parsed JSON value as a `SignedAuditCompressionManifest`.
 *
 * Narrow but defensive: rejects only the failure modes that would
 * either crash the verifier or pollute terminal output. Full semantic
 * validation happens implicitly when `verifyManifest` checks the
 * Ed25519 signature — a tampered body field surfaces there as
 * `invalid_signature`, not as a crash.
 *
 * @throws {ManifestValidationError} on any shape mismatch.
 */
export function validateSignedManifest(
  value: unknown,
  source: string,
): SignedAuditCompressionManifest {
  if (!value || typeof value !== 'object') {
    throw new ManifestValidationError(source, '<root>', 'top-level must be a JSON object');
  }
  const v = value as Record<string, unknown>;

  if (!v.body || typeof v.body !== 'object') {
    throw new ManifestValidationError(source, 'body', 'missing or invalid');
  }
  if (typeof v.signatureB64Url !== 'string' || v.signatureB64Url.length === 0) {
    throw new ManifestValidationError(source, 'signatureB64Url', 'missing or invalid');
  }
  if (v.signatureAlg !== 'ed25519') {
    throw new ManifestValidationError(
      source,
      'signatureAlg',
      `must be "ed25519", got ${JSON.stringify(v.signatureAlg)}`,
    );
  }

  const body = v.body as Record<string, unknown>;

  for (const k of IDENTIFIER_FIELDS) {
    const raw = body[k];
    if (typeof raw !== 'string' || raw.length === 0) {
      throw new ManifestValidationError(source, `body.${k}`, 'missing or invalid');
    }
    if (!SAFE_MANIFEST_IDENTIFIER.test(raw)) {
      // We deliberately do NOT include the offending value in the error
      // message — it may contain ANSI escapes or other control bytes
      // and we are not going to give them a free trip through stderr.
      throw new ManifestValidationError(
        source,
        `body.${k}`,
        `contains disallowed characters (must match ${SAFE_MANIFEST_IDENTIFIER.source})`,
      );
    }
  }

  for (const k of NUMERIC_FIELDS) {
    const raw = body[k];
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
      throw new ManifestValidationError(source, `body.${k}`, 'missing or not finite number');
    }
  }

  return value as SignedAuditCompressionManifest;
}
