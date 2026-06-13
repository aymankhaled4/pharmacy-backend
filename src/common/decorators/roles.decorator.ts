import { SetMetadata } from '@nestjs/common';
import { UserRole } from '../types/auth-user.type';

export const ROLES_KEY = 'roles';

export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
