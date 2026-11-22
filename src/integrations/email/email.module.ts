import { Global, Injectable, Logger, Module } from '@nestjs/common';
import { integrationsConfig, type IntegrationsConfig } from '../../config/index.js';

export const EMAIL_PROVIDER = Symbol('EMAIL_PROVIDER');

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export interface EmailProvider {
  readonly name: string;
  send(message: EmailMessage): Promise<void>;
}

/** Development provider: logs the email instead of sending it (EMAIL_PROVIDER=console). */
@Injectable()
class ConsoleEmailProvider implements EmailProvider {
  readonly name = 'console';
  private readonly logger = new Logger('Email');
  send(message: EmailMessage): Promise<void> {
    this.logger.log(
      { to: message.to, subject: message.subject },
      'Email (not sent: console provider)',
    );
    return Promise.resolve();
  }
}

class NoopEmailProvider implements EmailProvider {
  readonly name = 'none';
  send(): Promise<void> {
    return Promise.resolve();
  }
}

@Global()
@Module({
  providers: [
    ConsoleEmailProvider,
    {
      provide: EMAIL_PROVIDER,
      inject: [integrationsConfig.KEY, ConsoleEmailProvider],
      useFactory: (config: IntegrationsConfig, consoleProvider: ConsoleEmailProvider) =>
        config.email.provider === 'console' ? consoleProvider : new NoopEmailProvider(),
    },
  ],
  exports: [EMAIL_PROVIDER],
})
export class EmailModule {}
