declare module "nodemailer" {
  export interface MailAttachment {
    filename: string;
    content: Buffer | string;
    contentType?: string;
    cid?: string;
  }

  export interface Transporter {
    sendMail(options: {
      from?: string;
      to: string;
      subject?: string;
      text?: string;
      html?: string;
      headers?: Record<string, string>;
      attachments?: MailAttachment[];
    }): Promise<unknown>;
  }

  export function createTransport(options: {
    host: string;
    port: number;
    secure?: boolean;
    auth?: { user: string; pass: string };
  }): Transporter;
}