import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { useCases } from './initiator';
import { RedisHealthIndicator } from './redis.health-indicator';

@Module({
  imports: [TerminusModule],
  controllers: [HealthController],
  providers: [...useCases, RedisHealthIndicator],
})
export class HealthModule {}
