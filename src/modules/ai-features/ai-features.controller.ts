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
const flashcardsBody = z.object({
  chapterId: z.string().min(1).max(160),
  count: z.number().int().min(3).max(30).default(10),
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
  @ApiOperation({ summary: 'Flashcard drafts for a chapter (the app saves the kept ones)' })
  flashcards(
    @Param('studentId') studentId: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertSelf(user, studentId);
    const dto = zparse(flashcardsBody, body);
    return this.study.flashcards(studentId, dto.chapterId, dto.count);
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
}
