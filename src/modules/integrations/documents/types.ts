export interface GenerateQrCodeInput {
    data: string;
    size?: number;
    format?: "png" | "svg";
}

export type GenerateQrCodeResult = string;