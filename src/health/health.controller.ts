import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiOkResponse, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';

import { HealthService } from './health.service';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  public constructor(private readonly healthService: HealthService) {}

  @Get('live')
  @ApiOkResponse({ description: 'The process is alive.' })
  public live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('ready')
  @ApiOkResponse({ description: 'PostgreSQL and SQS are reachable.' })
  @ApiServiceUnavailableResponse({ description: 'A required dependency is unavailable.' })
  public async ready(): Promise<{ status: 'ok' }> {
    try {
      await this.healthService.assertReady();
      return { status: 'ok' };
    } catch {
      throw new ServiceUnavailableException({ code: 'DEPENDENCY_UNAVAILABLE' });
    }
  }
}
