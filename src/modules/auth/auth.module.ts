import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SupabaseService } from '../../database/supabase.service';
import { CacheService } from '../../shared/cache/cache.service';
import { LoggerService } from '../../shared/logger/logger.service';

@Module({
  controllers: [AuthController],
  providers: [AuthService, SupabaseService, CacheService, LoggerService],
  exports: [AuthService],
})
export class AuthModule {}
