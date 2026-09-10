import 'dotenv/config';
import { plainToInstance, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  validateSync,
} from 'class-validator';

type NodeEnv = 'development' | 'test' | 'production';

// Validated once at import time. The `!` assertions below are safe because
// validateSync(), run immediately after, throws before `config` is ever
// exported if any of these are missing or malformed — the guard just lives
// a few lines below the declaration instead of above each usage site.
//
// Numeric fields need an explicit @Type(() => Number): class-transformer's
// `enableImplicitConversion` reads reflect-metadata design:type to coerce
// env strings, and that inference is unreliable in practice — @Type() makes
// the conversion explicit instead of depending on it.
class EnvironmentVariables {
  @IsIn(['development', 'test', 'production'])
  NODE_ENV: NodeEnv = 'development';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT = 3000;

  @IsString()
  POSTGRES_HOST!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  POSTGRES_PORT!: number;

  @IsString()
  POSTGRES_USER!: string;

  @IsString()
  POSTGRES_PASSWORD!: string;

  @IsString()
  POSTGRES_DB!: string;

  @IsString()
  REDIS_HOST!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  REDIS_PORT!: number;

  @IsOptional()
  @IsString()
  REDIS_PASSWORD?: string;

  /**
   * The no-color.org convention: any non-empty value disables ANSI colour in
   * the log output. Set it when piping logs to a file, where the escape codes
   * are just noise.
   */
  @IsOptional()
  @IsString()
  NO_COLOR?: string;
}

function loadEnv(): EnvironmentVariables {
  const env = plainToInstance(EnvironmentVariables, process.env, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(env, { skipMissingProperties: false });
  if (errors.length > 0) {
    const detail = errors
      .map((error) => Object.values(error.constraints ?? {}).join(', '))
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${detail}`);
  }

  return env;
}

const env = loadEnv();

export interface AppConfig {
  nodeEnv: NodeEnv;
  port: number;
  db: {
    host: string;
    port: number;
    username: string;
    password: string;
    database: string;
  };
  redis: {
    host: string;
    port: number;
    password?: string;
  };
  log: {
    /** Whether to write ANSI colour codes. See NO_COLOR above. */
    color: boolean;
  };
}

export const config: AppConfig = {
  nodeEnv: env.NODE_ENV,
  port: env.PORT,
  db: {
    host: env.POSTGRES_HOST,
    port: env.POSTGRES_PORT,
    username: env.POSTGRES_USER,
    password: env.POSTGRES_PASSWORD,
    database: env.POSTGRES_DB,
  },
  redis: {
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    password: env.REDIS_PASSWORD,
  },
  log: {
    // Deliberately not gated on `process.stdout.isTTY`. A container started by
    // `docker compose up -d` has no TTY, so a TTY check would strip the colour
    // from `docker logs` — the one place it is most useful. Production writes
    // JSON, which is never coloured, so this only affects the human format.
    color: !env.NO_COLOR,
  },
};
