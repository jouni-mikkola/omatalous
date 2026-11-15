// @ts-check
/**
 * Preloaded into the server of an e2e run (`node --import`, e2e/server.mjs) when E2E_HOSTS_DIR is set: every TCP connection
 * the server opens (fetch, http, https, all go through a socket) is written to a file as `server\t<host>`. Decision: which
 * hosts the server calls, to hold them to the list in docs/SECURITY.md (tools/lib/outside-hosts.mjs). A path (unix socket)
 * has no host and is not recorded.
 */
import { appendFileSync } from "node:fs";
import { Socket } from "node:net";
import { join } from "node:path";

const dir = process.env.E2E_HOSTS_DIR;
if (dir) {
  const file = join(dir, `server-${process.pid}.log`);
  const connect = Socket.prototype.connect;
  Socket.prototype.connect = /** @type {typeof connect} */ (
    /** @this {any} */
    function (/** @type {any[]} */ ...args) {
      // net.connect hands the socket its arguments already normalized, as [options, callback]
      const first = Array.isArray(args[0]) ? args[0][0] : args[0];
      /** The three forms: ({ host, port }), (port, host), (path). */
      const host = typeof first === "object" && first ? (first.host ?? (first.path ? undefined : "localhost")) : typeof first === "number" ? (typeof args[1] === "string" ? args[1] : "localhost") : undefined;
      if (typeof host === "string") appendFileSync(file, `server\t${host.includes(":") ? `[${host}]` : host}\n`);
      return connect.apply(this, /** @type {any} */ (args));
    }
  );
}
