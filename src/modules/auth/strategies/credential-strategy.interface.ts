/**
 * Sign-in methods plug in as strategies, so email+password, phone+password and
 * phone+OTP share one AuthService flow (verify → load roles → create session → issue tokens).
 */
export type CredentialType = 'email-password' | 'phone-password' | 'phone-otp';

export interface CredentialStrategy<TInput> {
  readonly type: CredentialType;
  /** Returns the user id on success, or null. Must not reveal which part was wrong. */
  verify(input: TInput): Promise<string | null>;
}

export interface OtpService {
  /** Sends a short-lived code; stores only its hash with an attempt counter. */
  issue(phone: string, purpose: 'login' | 'verify-phone' | 'reset-password'): Promise<void>;
  verify(
    phone: string,
    code: string,
    purpose: 'login' | 'verify-phone' | 'reset-password',
  ): Promise<boolean>;
}
