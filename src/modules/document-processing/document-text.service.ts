import { Injectable } from '@nestjs/common';
import { PDFDocument } from 'pdf-lib';
import { invalid } from '../../common/exceptions/app.exception.js';
import {
  AiServiceClient,
  type DocumentType,
  type ExtractedPage,
} from '../../integrations/ai-service/ai-service.client.js';
import { INGESTIBLE_TYPES } from './ingestion.service.js';

const BATCH = 4;
const PARALLEL = 2;

const BY_EXTENSION: Record<string, DocumentType> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

/** The file's document type, trusting the extension when the browser sent a generic type. */
export function documentType(file: { originalname: string; mimetype: string }): DocumentType | undefined {
  if ((INGESTIBLE_TYPES as string[]).includes(file.mimetype)) return file.mimetype as DocumentType;
  return BY_EXTENSION[file.originalname.split('.').pop()?.toLowerCase() ?? ''];
}

export interface DocumentText {
  pages: ExtractedPage[];
  pageCount: number;
  failedPages: number[];
  text: string;
  truncated: boolean;
}

/**
 * Text of an uploaded document (question papers, notes, worksheets): the AI service reads PDF pages
 * and photos with a vision model and parses Word/Excel/text files.
 */
@Injectable()
export class DocumentTextService {
  constructor(private readonly ai: AiServiceClient) {}

  async read(buffer: Buffer, type: DocumentType, maxPages = 30): Promise<DocumentText> {
    if (type !== 'application/pdf') {
      const res = await this.ai.extract({ media_type: type, data: buffer.toString('base64') });
      return this.result(res.pages, res.pages.length, res.failed_pages ?? [], false);
    }
    let pdf: PDFDocument;
    try {
      pdf = await PDFDocument.load(buffer, { ignoreEncryption: true, updateMetadata: false });
    } catch {
      return invalid('INVALID_FILE', undefined, 422);
    }
    const total = pdf.getPageCount();
    const last = Math.min(total, maxPages);
    const starts: number[] = [];
    for (let s = 1; s <= last; s += BATCH) starts.push(s);
    const pages: ExtractedPage[] = [];
    const failed: number[] = [];
    const run = async () => {
      for (let start = starts.shift(); start !== undefined; start = starts.shift()) {
        const end = Math.min(last, start + BATCH - 1);
        const part = await PDFDocument.create();
        const copied = await part.copyPages(
          pdf,
          Array.from({ length: end - start + 1 }, (_, k) => start - 1 + k),
        );
        for (const p of copied) part.addPage(p);
        const res = await this.ai.extract({
          media_type: 'application/pdf',
          data: Buffer.from(await part.save()).toString('base64'),
          start_page: 1,
          max_pages: end - start + 1,
          page_offset: start - 1,
        });
        pages.push(...res.pages);
        failed.push(...(res.failed_pages ?? []));
      }
    };
    await Promise.all(Array.from({ length: Math.min(PARALLEL, starts.length) }, run));
    pages.sort((a, b) => a.page - b.page);
    return this.result(pages, total, failed, total > last);
  }

  private result(pages: ExtractedPage[], pageCount: number, failedPages: number[], truncated: boolean) {
    return {
      pages,
      pageCount,
      failedPages,
      truncated,
      text: pages
        .map((p) => p.text.trim())
        .filter(Boolean)
        .join('\n\n'),
    };
  }
}
