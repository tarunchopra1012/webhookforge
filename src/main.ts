import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { config } from '@utils/config';
import { MainModule } from './main.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(MainModule);
  await app.listen(config.port);
  Logger.log(`WebhookForge listening on port ${config.port}`, 'Bootstrap');
}

void bootstrap();
