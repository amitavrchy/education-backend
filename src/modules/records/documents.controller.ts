import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { hasAnyPermission, type Permission } from '../../common/auth/permissions.js';
import { CurrentUser, Public } from '../../common/decorators/index.js';
import { forbidden, invalid, notFound } from '../../common/exceptions/app.exception.js';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface.js';
import { AccessPolicyService, type StudentArea } from '../access/access-policy.service.js';
import {
  PermissionMatrixService,
  PERMISSION_MATRIX_KEY,
} from '../access/permission-matrix.service.js';
import { AuditLogsService } from '../audit-logs/audit-logs.service.js';
import { DocumentsService } from './documents.service.js';

type Who = AuthenticatedUser | undefined;
type Check = (user: Who, id: string) => boolean | Promise<boolean>;

interface DocRule {
  read: Check;
  write: Check;
}

const perms =
  (...p: Permission[]): Check =>
  (u) =>
    !!u && hasAnyPermission(u.permissions, p);
const owner: Check = (u, id) => !!u && u.id === id;
const nobody: Check = () => false;

/**
 * Singleton documents the frontend keeps with getDocument()/saveDocument().
 * Server-managed documents (gamification, usage meters) are read-only here: they change only
 * through /progress and /usage, so XP and quotas can't be edited by clients.
 */
@ApiTags('documents')
@Public()
@Controller('documents')
export class DocumentsController {
  private readonly global: Record<string, DocRule> = {
    systemConfig: { read: () => true, write: perms('system.config') },
    [PERMISSION_MATRIX_KEY]: { read: (u) => !!u, write: perms('roles.manage') },
    aiSettings: { read: perms('kb.view', 'kb.manage'), write: perms('kb.manage') },
  };

  private readonly prefixed: Record<string, DocRule> = {
    gamification: { read: this.student('studyTime'), write: nobody },
    usage: {
      read: (u, id) => owner(u, id) || perms('users.view', 'billing.view')(u, id),
      write: nobody,
    },
    planSettings: { read: this.student('calendar'), write: owner },
    english: { read: this.student('progress'), write: owner },
    guardianGoals: { read: owner, write: owner },
  };

  constructor(
    private readonly documents: DocumentsService,
    private readonly matrix: PermissionMatrixService,
    private readonly access: AccessPolicyService,
    private readonly audit: AuditLogsService,
  ) {}

  private student(area: StudentArea): Check {
    return (u, id) => this.access.canReadStudent(u, id, area);
  }

  private rule(key: string): { rule: DocRule; id: string } {
    if (this.global[key]) return { rule: this.global[key], id: '' };
    const [prefix, id] = key.split(':');
    const rule = this.prefixed[prefix];
    if (!rule || !id) notFound('Document');
    return { rule, id };
  }

  @Get(':key')
  @ApiOperation({ summary: 'Read a singleton document (null when never saved)' })
  async get(@Param('key') key: string, @CurrentUser() user?: AuthenticatedUser) {
    const { rule, id } = this.rule(key);
    if (!(await rule.read(user, id))) notFound('Document');
    if (key === PERMISSION_MATRIX_KEY) return { id: 'matrix', matrix: await this.matrix.matrix() };
    return (await this.documents.find(key)) ?? null;
  }

  @Put(':key')
  @ApiOperation({ summary: 'Replace a singleton document' })
  async put(
    @Param('key') key: string,
    @Body() body: unknown,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    const { rule, id } = this.rule(key);
    if (!body || typeof body !== 'object' || Array.isArray(body)) invalid('VALIDATION');
    if (!(await rule.write(user, id))) {
      if (await rule.read(user, id)) forbidden();
      notFound('Document');
    }
    const doc = body as Record<string, unknown>;
    if (key === PERMISSION_MATRIX_KEY) {
      const saved = await this.matrix.save(doc.matrix ?? doc);
      await this.audit.record({
        actor: user!,
        category: 'security',
        action: 'permissionMatrix.update',
        target: { type: 'PermissionMatrix', id: 'matrix', label: 'Permission matrix' },
      });
      return { id: 'matrix', matrix: saved };
    }
    await this.documents.set(key, doc, id || null);
    if (!id)
      await this.audit.record({
        actor: user!,
        category: 'system',
        action: `${key}.update`,
        target: { type: 'Document', id: key, label: key },
      });
    return doc;
  }
}
