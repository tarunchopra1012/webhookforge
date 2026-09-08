import { Inject, Injectable } from '@nestjs/common';
import { HealthIndicatorResult, HealthIndicatorService } from '@nestjs/terminus';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '@shared/cache/redis-client.token';

const PING_TIMEOUT_MS = 3000;

@Injectable()
export class RedisHealthIndicator {
  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async isHealthy<Key extends string>(key: Key): Promise<HealthIndicatorResult<Key>> {
    const indicator = this.healthIndicatorService.check(key);

    try {
      await this.pingWithTimeout();
      return indicator.up();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Redis ping failed';
      return indicator.down({ message });
    }
  }

  private pingWithTimeout(): Promise<unknown> {
    return Promise.race([
      this.redis.ping(),
      new Promise((_resolve, reject) => {
        setTimeout(() => reject(new Error('Redis ping timed out')), PING_TIMEOUT_MS);
      }),
    ]);
  }
}
