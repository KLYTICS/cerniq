// G-4: Webhook subscription endpoints — subscribe, list, unsubscribe.
//
// These are the management-plane endpoints relying parties use to register
// callback URLs so AEGIS can push events (trust_score_changed, agent_revoked,
// anomaly_flagged, etc.) rather than requiring them to poll.
//
// Design:
//   - Standard key-auth (x-aegis-api-key). Verify-only keys are NOT
//     permitted here; subscriptions are management operations.
//   - principalId from auth context scopes all operations — a principal
//     can only see and delete their own subscriptions (invariant #5).
//   - The signing secret returned on creation is shown once and never
//     stored in plaintext (only the bcrypt hash lands in DB). Callers
//     MUST record it immediately and use it to verify HMAC signatures on
//     incoming webhook deliveries.
//   - Unsubscribe is idempotent: deleting a non-existent subscription
//     returns 204 (no error) so retries are safe.

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { IsArray, IsString, IsUrl, MaxLength } from 'class-validator';
import { Auth } from '../../common/decorators/auth.decorator';
import type { AuthenticatedKey } from '../auth/api-key.service';
import { WebhooksService } from './webhooks.service';

// ── DTOs ─────────────────────────────────────────────────────────────────────

export class CreateWebhookSubscriptionDto {
  @ApiProperty({
    description: 'HTTPS endpoint AEGIS will POST webhook events to. Must be publicly reachable.',
    example: 'https://api.example.com/webhooks/aegis',
  })
  @IsString()
  @IsUrl({ require_tld: true, protocols: ['https'] })
  @MaxLength(2048)
  url!: string;

  @ApiProperty({
    description:
      'Event types to subscribe to. Use "*" for all events or list specific types ' +
      '(e.g. "aegis.agent.trust_score_changed", "aegis.agent.revoked", "aegis.anomaly.detected").',
    type: [String],
    example: ['aegis.agent.trust_score_changed', 'aegis.agent.revoked'],
  })
  @IsArray()
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  events!: string[];
}

export class WebhookSubscriptionCreatedDto {
  @ApiProperty({ description: 'Subscription ID. Use this to unsubscribe.' })
  id!: string;

  @ApiProperty({
    description:
      'HMAC signing secret (whsec_ prefix). Shown ONCE — store it securely. ' +
      'AEGIS signs every delivery with `X-Aegis-Signature: t=<ts>,v1=<hmac>` ' +
      'using HMAC-SHA256 keyed with this secret. Verify it on every inbound request.',
    example: 'whsec_aBcDeFgHiJkLmNoPqRsTuVwX',
  })
  secret!: string;
}

export class WebhookSubscriptionDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  url!: string;

  @ApiProperty({ type: [String] })
  events!: string[];

  @ApiProperty()
  active!: boolean;
}

// ── Controller ────────────────────────────────────────────────────────────────

@ApiTags('Webhooks')
@ApiSecurity('ApiKeyAuth')
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  /**
   * POST /v1/webhooks
   *
   * Subscribe a URL to one or more event types. Returns the subscription id
   * and the signing secret. The secret is shown exactly once — it is stored
   * only as a bcrypt hash in the database and cannot be retrieved later.
   */
  @Post()
  @ApiOperation({
    summary: 'Subscribe a callback URL to webhook events.',
    description:
      'Creates a new webhook subscription scoped to the calling principal. ' +
      'The returned `secret` (whsec_ prefixed) must be stored immediately — ' +
      'it is shown only once and used to verify HMAC signatures on incoming ' +
      'deliveries. AEGIS retries failed deliveries up to 5 times with ' +
      'exponential back-off (1 s → 2 s → 4 s → 8 s → 16 s) before moving ' +
      'the delivery to the dead-letter queue.',
  })
  subscribe(
    @Auth() auth: AuthenticatedKey,
    @Body() dto: CreateWebhookSubscriptionDto,
  ): Promise<WebhookSubscriptionCreatedDto> {
    return this.webhooks.subscribe(auth.principalId, dto.url, dto.events);
  }

  /**
   * GET /v1/webhooks
   *
   * List all webhook subscriptions owned by the calling principal.
   */
  @Get()
  @ApiOperation({
    summary: 'List webhook subscriptions for the calling principal.',
  })
  list(@Auth() auth: AuthenticatedKey): Promise<WebhookSubscriptionDto[]> {
    return this.webhooks.list(auth.principalId);
  }

  /**
   * DELETE /v1/webhooks/:id
   *
   * Unsubscribe (permanently delete) a webhook subscription. Idempotent —
   * deleting a non-existent or already-deleted subscription returns 204.
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a webhook subscription.',
    description:
      'Permanently removes the subscription and stops future deliveries. ' +
      'In-flight deliveries already queued may still arrive at the target URL ' +
      'for a brief window after deletion. This operation is idempotent.',
  })
  async unsubscribe(
    @Auth() auth: AuthenticatedKey,
    @Param('id') id: string,
  ): Promise<void> {
    await this.webhooks.unsubscribe(auth.principalId, id);
  }
}
