import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../../database/supabase.service';
import { AddInventoryItemDto } from './dto/add-inventory-item.dto';
import { InventoryFilterDto } from './dto/inventory-filter.dto';
import { UpdateInventoryItemDto } from './dto/update-inventory-item.dto';

const INVENTORY_SELECT = `
  id,
  pharmacy_id,
  drug_id,
  batch_number,
  quantity,
  expiry_date,
  selling_price,
  discount_percent,
  status,
  updated_at,
  created_at,
  drug:drug_id (
    id,
    brand_name,
    brand_name_ar,
    generic_name,
    active_ingredient,
    category,
    strength,
    dosage_form,
    manufacturer
  )
`;

@Injectable()
export class InventoryService {
  constructor(private readonly supabase: SupabaseService) {}

  async list(pharmacyId: string, filters: InventoryFilterDto) {
    const limit = filters.limit ?? 20;

    let query = this.supabase.adminClient
      .from('inventory')
      .select(INVENTORY_SELECT)
      .eq('pharmacy_id', pharmacyId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (filters.id) {
      query = query.eq('id', filters.id);
    }

    if (filters.drug_id) {
      query = query.eq('drug_id', filters.drug_id);
    }

    if (filters.status) {
      query = query.eq('status', filters.status);
    }

    if (filters.batch_number?.trim()) {
      query = query.ilike('batch_number', `%${filters.batch_number.trim()}%`);
    }

    if (filters.quantity !== undefined) {
      query = query.eq('quantity', filters.quantity);
    }

    if (filters.expiry_date) {
      query = query.eq('expiry_date', filters.expiry_date);
    }

    if (filters.selling_price !== undefined) {
      query = query.eq('selling_price', filters.selling_price);
    }

    if (filters.discount_percent !== undefined) {
      query = query.eq('discount_percent', filters.discount_percent);
    }

    if (filters.near_expiry) {
      query = query
        .eq('status', 'active')
        .gte('expiry_date', this.getTodayDateString())
        .lte('expiry_date', this.getDateDaysFromNow(30));
    }

    const { data, error } = await query;

    if (error) {
      this.supabase.throwFromPostgresError(error);
    }

    if (!filters.search?.trim()) {
      return data ?? [];
    }

    const search = filters.search.trim().toLowerCase();
    return (data ?? []).filter((item) => {
      const drug = item.drug as unknown as Record<string, string | null> | null;
      return [
        item.batch_number,
        drug?.brand_name,
        drug?.brand_name_ar,
        drug?.generic_name,
        drug?.active_ingredient,
      ].some((value) => value?.toLowerCase().includes(search));
    });
  }

  async add(pharmacyId: string, dto: AddInventoryItemDto) {
    this.assertNotExpired(dto.expiry_date);

    const { data, error } = await this.supabase.adminClient
      .from('inventory')
      .insert({
        pharmacy_id: pharmacyId,
        drug_id: dto.drug_id,
        batch_number: dto.batch_number ?? null,
        quantity: dto.quantity,
        expiry_date: dto.expiry_date,
        selling_price: dto.selling_price,
        discount_percent: dto.discount_percent ?? 0,
        status: 'active',
      })
      .select(INVENTORY_SELECT)
      .single();

    if (error) {
      this.supabase.throwFromPostgresError(error);
    }

    return data;
  }

  async update(
    id: string,
    pharmacyId: string,
    dto: UpdateInventoryItemDto,
  ) {
    if (Object.keys(dto).length === 0) {
      throw new BadRequestException('At least one field is required');
    }

    await this.assertOwnedByPharmacy(id, pharmacyId);

    if (dto.expiry_date) {
      this.assertNotExpired(dto.expiry_date);
    }

    const { data, error } = await this.supabase.adminClient
      .from('inventory')
      .update({ ...dto, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('pharmacy_id', pharmacyId)
      .select(INVENTORY_SELECT)
      .single();

    if (error) {
      this.supabase.throwFromPostgresError(error);
    }

    return data;
  }

  async remove(id: string, pharmacyId: string) {
    await this.assertOwnedByPharmacy(id, pharmacyId);
    await this.assertNoPendingReservations(id);

    const { error } = await this.supabase.adminClient
      .from('inventory')
      .delete()
      .eq('id', id)
      .eq('pharmacy_id', pharmacyId);

    if (error) {
      this.supabase.throwFromPostgresError(error);
    }

    return { success: true };
  }

  async getNearExpiry(pharmacyId: string) {
    const { data, error } = await this.supabase.adminClient
      .from('inventory')
      .select(INVENTORY_SELECT)
      .eq('pharmacy_id', pharmacyId)
      .eq('status', 'active')
      .gte('expiry_date', this.getTodayDateString())
      .lte('expiry_date', this.getDateDaysFromNow(30))
      .order('expiry_date', { ascending: true });

    if (error) {
      this.supabase.throwFromPostgresError(error);
    }

    return data ?? [];
  }

  async updateDiscount(
    id: string,
    pharmacyId: string,
    discountPercent: number,
  ) {
    await this.assertOwnedByPharmacy(id, pharmacyId);

    const { data, error } = await this.supabase.adminClient
      .from('inventory')
      .update({
        discount_percent: discountPercent,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('pharmacy_id', pharmacyId)
      .select(INVENTORY_SELECT)
      .single();

    if (error) {
      this.supabase.throwFromPostgresError(error);
    }

    return data;
  }

  private async assertOwnedByPharmacy(
    inventoryId: string,
    pharmacyId: string,
  ): Promise<void> {
    const { data, error } = await this.supabase.adminClient
      .from('inventory')
      .select('id')
      .eq('id', inventoryId)
      .eq('pharmacy_id', pharmacyId)
      .single();

    if (error || !data) {
      throw new NotFoundException('Inventory item not found');
    }
  }

  private async assertNoPendingReservations(inventoryId: string): Promise<void> {
    const { count, error } = await this.supabase.adminClient
      .from('reservations')
      .select('id', { count: 'exact', head: true })
      .eq('inventory_id', inventoryId)
      .eq('status', 'pending');

    if (error) {
      this.supabase.throwFromPostgresError(error);
    }

    if ((count ?? 0) > 0) {
      throw new BadRequestException(
        'Inventory item has pending reservations and cannot be deleted',
      );
    }
  }

  private getDateDaysFromNow(days: number): string {
    const date = new Date();
    date.setDate(date.getDate() + days);
    return date.toISOString().slice(0, 10);
  }

  private getTodayDateString(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private assertNotExpired(expiryDate: string): void {
    if (expiryDate < this.getTodayDateString()) {
      throw new BadRequestException(
        'Expiry date is already expired and cannot be added to active inventory',
      );
    }
  }
}
