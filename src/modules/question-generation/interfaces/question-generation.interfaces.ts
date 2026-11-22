export type GeneratedQuestionType = 'mcq' | 'creative' | 'short';
export type Difficulty = 'easy' | 'medium' | 'hard';

/** Job payload for the question-generation queue. */
export interface QuestionGenerationJobData {
  requestedById: string;
  subjectId: string;
  chapterIds: string[];
  type: GeneratedQuestionType;
  difficulty: Difficulty;
  count: number;
  language: 'bn' | 'en';
}

export interface GeneratedQuestion {
  type: GeneratedQuestionType;
  stem: string;
  options?: string[];
  correctOptionIndex?: number;
  explanation?: string;
  sourceChunkIds: string[];
}
