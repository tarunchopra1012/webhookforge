import { Global, Module } from '@nestjs/common';
import { CacheModule } from './cache/cache.module';
import { DatabaseModule } from './database/database.module';

// The one sanctioned @Global() module — see .claude/rules/code-style.md.
// Everything else declares its imports explicitly.
@Global()
@Module({
  imports: [CacheModule, DatabaseModule],
  exports: [CacheModule, DatabaseModule],
})
export class SharedModule {}
