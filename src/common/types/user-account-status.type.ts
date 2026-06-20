export type UserAccountStatus = 'active' | 'blocked' | 'deleted';

export interface UserProfileStatusRow {
  status?: UserAccountStatus | string | null;
  deleted_at?: string | null;
}
