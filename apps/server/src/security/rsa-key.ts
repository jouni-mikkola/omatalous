/**
 * Imports an RSA private key (PKCS#8 or PKCS#1 PEM) into WebCrypto for RS256 signing. Generic key handling, so it
 * lives here and not with the bank connector that signs with it.
 */

export type SigningKey = Awaited<ReturnType<typeof crypto.subtle.importKey>>;

function pemToDer(pem: string): Uint8Array {
  const b64 = pem.replace(/-----(BEGIN|END)[^-]+-----/g, "").replace(/\s+/g, "");
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function derLength(len: number): number[] {
  if (len < 0x80) return [len];
  const bytes: number[] = [];
  for (let l = len; l > 0; l >>= 8) bytes.unshift(l & 0xff);
  return [0x80 | bytes.length, ...bytes];
}

/** Wraps a PKCS#1 "RSA PRIVATE KEY" into PKCS#8, the only RSA format WebCrypto imports. */
function pkcs1ToPkcs8(pkcs1: Uint8Array): Uint8Array {
  const version = [0x02, 0x01, 0x00];
  const rsaAlgorithm = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00];
  const octet = [0x04, ...derLength(pkcs1.length), ...pkcs1];
  const body = [...version, ...rsaAlgorithm, ...octet];
  return Uint8Array.from([0x30, ...derLength(body.length), ...body]);
}

export async function importPrivateKey(pem: string, extractable = false): Promise<SigningKey> {
  const der = pemToDer(pem);
  const pkcs8 = pem.includes("BEGIN RSA PRIVATE KEY") ? pkcs1ToPkcs8(der) : der;
  return crypto.subtle.importKey("pkcs8", pkcs8, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, extractable, ["sign"]);
}
