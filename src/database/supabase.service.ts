import {
  Injectable,
  InternalServerErrorException,
  ConflictException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class SupabaseService {
  readonly adminClient: SupabaseClient;

  private readonly url: string;
  private readonly anonKey: string;

  constructor(private config: ConfigService) {
    this.url = this.config.get<string>('supabase.url')!;
    this.anonKey = this.config.get<string>('supabase.anonKey')!;
    const serviceRoleKey = this.config.get<string>('supabase.serviceRoleKey')!;

    this.adminClient = createClient(this.url, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }

  userClient(token: string): SupabaseClient {
    return createClient(this.url, this.anonKey, {
      global: {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }

  throwFromPostgresError(error: { code?: string; message: string }): never {
    switch (error.code) {
      case '23505':
        throw new ConflictException(error.message);
      case '23503':
        throw new BadRequestException('Referenced record not found');
      case '23514':
        throw new BadRequestException(error.message);
      case 'PGRST116':
        throw new NotFoundException('Record not found');
      default:
        throw new InternalServerErrorException(`Database error: ${error.message}`);
    }
  }
}