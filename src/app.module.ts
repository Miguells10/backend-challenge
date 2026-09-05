import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';

import mikroOrmConfig from '../mikro-orm.config';
import { HealthModule } from './health/health.module';
import { ObservabilityModule } from './observability/observability.module';
import { WageringModule } from './wagering/wagering.module';
import { WalletsModule } from './wallets/wallets.module';

@Module({
  imports: [MikroOrmModule.forRoot(mikroOrmConfig), ObservabilityModule, HealthModule, WalletsModule, WageringModule],
})
export class AppModule {}
