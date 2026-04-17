export function getPathname(url: string | undefined): string {
  if (!url) return "";
  return url.split("?")[0] ?? "";
}
