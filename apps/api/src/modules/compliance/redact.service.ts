// RedactService — implements GDPR Art. 17 erasure for OKORO audit events.
//
// IMPORTANT: this service does NOT modify `audit.service.ts`. It uses
// Prisma directly for the redact write (zeroing raw columns) and then
// calls `AuditService.append()` to record a `audit.redact` meta-event
// in the chain. The chain remains tamper-evident because the redacted
// row's *Hash columns and okoroSignature are not modified.
//
// Failure modes:
//   - eventId not found → 404.
//   - eventId belongs to a different principal → 404 (NOT 403; we don't
//     leak existence across tenants).
//   - eventId already redacted → no-op return with the original
//     redactedAt timestamp (idempotent).

import { Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

import type {
  AuditRedactableField,
  RedactAuditByAgentDto,
  RedactAuditByAgentResultDto,
  RedactAuditEventDto,
  RedactAuditEventResultDto,
} from './redact.dto';

const ALL_REDACTABLE: AuditRedactableField[] = [
  'action',
  'relyingParty',
  'requestedAmount',
  'currency',
  'policyId',
  'policySnapshot',
];

@Injectable()
export class RedactService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async redactEvent(principalId: string, dto: RedactAuditEventDto): Promise<RedactAuditEventResultDto> {
    const event = await this.prisma.auditEvent.findFirst({
      where: { id: dto.eventId, principalId },
      select: { id: true, redactedAt: true, agentId: true },
    });
    if (!event) throw new NotFoundException('audit_event_not_found');

    const fields = dto.fields ?? ALL_REDACTABLE;

    // Idempotent: if already redacted, return the original timestamp + a
    // fresh meta-event id pointing to the prior redaction. We DO write
    // a new meta-event (audit trail of the redaction-attempt) — that's
    // not a chain pollutant; it's a feature.
    const update: Record<string, unknown> = {};
    if (fields.includes('action')) update.action = null;
    if (fields.includes('relyingParty')) update.relyingParty = null;
    if (fields.includes('requestedAmount')) update.requestedAmount = null;
    if (fields.includes('currency')) update.currency = null;
    if (fields.includes('policyId')) update.policyId = null;
    if (fields.includes('policySnapshot')) update.policySnapshot = null;

    const redactedAt = event.redactedAt ?? new Date();
    if (!event.redactedAt) {
      update.redactedAt = redactedAt;
      update.redactionReason = dto.reason;
      await this.prisma.auditEvent.update({ where: { id: event.id }, data: update });
    }

    const metaEventId = await this.audit.append({
      // Meta-event always references the principal whose event we touched.
      // agentId stays null — redaction is a system-level action.
      agentId: null,
      claimedAgentId: event.agentId ?? null,
      principalId,
      action: 'audit.redact',
      decision: 'APPROVED',
      // Note: the meta-event itself is NEVER redactable (callers cannot
      // erase the fact that a redaction happened). Reason field is small
      // and free-form.
      relyingParty: dto.dataSubjectRef ?? null,
      policyId: event.id, // Reuse policyId column to point at the redacted event id.
      trustScoreAtEvent: 0,
      trustBandAtEvent: 'VERIFIED',
    });

    return {
      eventId: event.id,
      redactedFields: fields,
      redactedAt: redactedAt.toISOString(),
      metaEventId,
    };
  }

  async redactByAgent(principalId: string, dto: RedactAuditByAgentDto): Promise<RedactAuditByAgentResultDto> {
    // Verify the agent is in scope. We don't fail-loud on no-events — a
    // legitimate "delete a freshly created agent" might match zero rows
    // and that's fine; the dataSubject still gets the meta-event.
    const fields = dto.fields ?? ALL_REDACTABLE;
    const update: Record<string, unknown> = { redactedAt: new Date(), redactionReason: dto.reason };
    if (fields.includes('action')) update.action = null;
    if (fields.includes('relyingParty')) update.relyingParty = null;
    if (fields.includes('requestedAmount')) update.requestedAmount = null;
    if (fields.includes('currency')) update.currency = null;
    if (fields.includes('policyId')) update.policyId = null;
    if (fields.includes('policySnapshot')) update.policySnapshot = null;

    const result = await this.prisma.auditEvent.updateMany({
      where: { agentId: dto.agentId, principalId, redactedAt: null },
      data: update,
    });

    const metaEventId = await this.audit.append({
      agentId: null,
      claimedAgentId: dto.agentId,
      principalId,
      action: 'audit.redact_bulk',
      decision: 'APPROVED',
      relyingParty: dto.dataSubjectRef ?? null,
      trustScoreAtEvent: 0,
      trustBandAtEvent: 'VERIFIED',
    });

    return { agentId: dto.agentId, eventsRedacted: result.count, metaEventId };
  }
}
