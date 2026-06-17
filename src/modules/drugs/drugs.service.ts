import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { SupabaseService } from '../../database/supabase.service';

@Injectable()
export class DrugsService {
  constructor(private readonly supabase: SupabaseService) {}

  async search(query: string, latitude?: string, longitude?: string, radius?: string) {
    const normalizedQuery = query?.trim();

    if (!normalizedQuery) {
      throw new BadRequestException('Search query is required');
    }

    const { data, error } = await this.supabase.adminClient.rpc('search_drugs', {
      p_query: normalizedQuery,
    });

    if (error) {
      this.supabase.throwFromPostgresError(error);
    }

    const drugs = data ?? [];
    const hasLocation = latitude !== undefined || longitude !== undefined;

    if (hasLocation) {
      if (latitude === undefined || longitude === undefined) {
        throw new BadRequestException('Both latitude and longitude are required');
      }

      const results = await Promise.all(
        drugs.map(async (drug: Record<string, any>) => {
          const drugId = drug.id ?? drug.drug_id;
          if (typeof drugId !== 'string' || drugId.length === 0) {
            return null;
          }

          const pharmacies = await this.findNearby(drugId, latitude, longitude, radius);
          if (pharmacies.length === 0) {
            return null;
          }

          return {
            ...drug,
            pharmacies,
          };
        }),
      );

      return results.filter((drug): drug is Record<string, any> => drug !== null);
    }

    const drugIds = drugs
      .map((drug: Record<string, any>) => drug.id ?? drug.drug_id)
      .filter((id: unknown): id is string => typeof id === 'string' && id.length > 0);

    if (drugIds.length === 0) {
      return [];
    }

    const { data: inventoryData, error: inventoryError } =
      await this.supabase.adminClient
        .from('inventory')
        .select('drug_id, pharmacy:pharmacy_id!inner(status)')
        .in('drug_id', drugIds)
        .eq('status', 'active')
        .gt('quantity', 0)
        .eq('pharmacy.status', 'approved');

    if (inventoryError) {
      this.supabase.throwFromPostgresError(inventoryError);
    }

    const availableDrugIds = new Set(
      (inventoryData ?? [])
        .map((item: Record<string, any>) => item.drug_id)
        .filter((id: unknown): id is string => typeof id === 'string'),
    );

    return drugs.filter((drug: Record<string, any>) =>
      availableDrugIds.has(drug.id ?? drug.drug_id),
    );
  }

  async getTrending(limit?: string) {
    return this.getTopRequested(limit);
  }

  async getTopRequested(limit?: string) {
    const parsedLimit = this.parseLimit(limit, 5);

    const { data, error } = await this.supabase.adminClient
      .from('reservations')
      .select(
        `
          id,
          quantity,
          status,
          inventory:inventory_id (
            drug:drug_id (
              id,
              brand_name,
              brand_name_ar,
              generic_name,
              active_ingredient,
              category
            )
          )
        `,
      )
      .in('status', ['pending', 'confirmed'])
      .limit(1000);

    if (error) {
      this.supabase.throwFromPostgresError(error);
    }

    const counts = new Map<string, Record<string, any>>();

    for (const reservation of data ?? []) {
      const inventory = reservation.inventory as unknown as Record<string, any> | null;
      const drug = inventory?.drug as Record<string, any> | null;
      if (!drug?.id) continue;

      const current = counts.get(drug.id) ?? {
        drug_id: drug.id,
        label: drug.generic_name ?? drug.brand_name,
        brand_name: drug.brand_name,
        brand_name_ar: drug.brand_name_ar,
        generic_name: drug.generic_name,
        active_ingredient: drug.active_ingredient,
        category: drug.category,
        request_count: 0,
        total_quantity: 0,
      };

      current.request_count += 1;
      current.total_quantity += reservation.quantity ?? 0;
      counts.set(drug.id, current);
    }

    return Array.from(counts.values())
      .sort((a, b) => {
        if (b.request_count !== a.request_count) {
          return b.request_count - a.request_count;
        }

        return b.total_quantity - a.total_quantity;
      })
      .slice(0, parsedLimit);
  }

  async findNearby(
    drugId: string,
    latitude: string,
    longitude: string,
    radius?: string,
  ) {
    const parsedLatitude = Number(latitude);
    const parsedLongitude = Number(longitude);
    const parsedRadius = radius === undefined ? 10 : Number(radius);

    if (!drugId) {
      throw new BadRequestException('Drug id is required');
    }

    if (!Number.isFinite(parsedLatitude) || parsedLatitude < -90 || parsedLatitude > 90) {
      throw new BadRequestException('Latitude must be a valid number between -90 and 90');
    }

    if (
      !Number.isFinite(parsedLongitude) ||
      parsedLongitude < -180 ||
      parsedLongitude > 180
    ) {
      throw new BadRequestException('Longitude must be a valid number between -180 and 180');
    }

    if (!Number.isFinite(parsedRadius) || parsedRadius <= 0) {
      throw new BadRequestException('Radius must be a positive number');
    }

    const { data, error } = await this.supabase.adminClient.rpc(
      'search_nearby_pharmacies',
      {
        p_drug_id: drugId,
        p_latitude: parsedLatitude,
        p_longitude: parsedLongitude,
        p_radius_km: parsedRadius,
      },
    );

    if (error) {
      if (error.message?.includes('function') && error.message?.includes('does not exist')) {
        throw new InternalServerErrorException(
          'search_nearby_pharmacies RPC signature does not match the backend call',
        );
      }

      this.supabase.throwFromPostgresError(error);
    }

    return data ?? [];
  }

  private parseLimit(value: string | undefined, defaultValue: number): number {
    if (value === undefined) return defaultValue;

    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 50) {
      throw new BadRequestException('Limit must be an integer between 1 and 50');
    }

    return parsed;
  }

}
