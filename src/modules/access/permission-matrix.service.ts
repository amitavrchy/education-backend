import { Injectable } from '@nestjs/common';
import {
  DEFAULT_ROLE_PERMISSIONS,
  LOCKED_PERMISSIONS,
  PERMISSIONS,
  type Permission,
  type PermissionMatrix,
} from '../../common/auth/permissions.js';
import { USER_ROLES, type UserRole } from '../../contracts/user.js';
import { DocumentsService } from '../records/documents.service.js';

export const PERMISSION_MATRIX_KEY = 'permissionMatrix';
const CACHE_MS = 10_000;

/**
 * The effective role → permission matrix. Defaults mirror the frontend; admins with
 * `roles.manage` can edit it (Security → Permission matrix) and the change applies to the
 * next request (short in-process cache, invalidated on save).
 */
@Injectable()
export class PermissionMatrixService {
  private cache?: { at: number; matrix: PermissionMatrix };

  constructor(private readonly documents: DocumentsService) {}

  async matrix(): Promise<PermissionMatrix> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.matrix;
    const doc = await this.documents.find<{ id: string; matrix: Partial<PermissionMatrix> }>(
      PERMISSION_MATRIX_KEY,
    );
    const matrix = PermissionMatrixService.normalize(doc?.matrix);
    this.cache = { at: Date.now(), matrix };
    return matrix;
  }

  async permissionsFor(role: UserRole): Promise<Permission[]> {
    return (await this.matrix())[role] ?? [];
  }

  async save(input: Partial<PermissionMatrix>): Promise<PermissionMatrix> {
    const matrix = PermissionMatrixService.normalize(input);
    await this.documents.set(PERMISSION_MATRIX_KEY, { id: 'matrix', matrix });
    this.cache = { at: Date.now(), matrix };
    return matrix;
  }

  /** Drops unknown roles/permissions, fills missing roles with defaults, re-adds locked permissions. */
  static normalize(input?: Partial<Record<string, readonly string[]>>): PermissionMatrix {
    const known = new Set<string>(PERMISSIONS);
    const out = {} as PermissionMatrix;
    for (const role of USER_ROLES) {
      const given = input?.[role];
      const list = (given ?? DEFAULT_ROLE_PERMISSIONS[role]).filter((p): p is Permission =>
        known.has(p),
      );
      out[role] = [...new Set([...list, ...(LOCKED_PERMISSIONS[role] ?? [])])];
    }
    return out;
  }
}
