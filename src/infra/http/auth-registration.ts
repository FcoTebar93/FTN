export function normalizeAndValidateUsername(raw: string): string | null {
  const t = raw.trim().toLowerCase();
  if (t.length < 3 || t.length > 64) {
    return null;
  }
  if (!/^[a-z0-9][a-z0-9_.-]*$/.test(t)) {
    return null;
  }
  return t;
}

export function validatePlainPassword(raw: string): boolean {
  return raw.length >= 10 && raw.length <= 256;
}
