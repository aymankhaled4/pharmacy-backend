import {
  Body,
  Controller,
  ForbiddenException,
  Headers,
  Post,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  NotificationWebhookPayload,
  WebhooksService,
} from './webhooks.service';
import { NotificationRow } from '../notifications/notifications.service';

@ApiTags('Webhooks')
@Controller('webhooks')
export class WebhooksController {
  constructor(
    private webhooksService: WebhooksService,
    private config: ConfigService,
  ) {}

  @Post('notification')
  @ApiOperation({ summary: 'Receive Supabase notification insert webhook' })
  @ApiHeader({ name: 'x-webhook-secret', required: true })
  handleNotification(
    @Headers('x-webhook-secret') secret: string | undefined,
    @Body() payload: NotificationWebhookPayload | NotificationRow,
  ) {
    this.assertWebhookSecret(secret);
    return this.webhooksService.handleNotification(payload);
  }

  private assertWebhookSecret(secret: string | undefined) {
    const expectedSecret = this.config.get<string>('supabase.webhookSecret');

    if (!expectedSecret || secret !== expectedSecret) {
      throw new ForbiddenException('Invalid webhook secret');
    }
  }
}
