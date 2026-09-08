import { Provider } from '@nestjs/common';
import Redis from 'ioredis';
import { config } from '@utils/config';
import { REDIS_CLIENT } from './redis-client.token';

export const redisClientProvider: Provider = {
  provide: REDIS_CLIENT,
  useFactory: (): Redis =>
    new Redis({
      host: config.redis.host,
      port: config.redis.port,
      password: config.redis.password || undefined,
    }),
};
