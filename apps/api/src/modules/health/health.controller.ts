import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/api-key.guard';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Public()
  @Get('live')
  live(): { status: 'ok'; ts: string } {
    return { status: 'ok', ts: new Date().toISOString() };
  }

  @Public()
  @Get('ready')
  async ready(): Promise<{ status: 'ok' | 'degraded'; checks: Record<string, boolean>; ts: string }> {
    const [db, cache] = await Promise.all([
      this.prisma
        .$queryRaw`SELECT 1`.then(() => true)
        .catch(() => false),
      this.redis.ping(),
    ]);
    const ok = db && cache;
    return {
      status: ok ? 'ok' : 'degraded',
      checks: { database: db, redis: cache },
      ts: new Date().toISOString(),
    };
  }
}
