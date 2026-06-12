import { Global, Module } from '@nestjs/common';
import { CacheService } from './cache/cache.service';
import { LoggerService } from './logger/logger.service';

@Global()
@Module({
  providers: [CacheService, LoggerService],
  exports: [CacheService, LoggerService],
})
export class SharedModule {}
