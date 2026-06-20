import { ForbiddenException, Injectable } from '@nestjs/common';
import { SupabaseService } from '../../database/supabase.service';
import {
  UserAccountStatus,
  UserProfileStatusRow,
} from '../types/user-account-status.type';

@Injectable()
export class UserAccountService {
  constructor(private supabase: SupabaseService) {}

  resolveStatus(profile: UserProfileStatusRow): UserAccountStatus {
    if (profile.deleted_at || profile.status === 'deleted') {
      return 'deleted';
    }
    if (profile.status === 'blocked') {
      return 'blocked';
    }
    return 'active';
  }

  async getStatus(userId: string): Promise<UserAccountStatus | null> {
    const { data: user } = await this.supabase.adminClient
      .from('user_profiles')
      .select('status, deleted_at')
      .eq('id', userId)
      .maybeSingle();

    if (user) {
      return this.resolveStatus(user as UserProfileStatusRow);
    }

    const { data: admin } = await this.supabase.adminClient
      .from('admin_profiles')
      .select('status, deleted_at')
      .eq('id', userId)
      .maybeSingle();

    if (admin) {
      return this.resolveStatus(admin as UserProfileStatusRow);
    }

    return null;
  }

  async assertCanAccess(userId: string): Promise<void> {
    const status = await this.getStatus(userId);

    if (!status) {
      return;
    }

    if (status === 'blocked') {
      throw new ForbiddenException(
        'Your account has been blocked. Please contact support.',
      );
    }

    if (status === 'deleted') {
      throw new ForbiddenException('Your account has been deleted.');
    }
  }
}
