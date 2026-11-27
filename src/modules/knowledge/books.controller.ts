import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { notFound } from '../../common/exceptions/app.exception.js';
import type { Topic } from '../../contracts/curriculum.js';
import type { Book } from '../../contracts/learning.js';
import { bookPage } from '../../domain/avatar/book-pages.js';
import { RecordStoreService, type Entity } from '../records/record-store.service.js';
import { KnowledgeService } from './knowledge.service.js';

const BOOKS = { collection: 'books', scope: '' };
const TOPICS = { collection: 'topics', scope: '' };

/**
 * Book reader content: pages read from the uploaded textbook (ingestion), or — for a book that has
 * not been ingested yet — the placeholder page generated from its chapter/topic outline.
 */
@ApiTags('books')
@ApiBearerAuth()
@Controller('books')
export class BooksController {
  constructor(
    private readonly store: RecordStoreService,
    private readonly knowledge: KnowledgeService,
  ) {}

  private async book(id: string) {
    return (await this.store.find<Book & Entity>(BOOKS, id)) ?? notFound('Book');
  }

  private chapterRefId(book: Book, n: number) {
    const ref = book.chapters.find((c) => n >= c.startPage && n <= c.endPage) ?? book.chapters[0];
    return ref?.id ?? '';
  }

  @Get(':id/pages/:page')
  @ApiOperation({ summary: 'One page of a book (Markdown + LaTeX)' })
  async page(@Param('id') id: string, @Param('page', ParseIntPipe) n: number) {
    const book = await this.book(id);
    const page = Math.min(Math.max(1, n), Math.max(1, book.pageCount));
    const stored = await this.knowledge.page(id, page);
    if (stored)
      return {
        id: stored.id,
        bookId: id,
        pageNumber: page,
        chapterRefId: this.chapterRefId(book, page),
        heading: stored.heading || undefined,
        body: stored.body,
        source: 'book' as const,
      };
    const chapterIds = book.chapters.map((c) => c.chapterId).filter(Boolean) as string[];
    const topics = chapterIds.length
      ? await this.store.all<Topic & Entity>(TOPICS, 'all', { filters: { chapterId: chapterIds } })
      : [];
    topics.sort((a, b) => a.order - b.order);
    const p = bookPage(book, topics, page);
    return {
      id: `${id}-p${page}`,
      bookId: id,
      pageNumber: page,
      chapterRefId: this.chapterRefId(book, page),
      heading: p.heading,
      body: p.body,
      source: 'outline' as const,
    };
  }

  @Get(':id/search')
  @ApiOperation({ summary: 'Pages of a book containing the text' })
  async search(@Param('id') id: string, @Query('q') q = '') {
    await this.book(id);
    const needle = q.trim().toLocaleLowerCase();
    if (!needle) return [];
    const pages = await this.knowledge.pages(id);
    return pages
      .filter((p) => `${p.heading}\n${p.body}`.toLocaleLowerCase().includes(needle))
      .slice(0, 30)
      .map((p) => ({ page: p.pageNumber, heading: p.heading || undefined }));
  }
}
