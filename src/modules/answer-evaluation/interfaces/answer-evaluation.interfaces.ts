/** Job payload for the ai-answer-evaluation queue. IDs only — the worker loads the data. */
export interface AnswerEvaluationJobData {
  submissionId: string;
  answerId: string;
}

export interface RubricCriterion {
  label: string;
  maxMarks: number;
  guidance: string;
}

export interface EvaluationInput {
  questionText: string;
  modelAnswer?: string;
  rubric: RubricCriterion[];
  studentAnswer: string;
  language: 'bn' | 'en';
}

export interface EvaluationResult {
  awardedMarks: number;
  maxMarks: number;
  criteria: { label: string; awarded: number; feedback: string }[];
  overallFeedback: string;
  /** AI scores are suggestions until a teacher confirms them. */
  requiresTeacherReview: boolean;
}

export interface AnswerEvaluator {
  evaluate(input: EvaluationInput): Promise<EvaluationResult>;
}
