import { Body, Controller, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { VerifyKeyOnly } from '../auth/api-key.guard';
import { Auth } from '../../common/decorators/auth.decorator';
import type { AuthenticatedKey } from '../auth/api-key.service';
import { VerifyService } from './verify.service';
import { VerifyRequestDto, VerifyResponseDto } from './verify.dto';

@ApiTags('Verification')
@Controller('verify')
export class VerifyController {
  constructor(private readonly verify: VerifyService) {}

  @Post()
  @VerifyKeyOnly()
  @Throttle({ verify: { limit: 1000, ttl: 60_000 } })
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
