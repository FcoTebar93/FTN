export interface SendEmailInput {
    to: string | string[];
    subject?: string;
    templateId?: string;
    htmlBody?: string;
    textBody?: string;
    locale?: string;
    variables?: Record<string, unknown>;
}

export interface GenerateQrCodeInput {
    data: string;
    size?: number;
    format?: "png" | "svg";
}

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

export interface DbExecuteInput {
    sql: string;
    params?: unknown[];
}
  
export interface DbExecuteResult {
    rowCount: number;
    rows: unknown[];
}