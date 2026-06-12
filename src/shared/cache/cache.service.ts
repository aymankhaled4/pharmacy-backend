import { Injectable } from '@nestjs/common';
import { createClient, RedisClientType } from 'redis';
import { LoggerService } from '../logger/logger.service';

@Injectable()
export class CacheService {
  private client: RedisClientType;
  private isConnected = false;

  constructor(private logger: LoggerService) {
    this.client = createClient({
      url: process.env.REDIS_URL ?? 'redis://localhost:6379',
    });

    this.client.on('error', (err) => {
      this.logger.error('Redis error', err.message, 'CacheService');
    });

    this.client.connect().then(() => {
        this.isConnected = true;
        this.logger.log('Redis connected', 'CacheService');
      }).catch((err) => {
        this.logger.error('Redis connection failed', err.message, 'CacheService');
      });
  }

  async get<T>(key: string): Promise<T | null> {
    if (!this.isConnected) return null;
    try {
      const value = await this.client.get(key);
      return value ? JSON.parse(value) as T : null;
    } catch {
      return null;
    }
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    if (!this.isConnected) return;
    try {
      await this.client.set(key, JSON.stringify(value), { EX: ttlSeconds });
    } catch {
      // fail silently — cache مش critical
    }
  }

  async delete(key: string): Promise<void> {
    if (!this.isConnected) return;
    try {
      await this.client.del(key);
    } catch {
      // fail silently
    }
  }

  roleKey(userId: string) {
    return `role:${userId}`;
  }

  drugSearchKey(query: string) {
    return `search_drugs:${query.toLowerCase().trim()}`;
  }
}
