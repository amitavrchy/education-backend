// Book avatar data: default avatars per book, the synthetic textbook pages, and page search
// (retrieval). The answer itself is written by the AI service (`education-ai`).
import type { Topic } from '../../contracts/curriculum.js';
import type { Bilingual } from '../../contracts/common.js';
import type { Book } from '../../contracts/learning.js';

/** FNV-1a string hash (same as the apps' hashString). */
function hashString(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export interface AvatarAppearance {
  gender: 'female' | 'male';
  skinTone: string;
  hairStyle: 'short' | 'side_part' | 'long' | 'bun' | 'hijab' | 'bald';
  hairColor: string;
  outfit: 'saree' | 'salwar' | 'shirt' | 'panjabi' | 'blazer';
  outfitColor: string;
  accentColor: string;
  glasses: boolean;
  beard: boolean;
  background: string;
}

export interface AvatarStats {
  sessions: number;
  questions: number;
  outOfScope: number;
  helpful: number;
  notHelpful: number;
}

/** One teacher avatar per book; it answers only from that book. */
export interface BookAvatar {
  id: string;
  bookId: string;
  name: Bilingual;
  title: Bilingual;
  appearance: AvatarAppearance;
  voice: { language: 'bn' | 'en'; rate: number; pitch: number; voiceURI?: string };
  greeting: Bilingual;
  persona: {
    style: 'friendly' | 'formal' | 'socratic';
    answerLength: 'short' | 'balanced' | 'detailed';
    useExamples: boolean;
  };
  scopeChapterIds: string[];
  strictBookScope: boolean;
  status: 'draft' | 'active' | 'disabled';
  stats: AvatarStats;
  createdAt: string;
  updatedAt: string;
}

export interface AvatarCitation {
  page: number;
  chapterTitle: string;
  heading?: string;
  excerpt: string;
}

type Lang = 'bn' | 'en';
type AvatarBook = Pick<Book, 'id' | 'title' | 'language' | 'subjectId' | 'chapters'>;

// ── Defaults for a book without an avatar ─────────────────────────────

const SKIN = ['#F2C9A0', '#E0AC7E', '#C68B5E', '#A86F4A', '#8D5A3B'];
const HAIR = ['#1F1A17', '#2E2420', '#4A3426', '#6B4A35', '#8A8A8A'];
const OUTFIT = ['#0F766E', '#1D4ED8', '#7C3AED', '#B45309', '#BE123C', '#334155', '#15803D'];
const BG = ['#E6F4F1', '#E8EEFB', '#F1ECFB', '#FBF1E4', '#FCE9EE', '#EEF2F6'];
const FEMALE_NAMES: [string, string][] = [
  ['নাসরিন আপা', 'Nasrin Apa'],
  ['ফারহানা ম্যাডাম', 'Farhana Madam'],
  ['তাহমিনা আপা', 'Tahmina Apa'],
  ['রুমানা ম্যাডাম', 'Rumana Madam'],
  ['সাবরিনা আপা', 'Sabrina Apa'],
];
const MALE_NAMES: [string, string][] = [
  ['রফিক স্যার', 'Rafiq Sir'],
  ['মাহফুজ স্যার', 'Mahfuz Sir'],
  ['কামাল স্যার', 'Kamal Sir'],
  ['আরিফ স্যার', 'Arif Sir'],
  ['শফিক স্যার', 'Shafiq Sir'],
];

/** hashString with a murmur3 fmix32 finaliser (same as the frontend). */
function mixHash(seed: string): number {
  let h = hashString(seed) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

export function defaultAppearance(seed: string): AvatarAppearance {
  const h = mixHash(seed);
  const gender = h % 2 ? 'female' : 'male';
  const pick = <T>(arr: readonly T[], salt: number) => arr[(h >>> salt) % arr.length];
  return {
    gender,
    skinTone: pick(SKIN, 1),
    hairStyle:
      gender === 'female'
        ? pick(['long', 'bun', 'hijab', 'long'] as const, 3)
        : pick(['short', 'side_part', 'short', 'bald'] as const, 3),
    hairColor: pick(HAIR, 5),
    outfit:
      gender === 'female'
        ? pick(['saree', 'salwar', 'blazer'] as const, 7)
        : pick(['shirt', 'panjabi', 'blazer'] as const, 7),
    outfitColor: pick(OUTFIT, 9),
    accentColor: pick(OUTFIT, 11),
    glasses: (h >>> 13) % 3 === 0,
    beard: gender === 'male' && (h >>> 15) % 3 === 0,
    background: pick(BG, 17),
  };
}

export function defaultAvatarFor(
  book: Pick<Book, 'id' | 'title' | 'language' | 'subjectId'>,
  now: string,
  status: BookAvatar['status'] = 'active',
): BookAvatar {
  const appearance = defaultAppearance(book.subjectId + book.id);
  const names = appearance.gender === 'female' ? FEMALE_NAMES : MALE_NAMES;
  const [bn, en] = names[mixHash(`name:${book.id}`) % names.length];
  const subjectBn = book.title.bn.replace(/\s*\(.*\)$/, '');
  const subjectEn = book.title.en.replace(/\s*\(.*\)$/, '');
  const language = book.language === 'en' ? 'en' : 'bn';
  return {
    id: `av-${book.id}`,
    bookId: book.id,
    name: { bn, en },
    title: { bn: `${subjectBn} শিক্ষক`, en: `${subjectEn} teacher` },
    appearance,
    voice: { language, rate: 1, pitch: appearance.gender === 'female' ? 1.1 : 0.9 },
    greeting: {
      bn: `আসসালামু আলাইকুম! আমি ${bn}। "${book.title.bn}" বইয়ের যেকোনো অধ্যায় থেকে প্রশ্ন করো — লিখে বা কথা বলে। আমি বইয়ের পৃষ্ঠা দেখিয়ে বুঝিয়ে দেব।`,
      en: `Hello! I'm ${en}. Ask me anything from "${book.title.en}" — by typing or speaking. I'll explain using the pages of the book.`,
    },
    persona: { style: 'friendly', answerLength: 'balanced', useExamples: true },
    scopeChapterIds: [],
    strictBookScope: true,
    status,
    stats: { sessions: 0, questions: 0, outOfScope: 0, helpful: 0, notHelpful: 0 },
    createdAt: now,
    updatedAt: now,
  };
}

// ── Synthetic book pages (same generator as the frontend reader) ──────

const FORMULA: Record<string, string> = {
  'ssc-physics': '$$v = u + at \\qquad s = ut + \\tfrac{1}{2}at^2$$',
  'ssc-chemistry': '$$n = \\frac{m}{M}$$',
  'ssc-math': '$$(a+b)^2 = a^2 + 2ab + b^2$$',
  'ssc-higher-math': '$$\\sin^2\\theta + \\cos^2\\theta = 1$$',
  'hsc-physics': '$$F = G\\frac{m_1 m_2}{r^2}$$',
  'hsc-finance': '$$FV = PV(1+r)^n$$',
};

export function bookPage(book: AvatarBook, topics: Topic[], pageNumber: number) {
  const ref =
    book.chapters.find((c) => pageNumber >= c.startPage && pageNumber <= c.endPage) ??
    book.chapters[0];
  const chapterTopics = topics.filter((t) => t.chapterId === ref.chapterId);
  const offset = pageNumber - ref.startPage;
  const topic = chapterTopics[offset % Math.max(1, chapterTopics.length)];
  const en = book.language === 'en';
  const t = topic ? (en ? topic.title.en : topic.title.bn) : en ? ref.title.en : ref.title.bn;
  const chapterTitle = en ? ref.title.en : ref.title.bn;
  const formula = FORMULA[book.subjectId] ?? '';
  const body = en
    ? [
        offset === 0 ? `# Chapter: ${chapterTitle}` : `## ${t}`,
        `This page introduces **${t}**. Read the definition carefully, then study the worked example. *(Synthetic demo text — not from an official textbook.)*`,
        `**Key idea.** ${t} connects to the earlier topics of this chapter. Students should be able to explain it in their own words and apply it to simple problems.`,
        offset % 2 === 0 && formula ? `**Important relation**\n\n${formula}` : '',
        `**Worked example.** A short example illustrates ${t.toLowerCase()} step by step: identify the given data, choose the right relation, substitute, and check the unit.`,
        `> Exam tip: questions on ${t.toLowerCase()} often appear as short definitions and application-based problems.`,
      ]
    : [
        offset === 0 ? `# অধ্যায়: ${chapterTitle}` : `## ${t}`,
        `এই পৃষ্ঠায় **${t}** নিয়ে আলোচনা করা হয়েছে। প্রথমে সংজ্ঞাটি মনোযোগ দিয়ে পড়ো, তারপর উদাহরণটি অনুসরণ করো। *(কৃত্রিম ডেমো লেখা — অফিসিয়াল পাঠ্যবই থেকে নেওয়া নয়।)*`,
        `**মূল ধারণা।** ${t} এই অধ্যায়ের আগের টপিকগুলোর সাথে সম্পর্কিত। শিক্ষার্থীরা নিজের ভাষায় এটি ব্যাখ্যা করতে এবং সহজ সমস্যায় প্রয়োগ করতে পারবে।`,
        offset % 2 === 0 && formula ? `**গুরুত্বপূর্ণ সম্পর্ক**\n\n${formula}` : '',
        `**উদাহরণ।** ধাপে ধাপে: প্রদত্ত তথ্য চিহ্নিত করো, সঠিক সূত্র বেছে নাও, মান বসাও এবং এককটি যাচাই করো।`,
        `> পরীক্ষার টিপ: ${t} থেকে প্রায়ই সংজ্ঞা ও প্রয়োগমূলক প্রশ্ন আসে।`,
      ];
  return { pageNumber, heading: t, body: body.filter(Boolean).join('\n\n') };
}

// ── Answer engine ─────────────────────────────────────────────────────

const norm = (s: string) => s.toLocaleLowerCase().normalize('NFC');
const STOP = new Set([
  'কী',
  'কি',
  'কাকে',
  'বলে',
  'কেন',
  'কীভাবে',
  'কিভাবে',
  'এর',
  'এবং',
  'ও',
  'একটি',
  'আমাকে',
  'বলো',
  'বুঝিয়ে',
  'দাও',
  'করো',
  'what',
  'is',
  'the',
  'a',
  'an',
  'of',
  'and',
  'how',
  'why',
  'explain',
  'me',
  'please',
  'define',
  'tell',
  'about',
  'in',
  'to',
]);

export function tokens(s: string): string[] {
  return norm(s)
    .replace(/[?!।,.;:()"'“”‘’\-–—/\\]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP.has(t));
}

interface Candidate {
  page: number;
  score: number;
  heading?: string;
  chapterTitle: string;
  chapterId?: string;
  excerpt: string;
}

export interface EngineInput {
  book: AvatarBook;
  avatar: BookAvatar;
  topics: Topic[];
  query: string;
}

export function scopeChapters({ book, avatar }: EngineInput) {
  return avatar.scopeChapterIds.length
    ? book.chapters.filter((c) => c.chapterId && avatar.scopeChapterIds.includes(c.chapterId))
    : book.chapters;
}

export function searchPages(input: EngineInput, q: string[], lang: Lang): Candidate[] {
  const out: Candidate[] = [];
  for (const ref of scopeChapters(input)) {
    const chapterTitle = lang === 'en' ? ref.title.en : ref.title.bn;
    for (let p = ref.startPage; p <= ref.endPage; p++) {
      const page = bookPage(input.book, input.topics, p);
      const heading = norm(page.heading ?? '');
      const body = norm(page.body);
      const ch = norm(`${ref.title.bn} ${ref.title.en}`);
      const topic = input.topics.find(
        (t) =>
          t.chapterId === ref.chapterId &&
          (t.title.bn === page.heading || t.title.en === page.heading),
      );
      const topicText = topic ? norm(`${topic.title.bn} ${topic.title.en}`) : '';
      let score = 0;
      for (const t of q) {
        if (heading.includes(t)) score += 4;
        if (topicText.includes(t)) score += 3;
        if (ch.includes(t)) score += 2;
        if (body.includes(t)) score += 1;
      }
      if (score > 0) {
        const para =
          page.body.split('\n\n').find((x) => x.startsWith('**')) ??
          page.body.split('\n\n')[1] ??
          '';
        out.push({
          page: p,
          score,
          heading: page.heading,
          chapterTitle,
          chapterId: ref.chapterId,
          excerpt: para.replace(/\*\(.*?\)\*/g, '').slice(0, 220),
        });
      }
    }
  }
  return out.sort((a, b) => b.score - a.score || a.page - b.page);
}
