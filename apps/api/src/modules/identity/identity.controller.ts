import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/api-key.guard';
import { Auth } from '../../common/decorators/auth.decorator';
import type { AuthenticatedKey } from '../auth/api-key.service';
import { IdentityService } from './identity.service';
import { AgentResponseDto, AgentStatusDto, RegisterAgentDto } from './identity.dto';

@ApiTags('Identity')
@Controller('agents')
export class IdentityController {
  constructor(private readonly identity: IdentityService) {}

  @Post('register')
  @ApiSecurity('ApiKeyAuth')
  @ApiOperation({ summary: 'Register a new agent identity (developer-side).' })
  register(@Auth() auth: AuthenticatedKey, @Body() dto: RegisterAgentDto): Promise<AgentResponseDto> {
    return this.identity.register(auth.principalId, dto);
  }

  @Get(':agentId')
  @ApiSecurity('ApiKeyAuth')
  @ApiOperation({ summary: 'Get details for an agent owned by the calling principal.' })
  findOne(@Auth() auth: AuthenticatedKey, @Param('agentId') agentId: string): Promise<AgentResponseDto> {
    return this.identity.findOne(auth.principalId, agentId);
  }

  @Delete(':agentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiSecurity('ApiKeyAuth')
  @ApiOperation({ summary: 'Permanently revoke an agent.' })
  async revoke(@Auth() auth: AuthenticatedKey, @Param('agentId') agentId: string): Promise<void> {
    await this.identity.revoke(auth.principalId, agentId);
  }

  @Public()
  @Get(':agentId/status')
  @ApiOperation({ summary: 'Public status + trust score (no auth required, suitable for relying party pre-checks).' })
  status(@Param('agentId') agentId: string): Promise<AgentStatusDto> {
    return this.identity.publicStatus(agentId);
  }
}
