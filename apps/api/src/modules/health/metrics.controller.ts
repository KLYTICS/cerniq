import { Controller, Get, Header, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../auth/api-key.guard';
import { MetricsService } from '../../common/observability/metrics.service';

@ApiTags('Health')
@Controller()
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  /**
   * Prometheus exposition. Public route by design — production should put
   * the API behind a private network / bearer-token reverse proxy so the
   * scraper is the only thing that can reach `/metrics`.
   */
  @Public()
  @Get('metrics')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Prometheus metrics — scrape from your Prometheus / Grafana Cloud agent.' })
  async render(@Res({ passthrough: false }) res: Response): Promise<void> {
    const { contentType, body } = await this.metrics.render();
    res.setHeader('Content-Type', contentType);
    res.send(body);
  }
}
