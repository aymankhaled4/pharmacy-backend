import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { SupabaseService } from '../../database/supabase.service';
import { UserAccountService } from '../services/user-account.service';

@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  constructor(
    private supabase: SupabaseService,
    private userAccount: UserAccountService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const token = this.extractToken(request);

    if (!token) {
      throw new UnauthorizedException('Missing authorization token');
    }

    const { data, error } = await this.supabase
      .userClient(token)
      .auth.getUser();

    if (error || !data.user) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    await this.userAccount.assertCanAccess(data.user.id);

    request.user = {
      id: data.user.id,
      token,
      role: null,
    };

    return true;
  }

  private extractToken(request: any): string | null {
    const auth: string | undefined = request.headers?.authorization;
    if (!auth?.startsWith('Bearer ')) return null;
    return auth.split(' ')[1];
  }
}
