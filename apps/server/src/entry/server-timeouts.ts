/**
 * How long the HTTP server keeps an idle connection. The proxy in front of the app must be
 * the side that closes first: a server that closes while the proxy sends a new request on
 * the same connection fails that request.
 */

/**
 * Above the 90 s that cloudflared keeps an idle connection to the app by default (its
 * `keepAliveTimeout`, developers.cloudflare.com/tunnel/reference/origin-parameters).
 * Node's own default is 5 s, which closes long before the proxy does.
 */
const KEEP_ALIVE_TIMEOUT_MS = 95_000;

/**
 * Above the keep-alive time: Node's default of 60 s is below it, and a header limit under the
 * keep-alive time can close a connection the server still promises to keep open.
 */
const HEADERS_TIMEOUT_MS = KEEP_ALIVE_TIMEOUT_MS + 5_000;

/** Sets both times on an HTTP/1 server; `requestTimeout` and a server without these settings (HTTP/2) are left alone. */
export function applyServerTimeouts(server: object): void {
  if (!("keepAliveTimeout" in server) || !("headersTimeout" in server)) return;
  const http1 = server as { keepAliveTimeout: number; headersTimeout: number };
  http1.keepAliveTimeout = KEEP_ALIVE_TIMEOUT_MS;
  http1.headersTimeout = HEADERS_TIMEOUT_MS;
}
