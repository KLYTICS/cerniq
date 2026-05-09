// Public types for @aegis/audit-evidence-bundle.
//
// The bundle manifest is part of the auditor wire contract — adding fields
// is non-breaking, but renames or removals require a major version bump
// because external auditors will pin to a specific spec_version as part of
// their work-paper trail.

export const BUNDLE_SPEC_VERSION = '1.0.0' as const;
export const TOOL_VERSION = '0.1.0' as const;

export interface BundleCliOptions {
  principalId: string;
  agentId?: string | undefined;
  from: string;
  to: string;
  output: string;
  apiBase: string;
  apiKey: string;
  verifyOnly: boolean;
  includeReadme: boolean;
}

export interface FetchedArtifacts {
  /** Local on-disk path to the streamed NDJSON file. Streamed to disk so the
   *  CLI handles 100k+ event exports in constant memory. */
  ndjsonPath: string;
  /** Number of NDJSON rows actually read off the wire. */
  ndjsonRowCount: number;
  /** Number of rows whose `payload.actionHash === null` (Art. 17 redactions).
   *  Counted while streaming so we don't re-read the file. */
  redactedRowCount: number;
  /** SHA256 of the NDJSON file in lowercase hex, computed in-stream. */
  ndjsonSha256: string;
  jwks: unknown;
  aegisConfiguration: unknown;
  /** Lane B will publish /.well-known/retention-policy.json. Until then,
   *  the bundle records `null` and the manifest notes the gap. */
  retentionPolicy: unknown | null;
  retentionPolicyAvailable: boolean;
  securityTxt: string;
}

export interface ChainVerificationFileShape {
  status: 'pass' | 'fail' | 'skipped';
  totalRows: number;
  signingKeys: string[];
  rotationEvents: Array<{
    atIndex: number;
    fromKid: string;
    toKid: string;
  }>;
  firstFailureAt: string | null;
  firstFailureReason: string | null;
  durationMs: number;
  verifierPackage: string;
  verifierVersion: string;
}

export interface BundleManifest {
  spec_version: typeof BUNDLE_SPEC_VERSION;
  generated_at: string;
  principal_id: string;
  agent_id: string | null;
  time_range: {
    from: string;
    to: string;
  };
  counts: {
    audit_events: number;
    redacted_events: number;
  };
  api_base: string;
  tool_version: typeof TOOL_VERSION;
  verification: {
    status: 'pass' | 'fail' | 'skipped';
    first_failure_at: string | null;
  };
  artifacts: {
    /** Lane B status — `false` means the well-known endpoint returned 404
     *  and `retention-policy.json` is omitted from the bundle. */
    retention_policy_included: boolean;
  };
}

export interface BundleEntry {
  /** Path inside the tarball, relative to the bundle root directory. */
  path: string;
  /** Either inline bytes OR a path to a file on disk to stream-copy. */
  source: { kind: 'bytes'; data: Uint8Array } | { kind: 'file'; absPath: string; size: number };
  /** SHA256 in lowercase hex. Required — populated either at fetch time
   *  (streaming) or computed at bundle time for in-memory entries. */
  sha256: string;
}
