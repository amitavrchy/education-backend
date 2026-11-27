import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { invalid } from '../../common/exceptions/app.exception.js';
import { integrationsConfig, type IntegrationsConfig } from '../../config/index.js';

/**
 * Client for the ShikkhaAI AI service (`../ai`, FastAPI + Claude). All prompts and model calls
 * live there; this side sends grounded inputs (passages, rubric, images) and stores results.
 * Field names follow the service's snake_case JSON.
 */

export interface AiPassage {
  id: string;
  book_title: string;
  chapter_title: string;
  page: number;
  text: string;
}

export interface AiImage {
  media_type: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
  data: string;
}

export interface TutorAnswerResult {
  content: string;
  cited_passage_ids: string[];
  grounded: boolean;
  simulated: boolean;
  model: string;
}

export interface EvaluationResult {
  transcribed_text: string;
  rubric: { criterion: string; max: number; awarded: number; comment: string }[];
  total_marks: number;
  dimensions: { concept: number; calculation: number; presentation: number };
  missing_points: string[];
  suggestions: string[];
  confidence: number;
  simulated: boolean;
  model: string;
}

export interface OcrResult {
  readable: boolean;
  text: string;
  confidence: number;
  detected_subject: string;
  solution: { steps: string[]; answer: string; explanation: string } | null;
  simulated: boolean;
  model: string;
}

export interface GeneratedQuestion {
  type: 'mcq' | 'short' | 'creative';
  stem: string;
  options: { id: string; text: string }[];
  correct_option_id: string;
  cq_parts: { label: string; level: string; question: string; answer: string; marks: number }[];
  answer: string;
  explanation: string;
  difficulty: 'easy' | 'medium' | 'hard';
  marks: number;
  source_passage_ids: string[];
}

export interface TutorReplyResult extends TutorAnswerResult {
  follow_ups: string[];
  warnings: string[];
  confidence: number;
}

export interface AvatarAnswerResult {
  text: string;
  spoken: string;
  cited_pages: number[];
  grounded: 'book' | 'greeting' | 'out_of_scope';
  follow_ups: string[];
  simulated: boolean;
  model: string;
}

export interface VoiceReplyResult {
  text: string;
  next_question: string;
  score: { got: number; max: number } | null;
  simulated: boolean;
  model: string;
}

export interface AudioLessonResult {
  title: string;
  segments: { title: string; text: string }[];
  simulated: boolean;
  model: string;
}

export interface FlashcardsResult {
  cards: { front: string; back: string; hint: string; tag: string }[];
  simulated: boolean;
  model: string;
}

export interface NoteResult {
  title: string;
  html: string;
  simulated: boolean;
  model: string;
}

export interface WritingResult {
  scores: { grammar: number; vocabulary: number; structure: number; task: number };
  overall: number;
  issues: { text: string; why: string; fix: string }[];
  strengths: string[];
  simulated: boolean;
  model: string;
}

type Lang = 'bn' | 'en' | 'mixed';

const DATA_URL = /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/;

/** `data:image/png;base64,...` → AI image input; null for anything else (e.g. seeded SVG previews). */
export function imageFromDataUrl(url: string): AiImage | null {
  const m = DATA_URL.exec(url.trim());
  return m ? { media_type: m[1] as AiImage['media_type'], data: m[2] } : null;
}

@Injectable()
export class AiServiceClient {
  private readonly logger = new Logger(AiServiceClient.name);

  constructor(@Inject(integrationsConfig.KEY) private readonly config: IntegrationsConfig) {}

  get enabled(): boolean {
    return this.config.ai.provider === 'service';
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    if (!this.enabled) invalid('AI_NOT_CONFIGURED', undefined, HttpStatus.SERVICE_UNAVAILABLE);
    let res: Response;
    try {
      res = await fetch(`${this.config.ai.serviceUrl.replace(/\/$/, '')}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-internal-key': this.config.ai.serviceKey ?? '',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.config.ai.serviceTimeoutMs),
      });
    } catch (error) {
      this.logger.error({ err: error, path }, 'AI service unreachable');
      return invalid('AI_UNAVAILABLE', undefined, HttpStatus.SERVICE_UNAVAILABLE);
    }
    const payload = (await res.json().catch(() => ({}))) as { code?: string } & T;
    if (res.ok) return payload;
    const code = payload.code ?? 'AI_UNAVAILABLE';
    if (res.status === 422 || res.status === 429) invalid(code, undefined, res.status);
    this.logger.warn({ status: res.status, code, path }, 'AI service error');
    return invalid(
      code === 'UNAUTHORIZED' ? 'AI_NOT_CONFIGURED' : 'AI_UNAVAILABLE',
      undefined,
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }

  tutorAnswer(input: {
    query: string;
    context: {
      level_code: string;
      grade: number;
      subject?: string;
      chapter?: string;
      mode: string;
      language: string;
    };
    passages: AiPassage[];
    history: { role: 'user' | 'assistant'; content: string }[];
  }) {
    return this.post<TutorAnswerResult>('/v1/tutor/answer', input);
  }

  evaluate(input: {
    question_text: string;
    model_answer: string;
    max_marks: number;
    rubric: { criterion: string; marks: number; description?: string }[];
    answer_text?: string;
    images: AiImage[];
    language: string;
  }) {
    return this.post<EvaluationResult>('/v1/evaluate', input);
  }

  ocr(input: { images: AiImage[]; solve: boolean; subject_hint?: string; language: string }) {
    return this.post<OcrResult>('/v1/ocr', input);
  }

  generateQuestions(input: {
    subject: string;
    chapter: string;
    topic?: string;
    level_code: string;
    type: 'mcq' | 'short' | 'creative';
    difficulty: string;
    count: number;
    language: string;
    passages: AiPassage[];
  }) {
    return this.post<{ questions: GeneratedQuestion[]; simulated: boolean; model: string }>(
      '/v1/questions/generate',
      input,
    );
  }

  solveText(input: { text: string; subject_hint?: string; language: string }) {
    return this.post<{
      steps: string[];
      answer: string;
      explanation: string;
      simulated: boolean;
      model: string;
    }>('/v1/solve', input);
  }

  tutorRespond(input: Parameters<AiServiceClient['tutorAnswer']>[0]) {
    return this.post<TutorReplyResult>('/v1/tutor/respond', input);
  }

  avatarAnswer(input: {
    query: string;
    book_title: string;
    avatar_name: string;
    language: Lang;
    persona: { style: string; answer_length: string; use_examples: boolean };
    strict_scope: boolean;
    chapters: string[];
    pages: { page: number; chapter_title: string; heading: string; text: string }[];
    history: { role: 'user' | 'assistant'; content: string }[];
  }) {
    return this.post<AvatarAnswerResult>('/v1/avatar/answer', input);
  }

  voiceReply(input: {
    text: string;
    mode: 'tutor' | 'oral_exam';
    language: Lang;
    subject?: string;
    oral_question?: string;
    turns: { speaker: 'student' | 'tutor'; text: string }[];
  }) {
    return this.post<VoiceReplyResult>('/v1/voice/reply', input);
  }

  audioLesson(input: {
    subject: string;
    chapter: string;
    topics: string[];
    passages: AiPassage[];
    language: Lang;
    minutes: number;
  }) {
    return this.post<AudioLessonResult>('/v1/audio/lesson', input);
  }

  flashcards(input: {
    subject: string;
    chapter: string;
    topics: string[];
    passages: AiPassage[];
    count: number;
    language: Lang;
  }) {
    return this.post<FlashcardsResult>('/v1/study/flashcards', input);
  }

  note(input: {
    kind: string;
    subject: string;
    chapter: string;
    topic: string;
    topics: string[];
    passages: AiPassage[];
    question_text?: string;
    answer_text?: string;
    conversation?: string;
    upload_text?: string;
    language: Lang;
  }) {
    return this.post<NoteResult>('/v1/study/notes', input);
  }

  writing(input: {
    text: string;
    kind: string;
    prompt: string;
    min_words: number;
    max_words: number;
  }) {
    return this.post<WritingResult>('/v1/english/writing', input);
  }
}

/** Knowledge-base passage → the AI service's passage shape. */
export function aiPassage(p: {
  id: string;
  bookTitle: string;
  chapterTitle: string;
  page: number;
  text: string;
}): AiPassage {
  return {
    id: p.id,
    book_title: p.bookTitle,
    chapter_title: p.chapterTitle,
    page: p.page,
    text: p.text,
  };
}
