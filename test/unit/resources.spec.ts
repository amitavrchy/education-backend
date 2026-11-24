import { parseListQuery } from '../../src/modules/records/records.controller.js';
import {
  guardianLinksHooks,
  notificationsHooks,
  onlyFields,
  usersHooks,
} from '../../src/modules/records/resource-hooks.js';
import { kebab, RESOURCES, resourceByPath } from '../../src/modules/records/resource-registry.js';
import { matchesVisibility } from '../../src/modules/records/resources.service.js';
import type { HookContext } from '../../src/modules/records/resource.types.js';

const ctx = (role: string, permissions: string[], id = 'u-1'): HookContext =>
  ({
    user: { id, role, permissions, institutionId: null },
    scope: '',
    def: RESOURCES[0],
    deps: {},
  }) as unknown as HookContext;

describe('resource registry', () => {
  it('uses the same paths as the frontend defaultApiPath()', () => {
    expect(kebab('examAttempts')).toBe('exam-attempts');
    expect(resourceByPath('chapter-progress')?.collection).toBe('chapterProgress');
    expect(resourceByPath('class-levels')?.collection).toBe('classLevels');
  });

  it('has unique paths and keeps scores/XP server-managed', () => {
    const paths = RESOURCES.map((r) => r.path);
    expect(new Set(paths).size).toBe(paths.length);
    for (const c of ['attempts', 'mastery', 'chapterProgress', 'activity', 'examAttempts']) {
      const def = RESOURCES.find((r) => r.collection === c);
      expect(def?.scoped && def.ownerWrite).toBe('server');
    }
  });
});

describe('list query parsing', () => {
  it('reads filter[k]=a,b in both query-parser styles', () => {
    expect(
      parseListQuery({ 'filter[portal]': 'student', page: '2', sortOrder: 'desc', all: 'true' }),
    ).toMatchObject({ filters: { portal: ['student'] }, page: 2, sortOrder: 'desc', all: true });
    expect(parseListQuery({ filter: { type: 'mcq,true_false' } }).filters).toEqual({
      type: ['mcq', 'true_false'],
    });
    expect(parseListQuery({ sortOrder: 'sideways' }).sortOrder).toBeUndefined();
  });
});

describe('visibility matching', () => {
  it('matches equality, one-of and array fields', () => {
    expect(matchesVisibility({ a: 'x' }, 'all')).toBe(true);
    expect(matchesVisibility({ a: 'x' }, 'none')).toBe(false);
    expect(matchesVisibility({ a: 'x', b: 2 }, [{ a: ['y'] }, { b: [2] }])).toBe(true);
    expect(matchesVisibility({ tags: ['p', 'q'] }, [{ tags: ['q'] }])).toBe(true);
    expect(matchesVisibility({ createdBy: { id: 'u-1' } }, [{ 'createdBy.id': ['u-1'] }])).toBe(
      true,
    );
    expect(matchesVisibility({}, [{ a: ['x'] }])).toBe(false);
  });
});

describe('hooks', () => {
  it('rejects edits outside an allow-list', () => {
    expect(() => onlyFields({ id: '1', a: 1, b: 1 }, { id: '1', a: 2, b: 1 }, ['a'])).not.toThrow();
    expect(() => onlyFields({ id: '1', a: 1, b: 1 }, { id: '1', a: 1, b: 2 }, ['a'])).toThrow();
  });

  it('stops users escalating their own role', () => {
    const me = { id: 'u-1', name: 'A', role: 'student', email: 'a@x.com' };
    expect(() =>
      usersHooks.beforeUpdate!(me, { ...me, role: 'super_admin' }, ctx('student', ['learn'])),
    ).toThrow();
    expect(() =>
      usersHooks.beforeUpdate!(me, { ...me, name: 'B' }, ctx('student', ['learn'])),
    ).not.toThrow();
    expect(() =>
      usersHooks.beforeUpdate!(
        me,
        { ...me, role: 'super_admin' },
        ctx('platform_admin', ['users.manage'], 'u-9'),
      ),
    ).toThrow();
  });

  it('keeps a guardian from switching on AI-conversation sharing', () => {
    const link = {
      id: 'gl',
      guardianId: 'g',
      studentId: 's',
      status: 'active',
      permissions: { aiConversations: false },
    };
    expect(() =>
      guardianLinksHooks.beforeUpdate!(
        link,
        { ...link, permissions: { aiConversations: true } },
        ctx('parent', ['guardian.view'], 'g'),
      ),
    ).toThrow();
    expect(() =>
      guardianLinksHooks.beforeUpdate!(
        link,
        { ...link, permissions: { aiConversations: true } },
        ctx('student', ['learn'], 's'),
      ),
    ).not.toThrow();
    expect(() =>
      guardianLinksHooks.beforeUpdate!(
        link,
        { ...link, status: 'active2' },
        ctx('parent', ['guardian.view'], 'g'),
      ),
    ).toThrow();
  });

  it('pins self-created notifications to the caller', () => {
    const out = notificationsHooks.beforeCreate!(
      { id: 'n', userId: 'someone-else', title: 't' },
      ctx('student', ['learn'], 'me'),
    ) as unknown as { userId: string };
    expect(out.userId).toBe('me');
  });
});
