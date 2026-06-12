import { Module } from '@nestjs/common';
import { SupabaseService } from '../../database/supabase.service';
import { LoggerService } from '../../shared/logger/logger.service';
import { FcmService } from './fcm.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, FcmService, SupabaseService, LoggerService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
