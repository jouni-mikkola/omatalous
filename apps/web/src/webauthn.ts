/**
 * The browser's side of a passkey: the server's JSON options become what `navigator.credentials` takes, and the
 * credential it returns becomes the JSON the server checks. The binary fields travel as base64url.
 */
interface Descriptor {
  id: string;
  type: "public-key";
  transports?: string[];
}
export interface CreationOptions {
  challenge: string;
  rp: { name: string; id?: string };
  user: { id: string; name: string; displayName: string };
  pubKeyCredParams: { type: "public-key"; alg: number }[];
  timeout?: number;
  excludeCredentials?: Descriptor[];
  authenticatorSelection?: AuthenticatorSelectionCriteria;
  attestation?: AttestationConveyancePreference;
}
export interface RequestOptions {
  challenge: string;
  rpId?: string;
  timeout?: number;
  allowCredentials?: Descriptor[];
  userVerification?: UserVerificationRequirement;
}

export function toBytes(b64url: string): Uint8Array<ArrayBuffer> {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(b64url.length / 4) * 4, "=");
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

export function toBase64Url(buffer: ArrayBuffer): string {
  let text = "";
  for (const byte of new Uint8Array(buffer)) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const descriptor = (d: Descriptor): PublicKeyCredentialDescriptor => ({ type: d.type, id: toBytes(d.id), transports: d.transports as AuthenticatorTransport[] | undefined });

export const passkeysSupported = (): boolean => typeof window !== "undefined" && !!window.PublicKeyCredential && !!navigator.credentials;

/** Null when the person dismissed the browser's prompt. */
export async function createPasskey(o: CreationOptions): Promise<unknown | null> {
  const credential = (await navigator.credentials
    .create({
      publicKey: {
        ...o,
        challenge: toBytes(o.challenge),
        user: { ...o.user, id: toBytes(o.user.id) },
        excludeCredentials: o.excludeCredentials?.map(descriptor),
      },
    })
    .catch(refused)) as PublicKeyCredential | null;
  if (!credential) return null;
  const r = credential.response as AuthenticatorAttestationResponse;
  return {
    id: credential.id,
    rawId: toBase64Url(credential.rawId),
    type: credential.type,
    response: { clientDataJSON: toBase64Url(r.clientDataJSON), attestationObject: toBase64Url(r.attestationObject), transports: r.getTransports?.() ?? [] },
    authenticatorAttachment: credential.authenticatorAttachment ?? undefined,
  };
}

/** Null when the person dismissed the browser's prompt. */
export async function getPasskey(o: RequestOptions): Promise<unknown | null> {
  const credential = (await navigator.credentials
    .get({ publicKey: { ...o, challenge: toBytes(o.challenge), allowCredentials: o.allowCredentials?.map(descriptor) } })
    .catch(refused)) as PublicKeyCredential | null;
  if (!credential) return null;
  const r = credential.response as AuthenticatorAssertionResponse;
  return {
    id: credential.id,
    rawId: toBase64Url(credential.rawId),
    type: credential.type,
    response: {
      clientDataJSON: toBase64Url(r.clientDataJSON),
      authenticatorData: toBase64Url(r.authenticatorData),
      signature: toBase64Url(r.signature),
      userHandle: r.userHandle ? toBase64Url(r.userHandle) : undefined,
    },
    authenticatorAttachment: credential.authenticatorAttachment ?? undefined,
  };
}

/** The person said no, or the prompt timed out: not an error to show as a failure of the app. */
function refused(err: unknown): null {
  if (err instanceof DOMException && (err.name === "NotAllowedError" || err.name === "AbortError")) return null;
  throw err;
}
