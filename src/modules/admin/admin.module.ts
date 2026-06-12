import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { SupabaseService } from '../../database/supabase.service';

@Module({
  controllers: [AdminController],
  providers: [AdminService, SupabaseService],
  exports: [AdminService],
})
export class AdminModule {}
