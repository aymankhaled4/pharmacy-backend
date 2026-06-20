import { Global, Module } from '@nestjs/common';
import { CacheService } from './cache/cache.service';
import { LoggerService } from './logger/logger.service';
import { UserAccountService } from '../common/services/user-account.service';
import { AuthUserLookupService } from '../common/services/auth-user-lookup.service';
import { SupabaseService } from '../database/supabase.service';
import { SupabaseAuthGuard } from '../common/guards/supabase-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';

@Global()
@Module({
  providers: [
    CacheService,
    LoggerService,
    UserAccountService,
    AuthUserLookupService,
    SupabaseService,
    SupabaseAuthGuard,
    RolesGuard,
  ],
  exports: [
    CacheService,
    LoggerService,
    UserAccountService,
    AuthUserLookupService,
    SupabaseService,
    SupabaseAuthGuard,
    RolesGuard,
  ],
})
export class SharedModule {}
