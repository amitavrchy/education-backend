import { Global, Module } from '@nestjs/common';
import { storageConfig, type StorageConfig } from '../../config/index.js';
import { LocalStorageProvider } from '../../integrations/file-storage/local-storage.provider.js';
import { S3StorageProvider } from '../../integrations/file-storage/s3-storage.provider.js';
import { STORAGE_PROVIDER, type StorageProvider } from './storage.interface.js';

/** Inject with `@Inject(STORAGE_PROVIDER) storage: StorageProvider`. */
@Global()
@Module({
  providers: [
    {
      provide: STORAGE_PROVIDER,
      inject: [storageConfig.KEY],
      useFactory: (config: StorageConfig): StorageProvider =>
        config.provider === 's3' ? new S3StorageProvider(config) : new LocalStorageProvider(config),
    },
  ],
  exports: [STORAGE_PROVIDER],
})
export class StorageModule {}
