import { Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../../database/supabase.service';
import { ListPharmaciesQueryDto } from './dto/list-pharmacies-query.dto';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { ListReservationsQueryDto } from './dto/list-reservations-query.dto';

const PHARMACY_SELECT =
  'id, pharmacy_name, phone, address, city, license_number, status, rejection_reason, verified_by, verified_at, created_at';

interface CursorPayload {
  created_at: string;
  id: string;
}

export interface UserProfileRow {
  id: string;
  full_name: string | null;
  phone: string | null;
  created_at: string;
  deleted_at: string | null;
}

export interface AdminUserListItem extends UserProfileRow {
  email: string | null;
  last_login: string | null;
  status: 'active' | 'deleted';
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
  constructor(private supabase: SupabaseService) {}

  async listPharmacies(query: ListPharmaciesQueryDto) {
    let dbQuery = this.supabase.adminClient
      .from('pharmacy_profiles')
      .select(PHARMACY_SELECT)
      .order('created_at', { ascending: false });

    if (query.status) {
      dbQuery = dbQuery.eq('status', query.status);
    }

    const { data, error } = await dbQuery;

    if (error) {
      this.supabase.throwFromPostgresError(error);
    }

    return data ?? [];
  }

  async approvePharmacy(id: string, adminId: string) {
    const { data, error } = await this.supabase.adminClient
      .from('pharmacy_profiles')
      .update({
        status: 'approved',
        verified_by: adminId,
        verified_at: new Date().toISOString(),
        rejection_reason: null,
      })
      .eq('id', id)
      .select(PHARMACY_SELECT)
      .single();

    if (error) {
      this.supabase.throwFromPostgresError(error);
    }

    if (!data) {
      throw new NotFoundException('Pharmacy not found');
    }

    return data;
  }

  async rejectPharmacy(id: string, adminId: string, reason: string) {
    const { data, error } = await this.supabase.adminClient
      .from('pharmacy_profiles')
      .update({
        status: 'rejected',
        rejection_reason: reason,
        verified_by: adminId,
        verified_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select(PHARMACY_SELECT)
      .single();

    if (error) {
      this.supabase.throwFromPostgresError(error);
    }

    if (!data) {
      throw new NotFoundException('Pharmacy not found');
    }

    return data;
  }

  async listUsers(query: ListUsersQueryDto) {
    const limit = query.limit ?? 20;

    let dbQuery = this.supabase.adminClient
      .from('user_profiles')
      .select('id, full_name, phone, created_at, deleted_at')
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1);

    if (!query.include_deleted) {
      dbQuery = dbQuery.is('deleted_at', null);
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

    const items = (data ?? []) as UserProfileRow[];
    const hasMore = items.length > limit;
    const page = hasMore ? items.slice(0, limit) : items;
    const last = page[page.length - 1];
    const enrichedPage = await this.enrichUsersWithAuth(page);

    return {
      items: enrichedPage,
      nextCursor:
        hasMore && last
          ? this.encodeCursor({ created_at: last.created_at, id: last.id })
          : null,
    };
  }

  private async enrichUsersWithAuth(
    profiles: UserProfileRow[],
  ): Promise<AdminUserListItem[]> {
    return Promise.all(
      profiles.map(async (profile) => {
        const { data } = await this.supabase.adminClient.auth.admin.getUserById(
          profile.id,
        );

        return {
          ...profile,
          email: data.user?.email ?? null,
          last_login: data.user?.last_sign_in_at ?? null,
          status: profile.deleted_at ? 'deleted' : 'active',
        };
      }),
    );
  }

  async softDeleteUser(id: string) {
    const { data, error } = await this.supabase.adminClient
      .from('user_profiles')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
      .is('deleted_at', null)
      .select('id, full_name, phone, deleted_at')
      .single();

    if (error) {
      this.supabase.throwFromPostgresError(error);
    }

    if (!data) {
      throw new NotFoundException('User not found or already deleted');
    }

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
    const [
      activeUsers,
      pendingPharmacies,
      approvedPharmacies,
      rejectedPharmacies,
      pendingReservations,
      confirmedReservations,
      cancelledReservations,
      expiredReservations,
      revenueResult,
    ] = await Promise.all([
      this.supabase.adminClient
        .from('user_profiles')
        .select('id', { count: 'exact', head: true })
        .is('deleted_at', null),
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

    const revenueRows = (revenueResult.data ?? []) as RevenueRow[];
    const totalRevenue = revenueRows.reduce(
      (sum, row) => sum + Number(row.total_price ?? 0),
      0,
    );

    return {
      users: {
        active: activeUsers.count ?? 0,
      },
      pharmacies: {
        pending: pendingPharmacies.count ?? 0,
        approved: approvedPharmacies.count ?? 0,
        rejected: rejectedPharmacies.count ?? 0,
        total:
          (pendingPharmacies.count ?? 0) +
          (approvedPharmacies.count ?? 0) +
          (rejectedPharmacies.count ?? 0),
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
