import { Global, Module } from '@nestjs/common';
import { DocumentsController } from './documents.controller.js';
import { RecordStoreService } from './record-store.service.js';
import { RecordsController } from './records.controller.js';
import { ResourcesService } from './resources.service.js';

/**
 * The contract store and the generic REST adapter. Import this module LAST in DomainModule:
 * its catch-all routes (/:resource/...) must be registered after the dedicated controllers.
 */
@Global()
@Module({
  controllers: [DocumentsController, RecordsController],
  providers: [RecordStoreService, ResourcesService],
  exports: [RecordStoreService, ResourcesService],
})
export class RecordsModule {}
