import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermissions } from '../../common/decorators/index.js';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface.js';
import { PrismaService } from '../../database/prisma/prisma.service.js';
import { asText } from '../../common/utils/json.util.js';
import { AccessPolicyService } from '../access/access-policy.service.js';

type Row = Record<string, unknown> & { studentId: string };

/**
 * Cross-student lists for staff screens (per-student collections otherwise need one request per
 * student): the teacher's answer-script queue and an exam's results. Rows carry `studentId`.
 */
@ApiTags('staff')
@ApiBearerAuth()
@Controller('staff')
export class StaffController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessPolicyService,
  ) {}

  private async rows(user: AuthenticatedUser, collection: string): Promise<Row[]> {
    const ids = await this.access.accessibleStudentIds(user, 'scores');
    const rows = await this.prisma.record.findMany({
      where: { collection, ...(ids === 'all' ? { NOT: { scope: '' } } : { scope: { in: ids } }) },
      select: { scope: true, data: true },
      take: 5000,
    });
    return rows.map((r) => ({ ...(r.data as Record<string, unknown>), studentId: r.scope }));
  }

  @Get('evaluations')
  @RequirePermissions('evaluation.review')
  @ApiOperation({
    summary: 'Answer scripts of the students this reviewer may see (optional ?stage=)',
  })
  async evaluations(@CurrentUser() user: AuthenticatedUser, @Query('stage') stage?: string) {
    const list = await this.rows(user, 'evaluations');
    return list
      .filter((e) => !stage || e.stage === stage)
      .sort((a, b) => asText(b.createdAt).localeCompare(asText(a.createdAt)));
  }

  @Get('exam-attempts')
  @RequirePermissions('exams.manage', 'exam.create')
  @ApiOperation({ summary: 'Finished attempts of one exam across students (?examId=)' })
  async examAttempts(@CurrentUser() user: AuthenticatedUser, @Query('examId') examId?: string) {
    const list = await this.rows(user, 'examAttempts');
    return list.filter((a) => a.result && (!examId || a.examId === examId));
  }
}
