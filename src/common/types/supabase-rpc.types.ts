export type GetMyRoleResult = 'admin' | 'pharmacy' | 'user' | 'unknown';

export interface CreateReservationResult {
  success: boolean;
  reservation_id: string;
  short_code: string;
  total_price: number;
  expires_at: string;
}

export interface ConfirmPickupResult {
  success: boolean;
  reservation_id: string;
  user_id: string;
  quantity: number;
  confirmed_at: string;
}

export interface DrugSearchResult {
  id: string;
  brand_name: string;
  generic_name: string;
  active_ingredient: string;
  category: string | null;
  strength: string | null;
  dosage_form: string | null;
  manufacturer: string | null;
  rank: number;
}

export interface NearbyPharmacyResult {
  pharmacy_id: string;
  pharmacy_name: string;
  address: string;
  city: string;
  phone: string | null;
  distance_km: number;
  inventory_id: string;
  quantity: number;
  selling_price: number;
  discount_percent: number;
}
