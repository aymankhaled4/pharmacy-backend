import { Module } from '@nestjs/common';
import { PharmacyController } from './pharmacy.controller';
import { PharmacyService } from './pharmacy.service';
import { SupabaseService } from '../../database/supabase.service';

@Module({
  controllers: [PharmacyController],
  providers: [PharmacyService, SupabaseService],
  exports: [PharmacyService],
})
export class PharmacyModule {}
