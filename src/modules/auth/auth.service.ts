import {
  Injectable,
  ForbiddenException,
} from '@nestjs/common';
import { SupabaseService } from '../../database/supabase.service';
import { GetMyRoleResult } from '../../common/types/supabase-rpc.types';
import { UserRole } from '../../common/types/auth-user.type';

export interface RoleResponse {
  role: UserRole;
  pharmacyStatus?: 'pending' | 'approved' | 'rejected';
  rejectionReason?: string | null;
}

@Injectable()
export class AuthService {
  constructor(private supabase: SupabaseService) {}

  async getRole(userId: string, token: string): Promise<RoleResponse> {
    const { data, error } = await this.supabase
      .userClient(token)
      .rpc('get_my_role');

    if (error) {
      throw new ForbiddenException('Could not determine user role');
    }

    const role = (data as GetMyRoleResult) ?? 'unknown';

    if (role === 'pharmacy') {
      const { data: pharmacy } = await this.supabase.adminClient
        .from('pharmacy_profiles')
        .select('status, rejection_reason')
        .eq('id', userId)
        .single();

      if (pharmacy?.status === 'pending') {
        throw new ForbiddenException(
          'Your pharmacy registration is under review. Please wait for admin approval.',
        );
      }

      if (pharmacy?.status === 'rejected') {
        throw new ForbiddenException(
          `Your pharmacy registration was rejected. Reason: ${pharmacy.rejection_reason ?? 'No reason provided'}`,
        );
      }

      return { role, pharmacyStatus: pharmacy?.status };
    }

    return { role };
  }
}