import { Global, Module } from '@nestjs/common';
import { BillingController } from './billing.controller.js';
import { BillingService } from './billing.service.js';
import { UsageService } from './usage.service.js';

@Global()
@Module({
  controllers: [BillingController],
  providers: [BillingService, UsageService],
  exports: [UsageService],
})
export class BillingModule {}
