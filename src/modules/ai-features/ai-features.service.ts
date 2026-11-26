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
    if (isStudent) await this.usage.consume(studentId, 'handwriting');

    const res = await this.ai.evaluate({
      question_text: ev.questionText,
      model_answer: ev.modelAnswer,
      max_marks: ev.maxMarks,
      rubric: ev.rubric.map((r) => ({ criterion: r.criterion, marks: r.max })),
      answer_text: images.length ? undefined : answerText,
      images,
      language: 'bn',
    });
    const scores = new Map(res.rubric.map((r) => [r.criterion, r]));
    const updated: HandwritingEvaluation = {
      ...ev,
      ocrText: images.length ? res.transcribed_text : ev.ocrText,
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
    input: { fileName: string; image: string; solve: boolean; subjectHint?: string },
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
    await this.store.insert({ collection: 'ocr', scope: studentId }, job as OcrJob & Entity);
    return { job, simulated: res.simulated };
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
