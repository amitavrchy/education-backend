import type { Readable } from 'node:stream';
import { NotImplementedException } from '@nestjs/common';
import type { StorageConfig } from '../../config/index.js';
import type {
  PutObjectInput,
  StorageProvider,
  StoredObject,
} from '../../infrastructure/storage/storage.interface.js';

/**
 * S3-compatible storage (AWS S3, Cloudflare R2, MinIO, DigitalOcean Spaces).
 * Placeholder: install `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`
 * and implement these methods when cloud storage is needed.
 */
export class S3StorageProvider implements StorageProvider {
  readonly name = 's3';

  constructor(private readonly config: StorageConfig) {}

  private notImplemented(): never {
    throw new NotImplementedException(
      `S3 storage (bucket "${this.config.bucket}") is not implemented yet; use STORAGE_PROVIDER=local`,
    );
  }

  put(_input: PutObjectInput): Promise<StoredObject> {
    this.notImplemented();
  }
  getStream(_key: string): Promise<Readable> {
    this.notImplemented();
  }
  delete(_key: string): Promise<void> {
    this.notImplemented();
  }
  exists(_key: string): Promise<boolean> {
    this.notImplemented();
  }
  getSignedUrl(_key: string): Promise<string> {
    this.notImplemented();
  }
}
