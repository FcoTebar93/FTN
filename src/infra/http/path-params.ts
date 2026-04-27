export function getPathParams(
  rawPath: string,
  expectedPartsLength: number
): string[] | undefined {
  const parts = rawPath.split("/");
  return parts.length === expectedPartsLength ? parts : undefined;
}
