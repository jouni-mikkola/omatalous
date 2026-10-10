const encoder = new TextEncoder();

/** Short, stable, URL-safe id from arbitrary text (SHA-256, 96 bits). */
export async function stableId(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(text)));
  return Array.from(digest.slice(0, 12), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function randomToken(): string {
  return crypto.randomUUID();
}
