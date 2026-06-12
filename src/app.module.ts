import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';

import { configValidationSchema } from './config/config.validation';
import { appConfig } from './config/app.config';
import { supabaseConfig } from './config/supabase.config';
import { openaiConfig } from './config/openai.config';

import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { PharmacyModule } from './modules/pharmacy/pharmacy.module';
import { AdminModule } from './modules/admin/admin.module';
import { ReservationsModule } from './modules/reservations/reservations.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { DrugsModule } from './modules/drugs/drugs.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { SharedModule } from './shared/shared.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, supabaseConfig, openaiConfig],
      validationSchema: configValidationSchema,
      validationOptions: { abortEarly: false },
    }),

    ThrottlerModule.forRoot([{ name: 'global', ttl: 60_000, limit: 100 }]),

    AuthModule,
    UsersModule,
    SharedModule,
    PharmacyModule,
    AdminModule,
    ReservationsModule,
    NotificationsModule,
    WebhooksModule,
    DrugsModule,
    InventoryModule,
  ],
})
export class AppModule {}
