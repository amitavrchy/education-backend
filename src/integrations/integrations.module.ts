import { Module } from '@nestjs/common';
import { AiServiceModule } from './ai-service/ai-service.module.js';
import { EmailModule } from './email/email.module.js';
import { PaymentProvidersModule } from './payment-providers/payment-providers.module.js';
import { SmsModule } from './sms/sms.module.js';

/** Third-party adapters. AI (models, OCR, speech) lives in the separate AI service (`education-ai`). */
@Module({
  imports: [AiServiceModule, EmailModule, SmsModule, PaymentProvidersModule],
})
export class IntegrationsModule {}
