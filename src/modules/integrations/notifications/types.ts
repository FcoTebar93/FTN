export interface SendEmailInput {
    to: string | string[];
    subject?: string;
    templateId?: string;
    htmlBody?: string;
    textBody?: string;
    locale?: string;
    variables?: Record<string, unknown>;
}
  
export interface SendSlackMessageInput {
    channel?: string;
    text: string;
}

export interface SendWebhookInput {
  url: string;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
}

export interface SendWebhookInput {
  url: string,
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  headers?: Record<string, string>,
  body?: unknown,
  timeoutMs?: number
}

export type SendSlackMessageResult = void;
export type SendEmailResult = void;
export type SendWebhookResult = {
  status: number;
};