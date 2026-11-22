export const OCR_PROVIDER = Symbol('OCR_PROVIDER');

export interface OcrPage {
  pageNumber: number;
  text: string;
  /** 0–1 when the engine reports it. */
  confidence?: number;
}

export interface OcrProvider {
  readonly name: string;
  /** Bangla + English recognition by default. */
  recognize(file: Buffer, options: { mimeType: string; languages?: string[] }): Promise<OcrPage[]>;
}
