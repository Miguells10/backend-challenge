import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';

import mikroOrmConfig from '../mikro-orm.config';
import { HealthModule } from './health/health.module';
import { WageringModule } from './wagering/wagering.module';

@Module({
  imports: [MikroOrmModule.forRoot(mikroOrmConfig), HealthModule, WageringModule],
})
export class AppModule {}
