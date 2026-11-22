import {
  HttpStatus,
  Injectable,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
  type PipeTransform,
} from '@nestjs/common';
import { ALLOWED_MIME_TYPES, type UploadCategory } from '../constants/upload.constants.js';
import { AppException } from '../exceptions/app.exception.js';

/** Minimal shape of a Multer file, so this pipe doesn't depend on @types/multer. */
export interface UploadedFileLike {
  originalname: string;
  mimetype: string;
  size: number;
  buffer?: Buffer;
}

const MAGIC_BYTES: Record<string, number[]> = {
  'application/pdf': [0x25, 0x50, 0x44, 0x46], // %PDF
  'image/png': [0x89, 0x50, 0x4e, 0x47],
  'image/jpeg': [0xff, 0xd8, 0xff],
};

/**
 * Validates an uploaded file: presence, size limit, declared MIME type,
 * and (when the buffer is available) the file signature, so a renamed .exe is rejected.
 */
@Injectable()
export class FileValidationPipe implements PipeTransform<
  UploadedFileLike | undefined,
  UploadedFileLike
> {
  constructor(
    private readonly category: UploadCategory,
    private readonly maxSizeBytes: number,
  ) {}

  transform(file: UploadedFileLike | undefined): UploadedFileLike {
    if (!file)
      throw new AppException('FILE_REQUIRED', 'A file is required', HttpStatus.BAD_REQUEST);

    if (file.size > this.maxSizeBytes) {
      throw new PayloadTooLargeException(
        `File exceeds the ${Math.round(this.maxSizeBytes / 1024 / 1024)} MB limit`,
      );
    }

    const allowed: readonly string[] = ALLOWED_MIME_TYPES[this.category];
    if (!allowed.includes(file.mimetype)) {
      throw new UnsupportedMediaTypeException(`Allowed file types: ${allowed.join(', ')}`);
    }

    const signature = MAGIC_BYTES[file.mimetype];
    if (
      signature &&
      file.buffer &&
      !signature.every((byte, index) => file.buffer![index] === byte)
    ) {
      throw new UnsupportedMediaTypeException('File content does not match its declared type');
    }

    return file;
  }
}
