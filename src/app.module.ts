import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';

import { configValidationSchema } from './config/config.validation';
import { appConfig } from './config/app.config';
import { supabaseConfig } from './config/supabase.config';
import { openaiConfig } from './config/openai.config';

import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, supabaseConfig, openaiConfig],
      validationSchema: configValidationSchema,
      validationOptions: { abortEarly: false },
    }),

    ThrottlerModule.forRoot([
      { name: 'global', ttl: 60_000, limit: 100 },
    ]),

    AuthModule,
    UsersModule,
  ],
})
export class AppModule {}