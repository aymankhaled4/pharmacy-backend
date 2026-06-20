import {
  Injectable,
  ForbiddenException,
  ConflictException,
  InternalServerErrorException,
} from '@nestjs/common';
import { SupabaseService } from '../../database/supabase.service';
import { UserAccountService } from '../../common/services/user-account.service';
import { GetMyRoleResult } from '../../common/types/supabase-rpc.types';
import { UserRole } from '../../common/types/auth-user.type';
import { UserAccountStatus } from '../../common/types/user-account-status.type';
import { RegisterDto } from './dto/register.dto';

export interface RoleResponse {
  role: UserRole;
  accountStatus?: UserAccountStatus;
  pharmacyStatus?: 'pending' | 'approved' | 'rejected';
  rejectionReason?: string | null;
}

@Injectable()
export class AuthService {
  constructor(
    private supabase: SupabaseService,
    private userAccount: UserAccountService,
  ) {}

  async register(dto: RegisterDto) {
    const { data, error } =
      await this.supabase.adminClient.auth.admin.createUser({
        email: dto.email,
        password: dto.password,
        email_confirm: true,
      });

    if (error) {
      if (error.message.includes('already registered')) {
        throw new ConflictException('Email already registered');
      }
      throw new InternalServerErrorException(error.message);
    }

    const { error: profileError } = await this.supabase.adminClient
      .from('user_profiles')
      .insert({
        id: data.user.id,
        full_name: dto.full_name ?? 'User',
        phone: dto.phone ?? null,
        status: 'active',
      });

    if (profileError) {
      await this.supabase.adminClient.auth.admin.deleteUser(data.user.id);
      this.supabase.throwFromPostgresError(profileError);
    }

    return {
      id: data.user.id,
      email: data.user.email,
      full_name: dto.full_name ?? null,
      status: 'active' as const,
    };
  }

  async getRole(userId: string, token: string): Promise<RoleResponse> {
    await this.userAccount.assertCanAccess(userId);

    const { data, error } = await this.supabase
      .userClient(token)
      .rpc('get_my_role');

    if (error) {
      throw new ForbiddenException('Could not determine user role');
    }

    const role = (data as GetMyRoleResult) ?? 'unknown';

    if (role === 'user' || role === 'admin') {
      const accountStatus = await this.userAccount.getStatus(userId);
      return { role, accountStatus: accountStatus ?? 'active' };
    }

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
