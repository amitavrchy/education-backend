import { Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../common/decorators/index.js';
import { notFound } from '../../common/exceptions/app.exception.js';
import { KnowledgeService } from './knowledge.service.js';

@ApiTags('knowledge-base')
@ApiBearerAuth()
@Controller('kb')
export class KbController {
  constructor(private readonly knowledge: KnowledgeService) {}

  @Post('collections/:id/reindex')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('kb.manage')
  @ApiOperation({ summary: "Re-embed a collection's passages (runs in the background)" })
  async reindex(@Param('id') id: string) {
    return (await this.knowledge.reindexCollection(id)) ?? notFound('KbCollection');
  }
}
