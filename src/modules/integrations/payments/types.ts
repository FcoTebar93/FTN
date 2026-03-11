export interface StripeCreateCheckoutSessionInput {
    successUrl: string;
    cancelUrl: string;
    customerEmail?: string;
    currency: string;
    lineItems: Array<{
      name: string;
      unitAmountCents: number;
      quantity: number;
    }>;
    metadata: Record<string, string>;
}
  
export interface StripeCreateCheckoutSessionResult {
    sessionId: string;
    url: string;
}

export interface PaymentCompletedSignalData {
  sessionId: string;
  amountTotal?: number;
  currency?: string;
  customerEmail?: string;
}

export interface ValidateOrderInput {
  orderId: string;
  userId: string;
  amount: number;
}
export interface ChargePaymentInput {
  orderId: string;
  amount: number;
}