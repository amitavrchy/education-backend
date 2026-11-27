import { Injectable } from '@nestjs/common';
import { invalid, notFound } from '../../common/exceptions/app.exception.js';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface.js';
import { nowIso } from '../../common/utils/dates.js';
import type { HandwritingEvaluation } from '../../contracts/assessment.js';
import type { Chapter, Subject, Topic } from '../../contracts/curriculum.js';
import type { OcrJob, SourcePassage } from '../../contracts/learning.js';
import type { Question } from '../../contracts/question.js';
import {
  AiServiceClient,
  imageFromDataUrl,
  type AiImage,
  type GeneratedQuestion,
} from '../../integrations/ai-service/ai-service.client.js';
import { AccessPolicyService } from '../access/access-policy.service.js';
import { UsageService } from '../billing/usage.service.js';
import { RecordStoreService, type Entity } from '../records/record-store.service.js';

const CURRICULUM = (collection: string) => ({ collection, scope: '' });

export interface GenerateInput {
  subjectId: string;
  chapterId: string;
  topicId?: string;
  type: 'mcq' | 'short' | 'creative';
  difficulty: 'easy' | 'medium' | 'hard' | 'mixed';
  count: number;
  language: 'bn' | 'en' | 'mixed';
}

/**
 * Backend side of the AI features served by the AI service: it checks access and quotas,
 * gathers grounded inputs from the database, and stores results in the frontend's contracts.
 */
@Injectable()
export class AiFeaturesService {
  constructor(
    private readonly ai: AiServiceClient,
    private readonly store: RecordStoreService,
    private readonly usage: UsageService,
    private readonly access: AccessPolicyService,
  ) {}

  /** Handwriting / written-answer evaluation → `ai_estimated` stage (a teacher can then review). */
  async evaluate(user: AuthenticatedUser, studentId: string, evaluationId: string) {
    const isStudent = user.id === studentId;
    const isReviewer =
      user.permissions.includes('evaluation.review') &&
      (await this.access.canReadStudent(user, studentId, 'scores'));
    if (!isStudent && !isReviewer) notFound('Evaluation');
    const ref = { collection: 'evaluations', scope: studentId };
    const ev =
      (await this.store.find<HandwritingEvaluation & Entity>(ref, evaluationId)) ??
      notFound('Evaluation');
    if (['teacher_reviewed', 'official'].includes(ev.stage))
      invalid('ALREADY_REVIEWED', undefined, 409);
    const images = ev.pages
      .map((p) => imageFromDataUrl(p.preview))
      .filter((i): i is AiImage => !!i);
    const answerText = ev.correctedText || ev.ocrText || undefined;
    if (!images.length && !answerText) invalid('NO_PAGES');
    // A transcription the student corrected is marked as text; otherwise the AI reads the pages.
    const useText = !!ev.correctedText?.trim() || !images.length;
    if (isStudent) await this.usage.consume(studentId, 'handwriting');

    const res = await this.ai.evaluate({
      question_text: ev.questionText,
      model_answer: ev.modelAnswer,
      max_marks: ev.maxMarks,
      rubric: ev.rubric.map((r) => ({ criterion: r.criterion, marks: r.max })),
      answer_text: useText ? answerText : undefined,
      images: useText ? [] : images,
      language: 'bn',
    });
    const scores = new Map(res.rubric.map((r) => [r.criterion, r]));
    const updated: HandwritingEvaluation = {
      ...ev,
      ocrText: useText ? ev.ocrText : res.transcribed_text,
      stage: 'ai_estimated',
      aiMarks: res.total_marks,
      rubric: ev.rubric.length
        ? ev.rubric.map((r) => ({
            ...r,
            ai: scores.get(r.criterion)?.awarded ?? 0,
            comment: scores.get(r.criterion)?.comment ?? r.comment,
          }))
        : res.rubric.map((r) => ({
            criterion: r.criterion,
            max: r.max,
            ai: r.awarded,
            comment: r.comment,
          })),
      dimensions: res.dimensions,
      missingPoints: res.missing_points,
      suggestions: res.suggestions,
      updatedAt: nowIso(),
    };
    await this.store.replace(ref, updated as HandwritingEvaluation & Entity);
    return { evaluation: updated, confidence: res.confidence, simulated: res.simulated };
  }

  /** Photo solver: read a photographed problem (and optionally solve it) → stored OcrJob. */
  async solvePhoto(
    studentId: string,
    input: { fileName: string; image: string; solve: boolean; subjectHint?: string; save: boolean },
  ) {
    const image = imageFromDataUrl(input.image);
    if (!image) invalid('INVALID_IMAGE');
    await this.usage.consume(studentId, 'photo');
    const res = await this.ai.ocr({
      images: [image],
      solve: input.solve,
      subject_hint: input.subjectHint,
      language: 'bn',
    });
    const job: OcrJob = {
      id: RecordStoreService.newId('ocr'),
      fileName: input.fileName.slice(0, 200),
      status: !res.readable ? 'unreadable' : res.solution ? 'solved' : 'extracted',
      extractedText: res.text,
      detectedSubjectId: await this.subjectIdFor(res.detected_subject),
      confidence: res.confidence,
      solution: res.solution ?? undefined,
      createdAt: nowIso(),
    };
    if (input.save)
      await this.store.insert({ collection: 'ocr', scope: studentId }, job as OcrJob & Entity);
    return { job, simulated: res.simulated };
  }

  /** Solves a typed problem (no photo, nothing stored). */
  async solveText(studentId: string, text: string, subjectId?: string) {
    const subject = subjectId
      ? await this.store.find<Subject & Entity>(CURRICULUM('subjects'), subjectId)
      : undefined;
    await this.usage.consume(studentId, 'ai');
    const res = await this.ai.solveText({ text, subject_hint: subject?.name.en, language: 'bn' });
    return {
      steps: res.steps,
      answer: res.answer,
      explanation: res.explanation,
      simulated: res.simulated,
    };
  }

  /** Solves the (corrected) text of a photo-solver job and stores the solution on it. */
  async solveJob(
    studentId: string,
    jobId: string,
    input: { correctedText: string; subjectId?: string; chapterId?: string },
  ) {
    const ref = { collection: 'ocr', scope: studentId };
    const job = (await this.store.find<OcrJob & Entity>(ref, jobId)) ?? notFound('OcrJob');
    const subject = input.subjectId
      ? await this.store.find<Subject & Entity>(CURRICULUM('subjects'), input.subjectId)
      : undefined;
    await this.usage.consume(studentId, 'ai');
    const res = await this.ai.solveText({
      text: input.correctedText,
      subject_hint: subject?.name.en,
      language: 'bn',
    });
    const updated: OcrJob = {
      ...job,
      status: 'solved',
      correctedText: input.correctedText,
      detectedSubjectId: input.subjectId ?? job.detectedSubjectId,
      chapterId: input.chapterId ?? job.chapterId,
      solution: { steps: res.steps, answer: res.answer, explanation: res.explanation },
    };
    await this.store.replace(ref, updated as OcrJob & Entity);
    return updated;
  }

  private async subjectIdFor(name: string): Promise<string | undefined> {
    if (!name) return undefined;
    const subjects = await this.store.all<Subject & Entity>(CURRICULUM('subjects'));
    const n = name.toLowerCase();
    return subjects.find((s) => s.name.en.toLowerCase() === n || s.name.bn === name)?.id;
  }

  /** Draft questions for a chapter, grounded in its KB passages. Drafts are not saved: authors
   * review them and save through POST /review-items/questions. */
  async generateQuestions(input: GenerateInput) {
    const [subject, chapter, topic] = await Promise.all([
      this.store.find<Subject & Entity>(CURRICULUM('subjects'), input.subjectId),
      this.store.find<Chapter & Entity>(CURRICULUM('chapters'), input.chapterId),
      input.topicId
        ? this.store.find<Topic & Entity>(CURRICULUM('topics'), input.topicId)
        : undefined,
    ]);
    if (!subject || !chapter || chapter.subjectId !== subject.id) notFound('Chapter');
    const passages = await this.store.list<SourcePassage & Entity>(
      CURRICULUM('kbPassages'),
      'all',
      { filters: { chapterId: [chapter.id] }, pageSize: 6 },
    );
    const res = await this.ai.generateQuestions({
      subject: subject.name.en,
      chapter: chapter.title.bn,
      topic: topic?.title.bn,
      level_code: subject.levelCode,
      type: input.type,
      difficulty: input.difficulty,
      count: input.count,
      language: input.language,
      passages: passages.items.map((p) => ({
        id: p.id,
        book_title: p.bookTitle,
        chapter_title: p.chapterTitle,
        page: p.page,
        text: p.text,
      })),
    });
    const now = nowIso();
    const drafts = res.questions.map((g) => this.toQuestion(g, subject, chapter, topic, now));
    return { questions: drafts, simulated: res.simulated };
  }

  /**
   * Questions found in an imported document's text (question papers, worksheets, banks), mapped to
   * the subject's chapters. Drafts only — the admin reviews them and saves the ones to keep.
   */
  async extractQuestions(input: { subjectId: string; text: string; language: 'bn' | 'en' | 'mixed' }) {
    const subject =
      (await this.store.find<Subject & Entity>(CURRICULUM('subjects'), input.subjectId)) ??
      notFound('Subject');
    const chapters = await this.store.all<Chapter & Entity>(CURRICULUM('chapters'), 'all', {
      filters: { subjectId: [subject.id] },
    });
    chapters.sort((a, b) => a.number - b.number);
    const byId = new Map(chapters.map((c) => [c.id, c]));
    // Long documents are sent in parts (at paragraph boundaries) so no question is cut in half.
    const parts: string[] = [];
    let cur = '';
    for (const para of input.text.split(/\n{2,}/)) {
      if (cur && cur.length + para.length > 24_000) {
        parts.push(cur);
        cur = '';
      }
      cur = cur ? `${cur}\n\n${para}` : para;
    }
    if (cur.trim()) parts.push(cur);
    const now = nowIso();
    const questions: Question[] = [];
    let simulated = false;
    for (const text of parts.slice(0, 6)) {
      const res = await this.ai.extractQuestions({
        text,
        subject: `${subject.name.bn} (${subject.name.en})`,
        chapters: chapters.map((c) => ({ id: c.id, title: `${c.title.bn} (${c.title.en})` })),
        language: input.language,
        max_questions: 60,
      });
      simulated ||= res.simulated;
      for (const g of res.questions) {
        const chapter = byId.get(g.chapter_id);
        const objective = g.type === 'mcq' || g.type === 'true_false';
        questions.push({
          id: RecordStoreService.newId('q'),
          type: g.type,
          levelCode: subject.levelCode,
          subjectId: subject.id,
          chapterId: chapter?.id ?? '',
          stem: g.stem,
          options: g.type === 'mcq' ? g.options : undefined,
          correctOptionId: g.type === 'mcq' && g.correct_option_id ? g.correct_option_id : undefined,
          correctBoolean:
            g.type === 'true_false' ? /^(true|সত্য|ঠিক|হ্যাঁ|t)\b/i.test(g.answer.trim()) : undefined,
          cqParts:
            g.type === 'creative'
              ? g.cq_parts.map((p) => ({
                  label: p.label as 'ক',
                  level: p.level as 'knowledge',
                  prompt: p.question,
                  answer: p.answer,
                  marks: p.marks,
                }))
              : undefined,
          answer: g.answer,
          explanation: g.explanation,
          marks: objective ? Math.max(1, Math.min(g.marks, 2)) : g.marks,
          difficulty: g.difficulty,
          source: { kind: 'teacher', label: 'Imported document' },
          provenance: 'user_generated',
          verification: 'unverified',
          examRelevance: chapter?.examRelevance ?? 'medium',
          frequency: 1,
          tags: ['imported'],
          status: 'draft',
          version: 1,
          createdAt: now,
          updatedAt: now,
        });
      }
    }
    return { questions, simulated, truncated: parts.length > 6 };
  }

  private toQuestion(
    g: GeneratedQuestion,
    subject: Subject,
    chapter: Chapter,
    topic: Topic | undefined,
    now: string,
  ): Question {
    return {
      id: RecordStoreService.newId('q'),
      type: g.type,
      levelCode: subject.levelCode,
      subjectId: subject.id,
      chapterId: chapter.id,
      topicId: topic?.id,
      stem: g.stem,
      options: g.type === 'mcq' ? g.options : undefined,
      correctOptionId: g.type === 'mcq' ? g.correct_option_id : undefined,
      cqParts:
        g.type === 'creative'
          ? g.cq_parts.map((p) => ({
              label: p.label as 'ক',
              level: p.level as 'knowledge',
              prompt: p.question,
              answer: p.answer,
              marks: p.marks,
            }))
          : undefined,
      answer: g.answer,
      explanation: g.explanation,
      marks: g.marks,
      difficulty: g.difficulty,
      source: { kind: 'textbook', label: 'AI draft · reviewer approval required' },
      provenance: 'user_generated',
      verification: 'unverified',
      examRelevance: chapter.examRelevance ?? 'medium',
      frequency: 1,
      tags: ['ai-draft'],
      status: 'draft',
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
  }
}
