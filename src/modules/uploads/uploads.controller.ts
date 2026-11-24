import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { hasAnyPermission } from '../../common/auth/permissions.js';
import { CurrentUser, RawResponse } from '../../common/decorators/index.js';
import { notFound } from '../../common/exceptions/app.exception.js';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface.js';
import {
  FileValidationPipe,
  type UploadedFileLike,
} from '../../common/pipes/file-validation.pipe.js';
import { PrismaService } from '../../database/prisma/prisma.service.js';
import { UploadsService } from './uploads.service.js';

const MAX = 10 * 1024 * 1024;

/**
 * Generic uploads for answer sheets, photo-solver images and assignment files (≤10 MB,
 * PDF/JPEG/PNG/WebP, signature-checked). Files are private to the uploader, their
 * institution's staff (institution visibility) and platform staff with users.view.
 */
@ApiTags('uploads')
@ApiBearerAuth()
@Controller('uploads')
export class UploadsController {
  constructor(
    private readonly uploads: UploadsService,
    private readonly prisma: PrismaService,
  ) {}

  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX } }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload a file → { id, name, mimeType, size, url }' })
  async upload(
    @UploadedFile(new FileValidationPipe('answerSheet', MAX))
    file: UploadedFileLike & { buffer: Buffer },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const category = file.mimetype === 'application/pdf' ? 'PDF' : 'IMAGE';
    const stored = await this.uploads.store(file, {
      category,
      uploadedById: user.id,
      institutionId: user.institutionId,
      visibility: user.institutionId ? 'INSTITUTION' : 'PRIVATE',
    });
    return {
      id: stored.id,
      name: stored.originalName,
      mimeType: stored.mimeType,
      size: Number(stored.sizeBytes),
      url: `/uploads/${stored.id}`,
    };
  }

  @Get(':id')
  @RawResponse()
  @ApiOperation({ summary: 'Download a file you may access' })
  async download(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const file = await this.prisma.storedFile.findFirst({ where: { id, deletedAt: null } });
    const allowed =
      !!file &&
      (file.uploadedById === user.id ||
        file.visibility === 'PUBLIC' ||
        (file.visibility === 'INSTITUTION' &&
          !!user.institutionId &&
          file.institutionId === user.institutionId &&
          hasAnyPermission(user.permissions, ['teacher.dashboard', 'institution.manage'])) ||
        hasAnyPermission(user.permissions, ['users.view', 'kb.manage']));
    if (!file || !allowed) notFound('File');
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader(
      'Content-Disposition',
      `inline; filename*=UTF-8''${encodeURIComponent(file.originalName)}`,
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return new StreamableFile(await this.uploads.open(file.key));
  }
}
