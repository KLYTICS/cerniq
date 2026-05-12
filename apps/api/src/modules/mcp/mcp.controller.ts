import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { McpService } from './mcp.service';
import type { ListMcpServersDto, McpServerDto, RegisterMcpServerDto } from './mcp.dto';

/**
 * MCP control-plane HTTP surface (ADR-0008).
 *
 *   POST   /v1/mcp-servers         — register a trusted MCP server
 *   GET    /v1/mcp-servers         — list this principal's MCP servers
 *   DELETE /v1/mcp-servers/:id     — revoke a server
 *
 * Authentication: ApiKeyGuard sets `req.principalId`. (Guard wiring is
 * done in app.module.ts; this controller relies on it being present.)
 */
@Controller('mcp-servers')
export class McpController {
  constructor(private readonly mcp: McpService) {}

  @Post()
  @HttpCode(201)
  async register(@Req() req: Request, @Body() dto: RegisterMcpServerDto): Promise<McpServerDto> {
    const principalId = (req as unknown as { principalId?: string }).principalId;
    if (!principalId) throw new Error('principal_missing'); // ApiKeyGuard contract.
    return this.mcp.register(principalId, dto);
  }

  @Get()
  async list(@Req() req: Request): Promise<ListMcpServersDto> {
    const principalId = (req as unknown as { principalId?: string }).principalId;
    if (!principalId) throw new Error('principal_missing');
    return this.mcp.list(principalId);
  }

  @Delete(':id')
  @HttpCode(204)
  async revoke(@Req() req: Request, @Param('id') id: string): Promise<void> {
    const principalId = (req as unknown as { principalId?: string }).principalId;
    if (!principalId) throw new Error('principal_missing');
    await this.mcp.revoke(principalId, id);
  }
}
