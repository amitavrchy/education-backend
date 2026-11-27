import { Inject, Injectable } from '@nestjs/common';
import { forbidden, invalid, notFound } from '../../common/exceptions/app.exception.js';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface.js';
import { daysFromNow, nowIso } from '../../common/utils/dates.js';
import { DEFAULT_ROLE_PERMISSIONS } from '../../common/auth/permissions.js';
import type {
  Coupon,
  ManualPaymentMethod,
  Payment,
  PaymentSettings,
  Plan,
  PlanCode,
  RefundRequest,
  Subscription,
} from '../../contracts/operations.js';
import type { UserRole } from '../../contracts/user.js';
import { DocumentsService } from '../records/documents.service.js';
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
  /** Manual wallets: the transaction id from the bKash/Nagad/Rocket/Upay receipt. */
  transactionId?: string;
  couponCode?: string;
  startTrial?: boolean;
}

export const MANUAL_METHODS: ManualPaymentMethod[] = ['bkash', 'nagad', 'rocket', 'upay'];
export const PAYMENT_SETTINGS_KEY = 'paymentSettings';
const METHOD_NAME: Record<ManualPaymentMethod, string> = {
  bkash: 'বিকাশ',
  nagad: 'নগদ',
  rocket: 'রকেট',
  upay: 'উপায়',
};

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
    private readonly documents: DocumentsService,
    @Inject(integrationsConfig.KEY) private readonly config: IntegrationsConfig,
  ) {}

  private get manual() {
    return this.config.payment.provider === 'manual';
  }

  /** Wallet numbers students send money to (only enabled ones with a number). */
  async paymentSettings(): Promise<PaymentSettings> {
    return (
      (await this.documents.find<PaymentSettings>(PAYMENT_SETTINGS_KEY)) ?? {
        id: 'payment',
        methods: [],
      }
    );
  }

  /** Users who verify payments (roles with billing.manage). */
  private async billingAdmins(): Promise<string[]> {
    const roles = (Object.keys(DEFAULT_ROLE_PERMISSIONS) as UserRole[]).filter((r) =>
      DEFAULT_ROLE_PERMISSIONS[r].includes('billing.manage'),
    );
    const admins = await this.store.all<UserAccount & Entity>(USERS, [{ role: roles }]);
    return admins.map((a) => a.id);
  }

  /** Applies a paid (or trial) plan to the user's subscription. */
  private async activate(
    userId: string,
    userName: string,
    plan: Plan,
    input: { planCode: PlanCode; cycle: 'monthly' | 'yearly'; total: number; trial?: boolean },
    coupon: Coupon | null,
  ): Promise<Subscription> {
    const existing = await this.activeSubscription(userId);
    const patch: Partial<Subscription> = {
      planCode: input.planCode,
      cycle: input.cycle,
      amount: input.total,
      status: input.trial ? 'trialing' : 'active',
      renewsAt: daysFromNow(input.trial ? plan.trialDays : input.cycle === 'yearly' ? 365 : 30),
      trialEndsAt: input.trial ? daysFromNow(plan.trialDays) : undefined,
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
        userId,
        userName,
        startedAt: nowIso(),
        createdAt: nowIso(),
        ...patch,
      } as Subscription;
      await this.store.insert(SUBS, sub as Subscription & Entity, OWNED);
    }
    await this.setPlan(userId, input.planCode);
    if (coupon)
      await this.store.replace(COUPONS, {
        ...coupon,
        redeemed: coupon.redeemed + 1,
        updatedAt: nowIso(),
      });
    return sub;
  }

  /**
   * Manual wallet payment: the student sent money to our bKash/Nagad/Rocket/Upay number and
   * submits their number and the transaction id. Nothing changes until an admin verifies it.
   */
  private async manualCheckout(user: AuthenticatedUser, input: CheckoutInput) {
    const method = input.method as ManualPaymentMethod;
    if (!MANUAL_METHODS.includes(method)) invalid('PAYMENT_METHOD_UNAVAILABLE');
    const settings = await this.paymentSettings();
    if (!settings.methods.some((m) => m.method === method && m.enabled && m.number))
      invalid('PAYMENT_METHOD_UNAVAILABLE');
    const trx = (input.transactionId ?? '').trim().toUpperCase();
    if (!/^[A-Z0-9]{6,20}$/.test(trx)) invalid('TRANSACTION_ID_INVALID');
    const sender = input.account.replace(/[\s-]/g, '');
    if (!/^(\+?88)?01[3-9]\d{8}$/.test(sender)) invalid('SENDER_NUMBER_INVALID');
    const used = await this.store.all<Payment & Entity>(PAYMENTS, [{ transactionId: [trx] }]);
    if (used.some((p) => p.method === method && p.status !== 'failed'))
      invalid('TRANSACTION_ID_USED', undefined, 409);
    const pending = await this.store.all<Payment & Entity>(PAYMENTS, [
      { userId: [user.id], status: ['pending'] },
    ]);
    if (pending.length) invalid('PAYMENT_ALREADY_PENDING', undefined, 409);

    const account = await this.account(user.id);
    const plan = await this.plan(input.planCode);
    const coupon = input.couponCode
      ? await this.validateCoupon(input.couponCode, input.planCode)
      : null;
    const base = input.cycle === 'yearly' ? plan.priceYearly : plan.priceMonthly;
    const { total } = priceWithCoupon(base, coupon);
    const payment: Payment = {
      id: RecordStoreService.newId('pay'),
      userId: user.id,
      userName: account.name,
      planCode: input.planCode,
      amount: total,
      method,
      status: 'pending',
      invoiceNo: `INV-${new Date().getFullYear()}-${Date.now().toString().slice(-7)}`,
      createdAt: nowIso(),
      cycle: input.cycle,
      couponCode: coupon?.code,
      senderNumber: sender,
      transactionId: trx,
      verification: 'awaiting',
    };
    await this.store.insert(PAYMENTS, payment as Payment & Entity, OWNED);
    await this.notifications.push([user.id], {
      type: 'payment',
      title: 'পেমেন্ট যাচাইয়ের অপেক্ষায়',
      body: `${plan.name.bn} · ৳${total} · ${METHOD_NAME[method]} TrxID ${trx}`,
      href: '/student/subscription',
      priority: 'normal',
    });
    const admins = await this.billingAdmins();
    if (admins.length)
      await this.notifications.push(admins, {
        type: 'payment',
        title: 'নতুন পেমেন্ট যাচাই করুন',
        body: `${account.name} · ${plan.name.bn} · ৳${total} · ${METHOD_NAME[method]} ${sender} · TrxID ${trx}`,
        href: '/admin/subscriptions?tab=verify',
        priority: 'high',
      });
    return payment;
  }

  /** Admin: approve (activates the plan) or reject (with a reason) a manual payment. */
  async verifyPayment(admin: AuthenticatedUser, paymentId: string, approve: boolean, note: string) {
    const p = (await this.store.find<Payment & Entity>(PAYMENTS, paymentId)) ?? notFound('Payment');
    if (p.status !== 'pending' || p.verification !== 'awaiting')
      invalid('PAYMENT_NOT_PENDING', undefined, 409);
    if (!approve && !note.trim()) invalid('REASON_REQUIRED');
    const plan = await this.plan(p.planCode);
    const updated: Payment = {
      ...p,
      status: approve ? 'success' : 'failed',
      verification: approve ? 'approved' : 'rejected',
      verifiedBy: admin.id,
      verifiedAt: nowIso(),
      reviewNote: note.trim() || undefined,
      failureReason: approve ? undefined : note.trim(),
    };
    if (approve) {
      const coupon = p.couponCode
        ? await this.validateCoupon(p.couponCode, p.planCode).catch(() => null)
        : null;
      const sub = await this.activate(
        p.userId,
        p.userName,
        plan,
        { planCode: p.planCode, cycle: p.cycle ?? 'monthly', total: p.amount },
        coupon,
      );
      updated.subscriptionId = sub.id;
    }
    await this.store.replace(PAYMENTS, updated as Payment & Entity, OWNED);
    await this.notifications.push([p.userId], {
      type: 'payment',
      title: approve ? 'পেমেন্ট যাচাই সম্পন্ন — প্ল্যান চালু' : 'পেমেন্ট যাচাই হয়নি',
      body: approve
        ? `${plan.name.bn} চালু হয়েছে · ৳${p.amount} · ${p.invoiceNo}`
        : `কারণ: ${note.trim()} · TrxID ${p.transactionId ?? ''}`,
      href: '/student/subscription',
      priority: approve ? 'normal' : 'high',
    });
    await this.audit.record({
      actor: admin,
      category: 'billing',
      action: approve ? 'payment.verify' : 'payment.reject',
      target: { type: 'Payment', id: p.id, label: p.invoiceNo },
      details: `${p.userName} · ${p.method} · ${p.transactionId ?? ''} · ৳${p.amount}`,
    });
    return updated;
  }

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
    if (this.manual && !input.startTrial) return this.manualCheckout(user, input);
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
