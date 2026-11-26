import { Module } from '@nestjs/common';
import { AiProvidersModule } from './ai-providers/ai-providers.module.js';
import { AiServiceModule } from './ai-service/ai-service.module.js';
import { EmailModule } from './email/email.module.js';
import { OcrServicesModule } from './ocr-services/ocr-services.module.js';
import { PaymentProvidersModule } from './payment-providers/payment-providers.module.js';
import { SmsModule } from './sms/sms.module.js';
import { SpeechServicesModule } from './speech-services/speech-services.module.js';

/** All third-party adapters. Each one defaults to a disabled/console implementation. */
@Module({
  imports: [
    AiProvidersModule,
    AiServiceModule,
    SpeechServicesModule,
    OcrServicesModule,
    EmailModule,
    SmsModule,
    PaymentProvidersModule,
  ],
})
export class IntegrationsModule {}
