import type { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';

// Boots the real AppModule without PostgreSQL or Redis: both connect lazily.
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-0123456789abcdef0123';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-0123456789abcdef012';
process.env.QUEUE_WORKERS_ENABLED = 'false';
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';

describe('HTTP pipeline (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const { AppModule } = await import('../../src/app.module.js');
    const { createValidationPipe } = await import('../../src/common/pipes/validation.pipe.js');
    const { AllExceptionsFilter } =
      await import('../../src/common/filters/all-exceptions.filter.js');
    const { ResponseEnvelopeInterceptor } =
      await import('../../src/common/interceptors/response-envelope.interceptor.js');
    const { VersioningType } = await import('@nestjs/common');

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(createValidationPipe());
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor(app.get(Reflector)));
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('GET /api/v1/health is public', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    expect(response.body.status).toBe('ok');
  });

  it('protected routes answer 401 in the standard error envelope', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/users/me').expect(401);
    expect(response.body).toMatchObject({ success: false, statusCode: 401, code: 'UNAUTHORIZED' });
  });

  it('invalid bodies answer 400 with field errors', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ identifier: 'student@example.com', extra: 'not allowed' })
      .expect(400);
    expect(response.body.code).toBe('VALIDATION_FAILED');
    expect(response.body.errors).toHaveProperty('password');
    expect(response.body.errors).toHaveProperty('extra');
  });

  it('unimplemented auth answers 501, not a fake success', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ identifier: 'student@example.com', password: 'secret123' })
      .expect(501);
  });
});
