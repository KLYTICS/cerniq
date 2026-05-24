import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';

import { Auth } from '../../common/decorators/auth.decorator';
import type { AuthenticatedKey } from '../auth/api-key.service';

import {
  CreatePolicyDto,
  CreatePolicyResponseDto,
  ListPoliciesQueryDto,
  PolicyResponseDto,
  RevokePolicyDto,
} from './policy.dto';
import { PolicyService } from './policy.service';

@ApiTags('Policies')
@ApiSecurity('ApiKeyAuth')
@Controller('agents/:agentId/policies')
export class PolicyController {
  constructor(private readonly policy: PolicyService) {}

  @Post()
  @ApiOperation({
    summary: 'Create a scoped permission policy and receive an CERNIQ-signed token.',
  })
  create(
    @Auth() auth: AuthenticatedKey,
    @Param('agentId') agentId: string,
    @Body() dto: CreatePolicyDto,
  ): Promise<CreatePolicyResponseDto> {
    return this.policy.create(auth.principalId, agentId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List policies for an agent. Optional status filter (OD-024 Phase A3).' })
  list(
    @Auth() auth: AuthenticatedKey,
    @Param('agentId') agentId: string,
    @Query() query: ListPoliciesQueryDto,
  ): Promise<PolicyResponseDto[]> {
    return this.policy.list(auth.principalId, agentId, { status: query.status });
  }

  @Get(':policyId')
  @ApiOperation({
    summary: 'Fetch a single policy by id (scoped to the calling principal). OD-024 Phase A1.',
  })
  findOne(
    @Auth() auth: AuthenticatedKey,
    @Param('agentId') agentId: string,
    @Param('policyId') policyId: string,
  ): Promise<PolicyResponseDto> {
    return this.policy.findOne(auth.principalId, agentId, policyId);
  }

  @Delete(':policyId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Instantly revoke a policy. Cache invalidation propagates within seconds.',
  })
  async revoke(
    @Auth() auth: AuthenticatedKey,
    @Param('agentId') agentId: string,
    @Param('policyId') policyId: string,
    @Body() body?: RevokePolicyDto,
  ): Promise<void> {
    await this.policy.revoke(auth.principalId, agentId, policyId, body?.reason, auth.apiKeyId);
  }
}
