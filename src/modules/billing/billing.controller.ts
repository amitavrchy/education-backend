import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { hasAnyPermission } from '../../common/auth/permissions.js';
import { CurrentUser, Public, RequirePermissions } from '../../common/decorators/index.js';
import { notFound } from '../../common/exceptions/app.exception.js';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface.js';
import { zparse } from '../../common/utils/zod.util.js';
import { BillingService } from './billing.service.js';
import { UsageService } from './usage.service.js';

const planCode = z.enum(['free', 'pro', 'family', 'institution']);
const cycle = z.enum(['monthly', 'yearly']);

const quoteBody = z.object({
  planCode,
  cycle: cycle.default('monthly'),
  couponCode: z.string().max(60).optional(),
});
const checkoutBody = z.object({
  planCode,
  cycle,
  method: z.enum(['bkash_mock', 'nagad_mock', 'card_mock', 'bank_mock']),
  account: z.string().min(4).max(40),
  couponCode: z.string().max(60).optional(),
  startTrial: z.boolean().optional(),
});
const reasonBody = z.object({ reason: z.string().max(1000).default('') });
const refundBody = z.object({
  paymentId: z.string().min(1).max(160),
  reason: z.string().min(1).max(1000),
});
const decideBody = z.object({ approve: z.boolean() });
const consumeBody = z.object({
  kind: z.enum(['ai', 'voice', 'photo', 'handwriting']),
  amount: z.number().int().min(1).max(120).default(1),
});

@ApiTags('billing')
@ApiBearerAuth()
@Controller()
export class BillingController {
  constructor(
    private readonly billing: BillingService,
    private readonly usage: UsageService,
  ) {}

  @Get('billing/me')
  @ApiOperation({ summary: 'My subscription, payments, refunds and usage' })
  me(@CurrentUser('id') userId: string) {
    return this.billing.overview(userId);
  }

  @Public()
  @Post('billing/quote')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Price a plan with an optional coupon (validates the coupon)' })
  quote(@Body() body: unknown) {
    const dto = zparse(quoteBody, body);
    return this.billing.quote(dto.couponCode, dto.planCode, dto.cycle);
  }

  @Post('billing/checkout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Pay for / start a trial of a plan → Payment' })
  checkout(@Body() body: unknown, @CurrentUser() user: AuthenticatedUser) {
    return this.billing.checkout(user, zparse(checkoutBody, body));
  }

  @Post('billing/payments/:id/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirm a pending wallet payment (mock gateway callback)' })
  confirm(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.billing.confirmPending(user, id);
  }

  @Post('billing/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(@Body() body: unknown, @CurrentUser('id') userId: string) {
    return this.billing.cancel(userId, zparse(reasonBody, body ?? {}).reason);
  }

  @Post('billing/resume')
  @HttpCode(HttpStatus.OK)
  resume(@CurrentUser('id') userId: string) {
    return this.billing.resume(userId);
  }

  @Post('billing/downgrade')
  @HttpCode(HttpStatus.NO_CONTENT)
  downgrade(@CurrentUser('id') userId: string) {
    return this.billing.downgradeToFree(userId);
  }

  @Post('billing/refunds')
  @ApiOperation({ summary: 'Request a refund for one of my payments' })
  refund(@Body() body: unknown, @CurrentUser() user: AuthenticatedUser) {
    const dto = zparse(refundBody, body);
    return this.billing.requestRefund(user, dto.paymentId, dto.reason);
  }

  @Post('billing/refunds/:id/decide')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('billing.manage')
  decide(@Param('id') id: string, @Body() body: unknown, @CurrentUser() user: AuthenticatedUser) {
    return this.billing.decideRefund(user, id, zparse(decideBody, body).approve);
  }

  @Get('usage/:userId')
  @ApiOperation({ summary: 'Plan limits and current usage' })
  getUsage(@Param('userId') userId: string, @CurrentUser() user: AuthenticatedUser) {
    if (user.id !== userId && !hasAnyPermission(user.permissions, ['users.view', 'billing.view']))
      notFound();
    return this.usage.get(userId);
  }

  @Post('usage/:userId/consume')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Count usage of an on-device feature against the plan quota (QUOTA_EXCEEDED when over)',
  })
  consume(
    @Param('userId') userId: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (user.id !== userId) notFound();
    const dto = zparse(consumeBody, body);
    return this.usage.consume(userId, dto.kind, dto.amount);
  }
}
