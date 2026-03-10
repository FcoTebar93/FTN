declare module "qrcode" {
    
    export interface QRCodeToDataURLOptions {
      width?: number;
      margin?: number;
      errorCorrectionLevel?: "L" | "M" | "Q" | "H";
    }
  
    export interface QRCodeToStringOptions {
      type?: "svg";
      width?: number;
      margin?: number;
      errorCorrectionLevel?: "L" | "M" | "Q" | "H";
    }
  
    export function toDataURL(text: string, options?: QRCodeToDataURLOptions): Promise<string>;
    export function toString(text: string, options?: QRCodeToStringOptions): Promise<string>;
}