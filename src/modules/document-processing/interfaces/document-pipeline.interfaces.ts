/** Payload for the pdf-processing queue. IDs only; the worker reads the file from storage. */
export interface PdfProcessingJobData {
  fileId: string;
  /** Set when the PDF is a textbook, so chapters can be attached to it. */
  bookId?: string;
}

/**
 * Pipeline stages, each a separate service so they can be retried and swapped independently:
 *   1. text extraction (digital PDFs)
 *   2. OCR for scanned pages        → ocr-processing queue
 *   3. chapter detection
 *   4. question extraction (board question papers)
 *   5. chunking + embedding + index → ai-document-indexing queue
 * StoredFile.processingStatus tracks progress: QUEUED → PROCESSING → COMPLETED | FAILED.
 */
export type PipelineStage =
  'text-extraction' | 'ocr' | 'chapter-detection' | 'question-extraction' | 'indexing';

export interface ExtractedPage {
  pageNumber: number;
  text: string;
  /** True when the page has no text layer and needs OCR. */
  needsOcr: boolean;
}

export interface DetectedChapter {
  number: number;
  title: string;
  pageStart: number;
  pageEnd: number;
}

export interface TextExtractor {
  extract(pdf: Buffer): Promise<ExtractedPage[]>;
}

export interface ChapterDetector {
  detect(pages: ExtractedPage[]): Promise<DetectedChapter[]>;
}
