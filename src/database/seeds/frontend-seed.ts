import { readFileSync } from 'node:fs';
import { asText } from '../../common/utils/json.util.js';
import { gunzipSync } from 'node:zlib';
import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import { ROLE_PORTAL } from '../../common/auth/permissions.js';
import type { UserRole } from '../../contracts/user.js';
import { resourceByCollection } from '../../modules/records/resource-registry.js';

type Json = Record<string, unknown>;

export interface FrontendSeed {
  exportedAt: string;
  demoUsers: Record<UserRole, { id: string }>;
  studentIds: string[];
  collections: Record<string, Json[]>;
  documents: Record<string, unknown>;
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Moves every exact ISO timestamp / YYYY-MM-DD value forward by `days`, so relative demo data
 * ("exam closes in 3 days", "studied yesterday") stays relative to the day you seed.
 */
export function shiftDates<T>(value: T, days: number): T {
  if (!days) return value;
  const ms = days * 864e5;
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') {
      if (ISO.test(v)) return new Date(new Date(v).getTime() + ms).toISOString();
      if (DAY.test(v))
        return new Date(new Date(`${v}T00:00:00Z`).getTime() + ms).toISOString().slice(0, 10);
      return v;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object')
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(value) as T;
}

export function loadFrontendSeed(file: string): FrontendSeed {
  const seed = JSON.parse(gunzipSync(readFileSync(file)).toString('utf8')) as FrontendSeed;
  const days = Math.floor((Date.now() - new Date(seed.exportedAt).getTime()) / 864e5);
  return days > 0
    ? {
        ...seed,
        collections: shiftDates(seed.collections, days),
        documents: shiftDates(seed.documents, days),
      }
    : seed;
}

const readPath = (obj: unknown, path?: string) =>
  path
    ? path.split('.').reduce<unknown>((acc, k) => (acc == null ? acc : (acc as Json)[k]), obj)
    : undefined;

const normalizePhone = (v: unknown) =>
  typeof v === 'string' ? v.replace(/\D/g, '').replace(/^88/, '') || null : null;

/**
 * Loads the frontend demo data: credential rows for every account (password = SEED_DEMO_PASSWORD),
 * every collection into `records`, every singleton into `documents`. Idempotent: existing rows
 * are kept unless `reset` is set.
 */
export async function seedFrontendData(
  prisma: PrismaClient,
  seed: FrontendSeed,
  opts: { passwordHash: string; reset?: boolean },
) {
  if (opts.reset) {
    await prisma.$transaction([
      prisma.record.deleteMany(),
      prisma.document.deleteMany(),
      prisma.userSession.deleteMany(),
      prisma.otpChallenge.deleteMany(),
    ]);
  }

  // Credentials for every account in the users collection.
  for (const u of seed.collections.users ?? []) {
    const data = {
      email: typeof u.email === 'string' ? u.email.toLowerCase() : null,
      phone: normalizePhone(u.phone),
      name: asText(u.name),
      role: String(u.role),
      status: asText(u.status, 'active'),
      institutionId: typeof u.institutionId === 'string' ? u.institutionId : null,
    };
    await prisma.user.upsert({
      where: { id: String(u.id) },
      create: { id: String(u.id), ...data, passwordHash: opts.passwordHash },
      update: opts.reset ? { ...data, passwordHash: opts.passwordHash, deletedAt: null } : {},
    });
  }

  // Notifications were per portal in the mock: give each one to the demo account of that portal.
  const portalOwner = new Map<string, string>();
  for (const [role, user] of Object.entries(seed.demoUsers)) {
    const portal = ROLE_PORTAL[role as UserRole];
    if (!portalOwner.has(portal)) portalOwner.set(portal, user.id);
  }
  const collections = { ...seed.collections };
  collections.notifications = (collections.notifications ?? []).map((n) => ({
    ...n,
    userId: portalOwner.get(String(n.portal)) ?? seed.demoUsers.student.id,
  }));

  let total = 0;
  for (const [key, items] of Object.entries(collections)) {
    const [collection, scope = ''] = key.split(':');
    const def = resourceByCollection(collection);
    // sessionRecords are served from the real user_sessions table.
    if (!def) {
      if (collection !== 'sessionRecords')
        console.warn(`  ! skipping unknown collection ${collection}`);
      continue;
    }
    const rows = items
      .filter((d) => typeof d.id === 'string' && d.id)
      .map((d) => {
        const owner = readPath(d, def.ownerField);
        const inst = readPath(d, def.institutionField);
        return {
          collection,
          scope,
          id: String(d.id),
          data: d as Prisma.InputJsonValue,
          ownerId: typeof owner === 'string' ? owner : null,
          institutionId: typeof inst === 'string' ? inst : null,
        };
      });
    for (let i = 0; i < rows.length; i += 1000) {
      const res = await prisma.record.createMany({
        data: rows.slice(i, i + 1000),
        skipDuplicates: true,
      });
      total += res.count;
    }
  }

  // The frontend's demo link code targets a fictional student; point it at a real student who is
  // not yet linked to the demo guardian.
  const demoParent = seed.demoUsers.parent.id;
  const linked = new Set(
    (seed.collections.guardianLinks ?? [])
      .filter((l) => l.guardianId === demoParent)
      .map((l) => String(l.studentId)),
  );
  const linkTarget = (seed.collections.users ?? []).find(
    (u) => u.role === 'student' && u.status === 'active' && !linked.has(String(u.id)),
  )?.id;

  const documents: Record<string, unknown> = {
    ...seed.documents,
    demoAccounts: Object.fromEntries(
      Object.entries(seed.demoUsers).map(([role, u]) => [role, u.id]),
    ),
    // The frontend's demo guardian link code (student settings → share code).
    ...(linkTarget
      ? {
          'guardianCode:SHK-2741': {
            code: 'SHK-2741',
            studentId: asText(linkTarget),
            expiresAt: new Date(Date.now() + 3650 * 864e5).toISOString(),
          },
        }
      : {}),
  };
  for (const [key, data] of Object.entries(documents)) {
    const ownerId = key.includes(':') ? key.split(':')[1] : null;
    const json = data as Prisma.InputJsonValue;
    await prisma.document.upsert({
      where: { key },
      create: { key, data: json, ownerId },
      update: opts.reset ? { data: json } : {},
    });
  }
  return {
    records: total,
    documents: Object.keys(documents).length,
    users: (seed.collections.users ?? []).length,
  };
}
