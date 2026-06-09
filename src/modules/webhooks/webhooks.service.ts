import { Injectable } from '@nestjs/common';
import {
  NotificationRow,
  NotificationsService,
} from '../notifications/notifications.service';

export interface NotificationWebhookPayload {
  record?: NotificationRow;
  type?: string;
  table?: string;
  schema?: string;
}

@Injectable()
export class WebhooksService {
  constructor(private notificationsService: NotificationsService) {}

  async handleNotification(
    payload: NotificationWebhookPayload | NotificationRow,
  ) {
    const record = this.extractNotificationRecord(payload);
    const dispatchResult = await this.notificationsService.dispatch(record);

    return {
      success: true,
      notificationId: record.id,
      dispatch: dispatchResult,
    };
  }

  private extractNotificationRecord(
    payload: NotificationWebhookPayload | NotificationRow,
  ): NotificationRow {
    if ('record' in payload && payload.record) {
      return payload.record;
    }

    return payload as NotificationRow;
  }
}
