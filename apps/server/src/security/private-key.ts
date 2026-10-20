/**
 * Accepts an uploaded RSA private key only after proving it is one, and
 * stores the server's own re-encoding of it, never the uploaded bytes.
 *
 * Checks, in order: size, plain text only, exactly one PEM block of an
 * allowed type, valid base64, WebCrypto imports it as an RSA key of at
 * least 2048 bits. Then it is re-exported as PKCS#8. A script, binary or anything
 * smuggled around the PEM block fails one of these steps.
 */
import { importPrivateKey } from "./rsa-key.ts";

/** A 4096-bit PKCS#1 key is about 3.3 KB; anything near this limit is not a key. */
export const MAX_PEM_BYTES = 16 * 1024;

export class KeyProblem extends Error {}

const PEM_BLOCK = /^-----BEGIN (RSA PRIVATE KEY|PRIVATE KEY)-----\n([A-Za-z0-9+/=\n]+)\n-----END \1-----$/;

export async function canonicalPrivateKey(input: unknown): Promise<string> {
  if (typeof input !== "string" || !input.trim()) throw new KeyProblem("Valitse tai liitä yksityinen avain (.pem).");
  if (input.length > MAX_PEM_BYTES) throw new KeyProblem("Tiedosto ei ole yksityinen avain.");
  // literal "\n" sequences come from keys pasted out of .env files
  const text = input.replace(/\\n/g, "\n").replace(/\r\n?/g, "\n").trim();
  // binaries (ELF, PE, archives) and scripts contain bytes or text a PEM file never has
  if (/[^\x20-\x7e\n\t]/.test(text)) throw new KeyProblem("Tiedosto ei ole tekstimuotoinen avain. Valitse Enable Bankingin lataama .pem-tiedosto.");
  if (/-----BEGIN CERTIFICATE-----/.test(text)) throw new KeyProblem("Tämä on varmenne. Valitse yksityinen avain (BEGIN PRIVATE KEY).");
  if (/ENCRYPTED/.test(text)) throw new KeyProblem("Avain on salasanasuojattu. Tallenna se ilman salasanaa (openssl pkey -in avain.pem -out uusi.pem).");

  const match = PEM_BLOCK.exec(text.replace(/[ \t]+$/gm, ""));
  if (!match) throw new KeyProblem("Tiedostossa pitää olla yksi yksityinen avain (BEGIN PRIVATE KEY) eikä muuta.");

  let key: CryptoKeyLike;
  try {
    // extractable only here, so the key can be re-encoded below
    key = await importPrivateKey(text, true);
  } catch {
    throw new KeyProblem("Avainta ei voitu lukea RSA-avaimena.");
  }
  const algorithm = key.algorithm as { modulusLength?: number };
  if ((algorithm.modulusLength ?? 0) < 2048) throw new KeyProblem("Avain on liian lyhyt. Tarvitaan vähintään 2048-bittinen RSA-avain.");

  // the stored key is our own encoding; the uploaded text is discarded
  return toPem(new Uint8Array(await crypto.subtle.exportKey("pkcs8", key)));
}

function toPem(der: Uint8Array): string {
  let bin = "";
  for (const b of der) bin += String.fromCharCode(b);
  return `-----BEGIN PRIVATE KEY-----\n${(btoa(bin).match(/.{1,64}/g) ?? []).join("\n")}\n-----END PRIVATE KEY-----\n`;
}

type CryptoKeyLike = Awaited<ReturnType<typeof crypto.subtle.importKey>>;
