import 'reflect-metadata';
import { config } from '@config';
import { entities } from '@persistence/index';
import { DataSource } from 'typeorm';

/**
 * The standalone DataSource the TypeORM CLI points at:
 *
 *   npm run migration:generate -- src/shared/database/migration/CreateTenantsTable
 *   npm run migration:run
 *   npm run migration:revert
 *
 * Separate from the connection `DatabaseModule` opens, because the CLI has to
 * work without booting Nest. Both read the same `entities` array, so a
 * generated migration always diffs against the schema the app will actually
 * use.
 *
 * ## Migrations run natively against localhost, not inside the container
 *
 * The reference codebase shells into its app container (`docker compose exec`)
 * because that is the only place its app exists. Here the app runs on the host
 * for the dev loop and the container is an opt-in `app` profile, so
 * `docker compose exec` would fail whenever that profile is down. Postgres is
 * published on localhost:5432 either way, so the CLI talks to it directly and
 * the commands work in both modes.
 *
 * `typeorm-ts-node-commonjs` is the right CLI wrapper here — not the `-esm`
 * variant the reference uses — because this project compiles to CommonJS. The
 * `ts-node.require` entry in tsconfig.json loads `tsconfig-paths/register`,
 * which is what makes the `@config` and `@persistence` aliases above resolve
 * under the CLI.
 */
const isTypeScriptRuntime = __filename.endsWith('.ts');

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: config.db.host,
  port: config.db.port,
  username: config.db.username,
  password: config.db.password,
  database: config.db.database,
  entities,
  // Never true, in any environment. Schema changes go through a reviewed
  // migration or they do not happen.
  synchronize: false,
  // Under ts-node the migration files are .ts next to their source; in a
  // built image they are .js under dist. A single glob cannot match both.
  migrations: isTypeScriptRuntime
    ? ['src/shared/database/migration/*.ts']
    : ['dist/**/migration/*.js'],
  // The app does not migrate itself on boot: two replicas starting together
  // would both try, and a failed migration would take the service down with
  // it. `migration:run` is a deliberate step in the deploy.
  migrationsRun: false,
  migrationsTableName: 'migrations',
  logging:
    config.nodeEnv === 'development'
      ? ['error', 'warn', 'migration', 'schema']
      : ['error'],
});
