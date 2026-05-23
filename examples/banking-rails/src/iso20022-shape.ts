// ISO 20022 / programmable-banking action shape — the merchant-side
// model that bank rails (Modern Treasury, Increase, Mercury,
// Goldman TxB, JPM Chase Connect) all converge on.
//
// We do NOT generate the actual ISO 20022 XML here — that's the bank
// transport's job. We model the canonical action shape an agent would
// authorize and CERNIQ would gate. The bank-side adapter (out of scope
// for this example) translates these to pacs.008 / pain.001 / etc.
//
// Why a unified shape across rails: ACH, wire, RTP, FedNow, and SEPA
// all carry roughly the same fields at the action level — debtor,
// creditor, amount, currency, value-date, end-to-end id. The
// rail-specific differences (cutoff times, settlement windows,
// reversal semantics) are properties of the rail, not the action.
// The agent authorizes the action; the bank routes it.

export type RailType =
  | 'ach'
  | 'wire'
  | 'rtp'
  | 'fednow'
  | 'sepa-ct'
  | 'sepa-instant'
  | 'book-transfer';

export type Iso4217Currency = 'USD' | 'EUR' | 'GBP' | 'JPY' | 'CAD' | 'AUD' | 'BRL' | 'CHF' | 'MXN';

/** Routing identifier for a counterparty account. We model the shape
 *  rather than the rail-specific format — the bank-side adapter
 *  reshapes this to pacs.008 BIC + IBAN, ABA + DDA, etc. */
export interface AccountIdentifier {
  /** ISO 9362 BIC (8 or 11 chars), or domestic routing number, etc.
   *  The discriminator below tells the bank-adapter which it is. */
  identifier: string;
  /** Account number / IBAN. Required for non-book transfers. */
  accountNumber?: string;
  /** Identifier kind. The string set is open by intent — extensions
   *  like `colombia-cc`, `india-vpa` are valid for emerging-market
   *  rails. */
  kind:
    | 'bic'
    | 'aba'
    | 'iban'
    | 'sort-code-account'
    | 'pix-key'
    | 'rtp-tn'
    | 'book-transfer-id'
    | string;
}

/** A programmable-banking action. CERNIQ gates "is the agent authorized
 *  to move money on behalf of this principal under this scope?".
 *  The bank-adapter answers "can the bank actually deliver this?". */
export interface PaymentInstruction {
  /** End-to-end id (E2EID) — propagated to the rail message and back
   *  on the camt.054 settlement notification. We use CERNIQ jti for
   *  same reasons as the ACP example: single unique key end-to-end. */
  endToEndId: string;
  /** Which rail to use. The rail can be selected by the merchant or
   *  by the bank-adapter based on cutoffs / cost. CERNIQ's policy may
   *  also restrict rails (e.g. no wires from CUSTOMER_SUPPORT scope). */
  rail: RailType;
  /** Debtor — the principal's account being debited. */
  debtor: AccountIdentifier;
  /** Creditor — the counterparty being credited. */
  creditor: AccountIdentifier;
  /** Amount in smallest currency unit (cents for USD, hundredths-of-pence
   *  for GBP). Bank rails are integer-cents under the hood. */
  amount: number;
  currency: Iso4217Currency;
  /** Requested value date (settlement date). Same-day for RTP/FedNow,
   *  T+1 standard for ACH, T+0 for wire. */
  valueDate: string;
  /** Free-text remittance information (the "memo" field). Capped at
   *  140 chars on most rails (RTP allows 4 KB structured). */
  remittanceInfo?: string;
}

/** Verdict shape returned by the bank adapter when actually
 *  submitting the instruction to the rail. The full lifecycle is
 *  longer (pacs.002 ack, camt.054 settlement); this models the
 *  initial accept/reject the merchant sees synchronously. */
export interface BankSubmitVerdict {
  accepted: boolean;
  /** Bank-side identifier for the payment. Different field per rail
   *  (UETR for wires, trace number for ACH, etc.). */
  bankId?: string;
  /** When rejected: rail-specific reason code. */
  rejectionCode?: string;
  /** When rejected: human-readable description. */
  rejectionReason?: string;
}

/** Result the merchant API returns to the agent. */
export interface InstructResponse {
  allowed: boolean;
  endToEndId: string;
  /** CERNIQ audit event id — lets a regulator independently verify
   *  the agent-leg of the audit trail. */
  auditEventId?: string;
  /** Bank id when accepted. */
  bankId?: string;
  /** When denied at CERNIQ: which reason. */
  cerniqDenialReason?: string;
  /** When denied at bank: rail rejection code. */
  bankRejectionCode?: string;
}
