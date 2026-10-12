/**
 * Encrypts small secrets at rest (Enable Banking private keys) with
 * AES-256-GCM. The key is derived with HKDF from APP_SECRET, which lives
 * outside the database (/secrets/app_secret, see entry/app-secret.ts), so a
 * stolen database file alone does not reveal the bank keys.
 *
 * Format: "v1.<iv>.<ciphertext+tag>" (base64url).
 */
import { isAppSecret } from "../entry/app-secret.ts";
import { fromBase64Url, randomBytes, toBase64Url, utf8 } from "./encoding.ts";

export class SecretBox {
  private constructor(private readonly key: CryptoKeyLike) {}

  static async fromSecret(secret: string): Promise<SecretBox> {
    if (!isAppSecret(secret)) throw new Error("APP_SECRET must be at least 32 characters");
    const material = await crypto.subtle.importKey("raw", utf8.encode(secret), "HKDF", false, ["deriveKey"]);
    const key = await crypto.subtle.deriveKey(
      { name: "HKDF", hash: "SHA-256", salt: utf8.encode("banking-app/secretbox"), info: utf8.encode("v1") },
      material,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
    return new SecretBox(key);
  }

  async seal(plaintext: string, context: string): Promise<string> {
    const iv = randomBytes(12);
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: utf8.encode(context) }, this.key, utf8.encode(plaintext));
    return `v1.${toBase64Url(iv)}.${toBase64Url(new Uint8Array(ct))}`;
  }

  /** `context` (e.g. the user id) must match the one used to seal: a value copied to another user's row will not decrypt. */
  async open(sealed: string, context: string): Promise<string> {
    const [version, iv, ct] = sealed.split(".");
    if (version !== "v1" || !iv || !ct) throw new Error("Unknown secret format");
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64Url(iv), additionalData: utf8.encode(context) }, this.key, fromBase64Url(ct));
    return new TextDecoder().decode(pt);
  }
}

type CryptoKeyLike = Awaited<ReturnType<typeof crypto.subtle.importKey>>;
