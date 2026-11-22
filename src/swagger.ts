import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { AppConfig } from './config/index.js';

/** OpenAPI docs at /api/docs (UI) and /api/docs-json (document). */
export function setupSwagger(app: INestApplication, config: AppConfig): void {
  const documentConfig = new DocumentBuilder()
    .setTitle('ShikkhaAI API')
    .setDescription(
      'REST API for ShikkhaAI — AI-powered learning for SSC/HSC students, teachers, parents and institutions in Bangladesh.\n\n' +
        'Every success response is `{ success: true, data, meta? }`; every error is ' +
        '`{ success: false, statusCode, code, message, errors?, path, timestamp, requestId }`.',
    )
    .setVersion(`v${config.apiVersion}`)
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' })
    .addTag('health', 'Liveness and readiness probes')
    .addTag('auth', 'Sign-in, tokens and sessions')
    .addTag('users', 'Accounts')
    .addTag('ai', 'AI tutor and AI features')
    .build();

  const docsPath = `${config.apiPrefix}/docs`;
  const documentFactory = () => {
    const document = SwaggerModule.createDocument(app, documentConfig);
    // setup() serves the JSON outside Nest's router; list it explicitly.
    document.paths[`/${docsPath}-json`] = {
      get: {
        tags: ['health'],
        summary: 'This OpenAPI document',
        responses: { '200': { description: 'OpenAPI JSON' } },
      },
    };
    return document;
  };

  SwaggerModule.setup(docsPath, app, documentFactory, {
    swaggerOptions: { persistAuthorization: true, docExpansion: 'none' },
    customSiteTitle: 'ShikkhaAI API Docs',
  });
}
