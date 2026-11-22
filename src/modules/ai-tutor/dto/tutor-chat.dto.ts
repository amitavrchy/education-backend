import { IsString, IsUUID, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { MAX_TUTOR_MESSAGE_LENGTH } from '../constants/tutor-prompts.js';

const notUndefined = (_: object, value: unknown) => value !== undefined;

export class TutorChatDto {
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_TUTOR_MESSAGE_LENGTH)
  message: string;

  /** Restrict retrieval to one subject's textbooks. */
  @ValidateIf(notUndefined)
  @IsUUID()
  subjectId?: string;

  @ValidateIf(notUndefined)
  @IsUUID()
  chapterId?: string;
}
