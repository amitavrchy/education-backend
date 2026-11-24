import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { UploadedFileLike } from '../../common/pipes/file-validation.pipe.js';
import { PrismaService } from '../../database/prisma/prisma.service.js';
import type { FileCategory, FileVisibility } from '../../generated/prisma/client.js';
import {
  DOMAIN_EVENTS,
  type FileUploadedEvent,
} from '../../infrastructure/events/domain-events.js';
import {
  buildStorageKey,
  type StorageFolder,
} from '../../infrastructure/storage/storage-key.util.js';
import {
  STORAGE_PROVIDER,
  type StorageProvider,
} from '../../infrastructure/storage/storage.interface.js';

const FOLDER_BY_CATEGORY: Record<FileCategory, StorageFolder> = {
  BOOK: 'books',
  PDF: 'pdfs',
  IMAGE: 'images',
  NOTE: 'notes',
  VIDEO: 'videos',
  ANSWER_SHEET: 'answer-sheets',
  OTHER: 'misc',
};

/**
 * Stores an already-validated file (see FileValidationPipe) in object storage and records
 * its metadata. Controllers for upload/download are added per feature, with access checks.
 */
@Injectable()
export class UploadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  async store(
    file: UploadedFileLike & { buffer: Buffer },
    options: {
      category: FileCategory;
      uploadedById: string;
      institutionId?: string | null;
      visibility?: FileVisibility;
    },
  ) {
    const key = buildStorageKey({
      folder: FOLDER_BY_CATEGORY[options.category],
      originalName: file.originalname,
      institutionId: options.institutionId,
    });
    const stored = await this.storage.put({
      key,
      body: file.buffer,
      contentType: file.mimetype,
      contentLength: file.size,
    });

    const record = await this.prisma.storedFile.create({
      data: {
        storageProvider: stored.provider,
        bucket: stored.bucket,
        key: stored.key,
        originalName: file.originalname.slice(0, 255),
        mimeType: file.mimetype,
        sizeBytes: BigInt(file.size),
        checksumSha256: createHash('sha256').update(file.buffer).digest('hex'),
        category: options.category,
        visibility: options.visibility ?? 'PRIVATE',
        uploadedById: options.uploadedById,
        institutionId: options.institutionId ?? null,
      },
    });

    const event: FileUploadedEvent = {
      fileId: record.id,
      uploadedById: record.uploadedById,
      mimeType: record.mimeType,
    };
    this.events.emit(DOMAIN_EVENTS.FILE_UPLOADED, event);
    return record;
  }

  /** Readable stream for a stored object (callers check access first). */
  open(key: string) {
    return this.storage.getStream(key);
  }
}
