import { ApiProperty } from '@nestjs/swagger';

/**
 * A class reference usable with `new`. Used wherever a class itself is passed
 * as a value — Swagger response models, the error list on `@Api()`.
 *
 * `never[]` rather than `any[]`: `code-style.md` bans `any`, and a rest
 * parameter of `never[]` still accepts every class, because parameter
 * assignability runs the other way (target `never` is assignable to any
 * source parameter type).
 */
export type Constructor<I> = new (...args: never[]) => I;

/**
 * Stable, machine-readable error identifiers.
 *
 * These strings are part of the public API contract: clients branch on them.
 * Renaming a value is a breaking change — add a new one instead.
 */
export enum AppErrorType {
  // Platform / HTTP
  InternalServerError = 'INTERNAL_SERVER_ERROR',
  BadRequestError = 'BAD_REQUEST',
  UnauthorizedError = 'UNAUTHORIZED',
  ForbiddenError = 'FORBIDDEN',
  NotFoundError = 'NOT_FOUND',
  RequestTimeoutError = 'REQUEST_TIMEOUT',

  // Persistence
  ResourceNotFoundError = 'RESOURCE_NOT_FOUND',
  FailedToFetchResourceError = 'FAILED_TO_FETCH_RESOURCE',
  FailedToSaveResourceError = 'FAILED_TO_SAVE_RESOURCE',
  FailedToDeleteResourceError = 'FAILED_TO_DELETE_RESOURCE',
  TransactionFailedError = 'TRANSACTION_FAILED',

  // Validation
  ValidationError = 'VALIDATION_ERROR',
  RequiredFieldValidationError = 'VALIDATION_REQUIRED_FIELD',
  InvalidStringValidationError = 'VALIDATION_INVALID_STRING',
  InvalidIntValidationError = 'VALIDATION_INVALID_INT',
  InvalidNumberValidationError = 'VALIDATION_INVALID_NUMBER',
  InvalidBooleanValidationError = 'VALIDATION_INVALID_BOOLEAN',
  InvalidDateValidationError = 'VALIDATION_INVALID_DATE',
  InvalidEmailValidationError = 'VALIDATION_INVALID_EMAIL',
  InvalidUuidValidationError = 'VALIDATION_INVALID_UUID',
  InvalidUrlValidationError = 'VALIDATION_INVALID_URL',
  InvalidEnumValidationError = 'VALIDATION_INVALID_ENUM',
  InvalidObjectValidationError = 'VALIDATION_INVALID_OBJECT',
  InvalidArrayValidationError = 'VALIDATION_INVALID_ARRAY',
  MinNumberValidationError = 'VALIDATION_MIN_NUMBER',
  MaxNumberValidationError = 'VALIDATION_MAX_NUMBER',
  MinStringLengthValidationError = 'VALIDATION_MIN_LENGTH',
  MaxStringLengthValidationError = 'VALIDATION_MAX_LENGTH',
  NotMatchingRegexValidationError = 'VALIDATION_PATTERN_MISMATCH',
  NotOneOfValuesValidationError = 'VALIDATION_NOT_ONE_OF',
}

/**
 * The base of every error in this codebase.
 *
 * Errors are *values*, not exceptions: Services, UseCases, Ports and
 * Repositories return `Promise<T | AppError>` and never throw. Only the
 * Controller throws, after an `instanceof AppError` check, and the global
 * `AppExceptionFilter` turns the thrown value into the response envelope.
 *
 * Deliberately NOT a subclass of `Error`. An `AppError` is a domain outcome
 * that happens to travel by `throw` at exactly one boundary; keeping it off
 * the `Error` prototype means a stray `catch (e)` elsewhere cannot mistake a
 * real crash for a business outcome, and vice versa.
 *
 * Subclasses live in `src/error.ts` and set two statics:
 *   `_type`   — the stable contract string (see `AppErrorType`)
 *   `_status` — the HTTP status the filter should send
 */
export abstract class AppError {
  /** Overridden by every concrete subclass. */
  static _type: AppErrorType;

  /**
   * HTTP status for this error class. Defaults to 400 so a new error is
   * safe by omission; override it when the condition is really a 404, 409,
   * 500 and so on.
   */
  static _status = 400;

  protected _message = 'Something went wrong';

  // No `example` here: this property is declared once on the base and
  // inherited by every subclass, so any example given would be wrong for all
  // but one of them. The realistic example lives on the per-endpoint 400
  // response that `@Api()` emits, built from that endpoint's own errors.
  @ApiProperty({ type: 'string' })
  get message(): string {
    return this._message;
  }

  @ApiProperty({
    type: 'string',
    enum: AppErrorType,
    enumName: 'ErrorType',
  })
  get type(): AppErrorType {
    return this.self._type;
  }

  get status(): number {
    return this.self._status;
  }

  /**
   * `this.constructor` is typed as `Function`, which loses the statics. This
   * one narrowing cast is what lets `type` and `status` read the subclass's
   * own values without an `any` anywhere.
   */
  private get self(): typeof AppError {
    return this.constructor as typeof AppError;
  }

  constructor(
    /**
     * Whose fault the failure was. `External` marks a dependency failure
     * (Postgres, Redis, a subscriber endpoint) and is what makes the logs
     * separable when a delivery worker starts failing.
     */
    readonly source: 'Application' | 'External' = 'Application',
    /** Original stack or cause, for logging only. Never serialised. */
    readonly cause?: unknown,
  ) {}
}

/**
 * The shape every list endpoint returns.
 *
 * `data` has no `@ApiProperty` here — a generic type argument is erased
 * before Swagger sees it. Use the `@ApiPaginatedResponse(Model)` decorator
 * from `@decorator` on the controller method to document the item type.
 */
export class PaginatedResponse<T> {
  data: T[];

  @ApiProperty({ type: 'integer', example: 137, description: 'Total matching rows.' })
  total: number;

  @ApiProperty({ type: 'integer', example: 1, description: '1-based page number.' })
  page: number;

  @ApiProperty({ type: 'integer', example: 20 })
  limit: number;

  @ApiProperty({ type: 'integer', example: 7 })
  totalPages: number;

  @ApiProperty({ type: 'boolean', example: true })
  hasNextPage: boolean;

  constructor(data: T[], total: number, page: number, limit: number) {
    this.data = data;
    this.total = total;
    this.page = page;
    this.limit = limit;
    // A limit of 0 would divide by zero; treat it as a single page.
    this.totalPages = limit > 0 ? Math.ceil(total / limit) : 1;
    this.hasNextPage = page < this.totalPages;
  }
}

/** What a repository returns for a page: the rows plus the unpaged count. */
export interface Page<T> {
  rows: T[];
  total: number;
}

/** Normalised `page`/`limit` after DTO validation and defaulting. */
export interface PaginationParams {
  page: number;
  limit: number;
}
