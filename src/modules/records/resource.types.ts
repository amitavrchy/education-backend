import type { Permission } from '../../common/auth/permissions.js';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface.js';
import type { AuditLog } from '../../contracts/operations.js';
import type { StudentArea } from '../access/access-policy.service.js';
import type { Entity, Where } from './record-store.service.js';

/**
 * Access rules for global collections. A rule grants visibility of some rows; a list of rules
 * is OR-ed. Rules are turned into SQL filters, so list endpoints never load rows the caller
 * can't see.
 */
export type Rule =
  /** Anyone, even without a token. */
  | { kind: 'public' }
  /** Any signed-in user. */
  | { kind: 'auth' }
  /** Signed-in user holding any of these permissions (all rows). */
  | { kind: 'perm'; perms: Permission[] }
  /** Rows whose `field` equals the caller's id (or institution id). */
  | { kind: 'field'; field: string; value: 'self' | 'institution' }
  /** Rows whose `field` is a student this caller may see in `area` (self, linked child, own institution…). */
  | { kind: 'student'; field: string; area: StudentArea }
  /** Rows matching a fixed condition, e.g. `{ status: ['published'] }`. */
  | { kind: 'match'; where: Where }
  /** All sub-rules must hold (intersection). */
  | { kind: 'and'; rules: Rule[] };

export const pub: Rule = { kind: 'public' };
export const auth: Rule = { kind: 'auth' };
export const perm = (...perms: Permission[]): Rule => ({ kind: 'perm', perms });
export const self = (field: string): Rule => ({ kind: 'field', field, value: 'self' });
export const inst = (field: string): Rule => ({ kind: 'field', field, value: 'institution' });
export const student = (field: string, area: StudentArea): Rule => ({
  kind: 'student',
  field,
  area,
});
export const match = (where: Where): Rule => ({ kind: 'match', where });
export const and = (...rules: Rule[]): Rule => ({ kind: 'and', rules });

export type AuditCategory = AuditLog['category'];

export interface HookContext {
  user?: AuthenticatedUser;
  scope: string;
  def: ResourceDef;
  deps: HookDeps;
}

/** Side-effect capabilities available to hooks (implemented by ResourcesService). */
export interface HookDeps {
  syncCredentials(account: Entity, previous?: Entity): Promise<void>;
  deleteCredentials(id: string): Promise<void>;
  revokeUserSessions(userId: string): Promise<void>;
  startIngestion(jobId: string): Promise<void>;
  /** Sends an email (best effort: failures are logged, never thrown). */
  sendEmail(message: { to: string; subject: string; text: string; html: string }): Promise<boolean>;
  /** The web app's base URL (links in emails). */
  appUrl: string;
  institutionOfStudent(studentId: string): Promise<string | null>;
  /** In-app notification to specific users (best effort). */
  notify(
    userIds: string[],
    input: {
      type: string;
      title: string;
      body: string;
      href?: string;
      priority?: 'low' | 'normal' | 'high';
    },
  ): Promise<void>;
  /** Guardians with an active link to the student whose sharing flag allows `flag`. */
  guardiansOf(studentId: string, flag: string): Promise<string[]>;
  find(collection: string, id: string, scope?: string): Promise<Entity | undefined>;
}

export interface ResourceHooks {
  /** Validate/normalize a new entity. Throw to reject. */
  beforeCreate?(data: Entity, ctx: HookContext): Entity | Promise<Entity>;
  /** Validate/normalize the merged entity (`next`) against `existing`. Throw to reject. */
  beforeUpdate?(existing: Entity, next: Entity, ctx: HookContext): Entity | Promise<Entity>;
  beforeRemove?(existing: Entity, ctx: HookContext): void | Promise<void>;
  afterCreate?(data: Entity, ctx: HookContext): void | Promise<void>;
  afterUpdate?(next: Entity, existing: Entity, ctx: HookContext): void | Promise<void>;
  afterRemove?(existing: Entity, ctx: HookContext): void | Promise<void>;
}

interface BaseDef {
  /** URL segment, e.g. "exam-attempts". */
  path: string;
  /** Frontend collection name, e.g. "examAttempts" (storage key). */
  collection: string;
  entity?: string;
  idPrefix?: string;
  searchFields?: string[];
  defaultSort?: { sortBy: string; sortOrder: 'asc' | 'desc' };
  /** Stamp createdAt/updatedAt like the mock repositories (default true). */
  timestamps?: boolean;
  ownerField?: string;
  institutionField?: string;
  hooks?: ResourceHooks;
  /** Audit every write by staff under this category. */
  audit?: AuditCategory;
}

/** A collection shared by everyone: `/path`, `/path/:id`. */
export interface GlobalResourceDef extends BaseDef {
  scoped?: false;
  read: Rule[];
  create: Rule[];
  update: Rule[];
  remove: Rule[];
}

/** A per-student collection: `/path/:studentId`, `/path/:studentId/:id`. */
export interface ScopedResourceDef extends BaseDef {
  scoped: true;
  /** What kind of data this is (decides guardian/teacher visibility). */
  area: StudentArea;
  /**
   * owner: the student writes freely (their own study material).
   * server: only dedicated endpoints write (scores, XP, mastery) — generic writes answer 403.
   */
  ownerWrite: 'owner' | 'server';
  /** Staff permissions that may also write (e.g. teachers reviewing handwriting). */
  staffWrite?: Permission[];
}

export type ResourceDef = GlobalResourceDef | ScopedResourceDef;
