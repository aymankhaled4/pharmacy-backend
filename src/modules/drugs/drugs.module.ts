import { Module } from '@nestjs/common';
import { SupabaseService } from '../../database/supabase.service';
import { DrugsController } from './drugs.controller';
import { DrugsService } from './drugs.service';

@Module({
  controllers: [DrugsController],
  providers: [DrugsService, SupabaseService],
})
export class DrugsModule {}
