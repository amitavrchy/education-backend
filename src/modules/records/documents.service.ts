import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';

/** Singleton JSON objects keyed by name ("systemConfig", "gamification:u-1", …). */
@Injectable()
export class DocumentsService {
  constructor(private readonly prisma: PrismaService) {}

  async find<T>(key: string): Promise<T | undefined> {
    const row = await this.prisma.document.findUnique({ where: { key } });
    return row ? (row.data as T) : undefined;
  }

  /** Returns the stored document, creating it from `seed` on first use. */
  async get<T>(key: string, seed: () => T, ownerId?: string): Promise<T> {
    const found = await this.find<T>(key);
    if (found !== undefined) return found;
    const doc = seed();
    await this.set(key, doc, ownerId);
    return doc;
  }

  async set<T>(key: string, data: T, ownerId?: string | null): Promise<T> {
    const json = data as unknown as Prisma.InputJsonValue;
    await this.prisma.document.upsert({
      where: { key },
      create: { key, data: json, ownerId: ownerId ?? null },
      update: { data: json },
    });
    return data;
  }

  async remove(key: string): Promise<void> {
    await this.prisma.document.deleteMany({ where: { key } });
  }
}
