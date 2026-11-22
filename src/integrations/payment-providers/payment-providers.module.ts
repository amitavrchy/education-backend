import { Global, Module, ServiceUnavailableException } from '@nestjs/common';

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');

export interface CreatePaymentInput {
  /** Our internal reference, used as the idempotency key. */
  reference: string;
  amountBdt: number;
  description: string;
  successUrl: string;
  cancelUrl: string;
}

export interface PaymentProvider {
  readonly name: string;
  createPayment(
    input: CreatePaymentInput,
  ): Promise<{ redirectUrl: string; providerPaymentId: string }>;
  /** Verify a callback/IPN with the provider before trusting it. */
  verifyPayment(
    providerPaymentId: string,
  ): Promise<{ status: 'paid' | 'failed' | 'pending'; amountBdt: number }>;
}

class DisabledPaymentProvider implements PaymentProvider {
  readonly name = 'none';
  createPayment(): Promise<{ redirectUrl: string; providerPaymentId: string }> {
    return Promise.reject(new ServiceUnavailableException('Payments are not configured'));
  }
  verifyPayment(): Promise<{ status: 'paid' | 'failed' | 'pending'; amountBdt: number }> {
    return Promise.reject(new ServiceUnavailableException('Payments are not configured'));
  }
}

/** Future adapters: bKash, Nagad, SSLCommerz. */
@Global()
@Module({
  providers: [{ provide: PAYMENT_PROVIDER, useClass: DisabledPaymentProvider }],
  exports: [PAYMENT_PROVIDER],
})
export class PaymentProvidersModule {}
