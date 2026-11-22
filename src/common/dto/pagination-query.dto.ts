import { IsIn, IsInt, IsString, Max, MaxLength, Min, ValidateIf } from 'class-validator';

const notUndefined = (_: object, value: unknown) => value !== undefined;

/** Standard list query: ?page=1&pageSize=20&search=physics&sortBy=createdAt&sortOrder=desc */
export class PaginationQueryDto {
  /** 1-based page number. */
  @ValidateIf(notUndefined)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ValidateIf(notUndefined)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize: number = 20;

  @ValidateIf(notUndefined)
  @IsString()
  @MaxLength(100)
  search?: string;

  @ValidateIf(notUndefined)
  @IsString()
  @MaxLength(50)
  sortBy?: string;

  @ValidateIf(notUndefined)
  @IsIn(['asc', 'desc'])
  sortOrder: 'asc' | 'desc' = 'desc';
}
