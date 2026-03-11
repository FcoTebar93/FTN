export interface SendEmailInput {
    to: string | string[];
    subject?: string;
    templateId?: string;
    htmlBody?: string;
    textBody?: string;
    locale?: string;
    variables?: Record<string, unknown>;
  }
  
  export type SendEmailResult = void;
  
  export interface SendSlackMessageInput {
    channel?: string;
    text: string;
  }
  
  export type SendSlackMessageResult = void;