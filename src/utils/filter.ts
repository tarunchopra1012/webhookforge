import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  ServiceUnavailableException,
  ValidationError as ClassValidatorError,
} from '@nestjs/common';
import {
  BadRequestError,
  ForbiddenError,
  InternalServerError,
  NotFoundError,
  RequestTimeoutError,
  UnauthorizedError,
  ValidationError,
} from '@error';
import { LogService } from '@logger';
import { AppError } from '@types';
import { Response } from 'express';

/**
 * The single response shape for every failure in the API.
 *
 * `errors` is a list because validation can fail on several fields at once;
 * everything else puts exactly one entry in it. `message` repeats the first
 * error so a client that only surfaces a string has something to show.
 */
interface ErrorEnvelope {
  status: number;
  message: string;
  errors: SerialisedError[];
}

interface SerialisedError {
  type: string;
  message: string;
  /** Present only for validation failures: the DTO property that failed. */
  field?: string;
}

function serialise(error: AppError, field?: string): SerialisedError {
  return {
    type: error.type,
    message: error.message,
    ...(field ? { field } : {}),
  };
}

/** Anything at or above this is our bug, not the client's. */
const SERVER_ERROR_FLOOR = 500;

/**
 * Status code to AppError. A lookup table rather than a switch because
 * `HttpException.getStatus()` is typed `number`, and comparing a plain number
 * against enum members is exactly the mismatch `no-unsafe-enum-comparison`
 * exists to catch. Computed keys sidestep it and read better anyway.
 */
const ERROR_BY_STATUS: Record<number, () => AppError> = {
  [HttpStatus.UNAUTHORIZED]: () => new UnauthorizedError(),
  [HttpStatus.FORBIDDEN]: () => new ForbiddenError(),
  [HttpStatus.NOT_FOUND]: () => new NotFoundError(),
  [HttpStatus.REQUEST_TIMEOUT]: () => new RequestTimeoutError(),
};

function envelope(status: number, errors: SerialisedError[]): ErrorEnvelope {
  return {
    status,
    message: errors[0]?.message ?? 'Something went wrong',
    errors,
  };
}

/**
 * Catches the AppErrors a Controller throws after its `instanceof` check.
 *
 * This is the normal failure path of the application: a UseCase returned an
 * error value, the Controller rethrew it, and the HTTP status comes from the
 * error class's own `_status`. The reference codebase answers 400 for
 * everything here, which makes "not found" and "conflict" indistinguishable
 * to a client; mapping per class costs one static field and is the first
 * thing an interviewer pokes at.
 */
@Catch(AppError)
export class AppExceptionFilter implements ExceptionFilter<AppError> {
  private readonly logger = new LogService(AppExceptionFilter.name);

  catch(exception: AppError, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<{ method?: string; url?: string }>();
    const status = exception.status;

    const where = `${request.method ?? '?'} ${request.url ?? '?'}`;
    // A 4xx is the API working as designed — reporting it at error level
    // trains people to ignore the error log. Only 5xx is our bug.
    if (status >= SERVER_ERROR_FLOOR) {
      this.logger.error(`${exception.type} on ${where}: ${exception.message}`, {
        source: exception.source,
        cause: exception.cause,
      });
    } else {
      this.logger.debug(`${exception.type} on ${where}: ${exception.message}`);
    }

    response.status(status).json(envelope(status, [serialise(exception)]));
  }
}

/**
 * Catches everything Nest itself throws — a failed guard, an unmatched
 * route, a payload over the body limit, the validation pipe — and rewrites
 * it into the same envelope, so a client needs exactly one error parser.
 *
 * Mapping is by status code rather than by exception class. The reference
 * codebase tests `instanceof` against a handful of exception types and falls
 * through to a generic 400 for the rest, which silently mislabels every
 * status it has not enumerated (413, 415, 429 …).
 */
@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter<HttpException> {
  private readonly logger = new LogService(HttpExceptionFilter.name);

  catch(exception: HttpException, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<{ method?: string; url?: string }>();
    const status = exception.getStatus();
    const body = exception.getResponse();

    // Terminus reports a failing health check as a ServiceUnavailableException
    // whose body is the structured indicator report. That body is a contract
    // with probes and dashboards, not an API error for a client, so it passes
    // through untouched.
    if (exception instanceof ServiceUnavailableException) {
      this.logger.warn(`Health check reported down on ${request.url ?? '?'}`);
      response.status(status).json(body);
      return;
    }

    const errors = this.toErrors(status, body);

    if (status >= SERVER_ERROR_FLOOR) {
      this.logger.error(
        new Error(`${status} on ${request.method ?? '?'} ${request.url ?? '?'}`, {
          cause: exception,
        }),
      );
    } else {
      this.logger.debug(
        `${status} on ${request.method ?? '?'} ${request.url ?? '?'}: ${
          errors[0]?.message ?? ''
        }`,
      );
    }

    response.status(status).json(envelope(status, errors));
  }

  private toErrors(status: number, body: string | object): SerialisedError[] {
    // The validation pipe already produced our envelope — keep it verbatim so
    // per-field errors survive.
    if (isErrorEnvelope(body)) {
      return body.errors;
    }

    const factory = ERROR_BY_STATUS[status];
    if (factory) return [serialise(factory())];

    // Any other 5xx: report it, but never forward the internal message to the
    // client — it routinely carries a driver error or a stack fragment.
    if (status >= SERVER_ERROR_FLOOR) return [serialise(new InternalServerError())];

    const message = typeof body === 'string' ? body : extractMessage(body);
    return [serialise(new BadRequestError(message))];
  }
}

/**
 * Last resort: anything that is neither an AppError nor an HttpException —
 * a TypeError, a driver-level failure that escaped a repository, a rejected
 * promise nobody checked.
 *
 * Without this, Nest's built-in filter answers with its own body shape and
 * the API has two error formats, one of which only appears when something is
 * already badly wrong. Registered FIRST in `main.module.ts`, because Nest
 * reverses the global filter list and picks the first match — see the note
 * there.
 */
@Catch()
export class UnknownExceptionFilter implements ExceptionFilter {
  private readonly logger = new LogService(UnknownExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<{ method?: string; url?: string }>();

    this.logger.error(
      new Error(`Unhandled exception on ${request.method ?? '?'} ${request.url ?? '?'}`, {
        cause: exception,
      }),
    );

    const error = new InternalServerError();
    response
      .status(HttpStatus.INTERNAL_SERVER_ERROR)
      .json(envelope(HttpStatus.INTERNAL_SERVER_ERROR, [serialise(error)]));
  }
}

/**
 * Turns class-validator failures into the project's error envelope.
 *
 * Wired as the global ValidationPipe's `exceptionFactory` in
 * `main.module.ts`. The field decorators in `@decorator` attach an AppError
 * instance to each constraint's `context`, and this reads it back out — that
 * indirection is what gives a validation failure the same stable `type`
 * string as every other failure.
 *
 * Two things the reference implementation gets wrong and this does not:
 *
 *  - It drops any constraint that has no `appError` context, so one missing
 *    context turns a 400 into `errors: []` and the client learns nothing.
 *    Here an un-annotated constraint falls back to its own message.
 *  - It ignores `children`, so nested object and array DTOs report nothing.
 *    Here the tree is flattened with a dotted path.
 */
export function validationExceptionFactory(errors: ClassValidatorError[]): HttpException {
  const flattened = flatten(errors);
  const status = HttpStatus.BAD_REQUEST;
  return new HttpException(
    {
      status,
      message: flattened[0]?.message ?? 'Validation failed',
      errors: flattened,
    } satisfies ErrorEnvelope,
    status,
  );
}

function flatten(errors: ClassValidatorError[], parentPath = ''): SerialisedError[] {
  const out: SerialisedError[] = [];

  for (const error of errors) {
    const path = parentPath ? `${parentPath}.${error.property}` : error.property;

    for (const [constraint, message] of Object.entries(error.constraints ?? {})) {
      const appError = readAppErrorContext(error.contexts, constraint);
      out.push(
        appError
          ? serialise(appError, path)
          : serialise(new ValidationError(message), path),
      );
    }

    if (error.children?.length) {
      out.push(...flatten(error.children, path));
    }
  }

  return out;
}

/**
 * Digs the AppError a field decorator attached to a constraint's `context`
 * out of class-validator's `contexts`, which is typed `any`. Narrowed by
 * hand rather than asserted, so nothing downstream is typed on trust.
 */
function readAppErrorContext(
  contexts: unknown,
  constraint: string,
): AppError | undefined {
  if (!isRecord(contexts)) return undefined;
  const context = contexts[constraint];
  if (!isRecord(context)) return undefined;
  const candidate = context['appError'];
  return candidate instanceof AppError ? candidate : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isErrorEnvelope(body: unknown): body is ErrorEnvelope {
  return (
    typeof body === 'object' &&
    body !== null &&
    'errors' in body &&
    Array.isArray(body.errors)
  );
}

function extractMessage(body: object): string {
  const message = (body as { message?: unknown }).message;
  if (typeof message === 'string') return message;
  if (Array.isArray(message)) return message.join(', ');
  return 'Please check the request and try again';
}
