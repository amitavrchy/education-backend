import { Body, Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { CurrentUser, RequirePermissions } from '../../common/decorators/index.js';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface.js';
import { zparse } from '../../common/utils/zod.util.js';
import { assertSelf } from '../access/access-policy.service.js';
import { AiFeaturesService } from './ai-features.service.js';
import { StudyAiService } from './study-ai.service.js';

const photoBody = z.object({
  fileName: z.string().min(1).max(200),
  /** `data:image/(jpeg|png|webp|gif);base64,...` (≤ ~8 MB). */
  image: z.string().max(12_000_000),
  solve: z.boolean().default(true),
  subjectHint: z.string().max(200).optional(),
  /** false = read only (e.g. transcribing answer-script pages); nothing is stored. */
  save: z.boolean().default(true),
});
const solveJobBody = z.object({
  correctedText: z.string().trim().min(1).max(8000),
  subjectId: z.string().max(120).optional(),
  chapterId: z.string().max(160).optional(),
});

const generateBody = z.object({
  subjectId: z.string().min(1).max(120),
  chapterId: z.string().min(1).max(160),
  topicId: z.string().max(160).optional(),
  type: z.enum(['mcq', 'short', 'creative']).default('mcq'),
  difficulty: z.enum(['easy', 'medium', 'hard', 'mixed']).default('mixed'),
  count: z.number().int().min(1).max(10).default(5),
  language: z.enum(['bn', 'en', 'mixed']).default('bn'),
});

const lang = z.enum(['bn', 'en', 'mixed']).default('bn');
const extractBody = z.object({
  subjectId: z.string().min(1).max(120),
  text: z.string().trim().min(1).max(200_000),
  language: lang,
});
const voiceBody = z.object({
  text: z.string().trim().min(1).max(2000),
  mode: z.enum(['tutor', 'oral_exam']).default('tutor'),
  language: lang,
  subjectId: z.string().max(120).optional(),
  oralQuestion: z.string().max(1000).optional(),
  turns: z
    .array(z.object({ speaker: z.enum(['student', 'tutor']), text: z.string().max(4000) }))
    .max(20)
    .default([]),
});
const audioBody = z.object({
  chapterId: z.string().min(1).max(160),
  minutes: z.number().int().min(2).max(15).default(5),
});
const flashcardsBody = z
  .object({
    chapterId: z.string().min(1).max(160).optional(),
    count: z.number().int().min(3).max(30).default(10),
    sourceText: z.string().max(30_000).optional(),
    title: z.string().max(300).optional(),
  })
  .refine((b) => b.chapterId || b.sourceText?.trim(), { message: 'chapterId or sourceText is required' });
const pronunciationBody = z
  .object({
    target: z.string().trim().min(1).max(600),
    /** `data:audio/webm;base64,...` recording (≤ ~10 MB). */
    audio: z.string().max(14_000_000).optional(),
    transcript: z.string().max(2000).optional(),
  })
  .refine((b) => b.audio || b.transcript?.trim(), { message: 'audio or transcript is required' });
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const planBody = z.object({
  subjectIds: z.array(z.string().max(120)).min(1).max(20),
  weakChapterIds: z.array(z.string().max(160)).max(100).default([]),
  examDate: day.optional(),
  startDate: day,
  days: z.number().int().min(1).max(28).default(14),
  dailyMinutes: z.number().int().min(15).max(600).default(90),
  startTime: z.string().regex(/^\d{2}:\d{2}$/).default('18:00'),
  goal: z.string().max(500).optional(),
});
const noteBody = z.object({
  kind: z
    .enum([
      'short',
      'detailed',
      'revision',
      'formula',
      'definition',
      'takeaways',
      'important_questions',
      'custom',
    ])
    .default('short'),
  chapterId: z.string().max(160).optional(),
  topicId: z.string().max(160).optional(),
  questionText: z.string().max(8000).optional(),
  answerText: z.string().max(12_000).optional(),
  conversation: z.string().max(30_000).optional(),
  uploadText: z.string().max(30_000).optional(),
  language: lang,
});
const writingBody = z.object({
  text: z.string().trim().min(1).max(8000),
  kind: z.string().max(60).default('paragraph'),
  prompt: z.string().max(1000).default(''),
  minWords: z.number().int().min(0).max(2000).default(0),
  maxWords: z.number().int().min(1).max(5000).default(1000),
});

/** AI features backed by the AI service (AI_PROVIDER=service); 503 AI_NOT_CONFIGURED otherwise. */
@ApiTags('ai')
@ApiBearerAuth()
@Controller()
export class AiFeaturesController {
  constructor(
    private readonly features: AiFeaturesService,
    private readonly study: StudyAiService,
  ) {}

  @Post('voice/:studentId/reply')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('learn')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Voice tutor / oral exam turn (the app does speech-to-text and TTS)' })
  voice(
    @Param('studentId') studentId: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertSelf(user, studentId);
    return this.study.voiceReply(studentId, zparse(voiceBody, body));
  }

  @Post('audio-lessons/generate')
  @RequirePermissions('learn', 'books.manage', 'curriculum.manage')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Write a new audio lesson for a chapter (saved to the catalogue)' })
  audio(@Body() body: unknown, @CurrentUser() user: AuthenticatedUser) {
    const dto = zparse(audioBody, body);
    return this.study.audioLesson(user.id, dto.chapterId, dto.minutes);
  }

  @Post('flashcards/:studentId/generate')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('learn')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Flashcard drafts for a chapter or from a note/conversation (the app saves the kept ones)',
  })
  flashcards(
    @Param('studentId') studentId: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertSelf(user, studentId);
    return this.study.flashcards(studentId, zparse(flashcardsBody, body));
  }

  @Post('notes/:studentId/generate')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('learn')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Study note (HTML) for a chapter/topic, a Q&A, a conversation or an upload',
  })
  note(
    @Param('studentId') studentId: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertSelf(user, studentId);
    return this.study.note(studentId, zparse(noteBody, body));
  }

  @Post('english/:studentId/writing')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('learn')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'English writing feedback (scores, issues with fixes, strengths)' })
  writing(
    @Param('studentId') studentId: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertSelf(user, studentId);
    return this.study.writing(studentId, zparse(writingBody, body));
  }

  @Post('evaluations/:studentId/:evaluationId/evaluate')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'AI-estimate marks for a handwritten/typed answer (student or reviewer)',
  })
  evaluate(
    @Param('studentId') studentId: string,
    @Param('evaluationId') evaluationId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.features.evaluate(user, studentId, evaluationId);
  }

  @Post('ocr/:studentId/solve')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('learn')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Photo solver: read (and optionally solve) a photographed problem' })
  solve(
    @Param('studentId') studentId: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertSelf(user, studentId);
    return this.features.solvePhoto(studentId, zparse(photoBody, body));
  }

  @Post('solve/:studentId')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('learn')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Step-by-step solution of a typed problem (not stored)' })
  solveTyped(
    @Param('studentId') studentId: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertSelf(user, studentId);
    const dto = zparse(solveJobBody, body);
    return this.features.solveText(studentId, dto.correctedText, dto.subjectId);
  }

  @Post('ocr/:studentId/:jobId/solve')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('learn')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: "Photo solver: solve the job's (corrected) text" })
  solveJob(
    @Param('studentId') studentId: string,
    @Param('jobId') jobId: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertSelf(user, studentId);
    return this.features.solveJob(studentId, jobId, zparse(solveJobBody, body));
  }

  @Post('questions/generate')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('content.create', 'questions.manage')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary:
      'Draft questions for a chapter (not saved; review then save via /review-items/questions)',
  })
  generate(@Body() body: unknown) {
    return this.features.generateQuestions(zparse(generateBody, body));
  }

  @Post('questions/extract')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('content.create', 'questions.manage')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Questions found in a document\'s text (from /document-text), mapped to chapters (drafts, not saved)',
  })
  extractQuestions(@Body() body: unknown) {
    return this.features.extractQuestions(zparse(extractBody, body));
  }

  @Post('english/:studentId/pronunciation')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('learn')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Pronunciation score of a read sentence (recording or transcript), word by word' })
  pronunciation(
    @Param('studentId') studentId: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertSelf(user, studentId);
    return this.study.pronunciation(studentId, zparse(pronunciationBody, body));
  }

  @Post('planner/:studentId/generate')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('learn')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'AI study plan (StudyTask[], not saved), weighted towards weak chapters' })
  plan(@Param('studentId') studentId: string, @Body() body: unknown, @CurrentUser() user: AuthenticatedUser) {
    assertSelf(user, studentId);
    return this.study.plan(studentId, zparse(planBody, body));
  }
}
