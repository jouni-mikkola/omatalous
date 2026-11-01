/** Class names joined; a false, null or empty part is left out. */
export function cx(...parts: (string | false | null | undefined)[]): string | undefined {
  const joined = parts.filter(Boolean).join(" ");
  return joined || undefined;
}
