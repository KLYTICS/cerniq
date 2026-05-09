// Reconciliation engine — joins AEGIS audit events to a downstream
// system's records on the shared `endToEndId` (a.k.a. AEGIS jti,
// a.k.a. Stripe idempotency-key, a.k.a. ISO 20022 EndToEndId).
//
// The four mismatch classes from docs/INTEGRATION_PATTERNS.md §10:
//
//   matched_settled    — AEGIS approved + system has a settled record
//                        (the happy path; the bulk of the report)
//   approved_missing   — AEGIS approved but the system has NO record
//                        of the action (network drop between gates;
//                        always investigate)
//   denied_present     — AEGIS denied but the system has a record
//                        anyway (bug in the merchant glue OR an
//                        attacker bypassing the AEGIS gate; always
//                        investigate)
//   reversed           — AEGIS approved + system settled + system
//                        later reversed (chargeback / R-code / refund;
//                        feeds back into BATE as fraud_confirmed or
//                        false_positive depending on the reversal cause)
//
// The engine is pure — takes the two streams, returns a structured
// report. No I/O, no side-effects, no time-of-day dependency.

export interface AegisAuditRow {
  /** Shared key — the AEGIS jti / endToEndId / idempotency-key. */
  endToEndId: string;
  eventId: string;
  decision: 'APPROVED' | 'DENIED' | 'FLAGGED';
  denialReason: string | null;
  agentId: string;
  principalId: string;
  timestamp: string;
}

export interface UnderlyingSystemRow {
  /** The same shared key as the AEGIS row. */
  endToEndId: string;
  /** System-side identifier (Stripe ch_xxx, bank trace number, etc.). */
  systemId: string;
  status: 'pending' | 'settled' | 'reversed' | 'failed';
  amount: number;
  currency: string;
  /** When `status='reversed'`: optional reversal cause (chargeback / R-code / refund / unknown). */
  reversalCause?: 'chargeback' | 'r03' | 'r05' | 'refund' | 'unknown';
  timestamp: string;
}

export type MismatchClass =
  | 'matched_settled'
  | 'approved_missing'
  | 'denied_present'
  | 'reversed';

export interface ReconcileEntry {
  endToEndId: string;
  class: MismatchClass;
  aegis: AegisAuditRow | null;
  system: UnderlyingSystemRow | null;
  /** When class='reversed', whether to fire fraud_confirmed (chargeback/r03/r05)
   *  or false_positive (refund) feedback. */
  bateFeedback?: 'fraud_confirmed' | 'false_positive';
}

export interface ReconcileReport {
  totalAegisRows: number;
  totalSystemRows: number;
  matchedSettled: number;
  approvedMissing: number;
  deniedPresent: number;
  reversed: number;
  /** Per-row detail, in the order matched_settled → approved_missing →
   *  denied_present → reversed. */
  entries: ReconcileEntry[];
  /** Sum of system-side `amount` across `matched_settled` rows.
   *  Useful as a sanity check vs. settlement totals reported by the
   *  underlying system. Currency-grouped because mixed-currency
   *  totals are meaningless. */
  matchedTotalsByCurrency: Record<string, number>;
}

export interface ReconcileOptions {
  /** When true, include matched-settled entries in `entries[]`. Default
   *  false — only mismatches are surfaced for incident triage to keep
   *  the output small. Set true for full audit-grade reports. */
  includeMatched?: boolean;
}

/** Reconcile two streams. Both arrays are walked once each; runtime
 *  is O(N+M) using a Map for the AEGIS-side index. */
export function reconcile(
  aegis: AegisAuditRow[],
  system: UnderlyingSystemRow[],
  opts: ReconcileOptions = {},
): ReconcileReport {
  const includeMatched = opts.includeMatched ?? false;
  const aegisById = new Map<string, AegisAuditRow>();
  for (const row of aegis) {
    if (aegisById.has(row.endToEndId)) {
      // Duplicate AEGIS rows for the same endToEndId would mean a replay
      // got past the gate; treat the second as `denied_present` later.
      // Keep the first APPROVED/FLAGGED if any; otherwise keep first.
      const existing = aegisById.get(row.endToEndId)!;
      if (existing.decision === 'DENIED' && row.decision !== 'DENIED') {
        aegisById.set(row.endToEndId, row);
      }
    } else {
      aegisById.set(row.endToEndId, row);
    }
  }

  const matchedSettledEntries: ReconcileEntry[] = [];
  const approvedMissingEntries: ReconcileEntry[] = [];
  const deniedPresentEntries: ReconcileEntry[] = [];
  const reversedEntries: ReconcileEntry[] = [];
  const matchedTotalsByCurrency: Record<string, number> = {};
  let matchedSettledCount = 0;

  const seenSystem = new Set<string>();
  for (const sysRow of system) {
    seenSystem.add(sysRow.endToEndId);
    const aegisRow = aegisById.get(sysRow.endToEndId) ?? null;

    // System has a record but AEGIS has none — definite bypass; treat
    // as denied_present with aegis=null so it surfaces in the report.
    if (!aegisRow) {
      deniedPresentEntries.push({
        endToEndId: sysRow.endToEndId,
        class: 'denied_present',
        aegis: null,
        system: sysRow,
      });
      continue;
    }

    if (aegisRow.decision === 'DENIED') {
      // AEGIS said no, system charged anyway.
      deniedPresentEntries.push({
        endToEndId: sysRow.endToEndId,
        class: 'denied_present',
        aegis: aegisRow,
        system: sysRow,
      });
      continue;
    }

    if (sysRow.status === 'reversed') {
      reversedEntries.push({
        endToEndId: sysRow.endToEndId,
        class: 'reversed',
        aegis: aegisRow,
        system: sysRow,
        bateFeedback: classifyReversal(sysRow.reversalCause),
      });
      continue;
    }

    if (sysRow.status === 'settled') {
      matchedSettledCount++;
      matchedTotalsByCurrency[sysRow.currency] =
        (matchedTotalsByCurrency[sysRow.currency] ?? 0) + sysRow.amount;
      if (includeMatched) {
        matchedSettledEntries.push({
          endToEndId: sysRow.endToEndId,
          class: 'matched_settled',
          aegis: aegisRow,
          system: sysRow,
        });
      }
    }
    // pending / failed system rows aren't reconciliation issues — pending
    // resolves on the next run, failed didn't move money. Counted in
    // totalSystemRows but not flagged.
  }

  // Approved-missing: AEGIS approved but system never reported it.
  for (const aegisRow of aegis) {
    if (aegisRow.decision === 'DENIED') continue;
    if (seenSystem.has(aegisRow.endToEndId)) continue;
    approvedMissingEntries.push({
      endToEndId: aegisRow.endToEndId,
      class: 'approved_missing',
      aegis: aegisRow,
      system: null,
    });
  }

  return {
    totalAegisRows: aegis.length,
    totalSystemRows: system.length,
    matchedSettled: matchedSettledCount,
    approvedMissing: approvedMissingEntries.length,
    deniedPresent: deniedPresentEntries.length,
    reversed: reversedEntries.length,
    entries: [
      ...matchedSettledEntries,
      ...approvedMissingEntries,
      ...deniedPresentEntries,
      ...reversedEntries,
    ],
    matchedTotalsByCurrency,
  };
}

function classifyReversal(cause: UnderlyingSystemRow['reversalCause']): 'fraud_confirmed' | 'false_positive' {
  // Chargebacks, NACHA R03 (no account/unable to locate) and R05
  // (unauthorized debit) all signal the agent shouldn't have moved the
  // money. Refunds are merchant-initiated reversals — usually a UX
  // outcome, not a fraud signal — so we treat them as false_positive.
  // 'unknown' defaults to false_positive (the conservative direction).
  switch (cause) {
    case 'chargeback':
    case 'r03':
    case 'r05':
      return 'fraud_confirmed';
    case 'refund':
    case 'unknown':
    case undefined:
      return 'false_positive';
  }
}

/** Parse NDJSON into rows. Permissive — drops blank lines, throws with
 *  line number on malformed JSON. */
export function parseAegisNdjson(ndjson: string): AegisAuditRow[] {
  return parseNdjson<AegisAuditRow>(ndjson, 'aegis');
}

export function parseSystemNdjson(ndjson: string): UnderlyingSystemRow[] {
  return parseNdjson<UnderlyingSystemRow>(ndjson, 'system');
}

function parseNdjson<T>(ndjson: string, label: string): T[] {
  const out: T[] = [];
  let lineNo = 0;
  for (const line of ndjson.split('\n')) {
    lineNo++;
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    try {
      out.push(JSON.parse(trimmed) as T);
    } catch (err) {
      throw new Error(`reconcile: ${label} NDJSON line ${lineNo} invalid — ${(err as Error).message}`);
    }
  }
  return out;
}
