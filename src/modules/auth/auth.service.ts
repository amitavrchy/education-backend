import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { invalid } from '../../common/exceptions/app.exception.js';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface.js';
import type { SystemConfig } from '../../contracts/operations.js';
import type { StudentProfile, UserAccount } from '../../contracts/people.js';
import type { AuthSession, User, UserRole } from '../../contracts/user.js';
import { integrationsConfig, type IntegrationsConfig } from '../../config/index.js';
import { PrismaService } from '../../database/prisma/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { DOMAIN_EVENTS } from '../../infrastructure/events/domain-events.js';
import { EMAIL_PROVIDER, type EmailProvider } from '../../integrations/email/email.module.js';
import { SMS_PROVIDER, type SmsProvider } from '../../integrations/sms/sms.module.js';
import { PermissionMatrixService } from '../access/permission-matrix.service.js';
import { AuditLogsService } from '../audit-logs/audit-logs.service.js';
import { DocumentsService } from '../records/documents.service.js';
import { RecordStoreService } from '../records/record-store.service.js';
import type { RegisterDto } from './dto/auth.dto.js';
import type { OtpPurpose, PendingOtp, SessionContext } from './interfaces/auth.interfaces.js';
import { PasswordHasherService } from './services/password-hasher.service.js';
import { TokenService } from './services/token.service.js';

/** Password the frontend's demo UI uses to show the "wrong password" error. */
export const DEMO_WRONG_PASSWORD = 'wrongpass';
export const DEMO_OTP = '123456';
/** Document listing the demo account id per role (written by the seeder). */
export const DEMO_ACCOUNTS_KEY = 'demoAccounts';

const USERS = { collection: 'users', scope: '' };
const OTP_WINDOW_MS = 15 * 60_000;
const OTP_MAX_PER_WINDOW = 5;

export const normalizePhone = (value: string) => value.replace(/[^\d]/g, '').replace(/^88/, '');
export const isPhone = (value: string) => /^01[3-9]\d{8}$/.test(normalizePhone(value));

type Credential = {
  id: string;
  email: string | null;
  phone: string | null;
  passwordHash: string | null;
  role: string;
  status: string;
  institutionId: string | null;
};

/**
 * Authentication flows used by the frontend (services/auth.service.ts): password login,
 * phone/email OTP login, OTP-verified registration, password reset, refresh rotation, logout,
 * and (demo mode only) the role switcher.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly store: RecordStoreService,
    private readonly documents: DocumentsService,
    private readonly hasher: PasswordHasherService,
    private readonly tokens: TokenService,
    private readonly matrix: PermissionMatrixService,
    private readonly audit: AuditLogsService,
    private readonly events: EventEmitter2,
    @Inject(integrationsConfig.KEY) private readonly config: IntegrationsConfig,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
    @Inject(EMAIL_PROVIDER) private readonly email: EmailProvider,
  ) {}

  private get demo() {
    return this.config.auth.demoMode;
  }

  // ── Lookups ────────────────────────────────────────────────────────────

  private findCredential(identifier: string): Promise<Credential | null> {
    const id = identifier.trim().toLowerCase();
    return this.prisma.user.findFirst({
      where: { deletedAt: null, ...(isPhone(id) ? { phone: normalizePhone(id) } : { email: id }) },
      select: {
        id: true,
        email: true,
        phone: true,
        passwordHash: true,
        role: true,
        status: true,
        institutionId: true,
      },
    });
  }

  private async account(id: string): Promise<UserAccount | undefined> {
    return (await this.store.find(USERS, id)) as UserAccount | undefined;
  }

  /** The frontend's session `User` shape. */
  async toUser(id: string): Promise<User> {
    const account = await this.account(id);
    if (!account) throw new UnauthorizedException('Account not found');
    let academicLevel: string | undefined;
    if (account.role === 'student') {
      const profile = (await this.store.find({ collection: 'studentProfiles', scope: '' }, id)) as
        StudentProfile | undefined;
      if (profile) academicLevel = `${profile.levelCode} ${profile.examYear}`;
    }
    return {
      id: account.id,
      name: account.name,
      email: account.email,
      phone: account.phone,
      role: account.role,
      avatarUrl: account.avatarUrl,
      academicLevel,
      institutionId: account.institutionId,
      status: account.status,
      onboarded: account.onboarded,
      createdAt: account.createdAt,
    };
  }

  private assertUsable(cred: { status: string }) {
    if (cred.status === 'suspended') invalid('ACCOUNT_SUSPENDED');
    if (cred.status === 'pending_deletion') invalid('ACCOUNT_PENDING_DELETION');
  }

  // ── Sessions ───────────────────────────────────────────────────────────

  private async issueSession(
    cred: Pick<Credential, 'id' | 'role' | 'institutionId'>,
    remember: boolean,
    client: SessionContext,
  ): Promise<AuthSession & { accessTokenExpiresAt: string; permissions: string[] }> {
    const refresh = this.tokens.generateRefreshToken();
    const expiresAt = new Date(Date.now() + this.tokens.sessionTtlMs(remember));
    const session = await this.prisma.userSession.create({
      data: {
        userId: cred.id,
        refreshTokenHash: refresh.hash,
        remember,
        expiresAt,
        userAgent: client.userAgent?.slice(0, 300),
        ipAddress: client.ipAddress,
      },
    });
    const role = cred.role as UserRole;
    const accessToken = await this.tokens.signAccessToken({
      userId: cred.id,
      role,
      institutionId: cred.institutionId,
      sessionId: session.id,
    });
    await this.prisma.user.update({ where: { id: cred.id }, data: { lastLoginAt: new Date() } });
    await this.touchAccount(cred.id, { lastActiveAt: new Date().toISOString() });
    return {
      user: await this.toUser(cred.id),
      accessToken,
      refreshToken: refresh.token,
      expiresAt: expiresAt.toISOString(),
      accessTokenExpiresAt: new Date(Date.now() + this.tokens.accessTtlMs()).toISOString(),
      remember,
      permissions: await this.matrix.permissionsFor(role),
    };
  }

  private async touchAccount(id: string, patch: Partial<UserAccount>) {
    const account = await this.account(id);
    if (account)
      await this.store.replace(USERS, { ...account, ...patch } as never, {
        institutionField: 'institutionId',
      });
  }

  async refresh(refreshToken: string, client: SessionContext) {
    const session = await this.prisma.userSession.findUnique({
      where: { refreshTokenHash: TokenService.hash(refreshToken) },
    });
    if (!session || session.revokedAt || session.expiresAt < new Date())
      throw new UnauthorizedException('Session expired');
    const cred = await this.prisma.user.findFirst({
      where: { id: session.userId, deletedAt: null },
    });
    if (!cred || cred.status === 'suspended' || cred.status === 'pending_deletion') {
      await this.prisma.userSession.update({
        where: { id: session.id },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('Account unavailable');
    }
    // Rotation: the old refresh token stops working immediately.
    const next = this.tokens.generateRefreshToken();
    await this.prisma.userSession.update({
      where: { id: session.id },
      data: {
        refreshTokenHash: next.hash,
        lastUsedAt: new Date(),
        ipAddress: client.ipAddress ?? session.ipAddress,
      },
    });
    const role = cred.role as UserRole;
    return {
      user: await this.toUser(cred.id),
      accessToken: await this.tokens.signAccessToken({
        userId: cred.id,
        role,
        institutionId: cred.institutionId,
        sessionId: session.id,
      }),
      refreshToken: next.token,
      expiresAt: session.expiresAt.toISOString(),
      accessTokenExpiresAt: new Date(Date.now() + this.tokens.accessTtlMs()).toISOString(),
      remember: session.remember,
      permissions: await this.matrix.permissionsFor(role),
    };
  }

  async logout(sessionId?: string): Promise<void> {
    if (!sessionId) return;
    await this.prisma.userSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async me(user: AuthenticatedUser) {
    return { user: await this.toUser(user.id), permissions: user.permissions };
  }

  // ── Password login ─────────────────────────────────────────────────────

  async loginWithPassword(
    input: { identifier: string; password: string; remember?: boolean },
    client: SessionContext,
  ) {
    const cred = await this.findCredential(input.identifier);
    // Constant work whether or not the account exists.
    const ok = await this.passwordMatches(cred, input.password);
    if (!cred) invalid('ACCOUNT_NOT_FOUND', { identifier: ['ACCOUNT_NOT_FOUND'] });
    if (!ok) {
      await this.audit.record({
        actor: { id: cred.id, role: cred.role },
        category: 'security',
        action: 'auth.login_failed',
        target: { type: 'User', id: cred.id, label: cred.email ?? cred.id },
        ip: client.ipAddress,
      });
      invalid('WRONG_PASSWORD', { password: ['WRONG_PASSWORD'] });
    }
    this.assertUsable(cred);
    const session = await this.issueSession(cred, !!input.remember, client);
    this.events.emit(DOMAIN_EVENTS.USER_SIGNED_IN, { userId: cred.id });
    return session;
  }

  private async passwordMatches(cred: Credential | null, password: string): Promise<boolean> {
    if (this.demo && cred && password !== DEMO_WRONG_PASSWORD) {
      const account = await this.account(cred.id);
      if (account?.demo) return true;
    }
    return this.hasher.verify(password, cred?.passwordHash);
  }

  // ── OTP ────────────────────────────────────────────────────────────────

  private codeHash(challengeId: string, code: string) {
    return createHash('sha256').update(`${challengeId}:${code.trim()}`).digest('hex');
  }

  async sendOtp(
    purpose: OtpPurpose,
    target: string,
    payload: Record<string, unknown> = {},
    remember?: boolean,
  ): Promise<PendingOtp> {
    const recent = await this.prisma.otpChallenge.count({
      where: { target, createdAt: { gt: new Date(Date.now() - OTP_WINDOW_MS) } },
    });
    if (recent >= OTP_MAX_PER_WINDOW) invalid('OTP_RATE_LIMITED', undefined, 429);
    const code = this.demo ? DEMO_OTP : String(randomInt(0, 1_000_000)).padStart(6, '0');
    const expiresAt = new Date(Date.now() + this.config.auth.otpTtlMinutes * 60_000);
    const challenge = await this.prisma.otpChallenge.create({
      data: {
        purpose,
        target,
        codeHash: 'pending',
        payload: { ...payload, remember: !!remember },
        expiresAt,
      },
    });
    await this.prisma.otpChallenge.update({
      where: { id: challenge.id },
      data: { codeHash: this.codeHash(challenge.id, code) },
    });
    await this.deliver(target, code);
    return {
      challengeId: challenge.id,
      purpose,
      target,
      remember,
      sentAt: challenge.createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      demoCode: this.demo ? DEMO_OTP : undefined,
    };
  }

  private async deliver(target: string, code: string) {
    const text = `ShikkhaAI verification code: ${code}. It expires in ${this.config.auth.otpTtlMinutes} minutes. Never share it.`;
    try {
      if (isPhone(target)) await this.sms.send(`+88${normalizePhone(target)}`, text);
      else
        await this.email.send({
          to: target,
          subject: 'Your ShikkhaAI code',
          text,
          html: `<p>${text}</p>`,
        });
    } catch (error) {
      this.logger.error({ err: error }, 'OTP delivery failed');
      // Demo mode uses the fixed code, so a provider rejection (e.g. an unverified sender
      // domain) must not block sign-up there.
      if (!this.demo) invalid('OTP_DELIVERY_FAILED', undefined, 503);
    }
  }

  /** Verifies a code for a non-auth purpose (e.g. guardian linking) and returns its payload. */
  async consumeOtp(
    challengeId: string,
    code: string,
    purpose: OtpPurpose,
  ): Promise<Record<string, unknown>> {
    const challenge = await this.prisma.otpChallenge.findUnique({ where: { id: challengeId } });
    if (
      !challenge ||
      challenge.purpose !== purpose ||
      challenge.consumedAt ||
      challenge.expiresAt < new Date()
    )
      invalid('NO_PENDING_OTP');
    if (challenge.attempts >= this.config.auth.otpMaxAttempts)
      invalid('OTP_TOO_MANY_ATTEMPTS', undefined, 429);
    if (challenge.codeHash !== this.codeHash(challenge.id, code)) {
      await this.prisma.otpChallenge.update({
        where: { id: challenge.id },
        data: { attempts: { increment: 1 } },
      });
      invalid('OTP_INVALID', { code: ['OTP_INVALID'] });
    }
    await this.prisma.otpChallenge.update({
      where: { id: challenge.id },
      data: { consumedAt: new Date() },
    });
    return (challenge.payload ?? {}) as Record<string, unknown>;
  }

  async requestLoginOtp(identifier: string, remember = false) {
    const cred = await this.findCredential(identifier);
    if (!cred) invalid('ACCOUNT_NOT_FOUND', { identifier: ['ACCOUNT_NOT_FOUND'] });
    this.assertUsable(cred);
    return this.sendOtp('login', identifier.trim().toLowerCase(), { userId: cred.id }, remember);
  }

  async register(dto: RegisterDto) {
    const config = await this.documents.find<SystemConfig>('systemConfig');
    if (config && config.signupsEnabled === false) invalid('SIGNUPS_DISABLED', undefined, 403);
    const identifier = dto.identifier.trim().toLowerCase();
    if (
      dto.channel === 'phone'
        ? !isPhone(identifier)
        : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier)
    )
      invalid('VALIDATION', { identifier: ['IDENTIFIER_INVALID'] });
    if (await this.findCredential(identifier))
      invalid('ACCOUNT_EXISTS', { identifier: ['ACCOUNT_EXISTS'] });
    const registration = {
      name: dto.name.trim(),
      identifier,
      channel: dto.channel,
      role: dto.role,
      passwordHash: dto.password ? await this.hasher.hash(dto.password) : null,
    };
    return this.sendOtp('register', identifier, { registration });
  }

  /** Same answer whether or not the account exists (no account enumeration). */
  async requestPasswordReset(identifier: string) {
    const target = identifier.trim().toLowerCase();
    const cred = await this.findCredential(target);
    if (cred) return this.sendOtp('reset', target, { userId: cred.id });
    const now = new Date();
    return {
      challengeId: randomBytes(18).toString('hex').slice(0, 36),
      purpose: 'reset' as const,
      target,
      sentAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + this.config.auth.otpTtlMinutes * 60_000).toISOString(),
      demoCode: this.demo ? DEMO_OTP : undefined,
    };
  }

  async resendOtp(challengeId: string) {
    const old = await this.prisma.otpChallenge.findUnique({ where: { id: challengeId } });
    if (!old || old.consumedAt) invalid('NO_PENDING_OTP');
    await this.prisma.otpChallenge.update({
      where: { id: old.id },
      data: { consumedAt: new Date() },
    });
    const payload = (old.payload ?? {}) as Record<string, unknown>;
    return this.sendOtp(old.purpose as OtpPurpose, old.target, payload, payload.remember === true);
  }

  /** Verifies a code. Login/register return a session; reset returns a one-time reset token. */
  async verifyOtp(challengeId: string, code: string, client: SessionContext) {
    const challenge = await this.prisma.otpChallenge.findUnique({ where: { id: challengeId } });
    if (
      !challenge ||
      challenge.consumedAt ||
      challenge.expiresAt < new Date() ||
      challenge.purpose === 'reset_token'
    )
      invalid('NO_PENDING_OTP');
    if (challenge.attempts >= this.config.auth.otpMaxAttempts)
      invalid('OTP_TOO_MANY_ATTEMPTS', undefined, 429);
    const expected = Buffer.from(challenge.codeHash, 'hex');
    const actual = Buffer.from(this.codeHash(challenge.id, code), 'hex');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      await this.prisma.otpChallenge.update({
        where: { id: challenge.id },
        data: { attempts: { increment: 1 } },
      });
      invalid('OTP_INVALID', { code: ['OTP_INVALID'] });
    }
    await this.prisma.otpChallenge.update({
      where: { id: challenge.id },
      data: { consumedAt: new Date() },
    });
    const payload = (challenge.payload ?? {}) as Record<string, unknown>;

    if (challenge.purpose === 'reset') {
      const token = randomBytes(32).toString('base64url');
      const row = await this.prisma.otpChallenge.create({
        data: {
          purpose: 'reset_token',
          target: challenge.target,
          codeHash: this.codeHash('reset', token),
          payload: { userId: payload.userId } as Prisma.InputJsonValue,
          expiresAt: new Date(Date.now() + 15 * 60_000),
        },
      });
      return { purpose: 'reset' as const, resetToken: `${row.id}.${token}` };
    }

    if (challenge.purpose === 'register') {
      const reg = payload.registration as {
        name: string;
        identifier: string;
        channel: 'email' | 'phone';
        role: 'student' | 'parent';
        passwordHash: string | null;
      };
      if (await this.findCredential(reg.identifier))
        invalid('ACCOUNT_EXISTS', { identifier: ['ACCOUNT_EXISTS'] });
      const cred = await this.createAccount(reg);
      this.events.emit(DOMAIN_EVENTS.USER_REGISTERED, { userId: cred.id });
      return {
        purpose: 'register' as const,
        session: await this.issueSession(cred, false, client),
      };
    }

    const cred = await this.prisma.user.findFirst({
      where: { id: String(payload.userId), deletedAt: null },
    });
    if (!cred) invalid('ACCOUNT_NOT_FOUND');
    this.assertUsable(cred);
    if (cred.status === 'invited') await this.activate(cred.id);
    return {
      purpose: 'login' as const,
      session: await this.issueSession(cred, payload.remember === true, client),
    };
  }

  private async activate(id: string) {
    await this.prisma.user.update({ where: { id }, data: { status: 'active' } });
    await this.touchAccount(id, { status: 'active' });
  }

  private async createAccount(reg: {
    name: string;
    identifier: string;
    channel: 'email' | 'phone';
    role: 'student' | 'parent';
    passwordHash: string | null;
  }) {
    const id = RecordStoreService.newId('u');
    const now = new Date().toISOString();
    const phone = reg.channel === 'phone' ? normalizePhone(reg.identifier) : undefined;
    const email = reg.channel === 'email' ? reg.identifier : `${phone}@phone.local`;
    const account: UserAccount = {
      id,
      name: reg.name,
      email,
      phone,
      role: reg.role,
      status: 'active',
      guardianIds: [],
      studentIds: [],
      planCode: 'free',
      lastActiveAt: now,
      supportTickets: [],
      onboarded: reg.role !== 'student',
      demo: true,
      createdAt: now,
      updatedAt: now,
    };
    const cred = await this.prisma.user.create({
      data: {
        id,
        email: reg.channel === 'email' ? email : null,
        phone: phone ?? null,
        name: reg.name,
        role: reg.role,
        status: 'active',
        passwordHash: reg.passwordHash,
      },
      select: { id: true, role: true, institutionId: true },
    });
    await this.store.insert(USERS, account as never, { institutionField: 'institutionId' });
    return cred;
  }

  async resetPassword(token: string, password: string) {
    if (password.length < 8) invalid('PASSWORD_TOO_SHORT', { password: ['PASSWORD_TOO_SHORT'] });
    const [id, secret] = token.split('.');
    const row =
      id && secret && /^[0-9a-f-]{36}$/.test(id)
        ? await this.prisma.otpChallenge.findUnique({ where: { id } })
        : null;
    if (
      !row ||
      row.purpose !== 'reset_token' ||
      row.consumedAt ||
      row.expiresAt < new Date() ||
      row.codeHash !== this.codeHash('reset', secret)
    )
      invalid('RESET_TOKEN_INVALID');
    const userId = String((row.payload as { userId?: string } | null)?.userId);
    await this.prisma.$transaction([
      this.prisma.otpChallenge.update({ where: { id: row.id }, data: { consumedAt: new Date() } }),
      this.prisma.user.update({
        where: { id: userId },
        data: { passwordHash: await this.hasher.hash(password) },
      }),
      // Every existing session ends when the password changes.
      this.prisma.userSession.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    await this.audit.record({
      actor: { id: userId, role: 'user' },
      category: 'security',
      action: 'auth.password_reset',
      target: { type: 'User', id: userId, label: row.target },
    });
  }

  // ── Misc ───────────────────────────────────────────────────────────────

  async markOnboarded(userId: string) {
    await this.touchAccount(userId, { onboarded: true });
    return this.toUser(userId);
  }

  /** Demo role switcher (frontend dev aid). Only in AUTH_DEMO_MODE. */
  async switchRole(role: UserRole, client: SessionContext) {
    if (!this.demo) invalid('DEMO_MODE_DISABLED', undefined, 403);
    const map = (await this.documents.find<Record<string, string>>(DEMO_ACCOUNTS_KEY)) ?? {};
    const cred = map[role]
      ? await this.prisma.user.findFirst({ where: { id: map[role], deletedAt: null } })
      : null;
    if (!cred) invalid('ACCOUNT_NOT_FOUND');
    return this.issueSession(cred, true, client);
  }

  /** Lists demo accounts for the login screen's quick picker (demo mode only). */
  async demoAccounts() {
    if (!this.demo) return [];
    const map = (await this.documents.find<Record<string, string>>(DEMO_ACCOUNTS_KEY)) ?? {};
    const rows = await this.prisma.user.findMany({
      where: { id: { in: Object.values(map) } },
      select: { id: true, role: true, email: true, phone: true, name: true },
    });
    return rows;
  }
}
