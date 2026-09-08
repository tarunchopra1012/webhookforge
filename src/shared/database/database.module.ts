import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { config } from '@utils/config';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: config.db.host,
      port: config.db.port,
      username: config.db.username,
      password: config.db.password,
      database: config.db.database,
      // No entities yet — this module only establishes the connection the
      // health check pings. Slice 1 adds entities and migrations.
      entities: [],
      synchronize: false,
      autoLoadEntities: false,
    }),
  ],
  exports: [TypeOrmModule],
})
export class DatabaseModule {}
