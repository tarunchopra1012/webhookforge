import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckResult } from '@nestjs/terminus';
import { GetHealthUseCase } from './initiator/GetHealthUseCase';

@Controller('health')
export class HealthController {
  constructor(private readonly getHealthUseCase: GetHealthUseCase) {}

  // Bare @Get() rather than the project's @Api() decorator: @Api() lives in
  // utils/decorator.ts, part of the Slice 1 platform spine that doesn't
  // exist yet in this scaffold.
  @Get()
  @HealthCheck()
  check(): Promise<HealthCheckResult> {
    return this.getHealthUseCase.execute();
  }
}
