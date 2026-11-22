import { Module } from '@nestjs/common';
import { DocumentProcessingService } from './document-processing.service.js';
import { PdfProcessingProcessor } from './processors/pdf-processing.processor.js';

@Module({
  providers: [DocumentProcessingService, PdfProcessingProcessor],
  exports: [DocumentProcessingService],
})
export class DocumentProcessingModule {}
