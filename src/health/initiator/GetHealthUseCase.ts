import { Injectable } from '@nestjs/common';
import {
  HealthCheckResult,
  HealthCheckService,
  HealthIndicatorService,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';
import { RedisHealthIndicator } from '../redis.health-indicator';

@Injectable()
export class GetHealthUseCase {
  constructor(
    private readonly health: HealthCheckService,
    private readonly healthIndicatorService: HealthIndicatorService,
    private readonly db: TypeOrmHealthIndicator,
    private readonly redis: RedisHealthIndicator,
  ) {}

  // HealthCheckService.check() throws a ServiceUnavailableException carrying
  // the structured result when any indicator is down — the right HTTP
  // contract for a liveness probe — so this use case lets it propagate
  // instead of converting it to an AppError. AppError lands with the Slice 1
  // platform spine, which this scaffold predates.
  execute(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.db.pingCheck('database', { timeout: 3000 }),
      () => this.redis.isHealthy('redis'),
      () =>
        Promise.resolve(
          this.healthIndicatorService.check('process').up({
            pid: process.pid,
            uptimeSeconds: Math.round(process.uptime()),
          }),
        ),
    ]);
  }
}
