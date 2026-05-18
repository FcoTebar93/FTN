import { Buffer } from "node:buffer";

const MAX_INLINE_IMAGE_BYTES = 2_000_000;

export interface InlineImagePart {
  cid: string;
  filename: string;
  contentType: string;
  content: Buffer;
}

function extensionForMime(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes("png")) return "png";
  if (m.includes("jpeg") || m.includes("jpg")) return "jpg";
  if (m.includes("gif")) return "gif";
  if (m.includes("webp")) return "webp";
  if (m.includes("svg")) return "svg";
  return "bin";
}

export function parseImageDataUrl(dataUrl: string): { contentType: string; content: Buffer } | null {
  const m = dataUrl.match(/^data:(image\/[a-z0-9+.+-]+);base64,(.+)$/i);
  if (!m) return null;
  const contentType = m[1].toLowerCase();
  const allowed =
    contentType === "image/png" ||
    contentType === "image/jpeg" ||
    contentType === "image/jpg" ||
    contentType === "image/gif" ||
    contentType === "image/webp" ||
    contentType === "image/svg+xml";
  if (!allowed) return null;

  const b64 = m[2].replace(/\s+/g, "");
  let content: Buffer;
  try {
    content = Buffer.from(b64, "base64");
  } catch {
    return null;
  }
  if (content.length === 0 || content.length > MAX_INLINE_IMAGE_BYTES) return null;
  return { contentType, content };
}

export function extractDataUrlImagesToCid(html: string): { html: string; inlineImages: InlineImagePart[] } {
  const inlineImages: InlineImagePart[] = [];
  let seq = 0;

  const replaced = html.replace(
    /src\s*=\s*(["'])(data:image\/(?:png|jpeg|jpg|gif|webp|svg\+xml);base64,[^"']+)\1/gi,
    (full, quote: string, dataUrl: string) => {
      const parsed = parseImageDataUrl(dataUrl);
      if (!parsed) return full;
      const cid = `ftn_inline_${seq++}`;
      inlineImages.push({
        cid,
        filename: `${cid}.${extensionForMime(parsed.contentType)}`,
        contentType: parsed.contentType,
        content: parsed.content,
      });
      return `src=${quote}cid:${cid}${quote}`;
    }
  );

  return { html: replaced, inlineImages };
}