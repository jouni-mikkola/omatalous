/**
 * What every call the server makes to another host shares: how much of an answer is read, and which host an address
 * taken from an answer may name. Each caller keeps its own limit, its own hosts and its own error. Nothing here logs:
 * an answer may hold account data or a key.
 */

/**
 * The body, or null when it is longer than `max` bytes. A Content-Length over the limit is refused unread and reading
 * stops at the limit, so an answer without an end is never held in memory. A read that fails throws what it threw.
 */
export async function readCapped(res: Response, max: number): Promise<Uint8Array<ArrayBuffer> | null> {
  if (Number(res.headers.get("content-length") ?? 0) > max) {
    void res.body?.cancel().catch(() => {});
    return null;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = res.body?.getReader();
  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      void reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  // a buffer of its own, exactly as long as the body
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return bytes;
}

/** `readCapped` for an answer that is text (UTF-8). */
export async function readCappedText(res: Response, max: number): Promise<string | null> {
  const bytes = await readCapped(res, max);
  return bytes && new TextDecoder().decode(bytes);
}

/**
 * An address that came in an answer from outside, or null when it is not one to use: it must be https on one of
 * `hosts` or on a subdomain of one, on the default port and without a user name. Each host is a domain its owner
 * holds, never a shared suffix. The address returned is the parsed one, so what is checked is what is used.
 */
export function addressOn(value: unknown, hosts: readonly string[]): string | null {
  if (typeof value !== "string") return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const named = hosts.some((h) => host === h || host.endsWith(`.${h}`)) && host.split(".").every((label) => label !== "");
  return url.protocol === "https:" && !url.username && !url.password && url.port === "" && named ? url.href : null;
}
