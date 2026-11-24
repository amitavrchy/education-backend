import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Public } from '../../common/decorators/index.js';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface.js';
import { SearchService, type SearchKind } from './search.service.js';

@ApiTags('search')
@Controller('search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Search everything the caller may see (?q=&kinds=chapter,question)' })
  find(
    @Query('q') q = '',
    @Query('kinds') kinds?: string,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.search.search(
      user,
      String(q),
      kinds ? (String(kinds).split(',') as SearchKind[]) : undefined,
    );
  }
}
