import { Api } from '@decorator';
import { ResourceNotFoundError } from '@error';
import { Body, Controller, INestApplication, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Type } from 'class-transformer';
import { IsInt, IsString, Max, MinLength, ValidateNested } from 'class-validator';
import request from 'supertest';
import { globalProviders } from '../src/main.module';

/**
 * The error contract, end to end: every failure in the API — a business
 * error, a framework exception, a validation failure, an unhandled crash —
 * comes back in one envelope with a stable machine-readable `type`.
 *
 * Mounts `globalProviders` from main.module.ts rather than a copy, so the
 * filter *ordering* declared there is what is actually under test. Needs no
 * Postgres or Redis: nothing here imports MainModule.
 */

class RetryOptionsDto {
  @IsInt()
  @Max(10)
  maxAttempts!: number;
}

class ProbeDto {
  @IsString()
  @MinLength(3)
  name!: string;

  @ValidateNested()
  @Type(() => RetryOptionsDto)
  retry!: RetryOptionsDto;
}

@Controller('probe')
class ProbeController {
  @Api({ verb: 'GET', path: '/app-error', isPublic: true, swaggerSuccessResponse: null })
  appError(): never {
    // What a Controller does after `result instanceof AppError`.
    throw new ResourceNotFoundError('Subscription');
  }

  @Api({ verb: 'GET', path: '/crash', isPublic: true, swaggerSuccessResponse: null })
  crash(): never {
    throw new TypeError("Cannot read properties of undefined (reading 'id')");
  }

  @Api({ verb: 'POST', path: '/validate', isPublic: true, swaggerSuccessResponse: null })
  validate(@Body() dto: ProbeDto): { name: string } {
    return { name: dto.name };
  }
}

describe('Error envelope (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ProbeController],
      providers: globalProviders,
    }).compile();

    app = moduleRef.createNestApplication();
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('maps a thrown AppError to its own status and stable type', async () => {
    const response = await request(app.getHttpServer())
      .get('/v1/probe/app-error')
      .expect(404);

    // 404, not the blanket 400 the reference codebase answers for every
    // AppError.
    expect(response.body).toEqual({
      status: 404,
      message: 'Subscription not found',
      errors: [{ type: 'RESOURCE_NOT_FOUND', message: 'Subscription not found' }],
    });
  });

  it('catches an unhandled exception in the same envelope, leaking nothing', async () => {
    const response = await request(app.getHttpServer())
      .get('/v1/probe/crash')
      .expect(500);

    expect(response.body.errors[0].type).toBe('INTERNAL_SERVER_ERROR');
    // The TypeError's message would tell a caller about our internals.
    expect(JSON.stringify(response.body)).not.toContain('Cannot read properties');
  });

  it('reports every failed field of a validation failure, nested ones included', async () => {
    const response = await request(app.getHttpServer())
      .post('/v1/probe/validate')
      .send({ name: 'no', retry: { maxAttempts: 99 } })
      .expect(400);

    expect(response.body.status).toBe(400);
    const fields = response.body.errors.map((error: { field: string }) => error.field);
    expect(fields).toContain('name');
    // Nested children are flattened with a dotted path — the reference
    // implementation drops these entirely.
    expect(fields).toContain('retry.maxAttempts');
    expect(
      response.body.errors.every((error: { type: string }) => Boolean(error.type)),
    ).toBe(true);
  });

  it('answers an unknown route in the envelope too', async () => {
    const response = await request(app.getHttpServer()).get('/v1/nope').expect(404);

    expect(response.body.errors[0].type).toBe('NOT_FOUND');
  });

  it('strips properties no DTO declares', async () => {
    const response = await request(app.getHttpServer())
      .post('/v1/probe/validate')
      .send({ name: 'valid', retry: { maxAttempts: 3 }, tenantId: 'someone-elses' })
      .expect(201);

    expect(response.body).toEqual({ name: 'valid' });
  });
});
