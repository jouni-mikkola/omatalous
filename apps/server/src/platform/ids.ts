import { createHash } from "node:crypto";

/**
 * Short, stable, URL-safe id from arbitrary text: the first 96 bits of SHA-256 as hex. Stored rows carry
 * these ids, so the output must never change. Synchronous because an import hashes every row and an async
 * digest per row cost more than the rest of the import.
 */
export function stableId(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex").slice(0, 24);
}

export function randomToken(): string {
  return crypto.randomUUID();
}
