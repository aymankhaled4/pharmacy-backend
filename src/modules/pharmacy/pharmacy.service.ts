import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../../database/supabase.service';
import { RegisterPharmacyDto } from './dto/register-pharmacy.dto';
import { UpdatePharmacyProfileDto } from './dto/update-pharmacy-profile.dto';

const PHARMACY_SELECT =
  'id, pharmacy_name, phone, address, city, license_number, status, rejection_reason, verified_by, verified_at, created_at';

@Injectable()
export class PharmacyService {
  constructor(private supabase: SupabaseService) {}

  async register(dto: RegisterPharmacyDto) {
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
      throw new BadRequestException(authError.message);
    }

    const userId = authData.user.id;

    const { data, error } = await this.supabase.adminClient
      .from('pharmacy_profiles')
      .insert({
        id: userId,
        pharmacy_name: dto.pharmacy_name,
        phone: dto.phone,
        address: dto.address,
        city: dto.city,
        license_number: dto.license_number,
        status: 'pending',
        location: `SRID=4326;POINT(${dto.longitude} ${dto.latitude})`,
      })
      .select(PHARMACY_SELECT)
      .single();

    if (error) {
      await this.supabase.adminClient.auth.admin.deleteUser(userId);
      this.supabase.throwFromPostgresError(error);
    }

    return data;
  }

  async getProfile(pharmacyId: string) {
    const { data, error } = await this.supabase.adminClient
      .from('pharmacy_profiles')
      .select(PHARMACY_SELECT)
      .eq('id', pharmacyId)
      .single();

    if (error || !data) {
      throw new NotFoundException('Pharmacy profile not found');
    }

    return data;
  }

  async updateProfile(pharmacyId: string, dto: UpdatePharmacyProfileDto) {
    const { data, error } = await this.supabase.adminClient
      .from('pharmacy_profiles')
      .update(dto)
      .eq('id', pharmacyId)
      .select(PHARMACY_SELECT)
      .single();

    if (error) {
      this.supabase.throwFromPostgresError(error);
    }

    if (!data) {
      throw new NotFoundException('Pharmacy profile not found');
    }

    return data;
  }
}
