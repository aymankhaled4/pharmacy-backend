import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../../database/supabase.service';

export interface AuthUserDetails {
  email: string | null;
  last_login: string | null;
}

@Injectable()
export class AuthUserLookupService {
  constructor(private supabase: SupabaseService) {}

  /**
   * Resolve email + last_sign_in_at for many IDs in as few round-trips as possible.
   * Tries auth.users (1 query) first, falls back to parallel admin API calls.
   */
  async getDetailsByIds(
    userIds: string[],
  ): Promise<Map<string, AuthUserDetails>> {
    const uniqueIds = [...new Set(userIds)];
    const result = new Map<string, AuthUserDetails>();

    if (uniqueIds.length === 0) {
      return result;
    }

    const fromDb = await this.fetchFromAuthUsersTable(uniqueIds);
    if (fromDb) {
      return fromDb;
    }

    await Promise.all(
      uniqueIds.map(async (id) => {
        const { data } =
          await this.supabase.adminClient.auth.admin.getUserById(id);

        result.set(id, {
          email: data.user?.email ?? null,
          last_login: data.user?.last_sign_in_at ?? null,
        });
      }),
    );

    return result;
  }

  private async fetchFromAuthUsersTable(
    userIds: string[],
  ): Promise<Map<string, AuthUserDetails> | null> {
    const { data, error } = await this.supabase.adminClient
      .schema('auth')
      .from('users')
      .select('id, email, last_sign_in_at')
      .in('id', userIds);

    if (error || !data) {
      return null;
    }

    return new Map(
      data.map((row) => [
        row.id as string,
        {
          email: (row.email as string | null) ?? null,
          last_login: (row.last_sign_in_at as string | null) ?? null,
        },
      ]),
    );
  }
}
