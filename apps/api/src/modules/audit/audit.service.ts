import { Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { Prisma, type AuditDecision, type TrustBand } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AppConfigService } from '../../config/config.service';
import { AuditChainUtil } from '../../common/crypto/audit-chain.util';
import { Ed25519Util, decodeBase64Url, encodeBase64Url } from '../../common/crypto/ed25519.util';
import { withSpan } from '../../common/observability/spans';
import { AuditQueryDto, AuditLogResponseDto } from './audit.dto';
import { computeKid } from '../wellknown/wellknown.service';

export interface AppendAuditInput {
  /**
   * Real Agent FK. Null for verify-denials where the claimed agent doesn't
   * exist (AGENT_NOT_FOUND). Use `claimedAgentId` to record what the
   * caller claimed in either case.
   */
  agentId: string | null;
  /** Agent ID as it appeared in the request — populated even when `agentId` is null. */
  claimedAgentId?: string | null;
  principalId: string;
  action: string;
  decision: AuditDecision;
  denialReason?: string | null;
  relyingParty?: string | null;
  requestedAmount?: number | null;
  currency?: string | null;
  policyId?: string | null;
  policySnapshot?: unknown;
  trustScoreAtEvent: number;
  trustBandAtEvent: TrustBand;
  // ── Enterprise backbone (ADR-0008, ADR-0011, ADR-0012) ──────────────
  /** FK to RelyingParty when this event came through an MCP bridge / API client. */
  relyingPartyId?: string | null;
  /** Which AEGIS audit-signing kid signed this row. Defaults to 'kid-genesis-v1'. */
  signingKeyId?: string | null;
  /** PolicyEngine that produced the decision: 'builtin' | 'cedar' | 'opa'. */
  policyEngineId?: string | null;
  /** Free-form engine metadata audited as `engineMetadata`. NEVER user-facing. */
  engineMetadata?: Record<string, unknown> | null;
}

/**
 * Append-only audit log.
 *
 * CLAUDE.md invariant #3: every write goes through `append()` and forms a
 * hash chain — each event is signed by AEGIS over `prev_hash || canonical(payload)`.
 *
 * Signing primitive: Ed25519 (per CLAUDE.md "one curve, one library").
 * Public key is published at `GET /v1/.well-known/audit-signing-key`.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);
  private auditPrivateKey?: Uint8Array;
  private auditPublicKeyB64?: string;
  /**
   * Kid (first 16 chars of `sha256(rawPublicKey)` base64url) for the
   * env-derived signing key. Computed once at init so every dev-path
   * `append()` stamps the correct kid on the row — matching what JWKS
   * publishes and what offline verifiers will look up.
   *
   * Production (KMS-backed) path reads the kid via `auditSigner.getActiveKid()`
   * instead — this field stays undefined there.
   */
  private envDerivedKid?: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly chain: AuditChainUtil,
    private readonly ed25519: Ed25519Util,
    // M-037: Optional KMS-backed signer. When wired (production), the
    // chain signs through the registered KmsAdapter; the env-derived
    // path below stays as the dev-only fallback. The signer also
    // reports the active `kid` for stamping on each row.
    @Optional()
    private readonly auditSigner?: import('../../common/crypto/audit-signer.service').AuditSignerService,
  ) {}

  async initSigningKey(): Promise<void> {
    const priv = this.config.auditEd25519PrivateB64;
    const pub = this.config.auditEd25519PublicB64;

    if (priv && pub) {
      this.auditPrivateKey = decodeBase64Url(priv);
      this.auditPublicKeyB64 = pub;
      // Stamp the active kid on every row so /.well-known/jwks.json clients
      // can pick the right verifying key. Matches what `WellknownService`
      // publishes (same `computeKid()` over the same raw public key bytes).
      this.envDerivedKid = computeKid(decodeBase64Url(pub));
      return;
    }
    if (this.config.nodeEnv === 'production') {
      throw new Error(
        'AEGIS_SIGNING_PRIVATE_KEY and AEGIS_SIGNING_PUBLIC_KEY must be set in production.',
      );
    }
    const kp = await this.ed25519.generateKeypair();
    this.auditPrivateKey = kp.privateKey;
    this.auditPublicKeyB64 = encodeBase64Url(kp.publicKey);
    this.envDerivedKid = computeKid(kp.publicKey);
    this.logger.warn('Using ephemeral Ed25519 audit-signing key. DO NOT USE IN PRODUCTION.');
  }

  publicKey(): { format: 'ed25519-base64url'; key: string } {
    if (!this.auditPublicKeyB64) throw new Error('Audit signing key not initialised.');
    return { format: 'ed25519-base64url', key: this.auditPublicKeyB64 };
  }

  /**
   * Append an event to the chain.
   *
   * **Concurrency safety** (audit a38b6fd6 fix): two concurrent appends for
   * the same `agentId` would otherwise both read the same `prev` and both
   * compute their signature against the same `prev_hash`, producing a
   * forked chain that fails third-party verification at export time.
   *
   * We acquire a Postgres advisory transaction lock keyed by
   * `hashtext(agentId)` for the duration of `(read prev → compute sig →
   * insert)`. Postgres releases the lock automatically on COMMIT/ROLLBACK
   * so we don't have to worry about leaks on error paths.
   *
   * Per CLAUDE.md invariant #3 the chain is append-only — we throw on any
   * persistence error (callers in the verify hot path use fire-and-forget
   * + DLQ for the SOC2 invariant; this method is the durable boundary).
   */
  async append(input: AppendAuditInput): Promise<string> {
    return withSpan('aegis.audit.chain.append', () => this.appendInternal(input), {
      'principal.id': input.principalId,
      'agent.id': input.agentId ?? input.claimedAgentId ?? undefined,
      'policy.id': input.policyId ?? undefined,
      decision: input.decision,
      'denial.reason': input.denialReason ?? undefined,
    });
  }

  private async appendInternal(input: AppendAuditInput): Promise<string> {
    if (!this.auditPrivateKey) await this.initSigningKey();

    const eventId = `evt_${cryptoRandomId()}`;
    const timestamp = new Date();
    // Lock partition key — fall back to claimedAgentId then to a per-principal
    // key so two unrelated AGENT_NOT_FOUND denies don't serialize on the same
    // lock. Using `'__no_agent__'` would create a single global hot lock.
    const lockKey = input.agentId ?? input.claimedAgentId ?? `principal:${input.principalId}`;
    const claimedAgentId = input.claimedAgentId ?? input.agentId ?? null;

    // Wrap in a transaction so the advisory lock auto-releases on commit/abort.
    await this.prisma
      .$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey})::bigint)`;

          // Find the previous chain entry. When agentId is real, we chain
          // per-agent. When agentId is null (no agent), we chain per-principal
          // — so each tenant's denial-only stream is still tamper-evident.
          const prev = input.agentId
            ? await tx.auditEvent.findFirst({
                where: { agentId: input.agentId },
                orderBy: { timestamp: 'desc' },
                select: { id: true, aegisSignature: true },
              })
            : await tx.auditEvent.findFirst({
                where: { agentId: null, principalId: input.principalId },
                orderBy: { timestamp: 'desc' },
                select: { id: true, aegisSignature: true },
              });

          // Build v2 chain payload — hashes the redactable fields (ADR-0006).
          // Raw fields are persisted as-is in nullable columns; the signed
          // payload commits to their hashes. Erasure later nulls the raw
          // columns without breaking signature verification.
          const built = this.chain.buildPayload({
            agentId: input.agentId ?? claimedAgentId ?? '__no_agent__',
            claimedAgentId,
            principalId: input.principalId,
            decision: input.decision,
            denialReason: input.denialReason ?? null,
            policyId: input.policyId ?? null,
            trustScoreAtEvent: input.trustScoreAtEvent,
            trustBandAtEvent: input.trustBandAtEvent,
            currency: input.currency ?? null,
            timestamp: timestamp.toISOString(),
            action: input.action,
            relyingParty: input.relyingParty ?? null,
            requestedAmount:
              input.requestedAmount != null ? input.requestedAmount.toFixed(2) : null,
            policySnapshot: input.policySnapshot ?? null,
          });

          // M-037: prefer KMS-backed signer when available; stamp signingKeyId
          // from the active KMS key. Fall back to env-derived auditPrivateKey
          // for dev. Both paths produce a base64url Ed25519 signature.
          let signature: string;
          let signingKid: string | undefined;
          if (this.auditSigner) {
            signature = await this.chain.signWithSigner(
              {
                eventId,
                prevEventId: prev?.id ?? null,
                prevSignatureB64Url: prev?.aegisSignature ?? null,
                payload: built.signed,
              },
              (msg) => this.auditSigner!.signRaw(msg),
            );
            signingKid = await this.auditSigner.getActiveKid();
          } else {
            signature = await this.chain.sign(
              {
                eventId,
                prevEventId: prev?.id ?? null,
                prevSignatureB64Url: prev?.aegisSignature ?? null,
                payload: built.signed,
              },
              this.auditPrivateKey!,
            );
            // Dev path: stamp the env-derived kid so the row points at the
            // public key that's actually in JWKS. Without this, rows fall
            // through to the schema default `'kid-genesis-v1'` and offline
            // verifiers can't pick a key from JWKS to verify them.
            signingKid = this.envDerivedKid;
          }

          // ADR-0006: actionHash is non-nullable in the schema, so an
          // 'audit.redact' meta-event (with action explicitly null) would
          // FK-violate. We pass an empty-string hash for that null case
          // — distinguishable from a genuine hash by length (0 bytes →
          // sha256 of empty = 47DEQpj8...) — actually sha256 of empty
          // string is well-known. Verifier handles it.
          const actionHashForRow = built.rawHashes.actionHash ?? this.chain.hashLeaf('')!;

          await tx.auditEvent.create({
            data: {
              id: eventId,
              agentId: input.agentId,
              claimedAgentId,
              principalId: input.principalId,
              action: input.action,
              decision: input.decision,
              denialReason: input.denialReason,
              relyingParty: input.relyingParty,
              requestedAmount: input.requestedAmount ?? undefined,
              currency: input.currency ?? undefined,
              policyId: input.policyId,
              policySnapshot: (input.policySnapshot ?? Prisma.JsonNull) as Prisma.InputJsonValue,
              actionHash: actionHashForRow,
              relyingPartyHash: built.rawHashes.relyingPartyHash,
              requestedAmountHash: built.rawHashes.requestedAmountHash,
              policySnapshotHash: built.rawHashes.policySnapshotHash,
              trustScoreAtEvent: input.trustScoreAtEvent,
              trustBandAtEvent: input.trustBandAtEvent,
              aegisSignature: signature,
              payloadVersion: 2,
              // ADR-0008/0011/0012 — enterprise backbone columns. M-037:
              // signingKeyId resolution order: caller-supplied → KMS active
              // kid → schema default ('kid-genesis-v1').
              signingKeyId: input.signingKeyId ?? signingKid ?? undefined,
              relyingPartyId: input.relyingPartyId ?? undefined,
              policyEngineId: input.policyEngineId ?? undefined,
              engineMetadata: (input.engineMetadata ?? Prisma.JsonNull) as Prisma.InputJsonValue,
              timestamp,
            },
          });
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeout: 10_000,
        },
      )
      .catch((err: unknown) => {
        this.logger.error(
          `Audit append failed agent=${input.agentId ?? '<none>'} event=${eventId}: ${(err as Error).message}`,
        );
        throw err;
      });

    return eventId;
  }

  async list(
    principalId: string,
    agentId: string,
    query: AuditQueryDto,
  ): Promise<AuditLogResponseDto> {
    const agent = await this.prisma.agentIdentity.findFirst({
      where: { id: agentId, principalId },
      select: { id: true },
    });
    if (!agent)
      throw new NotFoundException({ error: 'AGENT_NOT_FOUND', message: 'Agent not found.' });

    const limit = query.limit ?? 100;
    const where: Prisma.AuditEventWhereInput = { agentId };
    if (query.from || query.to) {
      where.timestamp = {};
      if (query.from) where.timestamp.gte = new Date(query.from);
      if (query.to) where.timestamp.lte = new Date(query.to);
    }

    const events = await this.prisma.auditEvent.findMany({
      where,
      orderBy: { timestamp: 'desc' },
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });

    const hasMore = events.length > limit;
    const sliced = hasMore ? events.slice(0, limit) : events;

    return {
      events: sliced.map((e) => ({
        eventId: e.id,
        agentId: e.agentId,
        claimedAgentId: e.claimedAgentId,
        principalId: e.principalId,
        timestamp: e.timestamp.toISOString(),
        action: e.action,
        actionHash: e.actionHash,
        relyingParty: e.relyingParty,
        decision: e.decision,
        decisionReason: e.denialReason,
        trustScoreAtEvent: e.trustScoreAtEvent,
        signature: e.aegisSignature,
      })),
      nextCursor: hasMore ? (sliced[sliced.length - 1]?.id ?? null) : null,
      count: sliced.length,
    };
  }

  /**
   * NDJSON-friendly chunked iterator over the audit log. Backstops the
   * controller's streaming export — bounded memory, cursor-paged in 1 K
   * blocks so neither the API nor the consumer needs to hold the whole
   * range in RAM.
   *
   * Yields rows in chronological order so external chain verifiers can
   * walk forward without re-sorting.
   */
  /**
   * Stream the audit log as one canonical row per yield.
   *
   * Shape matches `@aegis/audit-verifier`'s `AuditEventRow` so an offline
   * relying party can pipe the NDJSON straight into `verifyChain()` with
   * no remapping:
   *
   *   {
   *     eventId, prevEventId, prevSignature,  // chain link
   *     signingKeyId, signature,              // pick + verify
   *     payload: AuditChainPayload,           // the bytes that got signed
   *   }
   *
   * The legacy flat shape (with `aegisSignature` at top level and payload
   * fields un-nested) was un-verifiable in practice — the `kid` was never
   * stamped at append time so JWKS lookups always failed. We don't preserve
   * it; X-AEGIS-Export-Format goes from `ndjson-v1` to `ndjson-v2`.
   *
   * `prevEventId` / `prevSignature` are reconstructed by walking rows in
   * timestamp order — that's exactly how the signer computed `prev_hash`
   * at write time, so a verifier replaying the same walk reconstructs the
   * same signed bytes.
   *
   * `redactedAt` and `redactionReason` are emitted at top level (siblings
   * of `payload`) because they're operational metadata, not part of the
   * signed-bytes envelope.
   */
  async *exportStream(
    principalId: string,
    agentId: string,
    query: AuditQueryDto,
  ): AsyncGenerator<{
    eventId: string;
    prevEventId: string | null;
    prevSignature: string | null;
    signingKeyId: string;
    signature: string;
    payload: {
      agentId: string;
      claimedAgentId: string | null;
      principalId: string;
      decision: string;
      denialReason: string | null;
      policyId: string | null;
      trustScoreAtEvent: number;
      trustBandAtEvent: string;
      currency: string | null;
      timestamp: string;
      actionHash: string | null;
      relyingPartyHash: string | null;
      requestedAmountHash: string | null;
      policySnapshotHash: string | null;
      v: 2;
    };
    // Operational sidecar — not part of the signed payload.
    redactedAt: string | null;
    redactionReason: string | null;
    payloadVersion: number;
  }> {
    const agent = await this.prisma.agentIdentity.findFirst({
      where: { id: agentId, principalId },
      select: { id: true },
    });
    if (!agent)
      throw new NotFoundException({ error: 'AGENT_NOT_FOUND', message: 'Agent not found.' });

    const where: Prisma.AuditEventWhereInput = { agentId };
    if (query.from || query.to) {
      where.timestamp = {};
      if (query.from) where.timestamp.gte = new Date(query.from);
      if (query.to) where.timestamp.lte = new Date(query.to);
    }

    const PAGE = 1_000;
    let cursor: string | undefined;
    let yielded = 0;
    const max = query.limit ?? Number.POSITIVE_INFINITY;
    // Track the predecessor across the timestamp-asc walk so each yielded
    // row carries its prevEventId + prevSignature. The verifier uses these
    // to reconstruct `prev_hash = sha256(prevSignature || prevEventId)` —
    // the exact bytes the signer prepended at write time.
    let prevEventId: string | null = null;
    let prevSignature: string | null = null;

    while (yielded < max) {
      const batch: Awaited<ReturnType<typeof this.prisma.auditEvent.findMany>> =
        await this.prisma.auditEvent.findMany({
          where,
          orderBy: { timestamp: 'asc' },
          take: PAGE,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        });
      if (batch.length === 0) break;

      for (const e of batch) {
        if (yielded >= max) break;
        yielded += 1;
        yield {
          eventId: e.id,
          prevEventId,
          prevSignature,
          // Stamped at append time. Tests may see the legacy default
          // `'kid-genesis-v1'` on rows written before this commit; new
          // rows carry the runtime kid that matches JWKS.
          signingKeyId: e.signingKeyId,
          signature: e.aegisSignature,
          // Mirrors `AuditChainPayload` in audit-chain.util.ts exactly.
          // These are the bytes that get canonicalized and signed — fields
          // here MUST match the signer's `built.signed` shape character
          // for character or downstream verification fails.
          payload: {
            agentId: e.agentId ?? e.claimedAgentId ?? '__no_agent__',
            claimedAgentId: e.claimedAgentId,
            principalId: e.principalId,
            decision: e.decision,
            denialReason: e.denialReason,
            policyId: e.policyId,
            trustScoreAtEvent: e.trustScoreAtEvent,
            trustBandAtEvent: e.trustBandAtEvent,
            currency: e.currency,
            timestamp: e.timestamp.toISOString(),
            actionHash: e.actionHash,
            relyingPartyHash: e.relyingPartyHash,
            requestedAmountHash: e.requestedAmountHash,
            policySnapshotHash: e.policySnapshotHash,
            v: 2 as const,
          },
          redactedAt: e.redactedAt?.toISOString() ?? null,
          redactionReason: e.redactionReason,
          payloadVersion: e.payloadVersion,
        };
        // Advance the predecessor cursor — the NEXT row's prev_hash will
        // be computed against THIS row's id+signature, which is exactly
        // what the signer did at append time.
        prevEventId = e.id;
        prevSignature = e.aegisSignature;
      }
      const last = batch[batch.length - 1];
      cursor = last?.id;
      if (batch.length < PAGE) break;
    }
  }

  /**
   * Tenant-wide NDJSON export (M-006 finalisation).
   *
   * Same chunked iteration as `exportStream` but scoped by `principalId`
   * only — used for "give me everything in my tenant" SOC2 evidence
   * pulls. Yields rows in chronological order so external chain verifiers
   * can walk forward without re-sorting.
   */
  async *exportTenantStream(
    principalId: string,
    query: AuditQueryDto,
  ): AsyncGenerator<{
    eventId: string;
    agentId: string | null;
    claimedAgentId: string | null;
    principalId: string;
    timestamp: string;
    action: string | null;
    actionHash: string;
    decision: string;
    denialReason: string | null;
    relyingParty: string | null;
    relyingPartyHash: string | null;
    trustScoreAtEvent: number;
    trustBandAtEvent: string;
    policyId: string | null;
    policySnapshot: unknown;
    policySnapshotHash: string | null;
    requestedAmount: string | null;
    requestedAmountHash: string | null;
    currency: string | null;
    aegisSignature: string;
    payloadVersion: number;
    redactedAt: string | null;
  }> {
    const where: Prisma.AuditEventWhereInput = { principalId };
    if (query.from || query.to) {
      where.timestamp = {};
      if (query.from) where.timestamp.gte = new Date(query.from);
      if (query.to) where.timestamp.lte = new Date(query.to);
    }

    const PAGE = 1_000;
    let cursor: string | undefined;
    let yielded = 0;
    const max = query.limit ?? Number.POSITIVE_INFINITY;

    while (yielded < max) {
      const batch: Awaited<ReturnType<typeof this.prisma.auditEvent.findMany>> =
        await this.prisma.auditEvent.findMany({
          where,
          orderBy: { timestamp: 'asc' },
          take: PAGE,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        });
      if (batch.length === 0) break;

      for (const e of batch) {
        if (yielded >= max) break;
        yielded += 1;
        yield {
          eventId: e.id,
          agentId: e.agentId,
          claimedAgentId: e.claimedAgentId,
          principalId: e.principalId,
          timestamp: e.timestamp.toISOString(),
          action: e.action,
          actionHash: e.actionHash,
          decision: e.decision,
          denialReason: e.denialReason,
          relyingParty: e.relyingParty,
          relyingPartyHash: e.relyingPartyHash,
          trustScoreAtEvent: e.trustScoreAtEvent,
          trustBandAtEvent: e.trustBandAtEvent,
          policyId: e.policyId,
          policySnapshot: e.policySnapshot,
          policySnapshotHash: e.policySnapshotHash,
          requestedAmount: e.requestedAmount?.toString() ?? null,
          requestedAmountHash: e.requestedAmountHash,
          currency: e.currency,
          aegisSignature: e.aegisSignature,
          payloadVersion: e.payloadVersion,
          redactedAt: e.redactedAt?.toISOString() ?? null,
        };
      }
      const last = batch[batch.length - 1];
      cursor = last?.id;
      if (batch.length < PAGE) break;
    }
  }

  /**
   * GDPR Article 17 redaction (ADR-0006).
   *
   * Nulls the raw value of one or more redactable fields on an audit row
   * the caller's principal owns. Hash columns + signature stay intact, so
   * the chain still verifies. Logs a meta-event into the chain so the
   * fact of redaction is itself auditable.
   *
   * Tenant-scoped: throws NotFoundException for cross-principal attempts
   * (multi-tenant isolation per CLAUDE.md invariant #5).
   */
  async redact(
    eventId: string,
    principalId: string,
    fields: Array<'action' | 'relyingParty' | 'requestedAmount' | 'policySnapshot'>,
    reason: string,
  ): Promise<{ eventId: string; redactedFields: string[]; redactionAuditId: string }> {
    const row = await this.prisma.auditEvent.findFirst({
      where: { id: eventId, principalId },
      select: { id: true, agentId: true, claimedAgentId: true, redactedAt: true },
    });
    if (!row) {
      throw new NotFoundException({
        error: 'AUDIT_EVENT_NOT_FOUND',
        message: 'Audit event not found.',
      });
    }

    const update: Prisma.AuditEventUpdateInput = {
      redactedAt: new Date(),
      redactionReason: reason,
    };
    const redactedFields: string[] = [];
    if (fields.includes('action')) {
      update.action = null;
      redactedFields.push('action');
    }
    if (fields.includes('relyingParty')) {
      update.relyingParty = null;
      redactedFields.push('relyingParty');
    }
    if (fields.includes('requestedAmount')) {
      update.requestedAmount = null;
      redactedFields.push('requestedAmount');
    }
    if (fields.includes('policySnapshot')) {
      update.policySnapshot = Prisma.JsonNull;
      redactedFields.push('policySnapshot');
    }
    if (redactedFields.length === 0) {
      throw new Error('At least one field must be specified for redaction.');
    }

    await this.prisma.auditEvent.update({ where: { id: eventId }, data: update });

    // Meta-event: the redaction itself is in the chain. action='audit.redact',
    // relyingParty carries the redacted-eventId so chain walkers see the link.
    const redactionAuditId = await this.append({
      agentId: row.agentId,
      claimedAgentId: row.claimedAgentId ?? null,
      principalId,
      action: 'audit.redact',
      decision: 'FLAGGED',
      relyingParty: `event:${eventId}`,
      policySnapshot: { redactedFields, reason },
      trustScoreAtEvent: 0,
      trustBandAtEvent: 'VERIFIED',
    });

    return { eventId, redactedFields, redactionAuditId };
  }
}

function cryptoRandomId(): string {
  // 26-char base62-ish identifier. Sufficient entropy; we're not minting
  // these per-microsecond.
  const { randomBytes } = require('node:crypto') as typeof import('node:crypto');
  return randomBytes(20)
    .toString('base64url')
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(0, 26);
}
