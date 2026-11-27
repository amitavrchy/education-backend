import { Controller, HttpCode, HttpStatus, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { hasAnyPermission } from '../../common/auth/permissions.js';
import { CurrentUser } from '../../common/decorators/index.js';
import { invalid } from '../../common/exceptions/app.exception.js';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface.js';
import { UsageService } from '../billing/usage.service.js';
import { DocumentTextService, documentType } from './document-text.service.js';

const MAX = 20 * 1024 * 1024;

/** Reads the text of an uploaded file (notes upload, question import). Nothing is stored. */
@ApiTags('documents')
@ApiBearerAuth()
@Controller('document-text')
export class DocumentTextController {
  constructor(
    private readonly documents: DocumentTextService,
    private readonly usage: UsageService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX } }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Text of a PDF, photo, Word, Excel or text file → { text, pages, pageCount, failedPages }',
  })
  async read(
    @UploadedFile() file: { originalname: string; mimetype: string; buffer: Buffer } | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!file) return invalid('NO_FILE');
    const type = documentType(file);
    if (!type) return invalid('UNSUPPORTED_FILE', undefined, 415);
    const staff = hasAnyPermission(user.permissions, ['content.create', 'questions.manage', 'kb.manage']);
    if (!staff) await this.usage.consume(user.id, 'ai');
    return this.documents.read(file.buffer, type, staff ? 40 : 15);
  }
}
