import 'dotenv/config';
import {PrismaClient} from '../src/api/generated/prisma/client.js';
import {PrismaPg} from '@prisma/adapter-pg';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL must be configured before running the seed script.');
const prisma = new PrismaClient({adapter: new PrismaPg({connectionString: process.env.DATABASE_URL})});
async function main() {
  // Intentionally non-destructive. Never seed fictional customers, professional credentials,
  // property findings, case results, paid transactions or production fees.
  console.log('Schema is ready. No fictional users, legal findings, cases or transactions were seeded.');
}
main().finally(() => prisma.$disconnect());
