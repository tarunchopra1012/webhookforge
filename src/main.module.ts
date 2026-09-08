import { Module } from '@nestjs/common';
import { SharedModule } from '@shared/shared.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [SharedModule, HealthModule],
})
export class MainModule {}
