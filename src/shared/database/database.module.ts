import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { config } from '@utils/config';
import { TransactionHelper } from './helper';
import { entities } from './persistence';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: config.db.host,
      port: config.db.port,
      username: config.db.username,
      password: config.db.password,
      database: config.db.database,
      // The same array `src/orm.ts` gives the migration CLI, so the schema the
      // app expects and the schema the migrations produce cannot drift.
      entities,
      // Non-negotiable. See src/orm.ts.
      synchronize: false,
      autoLoadEntities: false,
      migrationsRun: false,
    }),
  ],
  providers: [TransactionHelper],
  exports: [TypeOrmModule, TransactionHelper],
})
export class DatabaseModule {}
