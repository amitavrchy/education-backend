/**
 * Seeds the database with the frontend's demo data (prisma/seed-data/frontend-seed.json.gz,
 * produced by `npm run seed:export`). Every demo account gets SEED_DEMO_PASSWORD; with
 * AUTH_DEMO_MODE=true they also accept any password except "wrongpass" (like the frontend mock).
 *
 *   npm run db:seed              keep existing rows, add missing ones
 *   npm run db:seed -- --reset   wipe records/documents/sessions first
 */
import 'dotenv/config';
import { join } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { PasswordHasherService } from '../src/modules/auth/services/password-hasher.service.js';
import { loadFrontendSeed, seedFrontendData } from '../src/database/seeds/frontend-seed.js';
import { PrismaClient } from '../src/generated/prisma/client.js';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is not set');
if (process.env.NODE_ENV === 'production' && !process.argv.includes('--allow-production')) {
  throw new Error(
    'Refusing to load demo data into production (pass --allow-production to override).',
  );
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const password = process.env.SEED_DEMO_PASSWORD ?? 'demo-password-123';

try {
  const seed = loadFrontendSeed(join(import.meta.dirname, 'seed-data', 'frontend-seed.json.gz'));
  const passwordHash = await new PasswordHasherService().hash(password);
  const res = await seedFrontendData(prisma, seed, {
    passwordHash,
    reset: process.argv.includes('--reset'),
  });
  console.log(`✔ ${res.users} accounts, ${res.records} records, ${res.documents} documents`);
} finally {
  await prisma.$disconnect();
}
