import { Api } from '@decorator';
import { Controller, VERSION_NEUTRAL } from '@nestjs/common';
import { HealthCheck, HealthCheckResult } from '@nestjs/terminus';
import { GetHealthUseCase } from './initiator/GetHealthUseCase';

/**
 * `VERSION_NEUTRAL`, so this stays at `/health` rather than `/v1/health`.
 *
 * URI versioning is on globally, but the probe path is a fixed contract: the
 * Docker Compose healthcheck, the CI job and the README all hit `/health`.
 * Versioning an endpoint whose consumers cannot be updated in step buys
 * nothing.
 */
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(private readonly getHealthUseCase: GetHealthUseCase) {}

  @Api({
    verb: 'GET',
    path: '/',
    isPublic: true,
    // Terminus builds the body from whichever indicators ran, so there is no
    // response class to point at — hence `swaggerResponses` rather than
    // `swaggerSuccessResponse`.
    swaggerResponses: [
      { status: 200, description: 'All dependencies reachable.' },
      {
        status: 503,
        description:
          "At least one dependency is down. The body is Terminus's indicator report, " +
          'not the standard error envelope — probes and dashboards consume it directly.',
      },
    ],
  })
  @HealthCheck()
  check(): Promise<HealthCheckResult> {
    return this.getHealthUseCase.execute();
  }
}
