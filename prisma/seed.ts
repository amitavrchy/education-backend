/**
 * Seeds reference data only (roles, permissions, boards, classes, groups).
 * No user accounts or credentials are created here.
 * Run: npm run db:seed   (also runs after `prisma migrate reset`)
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { seedAcademicCatalog, seedRbac } from '../src/database/seeds/index.js';
import { PrismaClient } from '../src/generated/prisma/client.js';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is not set');

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

try {
  await seedRbac(prisma);
  console.log('✔ Roles and permissions');
  await seedAcademicCatalog(prisma);
  console.log('✔ Education boards, classes and groups');
} finally {
  await prisma.$disconnect();
}
