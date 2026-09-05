import { Controller, Get, Header } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';

import { MetricsService } from './metrics.service';

@ApiTags('Observability')
@Controller('metrics')
export class MetricsController {
  public constructor(private readonly metrics: MetricsService) {}

  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  @ApiOperation({ summary: 'Expõe métricas no formato Prometheus' })
  @ApiProduces('text/plain')
  @ApiOkResponse({ description: 'Métricas operacionais do processo atual.' })
  public render(): Promise<string> {
    return this.metrics.render();
  }
}
