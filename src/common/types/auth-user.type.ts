export type UserRole = 'admin' | 'pharmacy' | 'user' | 'unknown';

export interface AuthUser {
  id: string;
  role: UserRole;
  token: string;
}