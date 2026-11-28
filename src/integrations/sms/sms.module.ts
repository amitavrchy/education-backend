import { Global, Logger, Module } from '@nestjs/common';
import { integrationsConfig, type IntegrationsConfig } from '../../config/index.js';

export const SMS_PROVIDER = Symbol('SMS_PROVIDER');

export interface SmsProvider {
  readonly name: string;
  /** `to` in E.164, e.g. +8801XXXXXXXXX. */
  send(to: string, message: string): Promise<void>;
}

/** Development provider: logs a masked number, never the message body (it may hold an OTP). */
class ConsoleSmsProvider implements SmsProvider {
  readonly name = 'console';
  private readonly logger = new Logger('Sms');
  send(to: string): Promise<void> {
    this.logger.log(
      { to: `${to.slice(0, 6)}*****${to.slice(-2)}` },
      'SMS (not sent: console provider)',
    );
    return Promise.resolve();
  }
}

/** No SMS gateway: sending fails, so phone sign-up/OTP says so instead of waiting for a code that never comes. */
class NoopSmsProvider implements SmsProvider {
  readonly name = 'none';
  send(): Promise<void> {
    return Promise.reject(new Error('SMS_NOT_CONFIGURED'));
  }
}

/** Future adapters: local Bangladeshi SMS gateways (e.g. SSL Wireless, BulkSMSBD). */
@Global()
@Module({
  providers: [
    {
      provide: SMS_PROVIDER,
      inject: [integrationsConfig.KEY],
      useFactory: (config: IntegrationsConfig): SmsProvider =>
        config.sms.provider === 'console' ? new ConsoleSmsProvider() : new NoopSmsProvider(),
    },
  ],
  exports: [SMS_PROVIDER],
})
export class SmsModule {}
