import { Module } from '@nestjs/common';
import { AiFeaturesController } from './ai-features.controller.js';
import { AiFeaturesService } from './ai-features.service.js';
import { StudyAiService } from './study-ai.service.js';

@Module({ controllers: [AiFeaturesController], providers: [AiFeaturesService, StudyAiService] })
export class AiFeaturesModule {}
