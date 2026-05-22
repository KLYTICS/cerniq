import { Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';

import { McpController } from './mcp.controller';
import { McpService } from './mcp.service';

/**
 * MCP control-plane module (ADR-0008). Owns the registry of trusted MCP
 * servers per principal. Tool-call verification itself happens in the
 * verify module via `@okoro/mcp-bridge` on the relying party's side —
 * this module only manages the registry.
 */
@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [McpController],
  providers: [McpService],
  exports: [McpService],
})
export class McpModule {}
