import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { SupabaseService } from '../../database/supabase.service';
import { CacheService } from '../../shared/cache/cache.service';
import { LoggerService } from '../../shared/logger/logger.service';

@Module({
  controllers: [UsersController],
  providers: [UsersService, SupabaseService, CacheService, LoggerService],
  exports: [UsersService],
})
export class UsersModule {}
