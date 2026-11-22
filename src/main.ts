import { VersioningType } from '@nestjs/common';
import { NestFactory, Reflector } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';
import { BigIntSerializerInterceptor } from './common/interceptors/bigint-serializer.interceptor.js';
import { ResponseEnvelopeInterceptor } from './common/interceptors/response-envelope.interceptor.js';
import { createValidationPipe } from './common/pipes/validation.pipe.js';
import { appConfig, type AppConfig } from './config/index.js';
import { setupSwagger } from './swagger.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  const config = app.get<AppConfig>(appConfig.KEY);

  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();

  // Security
  if (config.trustProxy) app.set('trust proxy', 1);
  app.use(helmet({ contentSecurityPolicy: config.isProduction ? undefined : false }));
  app.enableCors({
    origin: config.corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    exposedHeaders: ['x-request-id', 'retry-after'],
    maxAge: 600,
  });
  app.useBodyParser('json', { limit: config.bodySizeLimit });
  app.useBodyParser('urlencoded', { limit: config.bodySizeLimit, extended: true });

  // Routing: /api/v1/...
  app.setGlobalPrefix(config.apiPrefix);
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: config.apiVersion });

  // Request/response pipeline
  app.useGlobalPipes(createValidationPipe());
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(
    new ResponseEnvelopeInterceptor(app.get(Reflector)),
    new BigIntSerializerInterceptor(),
  );

  if (config.swaggerEnabled) setupSwagger(app, config);

  await app.listen(config.port, '0.0.0.0');
  app
    .get(Logger)
    .log(
      `ShikkhaAI API listening on http://localhost:${config.port}/${config.apiPrefix}/v${config.apiVersion}`,
      'Bootstrap',
    );
}

await bootstrap();
