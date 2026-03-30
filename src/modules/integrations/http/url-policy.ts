import { isIPv4, isIPv6 } from "node:net";

const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);

function ipv4Private(host: string): boolean {
  if (!isIPv4(host)) return false;
  const [a, b] = host.split(".").map(Number);
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

function ipv6LoopbackOrPrivate(host: string): boolean {
  if (!isIPv6(host)) return false;
  const h = host.toLowerCase();
  if (h === "::1" || h.startsWith("fe80:")) return true;
  return false;
}

export function assertPublicHttpUrl(urlString: string, allowPrivate: boolean): URL {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    throw new Error("URL inválida");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Solo se permiten URLs http o https");
  }

  if (allowPrivate) {
    return url;
  }

  const host = url.hostname;
  if (LOOPBACK.has(host) || host.endsWith(".localhost")) {
    throw new Error("URL no permitida (loopback / localhost); usa FTN_HTTP_ALLOW_PRIVATE_URLS=1 si es intencional");
  }

  if (ipv4Private(host) || ipv6LoopbackOrPrivate(host)) {
    throw new Error("URL no permitida (red privada); usa FTN_HTTP_ALLOW_PRIVATE_URLS=1 si es intencional");
  }

  return url;
}