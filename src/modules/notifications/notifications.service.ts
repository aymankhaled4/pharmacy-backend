import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PostgrestError } from '@supabase/supabase-js';
import { UserRole } from '../../common/types/auth-user.type';
import { SupabaseService } from '../../database/supabase.service';
import { LoggerService } from '../../shared/logger/logger.service';
import { FcmService } from './fcm.service';

type NotificationTargetRole = Extract<UserRole, 'user' | 'pharmacy'>;

export interface NotificationRow {
  id: string;
  user_id: string | null;
  pharmacy_id: string | null;
  type: string;
  title: string;
  message: string;
  is_read: boolean;
  created_at: string;
}

interface FcmTokenRow {
  fcm_token: string | null;
}

interface QueryResult<T> {
  data: T | null;
  error: PostgrestError | null;
}

@Injectable()
export class NotificationsService {
  constructor(
    private supabase: SupabaseService,
    private fcm: FcmService,
    private logger: LoggerService,
  ) {}

  async listMine(userId: string, role: UserRole) {
    const targetRole = this.assertNotificationRole(role);
    const targetColumn = this.getTargetColumn(targetRole);

    const { data, error } = (await this.supabase.adminClient
      .from('notifications')
      .select(
        'id, user_id, pharmacy_id, type, title, message, is_read, created_at',
      )
      .eq(targetColumn, userId)
      .order('created_at', { ascending: false })) as QueryResult<
      NotificationRow[]
    >;

    if (error) {
      this.supabase.throwFromPostgresError(error);
    }

    return data;
  }

  async markAsRead(id: string, userId: string, role: UserRole) {
    const targetRole = this.assertNotificationRole(role);
    const targetColumn = this.getTargetColumn(targetRole);

    const { data, error } = (await this.supabase.adminClient
      .from('notifications')
      .update({ is_read: true })
      .eq(targetColumn, userId)
      .eq('id', id)
      .select(
        'id, user_id, pharmacy_id, type, title, message, is_read, created_at',
      )
      .single()) as QueryResult<NotificationRow>;

    if (error || !data) {
      throw new NotFoundException('Notification not found');
    }

    return data;
  }

  async markAllRead(userId: string, role: UserRole) {
    const targetRole = this.assertNotificationRole(role);
    const targetColumn = this.getTargetColumn(targetRole);

    const { data, error } = (await this.supabase.adminClient
      .from('notifications')
      .update({ is_read: true })
      .eq(targetColumn, userId)
      .eq('is_read', false)
      .select('id')) as QueryResult<Array<{ id: string }>>;

    if (error) {
      this.supabase.throwFromPostgresError(error);
    }

    return {
      success: true,
      updatedCount: data?.length ?? 0,
    };
  }

  async dispatch(notification: NotificationRow) {
    const target = this.resolveDispatchTarget(notification);

    if (!target) {
      this.logger.warn(
        `Notification ${notification.id} has no user_id or pharmacy_id`,
        'NotificationsService',
      );
      return { success: false, reason: 'missing_target' };
    }

    const fcmToken = await this.getTargetFcmToken(target.id, target.role);

    if (!fcmToken) {
      this.logger.warn(
        `No FCM token for ${target.role} ${target.id}`,
        'NotificationsService',
      );
      return { success: false, reason: 'missing_fcm_token' };
    }

    const result = await this.fcm.send(
      fcmToken,
      notification.title,
      notification.message,
      {
        notificationId: notification.id,
        type: notification.type,
      },
    );

    if (result.invalidToken) {
      await this.clearTargetFcmToken(target.id, target.role);
    }

    return result;
  }

  private getTargetColumn(role: NotificationTargetRole) {
    return role === 'user' ? 'user_id' : 'pharmacy_id';
  }

  private assertNotificationRole(role: UserRole): NotificationTargetRole {
    if (role !== 'user' && role !== 'pharmacy') {
      throw new BadRequestException(
        'Notifications are available for users and pharmacies only',
      );
    }

    return role;
  }

  private resolveDispatchTarget(
    notification: NotificationRow,
  ): { id: string; role: NotificationTargetRole } | null {
    if (notification.user_id) {
      return { id: notification.user_id, role: 'user' };
    }

    if (notification.pharmacy_id) {
      return { id: notification.pharmacy_id, role: 'pharmacy' };
    }

    return null;
  }

  private async getTargetFcmToken(
    targetId: string,
    role: NotificationTargetRole,
  ): Promise<string | null> {
    const table = role === 'user' ? 'user_profiles' : 'pharmacy_profiles';

    const { data, error } = (await this.supabase.adminClient
      .from(table)
      .select('fcm_token')
      .eq('id', targetId)
      .single()) as {
      data: FcmTokenRow | null;
      error: PostgrestError | null;
    };

    if (error) {
      this.logger.warn(
        `Could not load FCM token for ${role} ${targetId}: ${error.message}`,
        'NotificationsService',
      );
      return null;
    }

    return data?.fcm_token ?? null;
  }

  private async clearTargetFcmToken(
    targetId: string,
    role: NotificationTargetRole,
  ): Promise<void> {
    const table = role === 'user' ? 'user_profiles' : 'pharmacy_profiles';
    const { error } = await this.supabase.adminClient
      .from(table)
      .update({ fcm_token: null })
      .eq('id', targetId);

    if (error) {
      this.logger.warn(
        `Could not clear invalid FCM token for ${role} ${targetId}: ${error.message}`,
        'NotificationsService',
      );
    }
  }
}
