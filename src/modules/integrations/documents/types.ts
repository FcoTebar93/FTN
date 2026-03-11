export interface GenerateQrCodeInput {
    data: string;
    size?: number;
    format?: "png" | "svg";
}
export interface RenderPdfFromTemplateInput {
    templateId: string;
    outputName: string;
    variables: Record<string, unknown>;
}
export interface RenderPdfFromTemplateResult {
    pdfUrl: string;
}

export type GenerateQrCodeResult = string;