import { Module } from '@nestjs/common';
import { SupabaseService } from '../../database/supabase.service';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';

@Module({
  controllers: [InventoryController],
  providers: [InventoryService, SupabaseService],
})
export class InventoryModule {}
