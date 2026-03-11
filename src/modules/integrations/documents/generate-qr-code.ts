import * as QRCode from "qrcode";
import type { ActivityDefinition, ActivityExecutionContext } from "../../../core/activities";
import type { GenerateQrCodeInput, GenerateQrCodeResult } from "./types";

export function generateQrCodeActivityDefinition(): ActivityDefinition<GenerateQrCodeInput, GenerateQrCodeResult> {
    return {
        name: "generate-qr-code",
        maxAttempts: 3,
        timeoutMs: 30_000,
        tags: ["documents", "qr-code"],
        version: "1.0.0",
        execute: async (input: GenerateQrCodeInput, ctx: ActivityExecutionContext) => {
            ctx.log("Generando QR Code", { data: input.data, size: input.size, format: input.format });
            
            const size = input.size ?? 256;
            const format = input.format ?? "png";
            try {
                if (format === "png") {
                    const dataUrl = await QRCode.toDataURL(input.data, { width: size });
                    return dataUrl;
                }
                
                if (format === "svg") {
                    const svg = await QRCode.toString(input.data, { type: "svg", width: size });
                    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
                } 

                throw new Error(`Unsupported QR format: ${format}`);
            } catch (error: unknown) {
                ctx.log("Error generando QR Code", { error: error });
                throw error;
            }
        }
    };
}