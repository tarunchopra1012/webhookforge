import { METADATA } from '@constant';
import { Api, API_KEY_SECURITY, Public } from '@decorator';
import { Controller } from '@nestjs/common';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';

/**
 * @nestjs/swagger's own metadata key. Not exported from the package's public
 * entry point, so it is spelled out here — if a future version renames it,
 * this test fails loudly rather than the security scheme silently vanishing
 * from the OpenAPI document.
 */
const API_SECURITY_METADATA = 'swagger/apiSecurity';

@Controller('probe')
class ProbeController {
  @Api({ verb: 'POST', path: '/', requiresApiKey: true, swaggerSuccessResponse: null })
  create(): void {}

  @Api({ verb: 'GET', path: '/:id', isPublic: true, swaggerSuccessResponse: null })
  read(): void {}
}

function handler(name: keyof ProbeController): (...args: unknown[]) => unknown {
  const descriptor = Object.getOwnPropertyDescriptor(ProbeController.prototype, name);
  return descriptor?.value as (...args: unknown[]) => unknown;
}

describe('@Api()', () => {
  it('binds the verb and path', () => {
    expect(Reflect.getMetadata(PATH_METADATA, handler('create'))).toBe('/');
    expect(Reflect.getMetadata(METHOD_METADATA, handler('create'))).toBe(
      RequestMethod.POST,
    );
    expect(Reflect.getMetadata(PATH_METADATA, handler('read'))).toBe('/:id');
    expect(Reflect.getMetadata(METHOD_METADATA, handler('read'))).toBe(RequestMethod.GET);
  });

  it('marks a public endpoint with the metadata key the guard reads', () => {
    // If this key ever stops being set, every public route starts demanding
    // an API key — noisy, but safe.
    expect(Reflect.getMetadata(METADATA.IS_PUBLIC_KEY, handler('read'))).toBe(true);
  });

  it('leaves an authenticated endpoint unmarked and attaches the security scheme', () => {
    // And this is the dangerous direction: an authenticated route wrongly
    // carrying the public flag is an unauthenticated write.
    expect(
      Reflect.getMetadata(METADATA.IS_PUBLIC_KEY, handler('create')),
    ).toBeUndefined();
    expect(Reflect.getMetadata(API_SECURITY_METADATA, handler('create'))).toEqual([
      { [API_KEY_SECURITY]: [] },
    ]);
  });

  it('exposes Public() for routes that are not @Api() endpoints', () => {
    class Bare {
      ping(): void {}
    }
    Public()(
      Bare.prototype,
      'ping',
      Object.getOwnPropertyDescriptor(Bare.prototype, 'ping')!,
    );

    expect(
      Reflect.getMetadata(
        METADATA.IS_PUBLIC_KEY,
        Object.getOwnPropertyDescriptor(Bare.prototype, 'ping')?.value,
      ),
    ).toBe(true);
  });
});
