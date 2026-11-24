import { Module } from '@nestjs/common';
import { UploadsModule } from '../uploads/uploads.module.js';
import { DocumentProcessingService } from './document-processing.service.js';
import { IngestionController } from './ingestion.controller.js';
import { IngestionService } from './ingestion.service.js';
import { PdfProcessingProcessor } from './processors/pdf-processing.processor.js';

@Module({
  imports: [UploadsModule],
  controllers: [IngestionController],
  providers: [DocumentProcessingService, IngestionService, PdfProcessingProcessor],
  exports: [DocumentProcessingService, IngestionService],
})
export class DocumentProcessingModule {}
