import { createReadStream, createWriteStream } from 'node:fs';
import { access, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { NotImplementedException } from '@nestjs/common';
import type { StorageConfig } from '../../config/index.js';
import type {
  PutObjectInput,
  StorageProvider,
  StoredObject,
} from '../../infrastructure/storage/storage.interface.js';

/** Development storage on the local disk (STORAGE_LOCAL_PATH). Not for production. */
export class LocalStorageProvider implements StorageProvider {
  readonly name = 'local';
  private readonly root: string;

  constructor(private readonly config: StorageConfig) {
    this.root = resolve(config.localPath, config.bucket);
  }

  /** Resolve a key inside the root and refuse anything that escapes it. */
  private pathFor(key: string): string {
    const fullPath = resolve(this.root, key);
    if (!fullPath.startsWith(this.root + sep)) {
      throw new Error(`Invalid storage key: ${key}`);
    }
    return fullPath;
  }

  async put(input: PutObjectInput): Promise<StoredObject> {
    const path = this.pathFor(input.key);
    await mkdir(dirname(path), { recursive: true });
    const source = Buffer.isBuffer(input.body) ? Readable.from(input.body) : input.body;
    await pipeline(source, createWriteStream(path));
    return {
      provider: this.name,
      bucket: this.config.bucket,
      key: input.key,
      sizeBytes: input.contentLength,
    };
  }

  async getStream(key: string): Promise<Readable> {
    const path = this.pathFor(key);
    await access(path);
    return createReadStream(path);
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }

  async exists(key: string): Promise<boolean> {
    try {
      await access(this.pathFor(key));
      return true;
    } catch {
      return false;
    }
  }

  getSignedUrl(): Promise<string> {
    // Local files are served through an authorized download endpoint instead (uploads module).
    throw new NotImplementedException('Signed URLs are not available for local storage');
  }
}
