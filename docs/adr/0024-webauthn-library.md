# 0024 A library for passkeys

## Context

A passkey is a second sign-in factor beside the authenticator code (docs/ROADMAP.md, second factor). Checking a
WebAuthn answer means parsing CBOR, reading a COSE key and verifying a signature over the authenticator data and the
hash of the client data, with the origin, the relying party hash, the flags and the counter checked in the right order. A
mistake there is a sign-in that anyone passes, so the household's app does not write it itself.

## Decision

`@simplewebauthn/server` 14.0.3 (MIT, Node 20 or later, 10 dependencies of the `@peculiar` family, `tiny-cbor` and
`@hexagon/base64`). It is used on the server only. The browser calls `navigator.credentials` itself and converts
base64url in about thirty lines (`apps/web/src/webauthn.ts`), so `@simplewebauthn/browser` is not added.

Attestation is `none`: the app wants a key it can verify later, not a proof of which device made it, and it keeps no
attestation roots. Only the library's `verify*` functions are called.

| Choice | Measured | Review | Trigger |
|---|---|---|---|
| `@simplewebauthn/server` 14.0.3 | the four functions bundled with esbuild 0.28, minified: 441 kB, 114 kB gzip, in the server bundle only | 2027-10-30 | a security advisory, a breaking change in a minor release, or no release in 6 months |

Rejected: writing the verification with `node:crypto` (the risk above), `@github/webauthn-json` (archived), and
`@simplewebauthn/browser` (the part the web needs is small).

## Consequences

The server bundle grows by the size above; the web bundle by nothing. A release of the library is a change of
`pnpm-lock.yaml` reviewed with its changelog. Passkeys work only on an https address or on `localhost`
(`services/passkeys.ts` says so on the page).
