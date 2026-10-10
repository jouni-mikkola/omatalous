/**
 * RSA key pair + self-signed X.509 certificate with WebCrypto only, so the
 * setup wizard can create the Enable Banking key on the server without
 * running an external program such as openssl.
 *
 * Enable Banking only reads the public key from the certificate ("Generate
 * outside the browser and import public certificate"), so a minimal v3
 * certificate without extensions is enough.
 */
import { randomBytes, utf8 } from "./encoding.ts";

// ── a tiny DER encoder: only the types a certificate needs ──

function len(n: number): number[] {
  if (n < 0x80) return [n];
  const bytes: number[] = [];
  for (let l = n; l > 0; l >>= 8) bytes.unshift(l & 0xff);
  return [0x80 | bytes.length, ...bytes];
}

const tlv = (tag: number, content: ArrayLike<number>): number[] => [tag, ...len(content.length), ...Array.from(content)];
const seq = (...items: number[][]) => tlv(0x30, items.flat());
const set = (...items: number[][]) => tlv(0x31, items.flat());
const explicit = (n: number, inner: number[]) => tlv(0xa0 + n, inner);
const nul = () => [0x05, 0x00];

function integer(bytes: Uint8Array): number[] {
  // DER integers are signed: a leading 1 bit needs a 0x00 pad to stay positive
  return tlv(0x02, bytes[0]! & 0x80 ? [0, ...bytes] : bytes);
}

function oid(dotted: string): number[] {
  const [a, b, ...rest] = dotted.split(".").map(Number) as [number, number, ...number[]];
  const out = [40 * a + b];
  for (const n of rest) {
    const chunk = [n & 0x7f];
    for (let v = n >>> 7; v > 0; v >>>= 7) chunk.unshift((v & 0x7f) | 0x80);
    out.push(...chunk);
  }
  return tlv(0x06, out);
}

/** UTCTime until 2049, GeneralizedTime after (RFC 5280 §4.1.2.5). */
function time(d: Date): number[] {
  const iso = d.toISOString().replace(/[-:T]/g, "").slice(0, 14); // YYYYMMDDHHMMSS
  return d.getUTCFullYear() < 2050 ? tlv(0x17, utf8.encode(`${iso.slice(2)}Z`)) : tlv(0x18, utf8.encode(`${iso}Z`));
}

const SHA256_WITH_RSA = seq(oid("1.2.840.113549.1.1.11"), nul());
const name = (commonName: string) => seq(set(seq(oid("2.5.4.3"), tlv(0x0c, utf8.encode(commonName)))));

function pem(label: string, der: Uint8Array): string {
  let bin = "";
  for (const b of der) bin += String.fromCharCode(b);
  const lines = btoa(bin).match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----\n`;
}

export interface GeneratedKey {
  /** PKCS#8 private key, PEM. Secret: stored encrypted, never shown in the UI. */
  privateKeyPem: string;
  /** Self-signed certificate, PEM. Public: uploaded to Enable Banking. */
  certificatePem: string;
}

export async function generateKeyAndCertificate(options: { commonName: string; now: Date; years?: number; modulusLength?: number }): Promise<GeneratedKey> {
  const keys = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: options.modulusLength ?? 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as { privateKey: CryptoKeyLike; publicKey: CryptoKeyLike };
  const spki = new Uint8Array(await crypto.subtle.exportKey("spki", keys.publicKey));
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", keys.privateKey));

  const notAfter = new Date(options.now);
  notAfter.setUTCFullYear(notAfter.getUTCFullYear() + (options.years ?? 10));
  const serial = randomBytes(16);
  // positive (top bit clear) and minimally encoded (first byte not zero), at most 20 octets
  serial[0] = (serial[0]! & 0x7f) | 0x01;
  const subject = name(options.commonName);

  const tbs = seq(
    explicit(0, tlv(0x02, [2])), // v3
    integer(serial),
    SHA256_WITH_RSA,
    subject, // issuer = subject: self-signed
    seq(time(options.now), time(notAfter)),
    subject,
    Array.from(spki),
  );
  const signature = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", keys.privateKey, Uint8Array.from(tbs)));
  const certificate = seq(tbs, SHA256_WITH_RSA, tlv(0x03, [0, ...signature]));

  return { privateKeyPem: pem("PRIVATE KEY", pkcs8), certificatePem: pem("CERTIFICATE", Uint8Array.from(certificate)) };
}

type CryptoKeyLike = Awaited<ReturnType<typeof crypto.subtle.importKey>>;
