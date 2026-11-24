import { DEFAULT_ROLE_PERMISSIONS, hasAnyPermission } from '../../src/common/auth/permissions.js';
import type { TopicMastery } from '../../src/contracts/study.js';
import { allowedTransitions } from '../../src/domain/content-workflow.js';
import { parseMissionId, updateMastery, weekStartKey } from '../../src/domain/progress-rules.js';
import { PermissionMatrixService } from '../../src/modules/access/permission-matrix.service.js';
import { shiftDates } from '../../src/database/seeds/frontend-seed.js';

describe('content workflow', () => {
  it('lets authors submit, reviewers review and only publishers publish', () => {
    expect(allowedTransitions('draft', 'teacher')).toEqual(['submitted']);
    expect(allowedTransitions('submitted', 'teacher')).toEqual(['draft']);
    expect(allowedTransitions('submitted', 'content_reviewer')).toEqual(['in_review', 'draft']);
    expect(allowedTransitions('approved', 'content_reviewer')).toEqual(['changes_requested']);
    expect(allowedTransitions('approved', 'content_manager')).toEqual([
      'published',
      'changes_requested',
    ]);
    expect(allowedTransitions('published', 'teacher')).toEqual([]);
  });
});

describe('permission matrix', () => {
  it('uses any-of semantics like the frontend', () => {
    expect(hasAnyPermission(['learn'], ['guardian.view', 'learn'])).toBe(true);
    expect(hasAnyPermission(['learn'], ['guardian.view'])).toBe(false);
  });

  it('drops unknown entries, fills missing roles and keeps super admin unlockable', () => {
    const m = PermissionMatrixService.normalize({
      student: ['learn', 'hack.everything'],
      super_admin: [],
    });
    expect(m.student).toEqual(['learn']);
    expect(m.parent).toEqual(DEFAULT_ROLE_PERMISSIONS.parent);
    expect(m.super_admin).toEqual(
      expect.arrayContaining(['admin.access', 'roles.manage', 'security.manage']),
    );
  });

  it('gives platform admins everything except role/security management', () => {
    expect(DEFAULT_ROLE_PERMISSIONS.platform_admin).not.toContain('roles.manage');
    expect(DEFAULT_ROLE_PERMISSIONS.super_admin).toContain('roles.manage');
    expect(DEFAULT_ROLE_PERMISSIONS.platform_admin).not.toContain('learn');
  });
});

describe('progress rules', () => {
  const m: TopicMastery = {
    id: 't',
    topicId: 't',
    chapterId: 'c',
    subjectId: 's',
    attempts: 0,
    correct: 0,
    mastery: 50,
    trend: [],
    mistakes: {},
  };

  it('moves mastery 30% towards the result', () => {
    const up = updateMastery(m, { correct: true, answeredAt: 'x' });
    expect(up.mastery).toBe(65);
    const down = updateMastery(m, { correct: false, answeredAt: 'x' });
    expect(down.mastery).toBe(35);
    expect(down.mistakes.concept_confusion).toBe(1);
  });

  it('parses weekly mission ids', () => {
    expect(parseMissionId('weekly-exams-2026-11-21')).toEqual({
      kind: 'exams',
      week: '2026-11-21',
    });
    expect(parseMissionId('weekly-xp-2026-11-21')).toBeNull();
  });

  it('starts weeks on Saturday (Bangladesh time)', () => {
    expect(weekStartKey(new Date('2026-11-24T06:00:00Z'))).toBe('2026-11-21'); // Tuesday → Saturday
    expect(weekStartKey(new Date('2026-11-21T06:00:00Z'))).toBe('2026-11-21');
  });
});

describe('seed date shifting', () => {
  it('shifts exact ISO timestamps and day keys only', () => {
    const out = shiftDates(
      { at: '2026-01-01T09:00:00.000Z', day: '2026-01-31', text: 'on 2026-01-01', n: 2026 },
      2,
    );
    expect(out).toEqual({
      at: '2026-01-03T09:00:00.000Z',
      day: '2026-02-02',
      text: 'on 2026-01-01',
      n: 2026,
    });
  });
});
