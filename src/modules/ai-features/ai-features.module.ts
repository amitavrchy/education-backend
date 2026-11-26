import { Module } from '@nestjs/common';
import { AiFeaturesController } from './ai-features.controller.js';
import { AiFeaturesService } from './ai-features.service.js';

@Module({ controllers: [AiFeaturesController], providers: [AiFeaturesService] })
export class AiFeaturesModule {}
