import { Global, Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsService } from './notifications.service.js';
import { EmailNotificationProcessor } from './processors/email-notification.processor.js';

@Global()
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, EmailNotificationProcessor],
  exports: [NotificationsService],
})
export class NotificationsModule {}
