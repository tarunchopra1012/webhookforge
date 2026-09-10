import { AppError, AppErrorType } from '@types';

/*
 * Every error in the application is declared here, exactly once.
 *
 * `main.ts` registers `Object.values(AllErrors)` as Swagger `extraModels`,
 * so this file must export error classes and nothing else — a stray helper
 * export would land in the OpenAPI document as a bogus schema.
 *
 * Two statics per class:
 *   `_type`   — the stable contract string clients branch on.
 *   `_status` — the HTTP status the AppExceptionFilter sends. Omit it to
 *               inherit 400.
 */

// ---------------------------------------------------------------------------
// Platform / HTTP
// ---------------------------------------------------------------------------

export class InternalServerError extends AppError {
  static _type = AppErrorType.InternalServerError;
  static _status = 500;
  protected _message = 'Something went wrong. Please try again later';
}

export class BadRequestError extends AppError {
  static _type = AppErrorType.BadRequestError;
  static _status = 400;
  protected _message = 'Please check the request and try again';

  constructor(message?: string) {
    super('Application');
    this._message = message ?? this._message;
  }
}

export class UnauthorizedError extends AppError {
  static _type = AppErrorType.UnauthorizedError;
  static _status = 401;
  protected _message = 'A valid API key is required';
}

export class ForbiddenError extends AppError {
  static _type = AppErrorType.ForbiddenError;
  static _status = 403;
  protected _message = 'This API key may not perform that action';
}

export class NotFoundError extends AppError {
  static _type = AppErrorType.NotFoundError;
  static _status = 404;
  protected _message = 'The requested route does not exist';
}

export class RequestTimeoutError extends AppError {
  static _type = AppErrorType.RequestTimeoutError;
  static _status = 408;
  protected _message = 'The request took too long and was aborted';
}

// ---------------------------------------------------------------------------
// Persistence
//
// These are what `BaseRepository` returns. A concrete repository is free to
// return a more specific error of its own instead — `SubscriptionNotFound`
// rather than the generic `ResourceNotFound` — so a UseCase can tell the
// cases apart with `instanceof`.
// ---------------------------------------------------------------------------

export class ResourceNotFoundError extends AppError {
  static _type = AppErrorType.ResourceNotFoundError;
  static _status = 404;
  protected _message = 'Resource not found';

  constructor(resource = 'Resource') {
    super('Application');
    this._message = `${resource} not found`;
  }
}

export class FailedToFetchResourceError extends AppError {
  static _type = AppErrorType.FailedToFetchResourceError;
  static _status = 500;
  protected _message = 'Failed to read from storage. Please try again later';

  constructor(resource = 'Resource', cause?: unknown) {
    super('External', cause);
    this._message = `Failed to read ${resource}. Please try again later`;
  }
}

export class FailedToSaveResourceError extends AppError {
  static _type = AppErrorType.FailedToSaveResourceError;
  static _status = 500;
  protected _message = 'Failed to write to storage. Please try again later';

  constructor(resource = 'Resource', cause?: unknown) {
    super('External', cause);
    this._message = `Failed to save ${resource}. Please try again later`;
  }
}

export class FailedToDeleteResourceError extends AppError {
  static _type = AppErrorType.FailedToDeleteResourceError;
  static _status = 500;
  protected _message = 'Failed to delete from storage. Please try again later';

  constructor(resource = 'Resource', cause?: unknown) {
    super('External', cause);
    this._message = `Failed to delete ${resource}. Please try again later`;
  }
}

export class TransactionFailedError extends AppError {
  static _type = AppErrorType.TransactionFailedError;
  static _status = 500;
  protected _message = 'The operation could not be completed. Nothing was saved';

  constructor(cause?: unknown) {
    super('External', cause);
  }
}

// ---------------------------------------------------------------------------
// Validation
//
// One per class-validator constraint used by the field decorators in
// `@decorator`. Each decorator attaches an instance as the constraint's
// `context.appError`, and `validationExceptionFactory` in `@filter` reads it
// back out. That indirection is what keeps a validation failure inside the
// same error envelope as every other failure.
// ---------------------------------------------------------------------------

export class ValidationError extends AppError {
  static _type = AppErrorType.ValidationError;
  static _status = 400;
  protected _message = 'Validation failed';

  constructor(message?: string) {
    super('Application');
    this._message = message ?? this._message;
  }
}

export class RequiredFieldValidationError extends AppError {
  static _type = AppErrorType.RequiredFieldValidationError;
  protected _message = 'This field is required';
}

export class InvalidStringValidationError extends AppError {
  static _type = AppErrorType.InvalidStringValidationError;
  protected _message = 'Must be a string';
}

export class InvalidIntValidationError extends AppError {
  static _type = AppErrorType.InvalidIntValidationError;
  protected _message = 'Must be a whole number';
}

export class InvalidNumberValidationError extends AppError {
  static _type = AppErrorType.InvalidNumberValidationError;
  protected _message = 'Must be a number';
}

export class InvalidBooleanValidationError extends AppError {
  static _type = AppErrorType.InvalidBooleanValidationError;
  protected _message = 'Must be true or false';
}

export class InvalidDateValidationError extends AppError {
  static _type = AppErrorType.InvalidDateValidationError;
  protected _message = 'Must be an ISO 8601 date string';
}

export class InvalidEmailValidationError extends AppError {
  static _type = AppErrorType.InvalidEmailValidationError;
  protected _message = 'Must be a valid email address';
}

export class InvalidUuidValidationError extends AppError {
  static _type = AppErrorType.InvalidUuidValidationError;
  protected _message = 'Must be a UUID';
}

export class InvalidUrlValidationError extends AppError {
  static _type = AppErrorType.InvalidUrlValidationError;
  protected _message = 'Must be a valid URL';
}

export class InvalidEnumValidationError extends AppError {
  static _type = AppErrorType.InvalidEnumValidationError;
  protected _message = 'Must be one of the allowed values';
}

export class InvalidObjectValidationError extends AppError {
  static _type = AppErrorType.InvalidObjectValidationError;
  protected _message = 'Must be an object';
}

export class InvalidArrayValidationError extends AppError {
  static _type = AppErrorType.InvalidArrayValidationError;
  protected _message = 'Must be an array';
}

export class MinNumberValidationError extends AppError {
  static _type = AppErrorType.MinNumberValidationError;
  protected _message = 'Value is too small';

  constructor(min?: number) {
    super('Application');
    this._message = min === undefined ? this._message : `Must be at least ${min}`;
  }
}

export class MaxNumberValidationError extends AppError {
  static _type = AppErrorType.MaxNumberValidationError;
  protected _message = 'Value is too large';

  constructor(max?: number) {
    super('Application');
    this._message = max === undefined ? this._message : `Must be at most ${max}`;
  }
}

export class MinStringLengthValidationError extends AppError {
  static _type = AppErrorType.MinStringLengthValidationError;
  protected _message = 'Value is too short';

  constructor(minLength?: number) {
    super('Application');
    this._message =
      minLength === undefined
        ? this._message
        : `Must be at least ${minLength} characters`;
  }
}

export class MaxStringLengthValidationError extends AppError {
  static _type = AppErrorType.MaxStringLengthValidationError;
  protected _message = 'Value is too long';

  constructor(maxLength?: number) {
    super('Application');
    this._message =
      maxLength === undefined ? this._message : `Must be at most ${maxLength} characters`;
  }
}

export class NotMatchingRegexValidationError extends AppError {
  static _type = AppErrorType.NotMatchingRegexValidationError;
  protected _message = 'Value is not in the expected format';

  constructor(pattern?: RegExp) {
    super('Application');
    this._message = pattern ? `Value must match ${pattern.toString()}` : this._message;
  }
}

export class NotOneOfValuesValidationError extends AppError {
  static _type = AppErrorType.NotOneOfValuesValidationError;
  protected _message = 'Value is not one of the allowed values';

  constructor(possibleValues?: readonly (string | number)[]) {
    super('Application');
    this._message = possibleValues?.length
      ? `Must be one of: ${possibleValues.join(', ')}`
      : this._message;
  }
}
