import { Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../../database/supabase.service';
import { UpdateProfileDto } from './dto/update-profile.dto';

@Injectable()
export class UsersService {
  constructor(private supabase: SupabaseService) {}

  async getProfile(userId: string) {
    const { data, error } = await this.supabase.adminClient
      .from('user_profiles')
      .select('id, full_name, phone, created_at')
      .eq('id', userId)
      .is('deleted_at', null)
      .single();

    if (error || !data) {
      throw new NotFoundException('User profile not found');
    }

    return data;
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const { data, error } = await this.supabase.adminClient
      .from('user_profiles')
      .update(dto)
      .eq('id', userId)
      .is('deleted_at', null)
      .select('id, full_name, phone, created_at')
      .single();

    if (error) {
      this.supabase.throwFromPostgresError(error);
    }

    return data;
  }

  async registerFcmToken(userId: string, fcmToken: string) {
    const { error } = await this.supabase.adminClient
      .from('user_profiles')
      .update({ fcm_token: fcmToken })
      .eq('id', userId)
      .is('deleted_at', null);

    if (error) {
      this.supabase.throwFromPostgresError(error);
    }

    return { success: true };
  }
}
