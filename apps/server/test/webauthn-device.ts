/**
 * A software authenticator for the tests: makes the JSON a browser sends for `navigator.credentials.create` (attestation
 * `none`) and `.get`, with an ES256 key it keeps. It is what a real device does at the level the server sees, so a test
 * checks the server against the format, not against a mock of the library.
 */
import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";

const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64url");
const sha = (b: Uint8Array | string) => createHash("sha256").update(b).digest();

type Cbor = number | string | Uint8Array | Map<number | string, Cbor>;

/** The few CBOR shapes a passkey needs: integers, byte and text strings, and maps. */
function cbor(v: Cbor): Buffer {
  const head = (major: number, n: number) => (n < 24 ? Buffer.from([(major << 5) | n]) : n < 256 ? Buffer.from([(major << 5) | 24, n]) : Buffer.from([(major << 5) | 25, n >> 8, n & 255]));
  if (typeof v === "number") return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (typeof v === "string") return Buffer.concat([head(3, Buffer.byteLength(v)), Buffer.from(v)]);
  if (v instanceof Uint8Array) return Buffer.concat([head(2, v.length), v]);
  return Buffer.concat([head(5, v.size), ...[...v].flatMap(([k, x]) => [cbor(k), cbor(x)])]);
}

export class Device {
  readonly credentialId = randomBytes(32);
  private readonly key: { privateKey: KeyObject; publicKey: KeyObject } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  counter = 0;

  constructor(private readonly flags = 0x01) {}

  private authData(rpId: string, attested: boolean): Buffer {
    const counter = Buffer.alloc(4);
    counter.writeUInt32BE(this.counter);
    const base = Buffer.concat([sha(rpId), Buffer.from([this.flags | (attested ? 0x40 : 0)]), counter]);
    if (!attested) return base;
    const jwk = this.key.publicKey.export({ format: "jwk" });
    const cose = cbor(new Map<number, Cbor>([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x!, "base64url")], [-3, Buffer.from(jwk.y!, "base64url")]]));
    const idLength = Buffer.alloc(2);
    idLength.writeUInt16BE(this.credentialId.length);
    return Buffer.concat([base, Buffer.alloc(16), idLength, this.credentialId, cose]);
  }

  private clientData(type: string, challenge: string, origin: string): Buffer {
    return Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
  }

  /** The answer to the creation options (`challenge` is the options' base64url challenge). */
  create(challenge: string, o: { rpId: string; origin: string }) {
    const attestation = cbor(new Map<string, Cbor>([["fmt", "none"], ["attStmt", new Map()], ["authData", this.authData(o.rpId, true)]]));
    return {
      id: b64(this.credentialId),
      rawId: b64(this.credentialId),
      type: "public-key",
      response: { clientDataJSON: b64(this.clientData("webauthn.create", challenge, o.origin)), attestationObject: b64(attestation), transports: ["internal"] },
      clientExtensionResults: {},
    };
  }

  /** The answer to the request options; the counter goes up by one as a real device's does. */
  get(challenge: string, o: { rpId: string; origin: string }) {
    this.counter += 1;
    const data = this.clientData("webauthn.get", challenge, o.origin);
    const authData = this.authData(o.rpId, false);
    const signature = sign("sha256", Buffer.concat([authData, sha(data)]), this.key.privateKey);
    return {
      id: b64(this.credentialId),
      rawId: b64(this.credentialId),
      type: "public-key",
      response: { clientDataJSON: b64(data), authenticatorData: b64(authData), signature: b64(signature) },
      clientExtensionResults: {},
    };
  }
}
