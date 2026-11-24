import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface.js';
import type { Bilingual } from '../../contracts/common.js';
import { resourceByCollection } from '../records/resource-registry.js';
import { ResourcesService } from '../records/resources.service.js';
import type { Entity } from '../records/record-store.service.js';

export type SearchKind =
  | 'subject'
  | 'chapter'
  | 'topic'
  | 'question'
  | 'book'
  | 'board_paper'
  | 'institution_paper'
  | 'note'
  | 'flashcard'
  | 'conversation'
  | 'audio'
  | 'exam';

export interface SearchHit {
  kind: SearchKind;
  id: string;
  title: Bilingual;
  subtitle?: Bilingual;
  href: string;
  score: number;
  subjectId?: string;
  chapterId?: string;
}

const norm = (s: string) => s.toLocaleLowerCase().normalize('NFC').trim();
const pair = (s: string): Bilingual => ({ bn: s, en: s });
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const bi = (v: unknown): Bilingual =>
  v && typeof v === 'object' && 'bn' in v ? (v as Bilingual) : pair(str(v));

/** exact title > prefix > contains > body match (same ranking as the frontend). */
export function scoreText(title: string, q: string): number {
  const t = norm(title);
  const n = norm(q);
  if (t === n) return 100;
  if (t.startsWith(n)) return 80;
  if (t.includes(n)) return 60;
  return 30;
}

interface Provider {
  kind: SearchKind;
  collection: string;
  scoped?: boolean;
  filters?: Record<string, string[]>;
  map(e: Entity, q: string): SearchHit;
}

const PROVIDERS: Provider[] = [
  {
    kind: 'subject',
    collection: 'subjects',
    map: (s, q) => ({
      kind: 'subject',
      id: s.id,
      title: bi(s.name),
      subtitle: pair(str(s.levelCode)),
      href: `/student/curriculum/${s.id}`,
      score: scoreText(`${bi(s.name).bn} ${bi(s.name).en}`, q) + 10,
      subjectId: s.id,
    }),
  },
  {
    kind: 'chapter',
    collection: 'chapters',
    map: (c, q) => ({
      kind: 'chapter',
      id: c.id,
      title: bi(c.title),
      href: `/student/curriculum/${str(c.subjectId)}/${c.id}`,
      score: scoreText(`${bi(c.title).bn} ${bi(c.title).en}`, q) + 5,
      subjectId: str(c.subjectId),
      chapterId: c.id,
    }),
  },
  {
    kind: 'topic',
    collection: 'topics',
    map: (t, q) => ({
      kind: 'topic',
      id: t.id,
      title: bi(t.title),
      href: `/student/curriculum/${str(t.subjectId)}/${str(t.chapterId)}#${t.id}`,
      score: scoreText(`${bi(t.title).bn} ${bi(t.title).en}`, q),
      subjectId: str(t.subjectId),
      chapterId: str(t.chapterId),
    }),
  },
  {
    kind: 'question',
    collection: 'questions',
    filters: { status: ['published'] },
    map: (x, q) => ({
      kind: 'question',
      id: x.id,
      title: pair(
        str(x.stem)
          .replace(/[$*\\]/g, '')
          .slice(0, 90),
      ),
      href: `/student/questions?q=${x.id}`,
      score: scoreText(str(x.stem), q) - 10,
      subjectId: str(x.subjectId),
      chapterId: str(x.chapterId),
    }),
  },
  {
    kind: 'book',
    collection: 'books',
    map: (b, q) => ({
      kind: 'book',
      id: b.id,
      title: bi(b.title),
      href: `/student/library/${b.id}`,
      score: scoreText(`${bi(b.title).bn}${bi(b.title).en}`, q),
      subjectId: str(b.subjectId),
    }),
  },
  {
    kind: 'board_paper',
    collection: 'boardPapers',
    map: (p, q) => ({
      kind: 'board_paper',
      id: p.id,
      title: pair(str(p.title)),
      href: `/student/board-questions/${p.id}`,
      score: scoreText(str(p.title), q) - 3,
      subjectId: str(p.subjectId),
    }),
  },
  {
    kind: 'audio',
    collection: 'audioLessons',
    map: (a, q) => ({
      kind: 'audio',
      id: a.id,
      title: bi(a.title),
      href: `/student/audio?lesson=${a.id}`,
      score: scoreText(`${bi(a.title).bn}${bi(a.title).en}`, q) - 3,
      subjectId: str(a.subjectId),
    }),
  },
  {
    kind: 'exam',
    collection: 'exams',
    map: (e, q) => ({
      kind: 'exam',
      id: e.id,
      title: pair(str(e.title)),
      href: '/student/exams',
      score: scoreText(str(e.title), q) - 2,
      subjectId: str(e.subjectId),
    }),
  },
  {
    kind: 'note',
    collection: 'notes',
    scoped: true,
    map: (n, q) => ({
      kind: 'note',
      id: n.id,
      title: pair(str(n.title)),
      href: `/student/notes/${n.id}`,
      score: scoreText(str(n.title), q),
      subjectId: str(n.subjectId),
    }),
  },
  {
    kind: 'flashcard',
    collection: 'cards',
    scoped: true,
    map: (c, q) => ({
      kind: 'flashcard',
      id: c.id,
      title: pair(str(c.front).slice(0, 90)),
      href: `/student/flashcards?deck=${str(c.deckId)}&q=${encodeURIComponent(str(c.front).slice(0, 30))}`,
      score: scoreText(str(c.front), q) - 5,
    }),
  },
  {
    kind: 'conversation',
    collection: 'conversations',
    scoped: true,
    map: (c, q) => ({
      kind: 'conversation',
      id: c.id,
      title: pair(str(c.title)),
      subtitle: { bn: 'AI টিউটর কথোপকথন', en: 'AI tutor conversation' },
      href: `/student/ai-tutor?c=${c.id}`,
      score: scoreText(str(c.title), q) - 5,
    }),
  },
];

/** Global search across curriculum, content and the caller's own study material. */
@Injectable()
export class SearchService {
  constructor(private readonly resources: ResourcesService) {}

  async search(
    user: AuthenticatedUser | undefined,
    q: string,
    kinds?: SearchKind[],
    limit = 60,
  ): Promise<SearchHit[]> {
    const query = q.trim().slice(0, 100);
    if (query.length < 2) return [];
    const providers = PROVIDERS.filter(
      (p) => (!kinds?.length || kinds.includes(p.kind)) && (!p.scoped || user),
    );
    const results = await Promise.all(
      providers.map(async (p) => {
        const def = resourceByCollection(p.collection)!;
        try {
          const page = await this.resources.list(def, user, p.scoped ? user!.id : '', {
            search: query,
            filters: p.filters,
            pageSize: 40,
          });
          return page.items.map((e) => p.map(e, query));
        } catch {
          return []; // collection not visible to this caller
        }
      }),
    );
    return results
      .flat()
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
}
