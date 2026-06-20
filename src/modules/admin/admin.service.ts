import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
} from '@nestjs/common';
import { SupabaseService } from '../../database/supabase.service';
import { CacheService } from '../../shared/cache/cache.service';
import { UserAccountService } from '../../common/services/user-account.service';
import { AuthUserLookupService } from '../../common/services/auth-user-lookup.service';
import { UserAccountStatus } from '../../common/types/user-account-status.type';
import { ListPharmaciesQueryDto } from './dto/list-pharmacies-query.dto';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { ListReservationsQueryDto } from './dto/list-reservations-query.dto';
import { CreateAccountDto } from './dto/create-account.dto';

const PHARMACY_SELECT =
  'id, pharmacy_name, phone, address, city, license_number, status, rejection_reason, verified_by, verified_at, created_at';

interface CursorPayload {
  created_at: string;
  id: string;
}

type ListableAccountRole = 'user' | 'admin';
type ProfileTable = 'user_profiles' | 'admin_profiles';

interface AccountProfileSource {
  role: ListableAccountRole;
}

const ACCOUNT_PROFILE_SOURCES: AccountProfileSource[] = [
  { role: 'user' },
  { role: 'admin' },
];

interface ProfileDbRow {
  id: string;
  full_name: string | null;
  phone?: string | null;
  deleted_at: string | null;
  status: UserAccountStatus;
  created_at: string;
}

export interface AccountListRow {
  id: string;
  role: ListableAccountRole;
  full_name: string | null;
  phone: string | null;
  created_at: string;
  deleted_at: string | null;
  status: UserAccountStatus;
}

export interface AdminAccountListItem extends AccountListRow {
  email: string | null;
  last_login: string | null;
}

export interface ReservationListRow {
  created_at: string;
  id: string;
}

interface RevenueRow {
  total_price: number | null;
}

interface SearchLogRow {
  resolved_ingredient: string;
  user_id: string | null;
}

interface ReservationPurchaseRow {
  id: string;
  quantity: number;
  inventory: {
    drugs: {
      id: string;
      brand_name: string;
      brand_name_ar: string | null;
      active_ingredient: string;
    } | null;
  } | null;
}

interface TopSearchedDrugRow {
  resolved_ingredient: string;
  search_count: number;
  unique_searchers: number;
}

interface TopPurchasedDrugRow {
  drug_id: string;
  brand_name: string;
  brand_name_ar: string | null;
  active_ingredient: string;
  total_purchased: number;
  total_orders: number;
}

@Injectable()
export class AdminService {
  constructor(
    private supabase: SupabaseService,
    private cache: CacheService,
    private userAccount: UserAccountService,
    private authLookup: AuthUserLookupService,
  ) {}

  async listPharmacies(query: ListPharmaciesQueryDto) {
    const usePagination = query.limit !== undefined && query.limit !== null;
    const limit = query.limit ?? 0;
    const fetchLimit = usePagination ? limit + 1 : 0;

    let dbQuery = this.supabase.adminClient
      .from('pharmacy_profiles')
      .select(PHARMACY_SELECT, { count: 'exact' })
      .order('created_at', { ascending: false })
      .order('id', { ascending: false });

    if (query.status) {
      dbQuery = dbQuery.eq('status', query.status);
    }

    if (query.search?.trim()) {
      const term = query.search.trim();
      dbQuery = dbQuery.or(
        `pharmacy_name.ilike.%${term}%,license_number.ilike.%${term}%,address.ilike.%${term}%,city.ilike.%${term}%,phone.ilike.%${term}%`,
      );
    }

    if (query.cursor) {
      const cursor = this.decodeCursor(query.cursor);
      dbQuery = dbQuery.or(
        `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`,
      );
    }

    if (usePagination) {
      dbQuery = dbQuery.limit(fetchLimit);
    }

    const { data, error, count } = await dbQuery;

    if (error) {
      this.supabase.throwFromPostgresError(error);
    }

    const items = data ?? [];
    const total = count ?? items.length;

    if (!usePagination) {
      return { items, nextCursor: null, total };
    }

    const hasMore = items.length > limit;
    const page = hasMore ? items.slice(0, limit) : items;
    const last = page[page.length - 1];

    return {
      items: page,
      nextCursor:
        hasMore && last
          ? this.encodeCursor({
              created_at: last.created_at,
              id: last.id,
            })
          : null,
      total,
    };
  }

  async approvePharmacy(id: string, adminId: string) {
    const existing = await this.getPharmacyStatus(id);

    if (existing === 'approved') {
      throw new ConflictException('Pharmacy is already approved');
    }

    if (existing === 'rejected') {
      throw new ConflictException('Pharmacy was rejected and cannot be approved');
    }

    if (!existing) {
      throw new NotFoundException('Pharmacy not found');
    }

    const { data, error } = await this.supabase.adminClient
      .from('pharmacy_profiles')
      .update({
        status: 'approved',
        verified_by: adminId,
        verified_at: new Date().toISOString(),
        rejection_reason: null,
      })
      .eq('id', id)
      .eq('status', 'pending')
      .select(PHARMACY_SELECT)
      .single();

    if (error) {
      this.supabase.throwFromPostgresError(error);
    }

    if (!data) {
      throw new ConflictException(
        'Pharmacy is no longer pending and could not be approved',
      );
    }

    return data;
  }

  async rejectPharmacy(id: string, adminId: string, reason: string) {
    const existing = await this.getPharmacyStatus(id);

    if (existing === 'rejected') {
      throw new ConflictException('Pharmacy is already rejected');
    }

    if (existing === 'approved') {
      throw new ConflictException('Pharmacy is already approved and cannot be rejected');
    }

    if (!existing) {
      throw new NotFoundException('Pharmacy not found');
    }

    const { data, error } = await this.supabase.adminClient
      .from('pharmacy_profiles')
      .update({
        status: 'rejected',
        rejection_reason: reason,
        verified_by: adminId,
        verified_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('status', 'pending')
      .select(PHARMACY_SELECT)
      .single();

    if (error) {
      this.supabase.throwFromPostgresError(error);
    }

    if (!data) {
      throw new ConflictException(
        'Pharmacy is no longer pending and could not be rejected',
      );
    }

    return data;
  }

  private async getPharmacyStatus(
    id: string,
  ): Promise<'pending' | 'approved' | 'rejected' | null> {
    const { data, error } = await this.supabase.adminClient
      .from('pharmacy_profiles')
      .select('status')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      this.supabase.throwFromPostgresError(error);
    }

    return (data?.status as 'pending' | 'approved' | 'rejected') ?? null;
  }

  async createAccount(dto: CreateAccountDto) {
    const role = dto.role ?? 'user';

    const { data: authData, error: authError } =
      await this.supabase.adminClient.auth.admin.createUser({
        email: dto.email,
        password: dto.password,
        email_confirm: true,
      });

    if (authError) {
      if (authError.message?.toLowerCase().includes('already')) {
        throw new ConflictException('Email already registered');
      }
      throw new InternalServerErrorException(authError.message);
    }

    const userId = authData.user.id;

    if (role === 'admin') {
      const { data, error } = await this.supabase.adminClient
        .from('admin_profiles')
        .insert({
          id: userId,
          full_name: dto.full_name,
          status: 'active',
        })
        .select('id, full_name, deleted_at, status, created_at')
        .single();

      if (error) {
        await this.supabase.adminClient.auth.admin.deleteUser(userId);
        this.supabase.throwFromPostgresError(error);
      }

      return {
        ...this.toAccountListRow(data as ProfileDbRow, 'admin'),
        email: authData.user.email ?? dto.email,
        last_login: null,
      };
    }

    const { data, error } = await this.supabase.adminClient
      .from('user_profiles')
      .insert({
        id: userId,
        full_name: dto.full_name,
        phone: dto.phone ?? null,
        status: 'active',
      })
      .select('id, full_name, phone, deleted_at, status, created_at')
      .single();

    if (error) {
      await this.supabase.adminClient.auth.admin.deleteUser(userId);
      this.supabase.throwFromPostgresError(error);
    }

    return {
      ...this.toAccountListRow(data as ProfileDbRow, 'user'),
      email: authData.user.email ?? dto.email,
      last_login: null,
    };
  }

  async listUsers(query: ListUsersQueryDto) {
    const limit = query.limit ?? 20;
    const fetchLimit = limit + 1;
    const cursor = query.cursor ? this.decodeCursor(query.cursor) : null;

    const sources = query.role
      ? ACCOUNT_PROFILE_SOURCES.filter((s) => s.role === query.role)
      : ACCOUNT_PROFILE_SOURCES;

    const profileRows = await Promise.all(
      sources.map((source) =>
        this.queryProfileSource(source, query, fetchLimit, cursor),
      ),
    );

    const sorted = this.sortAccountsByNewest(profileRows.flat());
    const hasMore = sorted.length > limit;
    const page = hasMore ? sorted.slice(0, limit) : sorted;
    const last = page[page.length - 1];

    const authById = await this.authLookup.getDetailsByIds(
      page.map((account) => account.id),
    );

    return {
      items: page.map((account) => this.attachAuthDetails(account, authById)),
      nextCursor:
        hasMore && last
          ? this.encodeCursor({ created_at: last.created_at, id: last.id })
          : null,
    };
  }

  private async queryProfileSource(
    source: AccountProfileSource,
    query: ListUsersQueryDto,
    limit: number,
    cursor: CursorPayload | null,
  ): Promise<AccountListRow[]> {
    if (source.role === 'user') {
      return this.queryUserProfiles(query, limit, cursor);
    }

    return this.queryAdminProfiles(query, limit, cursor);
  }

  private async queryUserProfiles(
    query: ListUsersQueryDto,
    limit: number,
    cursor: CursorPayload | null,
  ): Promise<AccountListRow[]> {
    let dbQuery = this.supabase.adminClient
      .from('user_profiles')
      .select('id, full_name, phone, deleted_at, status, created_at')
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit);

    dbQuery = this.applyAccountStatusFilter(dbQuery, query);

    if (cursor) {
      dbQuery = dbQuery.or(
        `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`,
      );
    }

    const { data, error } = await dbQuery;

    if (error) {
      this.supabase.throwFromPostgresError(error);
    }

    return ((data ?? []) as ProfileDbRow[]).map((row) =>
      this.toAccountListRow(row, 'user'),
    );
  }

  private async queryAdminProfiles(
    query: ListUsersQueryDto,
    limit: number,
    cursor: CursorPayload | null,
  ): Promise<AccountListRow[]> {
    let dbQuery = this.supabase.adminClient
      .from('admin_profiles')
      .select('id, full_name, deleted_at, status, created_at')
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit);

    dbQuery = this.applyAccountStatusFilter(dbQuery, query);

    if (cursor) {
      dbQuery = dbQuery.or(
        `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`,
      );
    }

    const { data, error } = await dbQuery;

    if (error) {
      this.supabase.throwFromPostgresError(error);
    }

    return ((data ?? []) as ProfileDbRow[]).map((row) =>
      this.toAccountListRow(row, 'admin'),
    );
  }

  private applyAccountStatusFilter<
    T extends {
      eq: (col: string, val: string) => T;
      neq: (col: string, val: string) => T;
    },
  >(dbQuery: T, query: ListUsersQueryDto): T {
    if (query.status) {
      return dbQuery.eq('status', query.status);
    }

    if (!query.include_deleted) {
      return dbQuery.neq('status', 'deleted');
    }

    return dbQuery;
  }

  private attachAuthDetails(
    account: AccountListRow,
    authById: Map<string, { email: string | null; last_login: string | null }>,
  ): AdminAccountListItem {
    const auth = authById.get(account.id);

    return {
      ...account,
      email: auth?.email ?? null,
      last_login: auth?.last_login ?? null,
    };
  }

  private toAccountListRow(
    row: ProfileDbRow,
    role: ListableAccountRole,
  ): AccountListRow {
    return {
      id: row.id,
      role,
      full_name: row.full_name,
      phone: role === 'user' ? (row.phone ?? null) : null,
      status: this.userAccount.resolveStatus(row),
      deleted_at: row.deleted_at,
      created_at: row.created_at,
    };
  }

  private sortAccountsByNewest(accounts: AccountListRow[]): AccountListRow[] {
    return accounts.sort((a, b) => {
      if (a.created_at !== b.created_at) {
        return a.created_at > b.created_at ? -1 : 1;
      }

      return a.id > b.id ? -1 : a.id < b.id ? 1 : 0;
    });
  }

  private async resolveProfileTable(id: string): Promise<ProfileTable | null> {
    const { data: admin } = await this.supabase.adminClient
      .from('admin_profiles')
      .select('id')
      .eq('id', id)
      .maybeSingle();

    if (admin) {
      return 'admin_profiles';
    }

    const { data: user } = await this.supabase.adminClient
      .from('user_profiles')
      .select('id')
      .eq('id', id)
      .maybeSingle();

    return user ? 'user_profiles' : null;
  }

  private async updateAccountStatus(
    id: string,
    update: Record<string, unknown>,
    filters: Record<string, unknown>,
  ) {
    const table = await this.resolveProfileTable(id);
    if (!table) {
      return null;
    }

    if (table === 'user_profiles') {
      let dbQuery = this.supabase.adminClient
        .from('user_profiles')
        .update(update)
        .eq('id', id);

      for (const [key, value] of Object.entries(filters)) {
        dbQuery = dbQuery.eq(key, value);
      }

      const { data, error } = await dbQuery
        .select('id, full_name, phone, deleted_at, status, created_at')
        .single();

      if (error) {
        this.supabase.throwFromPostgresError(error);
      }

      const row = data as ProfileDbRow | null;
      return row ? this.toAccountListRow(row, 'user') : null;
    }

    let dbQuery = this.supabase.adminClient
      .from('admin_profiles')
      .update(update)
      .eq('id', id);

    for (const [key, value] of Object.entries(filters)) {
      dbQuery = dbQuery.eq(key, value);
    }

    const { data, error } = await dbQuery
      .select('id, full_name, deleted_at, status, created_at')
      .single();

    if (error) {
      this.supabase.throwFromPostgresError(error);
    }

    const row = data as ProfileDbRow | null;
    return row ? this.toAccountListRow(row, 'admin') : null;
  }

  async softDeleteUser(id: string) {
    const table = await this.resolveProfileTable(id);
    if (!table) {
      throw new NotFoundException('Account not found');
    }

    if (table === 'user_profiles') {
      const { data, error } = await this.supabase.adminClient
        .from('user_profiles')
        .update({
          deleted_at: new Date().toISOString(),
          status: 'deleted',
        })
        .eq('id', id)
        .neq('status', 'deleted')
        .select('id, full_name, phone, deleted_at, status, created_at')
        .single();

      if (error) {
        this.supabase.throwFromPostgresError(error);
      }

      const row = data as ProfileDbRow | null;
      if (!row) {
        throw new NotFoundException('Account not found or already deleted');
      }

      await this.cache.delete(this.cache.roleKey(id));
      return { success: true, user: this.toAccountListRow(row, 'user') };
    }

    const { data, error } = await this.supabase.adminClient
      .from('admin_profiles')
      .update({
        deleted_at: new Date().toISOString(),
        status: 'deleted',
      })
      .eq('id', id)
      .neq('status', 'deleted')
      .select('id, full_name, deleted_at, status, created_at')
      .single();

    if (error) {
      this.supabase.throwFromPostgresError(error);
    }

    const row = data as ProfileDbRow | null;
    if (!row) {
      throw new NotFoundException('Account not found or already deleted');
    }

    await this.cache.delete(this.cache.roleKey(id));
    return { success: true, user: this.toAccountListRow(row, 'admin') };
  }

  async activateUser(id: string) {
    return this.unblockUser(id);
  }

  async deactivateUser(id: string) {
    return this.blockUser(id);
  }

  async bulkActivateUsers(userIds: string[]) {
    return this.bulkUpdateUserStatus(userIds, 'blocked', 'active');
  }

  async bulkDeactivateUsers(userIds: string[]) {
    return this.bulkUpdateUserStatus(userIds, 'active', 'blocked');
  }

  private async bulkUpdateUserStatus(
    userIds: string[],
    fromStatus: UserAccountStatus,
    toStatus: UserAccountStatus,
  ) {
    const uniqueIds = [...new Set(userIds)];
    const users: AccountListRow[] = [];
    const failedIds: string[] = [];

    for (const id of uniqueIds) {
      const data = await this.updateAccountStatus(
        id,
        { status: toStatus },
        {
          status: fromStatus,
        },
      );

      if (!data) {
        failedIds.push(id);
        continue;
      }

      users.push(data);
      await this.cache.delete(this.cache.roleKey(id));
    }

    return {
      success: true,
      updated_count: users.length,
      failed_ids: failedIds,
      users,
    };
  }

  async blockUser(id: string) {
    const data = await this.updateAccountStatus(
      id,
      { status: 'blocked' },
      { status: 'active' },
    );

    if (!data) {
      throw new BadRequestException(
        'Account not found, already blocked, or deleted',
      );
    }

    await this.cache.delete(this.cache.roleKey(id));
    return { success: true, user: data };
  }

  async unblockUser(id: string) {
    const data = await this.updateAccountStatus(
      id,
      { status: 'active', deleted_at: null },
      { status: 'blocked' },
    );

    if (!data) {
      throw new NotFoundException('Account not found or not blocked');
    }

    await this.cache.delete(this.cache.roleKey(id));
    return { success: true, user: data };
  }

  async listAllReservations(query: ListReservationsQueryDto) {
    const limit = query.limit ?? 20;

    let dbQuery = this.supabase.adminClient
      .from('reservations')
      .select(
        `
        id, short_code, status, quantity, price_at_reservation, discount_at_reservation, total_price, expires_at, confirmed_at, created_at,
        user_profiles ( id, full_name, phone ),
        inventory (
          id, selling_price, discount_percent, pharmacy_id,
          pharmacy_profiles ( id, pharmacy_name, address, phone, city ),
          drugs ( id, brand_name, brand_name_ar, active_ingredient )
        )
      `,
      )
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1);

    if (query.status) {
      dbQuery = dbQuery.eq('status', query.status);
    }

    if (query.from_date) {
      dbQuery = dbQuery.gte('created_at', query.from_date);
    }

    if (query.to_date) {
      dbQuery = dbQuery.lte('created_at', query.to_date);
    }

    if (query.cursor) {
      const cursor = this.decodeCursor(query.cursor);
      dbQuery = dbQuery.or(
        `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`,
      );
    }

    const { data, error } = await dbQuery;

    if (error) {
      this.supabase.throwFromPostgresError(error);
    }

    const items = (data ?? []) as ReservationListRow[];
    const hasMore = items.length > limit;
    const page = hasMore ? items.slice(0, limit) : items;
    const last = page[page.length - 1];

    return {
      items: page,
      nextCursor:
        hasMore && last
          ? this.encodeCursor({ created_at: last.created_at, id: last.id })
          : null,
    };
  }

  async getAnalyticsOverview() {
    const todayStart = this.startOfUtcDay(new Date());
    const yesterdayStart = this.startOfUtcDay(
      new Date(Date.now() - 24 * 60 * 60 * 1000),
    );

    const [
      activeUsers,
      pendingPharmacies,
      approvedPharmacies,
      rejectedPharmacies,
      pendingSinceYesterday,
      todaysApprovals,
      recentRejections,
      reviewedPharmacies,
      pendingReservations,
      confirmedReservations,
      cancelledReservations,
      expiredReservations,
      revenueResult,
    ] = await Promise.all([
      this.supabase.adminClient
        .from('user_profiles')
        .select('id', { count: 'exact', head: true })
        .neq('status', 'deleted'),
      this.supabase.adminClient
        .from('pharmacy_profiles')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending'),
      this.supabase.adminClient
        .from('pharmacy_profiles')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'approved'),
      this.supabase.adminClient
        .from('pharmacy_profiles')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'rejected'),
      this.supabase.adminClient
        .from('pharmacy_profiles')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending')
        .gte('created_at', yesterdayStart.toISOString()),
      this.supabase.adminClient
        .from('pharmacy_profiles')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'approved')
        .gte('verified_at', todayStart.toISOString()),
      this.supabase.adminClient
        .from('pharmacy_profiles')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'rejected')
        .gte('verified_at', todayStart.toISOString()),
      this.supabase.adminClient
        .from('pharmacy_profiles')
        .select('created_at, verified_at')
        .in('status', ['approved', 'rejected'])
        .not('verified_at', 'is', null),
      this.supabase.adminClient
        .from('reservations')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending'),
      this.supabase.adminClient
        .from('reservations')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'confirmed'),
      this.supabase.adminClient
        .from('reservations')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'cancelled'),
      this.supabase.adminClient
        .from('reservations')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'expired'),
      this.supabase.adminClient
        .from('reservations')
        .select('total_price')
        .eq('status', 'confirmed'),
    ]);

    const pending = pendingPharmacies.count ?? 0;
    const approved = approvedPharmacies.count ?? 0;
    const rejected = rejectedPharmacies.count ?? 0;
    const reviewedTotal = approved + rejected;

    const revenueRows = (revenueResult.data ?? []) as RevenueRow[];
    const totalRevenue = revenueRows.reduce(
      (sum, row) => sum + Number(row.total_price ?? 0),
      0,
    );

    return {
      pending_pharmacies: pending,
      pending_pharmacies_delta: pendingSinceYesterday.count ?? 0,
      pending_pharmacies_delta_label: 'since yesterday',
      todays_approvals: todaysApprovals.count ?? 0,
      recent_rejections: recentRejections.count ?? 0,
      avg_review_time_hours: this.averageReviewTimeHours(
        reviewedPharmacies.data ?? [],
      ),
      approval_rate:
        reviewedTotal > 0 ? Math.round((approved / reviewedTotal) * 100) : null,
      users: {
        active: activeUsers.count ?? 0,
      },
      pharmacies: {
        pending,
        approved,
        rejected,
        total: pending + approved + rejected,
      },
      reservations: {
        pending: pendingReservations.count ?? 0,
        confirmed: confirmedReservations.count ?? 0,
        cancelled: cancelledReservations.count ?? 0,
        expired: expiredReservations.count ?? 0,
        total:
          (pendingReservations.count ?? 0) +
          (confirmedReservations.count ?? 0) +
          (cancelledReservations.count ?? 0) +
          (expiredReservations.count ?? 0),
      },
      revenue: {
        confirmed_total: totalRevenue,
      },
    };
  }

  private startOfUtcDay(date: Date): Date {
    return new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
    );
  }

  private averageReviewTimeHours(
    rows: Array<{ created_at: string; verified_at: string | null }>,
  ): number | null {
    if (rows.length === 0) {
      return null;
    }

    const totalHours = rows.reduce((sum, row) => {
      const ms =
        new Date(row.verified_at!).getTime() -
        new Date(row.created_at).getTime();
      return sum + ms / (1000 * 60 * 60);
    }, 0);

    return Math.round((totalHours / rows.length) * 10) / 10;
  }

  async getTopSearchedDrugs(limit = 10) {
    const mvResult = await this.supabase.adminClient
      .from('mv_drug_search_analytics')
      .select('resolved_ingredient, search_count, unique_searchers')
      .order('search_count', { ascending: false })
      .limit(limit);

    if (!mvResult.error) {
      return mvResult.data ?? [];
    }

    if (!this.isMissingAnalyticsRelation(mvResult.error)) {
      this.supabase.throwFromPostgresError(mvResult.error);
    }

    return this.queryTopSearchedDrugsLive(limit);
  }

  async getTopPurchasedDrugs(limit = 10) {
    const mvResult = await this.supabase.adminClient
      .from('mv_drug_purchase_analytics')
      .select(
        'drug_id, brand_name, brand_name_ar, active_ingredient, total_purchased, total_orders',
      )
      .order('total_purchased', { ascending: false })
      .limit(limit);

    if (!mvResult.error) {
      return mvResult.data ?? [];
    }

    if (!this.isMissingAnalyticsRelation(mvResult.error)) {
      this.supabase.throwFromPostgresError(mvResult.error);
    }

    return this.queryTopPurchasedDrugsLive(limit);
  }

  private async queryTopSearchedDrugsLive(
    limit: number,
  ): Promise<TopSearchedDrugRow[]> {
    const { data, error } = await this.supabase.adminClient
      .from('search_logs')
      .select('resolved_ingredient, user_id')
      .not('resolved_ingredient', 'is', null);

    if (error) {
      this.supabase.throwFromPostgresError(error);
    }

    const counts = new Map<
      string,
      { search_count: number; unique_searchers: Set<string> }
    >();

    for (const row of (data ?? []) as SearchLogRow[]) {
      const ingredient = row.resolved_ingredient;
      const entry = counts.get(ingredient) ?? {
        search_count: 0,
        unique_searchers: new Set<string>(),
      };
      entry.search_count += 1;
      if (row.user_id) {
        entry.unique_searchers.add(row.user_id);
      }
      counts.set(ingredient, entry);
    }

    return Array.from(counts.entries())
      .map(([resolved_ingredient, stats]) => ({
        resolved_ingredient,
        search_count: stats.search_count,
        unique_searchers: stats.unique_searchers.size,
      }))
      .sort((a, b) => b.search_count - a.search_count)
      .slice(0, limit);
  }

  private async queryTopPurchasedDrugsLive(
    limit: number,
  ): Promise<TopPurchasedDrugRow[]> {
    const { data, error } = await this.supabase.adminClient
      .from('reservations')
      .select(
        `
        id,
        quantity,
        inventory (
          drugs ( id, brand_name, brand_name_ar, active_ingredient )
        )
      `,
      )
      .eq('status', 'confirmed');

    if (error) {
      this.supabase.throwFromPostgresError(error);
    }

    const totals = new Map<string, TopPurchasedDrugRow>();

    for (const row of (data ?? []) as unknown as ReservationPurchaseRow[]) {
      const drug = row.inventory?.drugs;
      if (!drug) continue;

      const existing = totals.get(drug.id);
      if (existing) {
        existing.total_purchased += row.quantity;
        existing.total_orders += 1;
        continue;
      }

      totals.set(drug.id, {
        drug_id: drug.id,
        brand_name: drug.brand_name,
        brand_name_ar: drug.brand_name_ar,
        active_ingredient: drug.active_ingredient,
        total_purchased: row.quantity,
        total_orders: 1,
      });
    }

    return Array.from(totals.values())
      .sort((a, b) => b.total_purchased - a.total_purchased)
      .slice(0, limit);
  }

  private isMissingAnalyticsRelation(error: {
    code?: string;
    message: string;
  }): boolean {
    return (
      error.code === 'PGRST205' ||
      error.message.includes('Could not find the table') ||
      error.message.includes('schema cache')
    );
  }

  private encodeCursor(payload: CursorPayload): string {
    return Buffer.from(JSON.stringify(payload)).toString('base64');
  }

  private decodeCursor(cursor: string): CursorPayload {
    return JSON.parse(
      Buffer.from(cursor, 'base64').toString('utf-8'),
    ) as CursorPayload;
  }
}
