import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Public } from '../../common/decorators/index.js';
import { invalid, notFound } from '../../common/exceptions/app.exception.js';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface.js';
import type { ListQuery, Where } from './record-store.service.js';
import { RESERVED_PATHS, resourceByPath } from './resource-registry.js';
import type { ResourceDef } from './resource.types.js';
import { ResourcesService } from './resources.service.js';

type QueryMap = Record<string, unknown>;
type BodyMap = Record<string, unknown>;

const toStr = (v: unknown) =>
  typeof v === 'string' ? v : Array.isArray(v) ? String(v[0]) : undefined;

/** `filter[key]=a,b` (flat or nested query parsers) → `{ key: ['a','b'] }`. */
export function parseListQuery(q: QueryMap): ListQuery & { all: boolean } {
  const filters: Where = {};
  const add = (key: string, raw: unknown) => {
    const value = toStr(raw);
    if (value === undefined || value === '') return;
    filters[key] = value.split(',');
  };
  for (const [key, raw] of Object.entries(q)) {
    const m = /^filter\[(.+)\]$/.exec(key);
    if (m) add(m[1], raw);
  }
  if (q.filter && typeof q.filter === 'object')
    for (const [k, v] of Object.entries(q.filter)) add(k, v);
  const num = (v: unknown) =>
    toStr(v) && Number.isFinite(Number(toStr(v))) ? Number(toStr(v)) : undefined;
  const order = toStr(q.sortOrder);
  return {
    page: num(q.page),
    pageSize: num(q.pageSize),
    search: toStr(q.search)?.slice(0, 200),
    sortBy: toStr(q.sortBy)?.slice(0, 80),
    sortOrder: order === 'asc' || order === 'desc' ? order : undefined,
    filters,
    all: toStr(q.all) === 'true',
  };
}

function idList(body: BodyMap): string[] {
  const ids = body.ids;
  if (!Array.isArray(ids) || ids.some((x) => typeof x !== 'string') || ids.length > 1000)
    invalid('VALIDATION', { ids: ['IDS_REQUIRED'] });
  return ids as string[];
}

function itemList(body: BodyMap | BodyMap[]): BodyMap[] {
  const items = Array.isArray(body) ? body : body.items;
  if (
    !Array.isArray(items) ||
    items.length > 5000 ||
    items.some((x) => !x || typeof x !== 'object' || Array.isArray(x))
  )
    invalid('VALIDATION', { items: ['ITEMS_REQUIRED'] });
  return items as BodyMap[];
}

function asObject(body: unknown): BodyMap {
  if (!body || typeof body !== 'object' || Array.isArray(body))
    invalid('VALIDATION', { body: ['OBJECT_REQUIRED'] });
  return body as BodyMap;
}

/**
 * The REST adapter contract of the frontend (services/core/repository.ts → createApiRepository):
 *
 *   GET    /:resource[/:studentId]?page&pageSize&search&sortBy&sortOrder&filter[k]=a,b   list
 *   GET    /:resource[/:studentId]?all=true                                              all
 *   GET    /:resource[/:studentId]/:id                                                   get
 *   POST   /:resource[/:studentId]                                                       create
 *   PATCH  /:resource[/:studentId]/:id                                                   update
 *   DELETE /:resource[/:studentId]/:id                                                   remove
 *   PATCH  /:resource[/:studentId]/bulk          { ids, patch }                          bulkUpdate
 *   POST   /:resource[/:studentId]/bulk-delete   { ids }                                 bulkRemove
 *   POST   /:resource[/:studentId]/batch         { items }                               create many
 *   PUT    /:resource/:studentId                 { items }                               replaceAll (owner study data)
 *
 * Routes are public at the guard level so curriculum/plans/notices work before sign-in;
 * each collection's rules decide what an anonymous or signed-in caller may see or change.
 * Registered last, so dedicated domain controllers win on overlapping paths.
 */
@ApiTags('resources')
@Public()
@Controller()
export class RecordsController {
  constructor(private readonly resources: ResourcesService) {}

  private def(path: string): ResourceDef {
    const def = RESERVED_PATHS.has(path) ? undefined : resourceByPath(path);
    return def ?? notFound('Resource');
  }

  private async listOrAll(
    def: ResourceDef,
    user: AuthenticatedUser | undefined,
    scope: string,
    q: QueryMap,
  ) {
    const { all, ...query } = parseListQuery(q);
    if (all) return this.resources.all(def, user, scope, query);
    const page = await this.resources.list(def, user, scope, query);
    return {
      items: page.items,
      meta: {
        page: page.page,
        pageSize: page.pageSize,
        total: page.total,
        totalPages: page.totalPages,
      },
    };
  }

  @Get(':resource')
  @ApiOperation({ summary: 'List a global collection (or ?all=true)' })
  listGlobal(
    @Param('resource') resource: string,
    @Query() q: QueryMap,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    const def = this.def(resource);
    if (def.scoped) notFound('Resource');
    return this.listOrAll(def, user, '', q);
  }

  @Get(':resource/:a')
  @ApiOperation({ summary: "Get a global entity, or list a student's collection" })
  getOrListScoped(
    @Param('resource') resource: string,
    @Param('a') a: string,
    @Query() q: QueryMap,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    const def = this.def(resource);
    return def.scoped ? this.listOrAll(def, user, a, q) : this.resources.get(def, user, '', a);
  }

  @Get(':resource/:scope/:id')
  @ApiOperation({ summary: "Get one entity of a student's collection" })
  getScoped(
    @Param('resource') resource: string,
    @Param('scope') scope: string,
    @Param('id') id: string,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    const def = this.def(resource);
    if (!def.scoped) notFound('Resource');
    return this.resources.get(def, user, scope, id);
  }

  @Post(':resource')
  @ApiOperation({ summary: 'Create in a global collection' })
  createGlobal(
    @Param('resource') resource: string,
    @Body() body: unknown,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    const def = this.def(resource);
    if (def.scoped) notFound('Resource');
    return this.resources.create(def, user, '', asObject(body));
  }

  @Post(':resource/:a')
  @ApiOperation({ summary: 'Global bulk-delete/batch, or create in a student collection' })
  async postA(
    @Param('resource') resource: string,
    @Param('a') a: string,
    @Body() body: unknown,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    const def = this.def(resource);
    if (!def.scoped) {
      if (a === 'bulk-delete')
        return this.resources.bulkRemove(def, user, '', idList(asObject(body)));
      if (a === 'batch') return this.resources.createMany(def, user, '', itemList(body as BodyMap));
      notFound('Resource');
    }
    return this.resources.create(def, user, a, asObject(body));
  }

  @Post(':resource/:scope/:action')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Student collection bulk-delete or batch create' })
  scopedAction(
    @Param('resource') resource: string,
    @Param('scope') scope: string,
    @Param('action') action: string,
    @Body() body: unknown,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    const def = this.def(resource);
    if (!def.scoped) notFound('Resource');
    if (action === 'bulk-delete')
      return this.resources.bulkRemove(def, user, scope, idList(asObject(body)));
    if (action === 'batch')
      return this.resources.createMany(def, user, scope, itemList(body as BodyMap));
    return notFound('Resource');
  }

  @Put(':resource/:scope')
  @ApiOperation({
    summary: "Replace a student's whole collection (owner-writable study data only)",
  })
  replaceAll(
    @Param('resource') resource: string,
    @Param('scope') scope: string,
    @Body() body: unknown,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    const def = this.def(resource);
    return this.resources.replaceAll(def, user, scope, itemList(body as BodyMap));
  }

  @Patch(':resource/:a')
  @ApiOperation({ summary: 'Update a global entity, or global bulk update' })
  patchA(
    @Param('resource') resource: string,
    @Param('a') a: string,
    @Body() body: unknown,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    const def = this.def(resource);
    if (def.scoped) notFound('Resource');
    const obj = asObject(body);
    if (a === 'bulk')
      return this.resources.bulkUpdate(def, user, '', idList(obj), asObject(obj.patch));
    return this.resources.update(def, user, '', a, obj);
  }

  @Patch(':resource/:scope/:id')
  @ApiOperation({ summary: 'Update in a student collection, or bulk update' })
  patchScoped(
    @Param('resource') resource: string,
    @Param('scope') scope: string,
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    const def = this.def(resource);
    if (!def.scoped) notFound('Resource');
    const obj = asObject(body);
    if (id === 'bulk')
      return this.resources.bulkUpdate(def, user, scope, idList(obj), asObject(obj.patch));
    return this.resources.update(def, user, scope, id, obj);
  }

  @Delete(':resource/:a')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a global entity' })
  async removeGlobal(
    @Param('resource') resource: string,
    @Param('a') a: string,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    const def = this.def(resource);
    if (def.scoped) notFound('Resource');
    await this.resources.remove(def, user, '', a);
  }

  @Delete(':resource/:scope/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete from a student collection' })
  async removeScoped(
    @Param('resource') resource: string,
    @Param('scope') scope: string,
    @Param('id') id: string,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    const def = this.def(resource);
    if (!def.scoped) notFound('Resource');
    await this.resources.remove(def, user, scope, id);
  }
}
