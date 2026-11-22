import { Global, Module, ServiceUnavailableException } from '@nestjs/common';
import { OCR_PROVIDER, type OcrPage, type OcrProvider } from './ocr.interfaces.js';

class DisabledOcrProvider implements OcrProvider {
  readonly name = 'none';
  recognize(): Promise<OcrPage[]> {
    return Promise.reject(new ServiceUnavailableException('OCR is not configured'));
  }
}

/** OCR boundary (future: Tesseract with Bangla data, or a cloud OCR adapter). */
@Global()
@Module({
  providers: [{ provide: OCR_PROVIDER, useClass: DisabledOcrProvider }],
  exports: [OCR_PROVIDER],
})
export class OcrServicesModule {}
