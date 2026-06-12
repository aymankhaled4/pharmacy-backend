import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { SupabaseService } from '../../database/supabase.service';
import { CacheService } from '../../shared/cache/cache.service';
import { LoggerService } from '../../shared/logger/logger.service';

@Module({
  controllers: [AdminController],
  providers: [AdminService, SupabaseService, CacheService, LoggerService],
  exports: [AdminService],
})
export class AdminModule {}
