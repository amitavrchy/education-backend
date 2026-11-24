import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';

/** A contract entity: any JSON object with a string id. */
export type Entity = { id: string } & Record<string, unknown>;

/** Equality conditions on data paths; every key must match (AND), a value list means "one of". */
export type Where = Record<string, readonly (string | number | boolean)[]>;

/** Row-level visibility: everything, nothing, or any of several conditions (OR of ANDs). */
export type Visibility = 'all' | 'none' | Where[];

export interface ListQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  filters?: Where;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface CollectionRef {
  collection: string;
  /** "" for global collections, the owning user id for per-student ones. */
  scope: string;
}

export interface StoreOptions {
  searchFields?: string[];
  defaultSort?: { sortBy: string; sortOrder: 'asc' | 'desc' };
  /** Denormalized owner/tenant columns (data paths) for fast access filtering. */
  ownerField?: string;
  institutionField?: string;
}

export const MAX_PAGE_SIZE = 1000;
export const MAX_ALL = 50_000;

const SAFE_PATH = /^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*$/;

function pathArray(path: string): string[] {
  if (!SAFE_PATH.test(path)) throw new Error(`Unsafe data path: ${path}`);
  return path.split('.');
}

/** `data #> '{a,b}'` with the path passed as a bound parameter (never interpolated). */
const jsonAt = (path: string) => Prisma.sql`("data" #> ${pathArray(path)}::text[])`;
const textAt = (path: string) => Prisma.sql`("data" #>> ${pathArray(path)}::text[])`;

function readPath(obj: unknown, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (acc, key) => (acc == null ? acc : (acc as Record<string, unknown>)[key]),
      obj,
    );
}

/**
 * PostgreSQL implementation of the frontend repository semantics
 * (frontend/src/services/core/repository.ts): equality filters with "one of" lists that also
 * match array fields, AND-of-terms case-insensitive search over chosen fields, sort on any
 * data path (nulls last), and page/pageSize pagination clamped like the mock.
 */
@Injectable()
export class RecordStoreService {
  constructor(private readonly prisma: PrismaService) {}

  // ── SQL building ───────────────────────────────────────────────────────

  static condition(where: Where): Prisma.Sql {
    const parts = Object.entries(where).map(([key, values]) => {
      if (!values.length) return Prisma.sql`FALSE`;
      const strings = values.map(String);
      return Prisma.sql`(CASE jsonb_typeof(${jsonAt(key)})
        WHEN 'array' THEN ${jsonAt(key)} ?| ${strings}::text[]
        ELSE ${textAt(key)} = ANY(${strings}::text[]) END)`;
    });
    return parts.length ? Prisma.join(parts, ' AND ') : Prisma.sql`TRUE`;
  }

  static visibilitySql(visibility: Visibility): Prisma.Sql {
    if (visibility === 'all') return Prisma.sql`TRUE`;
    if (visibility === 'none' || !visibility.length) return Prisma.sql`FALSE`;
    return Prisma.sql`(${Prisma.join(
      visibility.map((w) => Prisma.sql`(${RecordStoreService.condition(w)})`),
      ' OR ',
    )})`;
  }

  static searchSql(search: string | undefined, fields: string[]): Prisma.Sql {
    const terms = (search ?? '')
      .toLocaleLowerCase()
      .normalize('NFC')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (!terms.length || !fields.length) return Prisma.sql`TRUE`;
    const haystack = Prisma.sql`lower(${Prisma.join(
      fields.map((f) => Prisma.sql`coalesce(${textAt(f)}, '')`),
      ` || ' ' || `,
    )})`;
    return Prisma.join(
      terms.map((t) => Prisma.sql`strpos(${haystack}, ${t}) > 0`),
      ' AND ',
    );
  }

  private whereSql(
    ref: CollectionRef,
    visibility: Visibility,
    query: ListQuery,
    opts: StoreOptions,
  ): Prisma.Sql {
    return Prisma.sql`"collection" = ${ref.collection} AND "scope" = ${ref.scope}
      AND ${RecordStoreService.visibilitySql(visibility)}
      AND ${RecordStoreService.condition(query.filters ?? {})}
      AND ${RecordStoreService.searchSql(query.search, opts.searchFields ?? [])}`;
  }

  private orderSql(query: ListQuery, opts: StoreOptions): Prisma.Sql {
    const sortBy = query.sortBy ?? opts.defaultSort?.sortBy;
    if (!sortBy || !SAFE_PATH.test(sortBy)) return Prisma.sql`ORDER BY "created_at" DESC, "id" ASC`;
    // Same merge as the mock: `{ ...defaultSort, ...params }`.
    const order = query.sortOrder ?? opts.defaultSort?.sortOrder ?? 'asc';
    const dir = order === 'desc' ? Prisma.sql`DESC` : Prisma.sql`ASC`;
    return Prisma.sql`ORDER BY ${jsonAt(sortBy)} ${dir} NULLS LAST, "id" ASC`;
  }

  // ── Reads ──────────────────────────────────────────────────────────────

  async list<T extends Entity>(
    ref: CollectionRef,
    visibility: Visibility,
    query: ListQuery,
    opts: StoreOptions = {},
  ): Promise<Paginated<T>> {
    const pageSize = Math.min(Math.max(1, Math.floor(query.pageSize ?? 20)), MAX_PAGE_SIZE);
    const where = this.whereSql(ref, visibility, query, opts);
    const [{ count }] = await this.prisma.$queryRaw<
      { count: bigint }[]
    >`SELECT count(*)::bigint AS count FROM "records" WHERE ${where}`;
    const total = Number(count);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(Math.max(1, Math.floor(query.page ?? 1)), totalPages);
    const rows = await this.prisma.$queryRaw<
      { data: T }[]
    >`SELECT "data" FROM "records" WHERE ${where}
      ${this.orderSql(query, opts)} LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`;
    return { items: rows.map((r) => r.data), total, page, pageSize, totalPages };
  }

  async all<T extends Entity>(
    ref: CollectionRef,
    visibility: Visibility = 'all',
    query: Omit<ListQuery, 'page' | 'pageSize'> = {},
    opts: StoreOptions = {},
  ): Promise<T[]> {
    const rows = await this.prisma.$queryRaw<{ data: T }[]>`SELECT "data" FROM "records"
      WHERE ${this.whereSql(ref, visibility, query, opts)} ${this.orderSql(query, opts)} LIMIT ${MAX_ALL}`;
    return rows.map((r) => r.data);
  }

  async find<T extends Entity>(
    ref: CollectionRef,
    id: string,
    visibility: Visibility = 'all',
  ): Promise<T | undefined> {
    const rows = await this.prisma.$queryRaw<{ data: T }[]>`SELECT "data" FROM "records"
      WHERE "collection" = ${ref.collection} AND "scope" = ${ref.scope} AND "id" = ${id}
      AND ${RecordStoreService.visibilitySql(visibility)} LIMIT 1`;
    return rows[0]?.data;
  }

  async findMany<T extends Entity>(ref: CollectionRef, ids: string[]): Promise<T[]> {
    if (!ids.length) return [];
    const rows = await this.prisma.record.findMany({
      where: { collection: ref.collection, scope: ref.scope, id: { in: ids } },
      select: { data: true },
    });
    const byId = new Map(rows.map((r) => [(r.data as unknown as T).id, r.data as unknown as T]));
    return ids.map((id) => byId.get(id)).filter((x): x is T => !!x);
  }

  async count(ref: CollectionRef, filters: Where = {}): Promise<number> {
    const [{ count }] = await this.prisma.$queryRaw<
      { count: bigint }[]
    >`SELECT count(*)::bigint AS count FROM "records"
      WHERE "collection" = ${ref.collection} AND "scope" = ${ref.scope} AND ${RecordStoreService.condition(filters)}`;
    return Number(count);
  }

  /** Ids visible under `visibility` among `ids` (for bulk operations). */
  async visibleIds(ref: CollectionRef, ids: string[], visibility: Visibility): Promise<string[]> {
    if (!ids.length) return [];
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`SELECT "id" FROM "records"
      WHERE "collection" = ${ref.collection} AND "scope" = ${ref.scope} AND "id" = ANY(${ids}::text[])
      AND ${RecordStoreService.visibilitySql(visibility)}`;
    return rows.map((r) => r.id);
  }

  // ── Writes ─────────────────────────────────────────────────────────────

  static newId(prefix: string): string {
    return `${prefix}-${Date.now().toString(36)}${randomUUID().slice(0, 8)}`;
  }

  private columns(data: Entity, opts: StoreOptions) {
    const owner = opts.ownerField ? readPath(data, opts.ownerField) : undefined;
    const inst = opts.institutionField ? readPath(data, opts.institutionField) : undefined;
    return {
      ownerId: typeof owner === 'string' ? owner : null,
      institutionId: typeof inst === 'string' ? inst : null,
    };
  }

  async insert<T extends Entity>(ref: CollectionRef, data: T, opts: StoreOptions = {}): Promise<T> {
    await this.prisma.record.create({
      data: {
        ...ref,
        id: data.id,
        data: data as unknown as Prisma.InputJsonValue,
        ...this.columns(data, opts),
      },
    });
    return data;
  }

  async insertMany<T extends Entity>(
    ref: CollectionRef,
    items: T[],
    opts: StoreOptions = {},
  ): Promise<T[]> {
    if (!items.length) return [];
    await this.prisma.record.createMany({
      data: items.map((d) => ({
        ...ref,
        id: d.id,
        data: d as unknown as Prisma.InputJsonValue,
        ...this.columns(d, opts),
      })),
      skipDuplicates: true,
    });
    return items;
  }

  /** Writes the full entity (callers merge patches first). */
  async replace<T extends Entity>(
    ref: CollectionRef,
    data: T,
    opts: StoreOptions = {},
  ): Promise<T> {
    await this.prisma.record.update({
      where: { collection_scope_id: { ...ref, id: data.id } },
      data: { data: data as unknown as Prisma.InputJsonValue, ...this.columns(data, opts) },
    });
    return data;
  }

  async upsert<T extends Entity>(ref: CollectionRef, data: T, opts: StoreOptions = {}): Promise<T> {
    const json = data as unknown as Prisma.InputJsonValue;
    await this.prisma.record.upsert({
      where: { collection_scope_id: { ...ref, id: data.id } },
      create: { ...ref, id: data.id, data: json, ...this.columns(data, opts) },
      update: { data: json, ...this.columns(data, opts) },
    });
    return data;
  }

  async remove(ref: CollectionRef, ids: string[]): Promise<number> {
    if (!ids.length) return 0;
    const res = await this.prisma.record.deleteMany({ where: { ...ref, id: { in: ids } } });
    return res.count;
  }

  /** Replaces every record of one collection/scope (student-owned bulk saves). */
  async replaceAll<T extends Entity>(
    ref: CollectionRef,
    items: T[],
    opts: StoreOptions = {},
  ): Promise<T[]> {
    await this.prisma.$transaction([
      this.prisma.record.deleteMany({ where: ref }),
      this.prisma.record.createMany({
        data: items.map((d) => ({
          ...ref,
          id: d.id,
          data: d as unknown as Prisma.InputJsonValue,
          ...this.columns(d, opts),
        })),
      }),
    ]);
    return items;
  }
}
