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

export interface CreateSubscriptionInput {
    orgId: string;
    planId: string;
    billingProvider: "stripe" | "braintree" | "custom";
    trialDays?: number;
    couponCode?: string;
}

export interface UpdateSubscriptionInput {
    orgId: string;
    subscriptionId: string;
    newPlanId: string;
    prorationBehavior?: "immediate" | "next-invoice";
}

export interface ChargeSubscriptionPaymentInput {
    orgId: string;
    invoiceId: string;
    amountCents: number;
    currency: string;
    paymentMethodId?: string;
}

export interface SendInvoiceEmailInput {
    orgId: string;
    invoiceId: string;
    to: string;
    pdfUrl?: string;
}

export interface SyncWithCRMInput {
    orgId: string;
    crm: "salesforce" | "hubspot" | "pipedrive";
    entityType: "account" | "contact" | "deal";
    entityId: string;
    payload: Record<string, unknown>;
    mode?: "upsert" | "update" | "delete";
}

export interface SyncWithIdentityProviderInput {
    orgId: string;
    provider: "okta" | "azure-ad" | "auth0" | string;
    userId: string;
    operation: "create" | "update" | "deactivate";
    attributes: Record<string, unknown>;
}

export interface CreateUserInput {
    orgId: string;
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    role: "admin" | "user" | "guest";
    attributes: Record<string, unknown>;
}

export interface UpdateUserInput {
    orgId: string;
    userId: string;
    firstName: string;
    lastName: string;
    role: "admin" | "user" | "guest";
    attributes: Record<string, unknown>;
}

export interface DeleteUserInput {
    orgId: string;
    userId: string;
}

export interface CreateOrganizationInput {
    name: string;
    description?: string;
    attributes: Record<string, unknown>;
}