// AdminModule — wires the founder-led onboarding controller.
//
// Imports the AuthModule for ApiKeyService (the canonical API key
// issuer with bcrypt + Redis-cache invariants), and PrismaService
// for Principal CRUD.

import { Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { AdminController } from './admin.controller';

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [AdminController],
})
export class AdminModule {}
