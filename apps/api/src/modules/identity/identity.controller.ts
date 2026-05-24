import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';

import { Auth } from '../../common/decorators/auth.decorator';
import { Public } from '../auth/api-key.guard';
import type { AuthenticatedKey } from '../auth/api-key.service';

import {
  AgentListResponseDto,
  AgentResponseDto,
  AgentStatusDto,
  HandshakeChallengeDto,
  HandshakeStatusDto,
  HandshakeVerifiedDto,
  ListAgentsQueryDto,
  RegisterAgentDto,
  RevokeAgentDto,
  VerifyHandshakeDto,
} from './identity.dto';
import { IdentityService } from './identity.service';

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

  @Get()
  @ApiSecurity('ApiKeyAuth')
  @ApiOperation({
    summary: 'List agents owned by the calling principal. Cursor-paginated, ordered newest-first.',
  })
  list(@Auth() auth: AuthenticatedKey, @Query() query: ListAgentsQueryDto): Promise<AgentListResponseDto> {
    return this.identity.list(auth.principalId, query);
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
  @ApiOperation({
    summary: 'Permanently revoke an agent. Optional reason captured for audit (OD-024 Phase A2).',
  })
  async revoke(
    @Auth() auth: AuthenticatedKey,
    @Param('agentId') agentId: string,
    @Body() body?: RevokeAgentDto,
  ): Promise<void> {
    await this.identity.revoke(auth.principalId, agentId, body?.reason);
  }

  @Get(':agentId/handshake-status')
  @ApiSecurity('ApiKeyAuth')
  @ApiOperation({
    summary:
      'Read whether the agent has completed a proof-of-possession handshake. Cached for 30 days after the most recent successful verify-handshake.',
  })
  handshakeStatus(
    @Auth() auth: AuthenticatedKey,
    @Param('agentId') agentId: string,
  ): Promise<HandshakeStatusDto> {
    return this.identity.getHandshakeStatus(auth.principalId, agentId);
  }

  @Post(':agentId/challenge')
  @HttpCode(HttpStatus.OK)
  @ApiSecurity('ApiKeyAuth')
  @ApiOperation({
    summary:
      'Issue a single-use Ed25519 handshake challenge. Sign the returned `message` with the agent private key and POST the signature to /verify-handshake.',
  })
  issueChallenge(
    @Auth() auth: AuthenticatedKey,
    @Param('agentId') agentId: string,
  ): Promise<HandshakeChallengeDto> {
    return this.identity.issueChallenge(auth.principalId, agentId);
  }

  @Post(':agentId/verify-handshake')
  @HttpCode(HttpStatus.OK)
  @ApiSecurity('ApiKeyAuth')
  @ApiOperation({
    summary:
      'Verify a signed handshake response. On success records proof-of-possession and lifts trust score to ≥600. The challenge is consumed regardless of outcome.',
  })
  verifyHandshake(
    @Auth() auth: AuthenticatedKey,
    @Param('agentId') agentId: string,
    @Body() dto: VerifyHandshakeDto,
  ): Promise<HandshakeVerifiedDto> {
    return this.identity.verifyHandshake(auth.principalId, agentId, dto.signature);
  }

  @Public()
  @Get(':agentId/status')
  @ApiOperation({ summary: 'Public status + trust score (no auth required, suitable for relying party pre-checks).' })
  status(@Param('agentId') agentId: string): Promise<AgentStatusDto> {
    return this.identity.publicStatus(agentId);
  }
}
