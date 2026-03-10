declare module "nodemailer" {
    export interface Transporter {
      sendMail(options: {
        from?: string;
        to: string;
        subject?: string;
        text?: string;
        html?: string;
        headers?: Record<string, string>;
      }): Promise<unknown>;
    }
  
    export function createTransport(options: {
      host: string;
      port: number;
      secure?: boolean;
      auth?: { user: string; pass: string };
    }): Transporter;
}