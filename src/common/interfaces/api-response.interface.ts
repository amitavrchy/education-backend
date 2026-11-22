export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/** Success envelope. Matches the frontend's ApiResponse<T> type. */
export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
  message?: string;
  meta?: PaginationMeta;
}

/** Error envelope. Matches the frontend's ApiErrorBody type. */
export interface ApiErrorResponse {
  success: false;
  statusCode: number;
  code: string;
  message: string;
  errors?: Record<string, string[]>;
  path: string;
  timestamp: string;
  requestId?: string;
}

/** Return this from a service to get `data` + `meta` in the envelope. */
export interface PaginatedResult<T> {
  items: T[];
  meta: PaginationMeta;
}
