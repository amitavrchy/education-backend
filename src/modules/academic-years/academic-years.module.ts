import { Module } from '@nestjs/common';
import { AcademicYearsService } from './academic-years.service.js';

@Module({
  providers: [AcademicYearsService],
  exports: [AcademicYearsService],
})
export class AcademicYearsModule {}
