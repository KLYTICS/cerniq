import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { Auth } from '../../common/decorators/auth.decorator';
import type { AuthenticatedKey } from '../auth/api-key.service';
import { PolicyService } from './policy.service';
import { CreatePolicyDto, CreatePolicyResponseDto, PolicyResponseDto } from './policy.dto';

@ApiTags('Policies')
@ApiSecurity('ApiKeyAuth')
@Controller('agents/:agentId/policies')
export class PolicyController {
  constructor(private readonly policy: PolicyService) {}

  @Post()
  @ApiOperation({ summary: 'Create a scoped permission policy and receive an AEGIS-signed token.' })
  create(
    @Auth() auth: AuthenticatedKey,
    @Param('agentId') agentId: string,
    @Body() dto: CreatePolicyDto,
  ): Promise<CreatePolicyResponseDto> {
    return this.policy.create(auth.principalId, agentId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List policies for an agent.' })
  list(@Auth() auth: AuthenticatedKey, @Param('agentId') agentId: string): Promise<PolicyResponseDto[]> {
    return this.policy.list(auth.principalId, agentId);
  }

  @Delete(':policyId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Instantly revoke a policy. Cache invalidation propagates within seconds.' })
  async revoke(
    @Auth() auth: AuthenticatedKey,
    @Param('agentId') agentId: string,
    @Param('policyId') policyId: string,
  ): Promise<void> {
    await this.policy.revoke(auth.principalId, agentId, policyId);
  }
}
