// Ported from frontend/src/services/ai/book-avatar-engine.ts and the avatar defaults in
// frontend/src/services/avatar.service.ts (deterministic local engine; no model, no network).
import type { Topic } from '../../contracts/curriculum.js';
import type { Bilingual } from '../../contracts/common.js';
import type { Book } from '../../contracts/learning.js';
import { hashString } from '../tutor/hash.js';
import { scenarios, type Scenario } from '../tutor/tutor-scenarios.js';

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

export interface AvatarAnswer {
  text: string;
  spoken: string;
  citations: AvatarCitation[];
  grounded: 'book' | 'greeting' | 'out_of_scope';
  followUps: string[];
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

export const isBangla = (s: string) => /[ঀ-৿]/.test(s);

function texToWords(tex: string) {
  return tex
    .replace(/\\(?:text|mathrm)\{([^}]*)\}/g, '$1')
    .replace(/\\t?frac\{([^}]*)\}\{([^}]*)\}/g, '$1 / $2')
    .replace(/\^\{?2\}?/g, ' squared')
    .replace(/\\(?:qquad|quad|,|;)/g, ' ')
    .replace(/\\([a-zA-Z]+)/g, '$1')
    .replace(/[{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Readable speech text: strip Markdown/LaTeX. */
export function toSpoken(md: string, lang: Lang): string {
  return md
    .replace(
      /\$\$([^$]+)\$\$/g,
      (_, tex: string) => ` ${lang === 'bn' ? 'সূত্র' : 'formula'}: ${texToWords(tex)}. `,
    )
    .replace(/\$([^$]+)\$/g, (_, tex: string) => texToWords(tex))
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_#>`]/g, '')
    .replace(/\[(\d+)\]/g, '')
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const GREETING =
  /^(হ্যালো|হাই|নমস্কার|আসসালামু|সালাম|শুভ|hello|hi|hey|good (morning|afternoon|evening))/i;
const WHO = /(তুমি কে|আপনি কে|তোমার নাম|আপনার নাম|who are you|your name|introduce)/i;
const CHAPTERS_Q =
  /(অধ্যায়গুলো|কী কী অধ্যায়|সূচি|সূচিপত্র|chapters|table of contents|what.*(in|does).*book)/i;

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

function scopeChapters({ book, avatar }: EngineInput) {
  return avatar.scopeChapterIds.length
    ? book.chapters.filter((c) => c.chapterId && avatar.scopeChapterIds.includes(c.chapterId))
    : book.chapters;
}

function searchPages(input: EngineInput, q: string[], lang: Lang): Candidate[] {
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

function matchScenario(input: EngineInput): Scenario | undefined {
  const ids = new Set(scopeChapters(input).map((c) => c.chapterId));
  const q = norm(input.query);
  const scored = scenarios
    .filter((s) => ids.has(s.chapterId))
    .map((s) => ({ s, score: s.keywords.filter((k) => k && q.includes(norm(k))).length }))
    .sort((a, b) => b.score - a.score);
  return scored[0]?.score ? scored[0].s : undefined;
}

function followUpsFor(
  input: EngineInput,
  chapterId: string | undefined,
  lang: Lang,
  exclude?: string,
) {
  const chs = scopeChapters(input);
  const chapterIds = chapterId
    ? [chapterId, ...chs.map((c) => c.chapterId).filter((x) => x !== chapterId)]
    : chs.map((c) => c.chapterId);
  const list: string[] = [];
  for (const cid of chapterIds) {
    for (const t of input.topics.filter((x) => x.chapterId === cid)) {
      const name = lang === 'en' ? t.title.en : t.title.bn;
      if (name === exclude) continue;
      list.push(lang === 'en' ? `What is ${name}?` : `${name} কী?`);
      if (list.length >= 3) return list;
    }
  }
  return list;
}

export function answerFromBook(input: EngineInput): AvatarAnswer {
  const { book, avatar, query } = input;
  const lang: Lang = isBangla(query) ? 'bn' : /[a-z]/i.test(query) ? 'en' : avatar.voice.language;
  const L = (bn: string, en: string) => (lang === 'en' ? en : bn);
  const bookTitle = lang === 'en' ? book.title.en : book.title.bn;
  const name = lang === 'en' ? avatar.name.en : avatar.name.bn;
  const trimmed = query.trim();
  const greet = (text: string): AvatarAnswer => ({
    text,
    spoken: toSpoken(text, lang),
    citations: [],
    grounded: 'greeting',
    followUps: followUpsFor(input, undefined, lang),
  });

  if (GREETING.test(trimmed) && trimmed.length < 40)
    return greet(lang === 'en' ? avatar.greeting.en : avatar.greeting.bn);
  if (WHO.test(trimmed))
    return greet(
      L(
        `আমি ${name}, "${bookTitle}" বইয়ের শিক্ষক। এই বইয়ের যেকোনো অধ্যায় থেকে প্রশ্ন করো — আমি বইয়ের পৃষ্ঠা দেখিয়ে উত্তর দেব।`,
        `I'm ${name}, the teacher for "${bookTitle}". Ask me anything from this book — I'll answer with the page it comes from.`,
      ),
    );
  if (CHAPTERS_Q.test(trimmed)) {
    const chs = scopeChapters(input);
    const text =
      L(`এই বইয়ে ${chs.length}টি অধ্যায় আছে:\n\n`, `This book has ${chs.length} chapters:\n\n`) +
      chs
        .map(
          (c, i) =>
            `${i + 1}. ${lang === 'en' ? c.title.en : c.title.bn} — ${L('পৃষ্ঠা', 'p.')} ${c.startPage}`,
        )
        .join('\n');
    return {
      text,
      spoken: toSpoken(text.split('\n').slice(0, 6).join('. '), lang),
      citations: [],
      grounded: 'book',
      followUps: followUpsFor(input, undefined, lang),
    };
  }

  const scenario = matchScenario(input);
  const pages = searchPages(input, tokens(trimmed), lang);
  const best = pages[0];
  const persona = avatar.persona;

  if (scenario) {
    const ref = book.chapters.find((c) => c.chapterId === scenario.chapterId)!;
    const sTitle = lang === 'en' ? scenario.title.en : scenario.title.bn;
    const page = pages.find((p) => p.chapterId === scenario.chapterId)?.page ?? ref.startPage;
    const parts: string[] = [];
    if (persona.style === 'socratic')
      parts.push(
        L(
          'চলো একসাথে ভাবি। প্রথমে বইয়ের সংজ্ঞাটা দেখো:',
          "Let's think it through. First, the book's definition:",
        ),
      );
    parts.push(`**${sTitle}:** ${lang === 'en' ? scenario.definition.en : scenario.definition.bn}`);
    if (persona.answerLength !== 'short')
      parts.push(lang === 'en' ? scenario.explanation.en : scenario.explanation.bn);
    if (scenario.formula) parts.push(`$$${scenario.formula.tex}$$`);
    if (persona.useExamples && persona.answerLength !== 'short')
      parts.push(
        `${L('উদাহরণ', 'Example')}: ${lang === 'en' ? scenario.example.en : scenario.example.bn}`,
      );
    if (persona.answerLength === 'detailed')
      parts.push(
        `${L('মনে রাখো', 'Remember')}: ${(lang === 'en' ? scenario.keyPoints.en : scenario.keyPoints.bn).join(' · ')}`,
      );
    if (persona.style === 'socratic')
      parts.push(lang === 'en' ? scenario.socratic.en[0] : scenario.socratic.bn[0]);
    parts.push(
      L(
        `📖 সূত্র: "${bookTitle}", ${ref.title.bn}, পৃষ্ঠা ${page}`,
        `📖 Source: "${bookTitle}", ${ref.title.en}, page ${page}`,
      ),
    );
    return {
      text: parts.join('\n\n'),
      spoken: toSpoken(parts.slice(0, -1).join(' '), lang),
      citations: [
        {
          page,
          chapterTitle: lang === 'en' ? ref.title.en : ref.title.bn,
          heading: sTitle,
          excerpt: (lang === 'en' ? scenario.definition.en : scenario.definition.bn).slice(0, 220),
        },
      ],
      grounded: 'book',
      followUps: followUpsFor(input, scenario.chapterId, lang, sTitle),
    };
  }

  if (best && best.score >= 3) {
    const extra = pages
      .slice(1, persona.answerLength === 'detailed' ? 3 : 2)
      .filter((p) => p.page !== best.page);
    const heading = best.heading ?? best.chapterTitle;
    const parts = [
      L(
        `বইয়ের "${best.chapterTitle}" অধ্যায়ে **${heading}** নিয়ে বলা আছে:`,
        `The chapter "${best.chapterTitle}" covers **${heading}**:`,
      ),
      best.excerpt.replace(/^\*\*[^*]+\*\*\s*/, ''),
      persona.answerLength !== 'short'
        ? L(
            `বইটি পরামর্শ দেয় — আগে সংজ্ঞা নিজের ভাষায় বলো, তারপর উদাহরণে প্রয়োগ করো। পরীক্ষায় ${heading} থেকে সংজ্ঞা ও প্রয়োগমূলক প্রশ্ন আসে।`,
            `The book suggests stating the definition in your own words first, then applying it to an example. Exams often ask definitions and application questions on ${heading}.`,
          )
        : '',
      ...extra.map((p) =>
        L(
          `আরও দেখো: ${p.heading ?? p.chapterTitle} (পৃষ্ঠা ${p.page})`,
          `See also: ${p.heading ?? p.chapterTitle} (page ${p.page})`,
        ),
      ),
      L(
        `📖 সূত্র: "${bookTitle}", পৃষ্ঠা ${best.page}`,
        `📖 Source: "${bookTitle}", page ${best.page}`,
      ),
    ].filter(Boolean);
    return {
      text: parts.join('\n\n'),
      spoken: toSpoken(parts.slice(0, 3).join(' '), lang),
      citations: [best, ...extra].map((p) => ({
        page: p.page,
        chapterTitle: p.chapterTitle,
        heading: p.heading,
        excerpt: p.excerpt,
      })),
      grounded: 'book',
      followUps: followUpsFor(input, best.chapterId, lang, best.heading),
    };
  }

  const suggestions = followUpsFor(input, undefined, lang);
  const text = avatar.strictBookScope
    ? L(
        `দুঃখিত, এই প্রশ্নের উত্তর "${bookTitle}" বইয়ে খুঁজে পাইনি। আমি শুধু এই বইয়ের বিষয়বস্তু থেকে উত্তর দিই। বইয়ের কোনো অধ্যায় বা টপিক নিয়ে প্রশ্ন করো — যেমন:`,
        `Sorry, I couldn't find that in "${bookTitle}". I only answer from this book. Try asking about one of its chapters or topics, for example:`,
      ) +
      '\n\n' +
      suggestions.map((s) => `• ${s}`).join('\n')
    : L(
        'এই বইয়ে সরাসরি উত্তর পাইনি। সাধারণ ব্যাখ্যার জন্য AI টিউটর ব্যবহার করো।',
        "I couldn't find this in the book. Use the AI tutor for a general explanation.",
      );
  return {
    text,
    spoken: toSpoken(text.split('\n\n')[0], lang),
    citations: [],
    grounded: 'out_of_scope',
    followUps: suggestions,
  };
}
