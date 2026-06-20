import { Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../../database/supabase.service';
import { UserAccountService } from '../../common/services/user-account.service';
import { UpdateProfileDto } from './dto/update-profile.dto';

@Injectable()
export class UsersService {
  constructor(
    private supabase: SupabaseService,
    private userAccount: UserAccountService,
  ) {}

  async getProfile(userId: string) {
    await this.userAccount.assertCanAccess(userId);

    const { data, error } = await this.supabase.adminClient
      .from('user_profiles')
      .select('id, full_name, phone, created_at, status')
      .eq('id', userId)
      .eq('status', 'active')
      .single();

    if (error || !data) {
      throw new NotFoundException('User profile not found');
    }

    return data;
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    await this.userAccount.assertCanAccess(userId);

    const { data, error } = await this.supabase.adminClient
      .from('user_profiles')
      .update(dto)
      .eq('id', userId)
      .eq('status', 'active')
      .select('id, full_name, phone, created_at, status')
      .single();

    if (error) {
      this.supabase.throwFromPostgresError(error);
    }

    return data;
  }

  async registerFcmToken(userId: string, fcmToken: string) {
    await this.userAccount.assertCanAccess(userId);

    const { error } = await this.supabase.adminClient
      .from('user_profiles')
      .update({ fcm_token: fcmToken })
      .eq('id', userId)
      .eq('status', 'active');

    if (error) {
      this.supabase.throwFromPostgresError(error);
    }

    return { success: true };
  }
}
