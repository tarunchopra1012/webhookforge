import { Module, Provider, ValidationPipe } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { SharedModule } from '@shared/shared.module';
import {
  AppExceptionFilter,
  HttpExceptionFilter,
  UnknownExceptionFilter,
  validationExceptionFactory,
} from '@filter';
import { LoggingInterceptor } from '@interceptor';
import { HealthModule } from './health/health.module';

/**
 * The application-wide guards, filters, interceptors and pipes.
 *
 * Exported so an e2e spec can mount the exact same list rather than a copy of
 * it — a copy would let the ordering below drift out from under the test that
 * is supposed to protect it.
 */
export const globalProviders: Provider[] = [
  // --- exception filters ------------------------------------------------
  //
  // ORDER MATTERS, and not in the obvious direction. Nest reverses the
  // global filter list and then picks the FIRST entry whose @Catch()
  // matches, so the last one registered here is consulted first.
  //
  // Registering the broadest filter first therefore makes it the fallback:
  //
  //   UnknownExceptionFilter  @Catch()               consulted last
  //   HttpExceptionFilter     @Catch(HttpException)  consulted second
  //   AppExceptionFilter      @Catch(AppError)       consulted first
  //
  // Flip this and @Catch() would swallow everything, and every business
  // error in the API would answer 500.
  { provide: APP_FILTER, useClass: UnknownExceptionFilter },
  { provide: APP_FILTER, useClass: HttpExceptionFilter },
  { provide: APP_FILTER, useClass: AppExceptionFilter },

  // --- interceptors -----------------------------------------------------
  { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },

  // --- pipes ------------------------------------------------------------
  {
    provide: APP_PIPE,
    useValue: new ValidationPipe({
      // DTOs declare class-validator types; without transform the values
      // arriving at a UseCase are still the raw strings from the query
      // string or JSON body.
      transform: true,
      // Strip properties no DTO declares. On a multi-tenant write API an
      // undeclared property is either a client mistake or an attempt to set
      // a field the DTO deliberately withholds (`tenantId`, `isActive`).
      whitelist: true,
      // Strip silently rather than reject: clients commonly send extra
      // metadata, and failing those requests buys nothing.
      forbidNonWhitelisted: false,
      // Validation failures come back in the project's error envelope with
      // a stable `type` per failed constraint. See @filter.
      exceptionFactory: validationExceptionFactory,
    }),
  },
];

@Module({
  imports: [SharedModule, HealthModule],
  providers: globalProviders,
})
export class MainModule {}
