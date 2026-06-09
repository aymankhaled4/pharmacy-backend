import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SupabaseService } from '../../database/supabase.service';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { GetMyRoleResult } from '../types/supabase-rpc.types';
import { UserRole } from '../types/auth-user.type';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private supabase: SupabaseService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredRoles || requiredRoles.length === 0) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    const role = await this.resolveRole(user.id, user.token);
    user.role = role;

    if (role === 'pharmacy' && requiredRoles.includes('pharmacy')) {
      await this.assertPharmacyApproved(user.id);
    }

    if (!requiredRoles.includes(role)) {
      throw new ForbiddenException(
        `Access denied. Required roles: ${requiredRoles.join(', ')}`,
      );
    }

    return true;
  }

  private async resolveRole(userId: string, token: string): Promise<UserRole> {
    const { data, error } = await this.supabase
      .userClient(token)
      .rpc('get_my_role');

    if (error) return 'unknown';

    return (data as GetMyRoleResult) ?? 'unknown';
  }

  private async assertPharmacyApproved(pharmacyId: string): Promise<void> {
    const { data, error } = await this.supabase.adminClient
      .from('pharmacy_profiles')
      .select('status, rejection_reason')
      .eq('id', pharmacyId)
      .single();

    if (error || !data) {
      throw new ForbiddenException('Pharmacy profile not found');
    }

    if (data.status === 'pending') {
      throw new ForbiddenException(
        'Your pharmacy registration is under review',
      );
    }

    if (data.status === 'rejected') {
      throw new ForbiddenException(
        `Your pharmacy registration was rejected. Reason: ${data.rejection_reason ?? 'No reason provided'}`,
      );
    }
  }
}
