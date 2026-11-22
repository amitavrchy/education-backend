import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service.js';
import { EmailNotificationProcessor } from './processors/email-notification.processor.js';

@Module({
  providers: [NotificationsService, EmailNotificationProcessor],
  exports: [NotificationsService],
})
export class NotificationsModule {}
