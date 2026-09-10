import { METADATA } from '@constant';
import {
  BadRequestError,
  ForbiddenError,
  InternalServerError,
  UnauthorizedError,
} from '@error';
import {
  applyDecorators,
  Delete,
  Get,
  HttpCode,
  Patch,
  Post,
  Put,
  SetMetadata,
  Type,
} from '@nestjs/common';
import {
  ApiExcludeEndpoint,
  ApiExtraModels,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiResponseOptions,
  ApiSecurity,
  getSchemaPath,
  ApiBody,
  ApiBodyOptions,
  ApiParam,
  ApiParamOptions,
  ApiQuery,
  ApiQueryOptions,
} from '@nestjs/swagger';
import { AppError, Constructor, PaginatedResponse } from '@types';

/** The security scheme name registered by `DocumentBuilder` in `main.ts`. */
export const API_KEY_SECURITY = 'api-key';

/**
 * Marks a route as needing no API key. The guard reads this metadata key.
 *
 * Normally set through `@Api({ isPublic: true })`; exported for the rare
 * route that is not an `@Api()` endpoint.
 */
export const Public = (): MethodDecorator & ClassDecorator =>
  SetMetadata(METADATA.IS_PUBLIC_KEY, true);

type HttpVerb = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * Exactly one of these must be given. There is no default: an endpoint that
 * forgets to say whether it is authenticated will not compile, which is the
 * point — a missing auth decision on an ingest API is an unauthenticated
 * write, and that is not something to discover in review.
 */
type AuthOptions =
  { isPublic: true; requiresApiKey?: never } | { requiresApiKey: true; isPublic?: never };

/**
 * Either name a response model, or describe the responses by hand for the
 * endpoints whose body is not a class (the health check, for one).
 */
type ResponseOptions =
  | { swaggerSuccessResponse: Constructor<unknown> | null; swaggerResponses?: never }
  | { swaggerResponses: ApiResponseOptions[]; swaggerSuccessResponse?: never };

type ApiOptions = AuthOptions &
  ResponseOptions & {
    verb: HttpVerb;
    /** Route path relative to the controller, e.g. '/' or '/:id/retry'. */
    path: string;
    /** Overrides the verb's default (201 for POST, 200 otherwise). */
    swaggerSuccessResponseCode?: number;
    /** Error classes this endpoint can return. Drives the 4xx schema. */
    swaggerRequestErrors?: Constructor<AppError>[];
    swaggerRequestBody?: ApiBodyOptions;
    swaggerRequestParam?: ApiParamOptions;
    swaggerRequestQueries?: ApiQueryOptions[];
    deprecated?: boolean;
    excludeFromSwagger?: boolean;
  };

const ROUTE_DECORATOR: Record<HttpVerb, (path: string) => MethodDecorator> = {
  GET: Get,
  POST: Post,
  PUT: Put,
  PATCH: Patch,
  DELETE: Delete,
};

function defaultSuccessCode(verb: HttpVerb): number {
  return verb === 'POST' ? 201 : 200;
}

/**
 * The one decorator every endpoint in this codebase uses. See the design
 * notes in `.claude/rules/architecture.md`; in short, it binds the route,
 * the auth posture, the success shape and the failure shape together so
 * they cannot drift apart.
 */
export const Api = (options: ApiOptions): MethodDecorator => {
  const {
    verb,
    path,
    swaggerRequestErrors = [],
    swaggerRequestBody,
    swaggerRequestParam,
    swaggerRequestQueries,
    swaggerSuccessResponseCode,
    deprecated,
    excludeFromSwagger,
  } = options;

  const decorators: MethodDecorator[] = [ROUTE_DECORATOR[verb](path)];

  const successCode = swaggerSuccessResponseCode ?? defaultSuccessCode(verb);
  // Nest answers 201 to every POST by default; when an endpoint declares a
  // different success code, make the runtime agree with the document.
  if (successCode !== defaultSuccessCode(verb)) {
    decorators.push(HttpCode(successCode));
  }

  // --- auth -----------------------------------------------------------
  const isPublic = 'isPublic' in options && options.isPublic === true;
  if (isPublic) {
    decorators.push(Public());
  } else {
    decorators.push(ApiSecurity(API_KEY_SECURITY));
  }

  // --- request --------------------------------------------------------
  if (swaggerRequestBody) decorators.push(ApiBody(swaggerRequestBody));
  if (swaggerRequestParam) decorators.push(ApiParam(swaggerRequestParam));
  swaggerRequestQueries?.forEach((query) => decorators.push(ApiQuery(query)));

  // --- success --------------------------------------------------------
  if ('swaggerSuccessResponse' in options) {
    decorators.push(
      ApiResponse({
        status: successCode,
        type: options.swaggerSuccessResponse ?? undefined,
      }),
    );
  } else {
    options.swaggerResponses.forEach((response) =>
      decorators.push(ApiResponse(response)),
    );
  }

  // --- failure --------------------------------------------------------
  // Every endpoint can return these two regardless of what it declares.
  const alwaysPossible: Constructor<AppError>[] = isPublic
    ? [InternalServerError]
    : [UnauthorizedError, ForbiddenError, InternalServerError];

  const errorClasses = [...swaggerRequestErrors, ...alwaysPossible];

  // Referenced by $ref below, so each one has to be in the document. main.ts
  // registers every error class already; this keeps @Api() self-contained if
  // that ever changes.
  decorators.push(ApiExtraModels(...(errorClasses as Type<unknown>[])));

  const exampleError = new (swaggerRequestErrors[0] ?? BadRequestError)();
  decorators.push(
    ApiResponse({
      status: 400,
      description: 'Error envelope. `errors[].type` is the stable machine-readable code.',
      schema: {
        type: 'object',
        properties: {
          status: { type: 'number' },
          message: { type: 'string' },
          errors: {
            type: 'array',
            items: {
              oneOf: errorClasses.map((error) => ({ $ref: getSchemaPath(error) })),
            },
          },
        },
        example: {
          status: exampleError.status,
          message: exampleError.message,
          errors: [{ type: exampleError.type, message: exampleError.message }],
        },
      },
    }),
  );

  if (excludeFromSwagger) decorators.push(ApiExcludeEndpoint());

  const composed = applyDecorators(...decorators);

  return (
    target: object,
    propertyKey: string | symbol,
    descriptor: PropertyDescriptor,
  ) => {
    // No ApiTags() here. Nest's Swagger explorer already tags an operation
    // with its controller's name, so adding one derived from that same name —
    // as the reference codebase does — lands the tag in the document twice.
    //
    // The method name becomes the operationId, which is what generated
    // clients name their methods — so renaming a handler is a client-facing
    // change, deliberately.
    ApiOperation({ operationId: String(propertyKey), deprecated })(
      target,
      propertyKey,
      descriptor,
    );
    return composed(target, propertyKey, descriptor);
  };
};

/**
 * Documents a `PaginatedResponse<Model>` body.
 *
 * A generic type argument is erased before Swagger's reflection runs, so
 * `PaginatedResponse<Subscription>` alone would document `data` as an
 * untyped array. This composes the envelope schema with an explicit item
 * `$ref`.
 */
export const ApiPaginatedResponse = <TModel extends Constructor<unknown>>(
  model: TModel,
  description?: string,
): MethodDecorator =>
  applyDecorators(
    ApiExtraModels(PaginatedResponse, model),
    ApiOkResponse({
      description,
      schema: {
        allOf: [
          { $ref: getSchemaPath(PaginatedResponse) },
          {
            properties: {
              data: { type: 'array', items: { $ref: getSchemaPath(model) } },
            },
          },
        ],
      },
    }),
  );
