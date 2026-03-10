import type { SendEmailInput, GenerateQrCodeInput } from "./activity-types";
import * as QRCode from "qrcode";
import * as nodemailer from "nodemailer";


let chargeAttempts = 0;

export type ActivityFn<TInput = unknown, TResult = unknown> = (input: TInput) => Promise<TResult> | TResult;

export interface ActivityRegistry {
    getActivity(name: string): ActivityFn | undefined;
}

export class InMemoryActivityRegistry implements ActivityRegistry {
    private readonly activities = new Map<string, ActivityFn>();

    register<TInput, TResult>(name: string, activity: ActivityFn<TInput, TResult>): void {
        this.activities.set(name, activity as ActivityFn<unknown, unknown>);
    }

    getActivity(name: string): ActivityFn | undefined {
        return this.activities.get(name);
    }
}

export const validateOrderActivity: ActivityFn<{orderId: string;userId: string;amount: number;}, void> = async (input) => {
    console.log("[activity] validate-order", input);
};

export const chargePaymentActivity: ActivityFn<{orderId: string;amount: number;}, void> = async (input) => {
  chargeAttempts += 1;
  console.log("[activity] charge-payment attempt", chargeAttempts, input);

  if (chargeAttempts < 2) {
    throw new Error("Simulated payment gateway failure");
  }
};

export const createShipmentActivity: ActivityFn<{orderId: string; userId: string;}, void> = async (input) => {
    console.log("[activity] create-shipment", input);
};

export const sendEmailActivity: ActivityFn<SendEmailInput, void> = async (input) => {
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;

    if (!user || !pass) {
    throw new Error("SMTP_USER/SMTP_PASS no están configuradas");
    }

    const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST ?? "localhost",
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: false,
    auth: { user, pass },
    });
    
    const to = Array.isArray(input.to) ? input.to.join(",") : input.to;
  
    await transporter.sendMail({
      from: process.env.SMTP_FROM,
      to,
      subject: input.subject ?? "[FTN] Notificación",
      text: input.textBody,
      html: input.htmlBody,
    });
};

export const generateQrCodeActivity: ActivityFn<GenerateQrCodeInput, string> = async (input) => {
    const size = input.size ?? 256;
    const format = input.format ?? "png";
  
    if (format === "png") {
      const dataUrl = await QRCode.toDataURL(input.data, { width: size });
      return dataUrl;
    }
  
    if (format === "svg") {
      const svg = await QRCode.toString(input.data, { type: "svg", width: size });
      return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
    }
  
    throw new Error(`Unsupported QR format: ${format}`);
};