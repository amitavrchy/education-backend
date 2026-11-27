import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module.js';
import { UploadsModule } from '../uploads/uploads.module.js';
import { DocumentProcessingService } from './document-processing.service.js';
import { DocumentTextController } from './document-text.controller.js';
import { DocumentTextService } from './document-text.service.js';
import { IngestionController } from './ingestion.controller.js';
import { IngestionService } from './ingestion.service.js';
import { PdfProcessingProcessor } from './processors/pdf-processing.processor.js';

@Module({
  imports: [UploadsModule, BillingModule],
  controllers: [IngestionController, DocumentTextController],
  providers: [
    DocumentProcessingService,
    DocumentTextService,
    IngestionService,
    PdfProcessingProcessor,
  ],
  exports: [DocumentProcessingService, DocumentTextService, IngestionService],
})
export class DocumentProcessingModule {}
