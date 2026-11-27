import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CurrentUser, RequirePermissions } from '../../common/decorators/index.js';
import { invalid } from '../../common/exceptions/app.exception.js';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface.js';
import { zparse } from '../../common/utils/zod.util.js';
import { AuditLogsService } from '../audit-logs/audit-logs.service.js';
import { RecordStoreService } from '../records/record-store.service.js';
import { UploadsService } from '../uploads/uploads.service.js';
import { documentType } from './document-text.service.js';
import { IngestionService } from './ingestion.service.js';

const MAX_BYTES = 200 * 1024 * 1024;
const startBody = z.object({
  bookId: z.string().min(1).max(160),
  bookTitle: z.string().min(1).max(300),
  publisher: z.string().trim().max(200).optional(),
  edition: z.string().trim().max(120).optional(),
  licenseType: z.enum(['open_license', 'publisher_license', 'unknown']).optional(),
  licenseHolder: z.string().trim().max(200).optional(),
  licenseNote: z.string().trim().max(500).optional(),
});

@ApiTags('ingestion')
@ApiBearerAuth()
@Controller('ingestion-jobs')
export class IngestionController {
  constructor(
    private readonly ingestion: IngestionService,
    private readonly uploads: UploadsService,
    private readonly store: RecordStoreService,
    private readonly audit: AuditLogsService,
  ) {}

  @Post('upload')
  @RequirePermissions('kb.manage', 'books.manage')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_BYTES } }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload a book or document (PDF, photo, Word, Excel, text) and start its ingestion job',
  })
  async upload(
    @UploadedFile()
    file: { originalname: string; mimetype: string; size: number; buffer: Buffer } | undefined,
    @Body() body: unknown,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!file) invalid('NO_FILE');
    const mimeType = documentType(file);
    if (!mimeType) invalid('UNSUPPORTED_FILE', undefined, 415);
    const dto = zparse(startBody, body);
    const stored = await this.uploads.store({ ...file, mimetype: mimeType }, {
      category: file.mimetype === 'application/pdf' ? 'BOOK' : 'OTHER',
      uploadedById: user.id,
    });
    const job = IngestionService.initialJob({
      id: RecordStoreService.newId('ing'),
      bookId: dto.bookId,
      bookTitle: dto.bookTitle,
      fileName: file.originalname,
      fileSizeKb: Math.round(file.size / 1024),
      fileId: stored.id,
      mimeType,
      bookPatch: {
        ...(dto.publisher ? { publisher: dto.publisher } : {}),
        ...(dto.edition ? { edition: dto.edition } : {}),
        ...(dto.licenseType
          ? {
              provenance: 'licensed_sample' as const,
              license: {
                type: dto.licenseType,
                holder: dto.licenseHolder ?? dto.publisher ?? '',
                downloadAllowed: false,
                printAllowed: false,
                note: dto.licenseNote ?? '',
              },
            }
          : {}),
      },
    });
    await this.store.insert({ collection: 'ingestionJobs', scope: '' }, job);
    await this.audit.record({
      actor: user,
      category: 'content',
      action: 'ingestion.start',
      target: { type: 'IngestionJob', id: job.id, label: file.originalname },
    });
    await this.ingestion.onRequested({ jobId: job.id });
    return job;
  }

  @Post(':id/retry')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('kb.manage', 'books.manage')
  retry(@Param('id') id: string) {
    return this.ingestion.retry(id);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('content.approve', 'content.publish', 'kb.manage')
  approve(@Param('id') id: string) {
    return this.ingestion.approveReview(id);
  }

  @Post(':id/reindex')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('kb.manage')
  reindex(@Param('id') id: string) {
    return this.ingestion.reindex(id);
  }
}
