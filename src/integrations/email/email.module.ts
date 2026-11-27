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

/** Resend (https://resend.com) over its REST API (EMAIL_PROVIDER=resend, RESEND_API_KEY). */
class ResendEmailProvider implements EmailProvider {
  readonly name = 'resend';
  private readonly logger = new Logger('Email');

  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  async send(message: EmailMessage): Promise<void> {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: this.from,
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const body = (await res.text()).slice(0, 300);
      this.logger.error({ status: res.status, body }, 'Resend rejected the email');
      throw new Error(`EMAIL_SEND_FAILED (${res.status})`);
    }
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
      useFactory: (config: IntegrationsConfig, consoleProvider: ConsoleEmailProvider) => {
        if (config.email.provider === 'resend')
          return new ResendEmailProvider(config.email.resendApiKey ?? '', config.email.from);
        return config.email.provider === 'console' ? consoleProvider : new NoopEmailProvider();
      },
    },
  ],
  exports: [EMAIL_PROVIDER],
})
export class EmailModule {}
