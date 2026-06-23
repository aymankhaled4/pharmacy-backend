import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getMessaging, type Message } from 'firebase-admin/messaging';
import { LoggerService } from '../../shared/logger/logger.service';

export interface FcmSendResult {
  success: boolean;
  invalidToken: boolean;
}

@Injectable()
export class FcmService {
  private readonly enabled: boolean;

  constructor(
    private config: ConfigService,
    private logger: LoggerService,
  ) {
    this.enabled = this.initializeFirebase();
  }

  async send(
    fcmToken: string,
    title: string,
    body: string,
    data: Record<string, string> = {},
  ): Promise<FcmSendResult> {
    if (!this.enabled) {
      this.logger.warn(
        'Firebase service account is not configured',
        'FcmService',
      );
      return { success: false, invalidToken: false };
    }

    try {
      const message: Message = {
        token: fcmToken,
        notification: { title, body },
        data,
        android: {
          notification: {
            channelId: 'dawak_high_importance',
            priority: 'high',
          },
          priority: 'high',
        },
        apns: {
          payload: {
            aps: {
              sound: 'default',
              badge: 1,
            },
          },
        },
      };

      await getMessaging().send(message);
      return { success: true, invalidToken: false };
    } catch (error) {
      const code = this.extractFirebaseErrorCode(error);
      const invalidToken =
        code === 'messaging/invalid-registration-token' ||
        code === 'messaging/registration-token-not-registered';

      this.logger.warn(
        `FCM send failed${code ? `: ${code}` : ''}`,
        'FcmService',
      );

      return { success: false, invalidToken };
    }
  }

  private initializeFirebase(): boolean {
    const rawServiceAccount = this.config.get<string>(
      'FIREBASE_SERVICE_ACCOUNT',
    );

    if (!rawServiceAccount) {
      return false;
    }

    if (getApps().length > 0) {
      return true;
    }

    try {
      const serviceAccount = JSON.parse(rawServiceAccount) as object;
      initializeApp({
        credential: cert(serviceAccount),
      });
      return true;
    } catch (error) {
      this.logger.error(
        'Failed to initialize Firebase Admin SDK',
        error instanceof Error ? error.stack : undefined,
        'FcmService',
      );
      return false;
    }
  }

  private extractFirebaseErrorCode(error: unknown): string | undefined {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      typeof error.code === 'string'
    ) {
      return error.code;
    }

    return undefined;
  }
}
