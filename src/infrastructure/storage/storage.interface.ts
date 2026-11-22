import type { Readable } from 'node:stream';

export const STORAGE_PROVIDER = Symbol('STORAGE_PROVIDER');

export interface PutObjectInput {
  key: string;
  body: Buffer | Readable;
  contentType: string;
  contentLength?: number;
  metadata?: Record<string, string>;
}

export interface StoredObject {
  provider: string;
  bucket: string;
  key: string;
  sizeBytes?: number;
}

/**
 * Object storage contract. Implementations: local disk (development) and S3-compatible
 * (AWS S3, Cloudflare R2, MinIO, DigitalOcean Spaces). Only keys and metadata go to PostgreSQL.
 */
export interface StorageProvider {
  readonly name: string;
  put(input: PutObjectInput): Promise<StoredObject>;
  getStream(key: string): Promise<Readable>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  /** Time-limited URL for direct download/upload by clients. */
  getSignedUrl(
    key: string,
    options?: { expiresInSeconds?: number; method?: 'GET' | 'PUT' },
  ): Promise<string>;
}
