import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';

import { Auth } from '../../common/decorators/auth.decorator';
import { PlanAwareThrottlerGuard } from '../../common/throttle/plan-aware-throttler.guard';
import { VerifyKeyOnly } from '../auth/api-key.guard';
import type { AuthenticatedKey } from '../auth/api-key.service';

import { VerifyRequestDto, VerifyResponseDto } from './verify.dto';
import { VerifyService } from './verify.service';

// OD-006: replaced flat `@Throttle({ verify: { limit: 1000, ttl: 60_000 } })`
// with PlanAwareThrottlerGuard. The guard reads each principal's tier from
// UsageGuardService and applies the tier-specific limit defined in
// `modules/billing/plans.ts.verifyRateLimit`. ENTERPRISE bypasses the
// throttler entirely (no Redis hit). Anonymous traffic falls back to the
// FREE limit on per-IP buckets so unauthenticated abuse is still capped.
@ApiTags('Verification')
@Controller('verify')
@UseGuards(PlanAwareThrottlerGuard)
export class VerifyController {
  constructor(private readonly verify: VerifyService) {}

  @Post()
  @VerifyKeyOnly()
  @ApiSecurity('PublicVerifyKey')
  @ApiOperation({
    summary: 'Primary relying-party endpoint. Verifies an agent token end-to-end.',
    description:
      'Authenticates the calling relying party by their verify-only API key. ' +
      'Every verify decision (approve or deny) is appended to the audit chain ' +
      'under the agent\'s principal when known, or the calling relying party\'s ' +
      'principal when the agent is unknown — never under a synthesised value.',
  })
  run(@Auth() auth: AuthenticatedKey, @Body() dto: VerifyRequestDto): Promise<VerifyResponseDto> {
    return this.verify.verify(dto, auth.principalId);
  }
}
