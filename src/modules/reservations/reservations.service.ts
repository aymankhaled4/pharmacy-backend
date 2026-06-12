import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PostgrestError } from '@supabase/supabase-js';
import { SupabaseService } from '../../database/supabase.service';
import { CreateReservationDto } from './dto/create-reservation.dto';

interface RpcResponse<T> {
  data: T | null;
  error: PostgrestError | null;
}

interface PendingReservationRow {
  id: string;
  inventory_id: string;
  quantity: number;
  status: string;
}

interface InventoryQuantityRow {
  id: string;
  quantity: number;
}

export interface CreateReservationRpcResult {
  success: boolean;
  reservation_id?: string;
  short_code?: string;
  total_price?: number;
  expires_at?: string;
  error?: string;
}

export interface ConfirmPickupRpcResult {
  success: boolean;
  reservation_id?: string;
  short_code?: string;
  total_price?: number;
  confirmed_at?: string;
  error?: string;
}

const RESERVATION_SELECT = `
  id,
  user_id,
  inventory_id,
  quantity,
  short_code,
  status,
  price_at_reservation,
  discount_at_reservation,
  total_price,
  expires_at,
  confirmed_at,
  created_at,
  inventory:inventory_id (
    id,
    batch_number,
    expiry_date,
    selling_price,
    discount_percent,
    pharmacy:pharmacy_id (
      id,
      pharmacy_name,
      phone,
      address,
      city
    ),
    drug:drug_id (
      id,
      brand_name,
      brand_name_ar,
      generic_name,
      active_ingredient,
      strength,
      dosage_form
    )
  )
`;

const PHARMACY_RESERVATION_SELECT = `
  id,
  user_id,
  inventory_id,
  quantity,
  short_code,
  status,
  price_at_reservation,
  discount_at_reservation,
  total_price,
  expires_at,
  confirmed_at,
  created_at,
  user:user_id (
    id,
    full_name,
    phone
  ),
  inventory:inventory_id!inner (
    id,
    batch_number,
    expiry_date,
    selling_price,
    discount_percent,
    pharmacy_id,
    drug:drug_id (
      id,
      brand_name,
      brand_name_ar,
      generic_name,
      active_ingredient,
      strength,
      dosage_form
    )
  )
`;

@Injectable()
export class ReservationsService {
  constructor(private supabase: SupabaseService) {}

  async create(userId: string, dto: CreateReservationDto) {
    const { data, error } = (await this.supabase.adminClient.rpc(
      'create_reservation',
      {
        p_user_id: userId,
        p_inventory_id: dto.inventoryId,
        p_quantity: dto.quantity,
      },
    )) as RpcResponse<CreateReservationRpcResult>;

    if (error) {
      this.supabase.throwFromPostgresError(error);
    }

    if (!data?.success) {
      throw new BadRequestException(data?.error ?? 'Reservation failed');
    }

    return data;
  }

  async listMine(userId: string) {
    const { data, error } = await this.supabase.adminClient
      .from('reservations')
      .select(RESERVATION_SELECT)
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      this.supabase.throwFromPostgresError(error);
    }

    return data;
  }

  async cancel(id: string, userId: string) {
    const { data: reservation, error: reservationError } =
      await this.supabase.adminClient
        .from('reservations')
        .select('id, inventory_id, quantity, status')
        .eq('id', id)
        .eq('user_id', userId)
        .single();

    if (reservationError || !reservation) {
      throw new NotFoundException('Reservation not found');
    }

    if (reservation.status !== 'pending') {
      throw new BadRequestException(
        'Only pending reservations can be cancelled',
      );
    }

    const { data: inventory, error: inventoryError } =
      await this.supabase.adminClient
        .from('inventory')
        .select('id, quantity')
        .eq('id', reservation.inventory_id)
        .single();

    if (inventoryError || !inventory) {
      throw new NotFoundException('Inventory item not found');
    }

    const { error: updateInventoryError } = await this.supabase.adminClient
      .from('inventory')
      .update({ quantity: inventory.quantity + reservation.quantity })
      .eq('id', reservation.inventory_id);

    if (updateInventoryError) {
      this.supabase.throwFromPostgresError(updateInventoryError);
    }

    const { data, error } = await this.supabase.adminClient
      .from('reservations')
      .update({ status: 'cancelled' })
      .eq('id', id)
      .eq('user_id', userId)
      .eq('status', 'pending')
      .select(RESERVATION_SELECT)
      .single();

    if (error) {
      this.supabase.throwFromPostgresError(error);
    }

    return data;
  }

  async cancelForPharmacy(id: string, pharmacyId: string) {
    const reservation = await this.findPendingReservationForPharmacy(
      id,
      pharmacyId,
    );

    const inventory = await this.getInventoryQuantity(reservation.inventory_id);

    const { error: updateInventoryError } = await this.supabase.adminClient
      .from('inventory')
      .update({ quantity: inventory.quantity + reservation.quantity })
      .eq('id', reservation.inventory_id);

    if (updateInventoryError) {
      this.supabase.throwFromPostgresError(updateInventoryError);
    }

    const { data, error } = await this.supabase.adminClient
      .from('reservations')
      .update({ status: 'cancelled' })
      .eq('id', id)
      .eq('status', 'pending')
      .select(PHARMACY_RESERVATION_SELECT)
      .single();

    if (error) {
      this.supabase.throwFromPostgresError(error);
    }

    return data;
  }

  async listForPharmacy(pharmacyId: string, status?: string) {
    let query = this.supabase.adminClient
      .from('reservations')
      .select(PHARMACY_RESERVATION_SELECT)
      .eq('inventory.pharmacy_id', pharmacyId)
      .order('created_at', { ascending: false });

    if (status) {
      query = query.eq('status', status);
    }

    const { data, error } = await query;

    if (error) {
      this.supabase.throwFromPostgresError(error);
    }

    return data;
  }

  private async findPendingReservationForPharmacy(
    reservationId: string,
    pharmacyId: string,
  ): Promise<PendingReservationRow> {
    const { data, error } = (await this.supabase.adminClient
      .from('reservations')
      .select(
        `
          id,
          inventory_id,
          quantity,
          status,
          inventory:inventory_id!inner (
            pharmacy_id
          )
        `,
      )
      .eq('id', reservationId)
      .eq('inventory.pharmacy_id', pharmacyId)
      .single()) as {
      data: PendingReservationRow | null;
      error: PostgrestError | null;
    };

    if (error || !data) {
      throw new NotFoundException('Reservation not found for this pharmacy');
    }

    if (data.status !== 'pending') {
      throw new BadRequestException(
        'Only pending reservations can be cancelled',
      );
    }

    return data;
  }

  private async getInventoryQuantity(
    inventoryId: string,
  ): Promise<InventoryQuantityRow> {
    const { data, error } = (await this.supabase.adminClient
      .from('inventory')
      .select('id, quantity')
      .eq('id', inventoryId)
      .single()) as {
      data: InventoryQuantityRow | null;
      error: PostgrestError | null;
    };

    if (error || !data) {
      throw new NotFoundException('Inventory item not found');
    }

    return data;
  }

  async confirmPickup(shortCode: string, pharmacyId: string) {
    const { data, error } = (await this.supabase.adminClient.rpc(
      'confirm_pickup',
      {
        p_short_code: shortCode.toUpperCase(),
        p_pharmacy_id: pharmacyId,
      },
    )) as RpcResponse<ConfirmPickupRpcResult>;

    if (error) {
      this.supabase.throwFromPostgresError(error);
    }

    if (!data?.success) {
      throw new BadRequestException(
        data?.error ?? 'Pickup confirmation failed',
      );
    }

    return data;
  }
}
