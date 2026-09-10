import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { LogService } from '@logger';
import { Observable, tap } from 'rxjs';

/** Probes hit this every few seconds; logging it drowns everything else. */
const IGNORED_PREFIXES = ['/health', '/api', '/metrics'];

/**
 * One line per request, on the way out, with the elapsed time.
 *
 * `code-style.md` says to log at boundaries — this is the HTTP boundary. It
 * deliberately logs no request body: on the ingest endpoint that body is the
 * tenant's event payload.
 *
 * The failure branch matters as much as the success one. A request that
 * throws still took time, and without the error branch the slow failing
 * requests are exactly the ones missing from the timing log.
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new LogService('REQUEST');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const http = context.switchToHttp();
    const request = http.getRequest<{ method: string; url: string }>();
    const response = http.getResponse<{ statusCode: number }>();

    if (IGNORED_PREFIXES.some((prefix) => request.url.startsWith(prefix))) {
      return next.handle();
    }

    const startedAt = Date.now();
    const where = `${request.method} ${request.url}`;

    return next.handle().pipe(
      tap({
        next: () => {
          this.logger.log(
            `${where} ${response.statusCode} - ${Date.now() - startedAt}ms`,
          );
        },
        error: (error: unknown) => {
          // Status is not set on the response yet — the filters run after
          // this. Log the outcome; the filter logs the detail.
          const label = error instanceof Error ? error.name : 'error';
          this.logger.log(`${where} ${label} - ${Date.now() - startedAt}ms`);
        },
      }),
    );
  }
}
