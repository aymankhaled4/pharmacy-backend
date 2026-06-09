import { Module } from '@nestjs/common';
import { SupabaseService } from '../../database/supabase.service';
import { ReservationsController } from './reservations.controller';
import { ReservationsService } from './reservations.service';

@Module({
  controllers: [ReservationsController],
  providers: [ReservationsService, SupabaseService],
  exports: [ReservationsService],
})
export class ReservationsModule {}
