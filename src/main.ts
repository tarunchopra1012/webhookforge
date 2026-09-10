import 'reflect-metadata';
import { API_KEY_HEADER, DEFAULT_API_VERSION, SWAGGER_PATH } from '@constant';
import * as AllErrors from '@error';
import { API_KEY_SECURITY } from '@decorator';
import { LogService } from '@logger';
import { VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { PaginatedResponse } from '@types';
import { config } from '@utils/config';
import { MainModule } from './main.module';

async function bootstrap(): Promise<void> {
  const logger = new LogService('Bootstrap');

  const app = await NestFactory.create(MainModule, {
    // Route Nest's own output through Winston too, so boot, shutdown and
    // request logs all share one format.
    logger: new LogService('Nest'),
  });

  app.enableCors();

  // Lifecycle hooks only fire on SIGTERM/SIGINT once this is on. Without it
  // the Redis client never quits cleanly and, once BullMQ lands, in-flight
  // delivery jobs are killed mid-attempt instead of being allowed to finish.
  app.enableShutdownHooks();

  // URI versioning: /v1/subscriptions. An unversioned path resolves to v1, so
  // adding v2 later does not break existing clients.
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: DEFAULT_API_VERSION,
  });

  // Global pipe, filters and interceptor are registered in main.module.ts, so
  // they are resolved by the DI container and a filter can inject what it
  // needs. See the ordering note there.

  const swaggerConfig = new DocumentBuilder()
    .setTitle('WebhookForge API')
    .setDescription(
      'Multi-tenant webhook delivery: register subscriptions, ingest events, ' +
        'and track delivery attempts, retries and dead letters.',
    )
    .setVersion(DEFAULT_API_VERSION)
    .setExternalDoc('OpenAPI JSON', `/${SWAGGER_PATH}-json`)
    .addApiKey({ type: 'apiKey', name: API_KEY_HEADER, in: 'header' }, API_KEY_SECURITY)
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig, {
    // Every error class, so the `oneOf` $refs that @Api() emits for the 4xx
    // envelope resolve. error.ts exports error classes and nothing else,
    // which is what makes this spread safe.
    extraModels: [...Object.values(AllErrors), PaginatedResponse],
  });
  SwaggerModule.setup(SWAGGER_PATH, app, document, {
    jsonDocumentUrl: `/${SWAGGER_PATH}-json`,
  });

  await app.listen(config.port);
  logger.log(`WebhookForge listening on port ${config.port} (${config.nodeEnv})`);
  logger.log(`API documentation at http://localhost:${config.port}/${SWAGGER_PATH}`);
}

void bootstrap();
