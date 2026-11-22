import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { appConfig, type AppConfig } from '../../config/index.js';

const REQUEST_ID_HEADER = 'x-request-id';

/** Reuse an incoming request id (from a proxy) or create one, and echo it back. */
function genReqId(req: IncomingMessage, res: ServerResponse): string {
  const incoming = req.headers[REQUEST_ID_HEADER];
  const id = (Array.isArray(incoming) ? incoming[0] : incoming) || randomUUID();
  res.setHeader(REQUEST_ID_HEADER, id);
  return id;
}

/**
 * Structured JSON logs (pino) with per-request ids and redaction of secrets.
 * Pretty-printed in development, raw JSON to stdout elsewhere.
 */
@Module({
  imports: [
    LoggerModule.forRootAsync({
      inject: [appConfig.KEY],
      useFactory: (config: AppConfig) => ({
        pinoHttp: {
          level: config.logLevel,
          genReqId,
          redact: {
            paths: [
              'req.headers.authorization',
              'req.headers.cookie',
              'res.headers["set-cookie"]',
              '*.password',
              '*.passwordHash',
              '*.refreshToken',
              '*.otp',
            ],
            censor: '[REDACTED]',
          },
          customProps: () => ({ service: 'shikkhaai-api' }),
          autoLogging: {
            ignore: (req: IncomingMessage) => req.url?.includes('/health') ?? false,
          },
          transport: config.isProduction
            ? undefined
            : {
                target: 'pino-pretty',
                options: { singleLine: true, translateTime: 'SYS:HH:MM:ss' },
              },
        },
      }),
    }),
  ],
})
export class LoggingModule {}
