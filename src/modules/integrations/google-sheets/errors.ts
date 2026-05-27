export function toGoogleSheetsError(err: unknown): Error {
  if (err instanceof Error) {
    const code = (err as Error & { code?: number | string }).code;
    if (code === 403 || code === "403") {
      return new Error(`google_sheets: permiso denegado — ${err.message}`);
    }
    if (code === 404 || code === "404") {
      return new Error(`google_sheets: recurso no encontrado — ${err.message}`);
    }
    if (code === 429 || code === "429") {
      return new Error(`google_sheets: rate limit — ${err.message}`);
    }
    return err;
  }
  return new Error(String(err));
}
