// Compliance DTOs — GDPR Art. 17 right-to-erasure on the audit chain.
//
// Per ADR-0006 (audit redactability), redaction nulls the *raw* columns
// while leaving `*Hash` columns and `cerniqSignature` intact. A redacted
// event still verifies cryptographically — the verifier hashes the null
// raw values to the same `null` and compares to the persisted hash. The
// signature commits to hashes, not to the raw plaintext, so erasure is
// non-destructive for chain integrity.

export type AuditRedactableField =
  | 'action'
  | 'relyingParty'
  | 'requestedAmount'
  | 'currency'
  | 'policyId'
  | 'policySnapshot';

export interface RedactAuditEventDto {
  /** ULID/cuid of the audit event being redacted. */
  eventId: string;
  /** Free-form reason. Required — appears in the redaction meta-event. */
  reason: string;
  /**
   * Which fields to null out. Default: all redactable fields. The audit
   * primary key, decision, denialReason, agentId reference, principalId,
   * trustScore, trustBand, signature, and timestamp are NEVER nullable
   * (they carry no user PII per ADR-0006).
   */
  fields?: AuditRedactableField[];
  /**
   * Optional GDPR data-subject reference. Recorded on the redaction
   * meta-event for downstream legal-discovery queries. Free-form.
   */
  dataSubjectRef?: string;
}

export interface RedactAuditEventResultDto {
  eventId: string;
  redactedFields: AuditRedactableField[];
  redactedAt: string;
  /** Id of the redaction meta-event written to the audit chain. */
  metaEventId: string;
}

export interface RedactAuditByAgentDto {
  /** Redact every event referencing this agent. Use case: GDPR account-delete. */
  agentId: string;
  reason: string;
  fields?: AuditRedactableField[];
  dataSubjectRef?: string;
}

export interface RedactAuditByAgentResultDto {
  agentId: string;
  eventsRedacted: number;
  metaEventId: string;
}
