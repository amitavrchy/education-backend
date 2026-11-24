import { Inject, Injectable } from '@nestjs/common';
import { forbidden, invalid, notFound } from '../../common/exceptions/app.exception.js';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface.js';
import { daysFromNow, nowIso } from '../../common/utils/dates.js';
import type {
  Coupon,
  Payment,
  Plan,
  PlanCode,
  RefundRequest,
  Subscription,
} from '../../contracts/operations.js';
import type { UserAccount } from '../../contracts/people.js';
import { integrationsConfig, type IntegrationsConfig } from '../../config/index.js';
import { AuditLogsService } from '../audit-logs/audit-logs.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { RecordStoreService, type Entity } from '../records/record-store.service.js';
import { UsageService } from './usage.service.js';

const ref = (collection: string) => ({ collection, scope: '' });
const USERS = ref('users');
const PLANS = ref('plans');
const SUBS = ref('subscriptions');
const PAYMENTS = ref('payments');
const COUPONS = ref('coupons');
const REFUNDS = ref('refunds');
const OWNED = { ownerField: 'userId' };

export interface CheckoutInput {
  planCode: PlanCode;
  cycle: 'monthly' | 'yearly';
  method: Payment['method'];
  account: string;
  couponCode?: string;
  startTrial?: boolean;
}

export function priceWithCoupon(
  base: number,
  coupon?: Pick<Coupon, 'percentOff' | 'amountOff'> | null,
) {
  if (!coupon) return { total: base, discount: 0 };
  const discount = coupon.percentOff
    ? Math.round((base * coupon.percentOff) / 100)
    : Math.min(base, coupon.amountOff ?? 0);
  return { total: Math.max(0, base - discount), discount };
}

/**
 * Subscriptions, payments, coupons and refunds (frontend billingService). Prices are computed
 * here, never taken from the client. PAYMENT_PROVIDER=mock reproduces the frontend's demo
 * gateway outcomes (card …0002 fails, wallet numbers ending in 9 stay pending); real gateways
 * (bKash, Nagad, SSLCommerz) plug in behind the same flow with webhook confirmation.
 */
@Injectable()
export class BillingService {
  constructor(
    private readonly store: RecordStoreService,
    private readonly usage: UsageService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditLogsService,
    @Inject(integrationsConfig.KEY) private readonly config: IntegrationsConfig,
  ) {}

  private async account(userId: string) {
    return (await this.store.find<UserAccount & Entity>(USERS, userId)) ?? notFound('User');
  }

  private async activeSubscription(userId: string) {
    const subs = await this.store.all<Subscription & Entity>(SUBS, [{ userId: [userId] }], {
      sortBy: 'startedAt',
      sortOrder: 'desc',
    });
    return subs.find((s) => s.status !== 'cancelled') ?? null;
  }

  private async setPlan(userId: string, planCode: PlanCode) {
    const account = await this.account(userId);
    await this.store.replace(
      USERS,
      { ...account, planCode, updatedAt: nowIso() },
      { institutionField: 'institutionId' },
    );
  }

  async overview(userId: string) {
    const [subscription, payments, refunds, usage] = await Promise.all([
      this.activeSubscription(userId),
      this.store.all<Payment & Entity>(PAYMENTS, [{ userId: [userId] }], {
        sortBy: 'createdAt',
        sortOrder: 'desc',
      }),
      this.store.all<RefundRequest & Entity>(REFUNDS, [{ userId: [userId] }]),
      this.usage.get(userId),
    ]);
    return { subscription, payments, refunds, usage };
  }

  async validateCoupon(code: string, planCode: PlanCode): Promise<Coupon> {
    const coupons = await this.store.all<Coupon & Entity>(COUPONS);
    const c = coupons.find((x) => x.code.toLowerCase() === code.trim().toLowerCase());
    if (!c || !c.active || new Date(c.validUntil).getTime() < Date.now()) invalid('COUPON_INVALID');
    if (!c.planCodes.includes(planCode)) invalid('COUPON_NOT_APPLICABLE');
    if (c.redeemed >= c.maxRedemptions) invalid('COUPON_EXHAUSTED');
    return c;
  }

  async quote(code: string | undefined, planCode: PlanCode, cycle: 'monthly' | 'yearly') {
    const plan = await this.plan(planCode);
    const coupon = code ? await this.validateCoupon(code, planCode) : null;
    const base = cycle === 'yearly' ? plan.priceYearly : plan.priceMonthly;
    const { total, discount } = priceWithCoupon(base, coupon);
    return {
      planCode,
      cycle,
      base,
      discount,
      total,
      coupon: coupon
        ? {
            code: coupon.code,
            description: coupon.description,
            percentOff: coupon.percentOff,
            amountOff: coupon.amountOff,
          }
        : null,
    };
  }

  private async plan(code: PlanCode): Promise<Plan> {
    const [plan] = await this.store.all<Plan & Entity>(PLANS, [{ code: [code] }]);
    if (!plan || !plan.active) invalid('PLAN_UNAVAILABLE');
    return plan;
  }

  /** Simulated gateway decision (mock provider only). */
  private gatewayOutcome(input: CheckoutInput): Payment['status'] {
    const digits = input.account.replace(/\D/g, '');
    if (input.method === 'card_mock' && digits.endsWith('0002')) return 'failed';
    if ((input.method === 'bkash_mock' || input.method === 'nagad_mock') && digits.endsWith('9'))
      return 'pending';
    return 'success';
  }

  async checkout(user: AuthenticatedUser, input: CheckoutInput) {
    if (this.config.payment.provider !== 'mock' && !input.startTrial)
      invalid('PAYMENTS_UNAVAILABLE', undefined, 503);
    const account = await this.account(user.id);
    const plan = await this.plan(input.planCode);
    if (input.planCode === 'free') invalid('PLAN_UNAVAILABLE');
    const coupon = input.couponCode
      ? await this.validateCoupon(input.couponCode, input.planCode)
      : null;
    const base = input.cycle === 'yearly' ? plan.priceYearly : plan.priceMonthly;
    const { total } = priceWithCoupon(base, coupon);

    if (input.startTrial) {
      if (!plan.trialDays) invalid('TRIAL_UNAVAILABLE');
      const history = await this.store.all<Subscription & Entity>(SUBS, [{ userId: [user.id] }]);
      if (history.some((s) => s.trialEndsAt)) invalid('TRIAL_ALREADY_USED');
    }
    const status: Payment['status'] = input.startTrial ? 'success' : this.gatewayOutcome(input);
    const payment: Payment = {
      id: RecordStoreService.newId('pay'),
      userId: user.id,
      userName: account.name,
      planCode: input.planCode,
      amount: input.startTrial ? 0 : total,
      method: input.method,
      status,
      invoiceNo: `INV-${new Date().getFullYear()}-${Date.now().toString().slice(-7)}`,
      createdAt: nowIso(),
      failureReason: status === 'failed' ? 'কার্ড প্রত্যাখ্যাত (ডেমো টেস্ট কার্ড ...0002)' : undefined,
    };
    if (status !== 'failed') {
      const existing = await this.activeSubscription(user.id);
      const patch: Partial<Subscription> = {
        planCode: input.planCode,
        cycle: input.cycle,
        amount: total,
        status: status === 'pending' ? 'pending_payment' : input.startTrial ? 'trialing' : 'active',
        renewsAt: daysFromNow(
          input.startTrial ? plan.trialDays : input.cycle === 'yearly' ? 365 : 30,
        ),
        trialEndsAt: input.startTrial ? daysFromNow(plan.trialDays) : undefined,
        couponCode: coupon?.code,
        cancelAt: undefined,
        updatedAt: nowIso(),
      };
      let sub: Subscription;
      if (existing) {
        sub = { ...existing, ...patch };
        await this.store.replace(SUBS, sub as Subscription & Entity, OWNED);
      } else {
        sub = {
          id: RecordStoreService.newId('sub'),
          userId: user.id,
          userName: account.name,
          startedAt: nowIso(),
          createdAt: nowIso(),
          ...patch,
        } as Subscription;
        await this.store.insert(SUBS, sub as Subscription & Entity, OWNED);
      }
      payment.subscriptionId = sub.id;
      if (status === 'success') await this.setPlan(user.id, input.planCode);
      if (coupon)
        await this.store.replace(COUPONS, {
          ...coupon,
          redeemed: coupon.redeemed + 1,
          updatedAt: nowIso(),
        });
    }
    await this.store.insert(PAYMENTS, payment as Payment & Entity, OWNED);
    await this.notifications.push([user.id], {
      type: 'payment',
      title:
        status === 'success'
          ? 'পেমেন্ট সফল'
          : status === 'pending'
            ? 'পেমেন্ট অপেক্ষমাণ'
            : 'পেমেন্ট ব্যর্থ',
      body: `${plan.name.bn} · ৳${payment.amount} · ${payment.invoiceNo}`,
      href: '/student/subscription',
      priority: status === 'failed' ? 'high' : 'normal',
    });
    return payment;
  }

  /** Gateway callback for a pending wallet payment (mock provider: the payer confirms). */
  async confirmPending(user: AuthenticatedUser, paymentId: string) {
    if (this.config.payment.provider !== 'mock') invalid('PAYMENTS_UNAVAILABLE', undefined, 503);
    const p = await this.store.find<Payment & Entity>(PAYMENTS, paymentId);
    if (!p || p.userId !== user.id) notFound('Payment');
    if (p.status !== 'pending') invalid('PAYMENT_NOT_PENDING', undefined, 409);
    const updated = { ...p, status: 'success' as const };
    await this.store.replace(PAYMENTS, updated, OWNED);
    const sub = (
      await this.store.all<Subscription & Entity>(SUBS, [
        { userId: [p.userId], status: ['pending_payment'] },
      ])
    )[0];
    if (sub)
      await this.store.replace(SUBS, { ...sub, status: 'active', updatedAt: nowIso() }, OWNED);
    await this.setPlan(p.userId, p.planCode);
    return updated;
  }

  async cancel(userId: string, reason: string) {
    const sub = await this.activeSubscription(userId);
    if (!sub) invalid('NO_SUBSCRIPTION');
    const next = { ...sub, cancelAt: sub.renewsAt, updatedAt: nowIso() };
    await this.store.replace(SUBS, next, OWNED);
    await this.audit.record({
      actor: { id: userId, role: 'user' },
      category: 'billing',
      action: 'subscription.cancel',
      target: { type: 'Subscription', id: sub.id, label: sub.planCode },
      details: reason.slice(0, 200),
    });
    return next;
  }

  async resume(userId: string) {
    const sub = await this.activeSubscription(userId);
    if (!sub) invalid('NO_SUBSCRIPTION');
    const { cancelAt: _drop, ...rest } = sub;
    const next = { ...rest, updatedAt: nowIso() } as Subscription & Entity;
    await this.store.replace(SUBS, next, OWNED);
    return next;
  }

  async downgradeToFree(userId: string) {
    const sub = await this.activeSubscription(userId);
    if (sub)
      await this.store.replace(
        SUBS,
        { ...sub, status: 'cancelled', cancelAt: nowIso(), updatedAt: nowIso() },
        OWNED,
      );
    await this.setPlan(userId, 'free');
  }

  async requestRefund(user: AuthenticatedUser, paymentId: string, reason: string) {
    const p = await this.store.find<Payment & Entity>(PAYMENTS, paymentId);
    if (!p || p.userId !== user.id) notFound('Payment');
    if (p.status !== 'success' || p.amount <= 0) invalid('REFUND_NOT_ELIGIBLE');
    const existing = await this.store.all<RefundRequest & Entity>(REFUNDS, [
      { paymentId: [paymentId] },
    ]);
    if (existing.some((r) => r.status !== 'rejected')) invalid('REFUND_EXISTS');
    const refund: RefundRequest = {
      id: RecordStoreService.newId('rf'),
      paymentId,
      userId: user.id,
      userName: p.userName,
      amount: p.amount,
      reason: reason.slice(0, 1000),
      status: 'requested',
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    await this.store.insert(REFUNDS, refund as RefundRequest & Entity, OWNED);
    await this.notifications.pushToPortal(
      'admin',
      {
        type: 'payment',
        title: 'নতুন রিফান্ড অনুরোধ',
        body: `${p.userName} · ৳${p.amount}`,
        href: '/admin/subscriptions',
        priority: 'normal',
      },
      { roles: ['support', 'platform_admin', 'super_admin'] },
    );
    return refund;
  }

  /** Admin decision on a refund; approval marks the payment refunded. */
  async decideRefund(admin: AuthenticatedUser, refundId: string, approve: boolean) {
    if (!admin.permissions.includes('billing.manage')) forbidden();
    const refund =
      (await this.store.find<RefundRequest & Entity>(REFUNDS, refundId)) ?? notFound('Refund');
    if (refund.status !== 'requested') invalid('INVALID_TRANSITION');
    const next = {
      ...refund,
      status: approve ? ('processed' as const) : ('rejected' as const),
      updatedAt: nowIso(),
    };
    await this.store.replace(REFUNDS, next, OWNED);
    if (approve) {
      const p = await this.store.find<Payment & Entity>(PAYMENTS, refund.paymentId);
      if (p) await this.store.replace(PAYMENTS, { ...p, status: 'refunded' }, OWNED);
    }
    await this.notifications.push([refund.userId], {
      type: 'payment',
      title: approve ? 'রিফান্ড অনুমোদিত' : 'রিফান্ড প্রত্যাখ্যাত',
      body: `৳${refund.amount}`,
      href: '/student/subscription',
      priority: 'normal',
    });
    await this.audit.record({
      actor: admin,
      category: 'billing',
      action: approve ? 'refund.approve' : 'refund.reject',
      target: { type: 'Refund', id: refund.id, label: refund.userName },
    });
    return next;
  }
}
