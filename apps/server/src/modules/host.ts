/**
 * The one object an add-on module's server half reaches the app through (docs/MODULES.md, "Server half"). The module's
 * bundle maps its imports of these specifiers to `modules`, so a state-holding file (the security log, the in-flight
 * work, the rate limits) exists once, the app's own copy.
 */
import * as core from "@banking/core";
import * as hono from "hono";
import * as cliArgs from "../cli-args.ts";
import * as demoData from "../demo-data.ts";
import { EXTENSIONS, type ServerExtension } from "../extensions.ts";
import * as errors from "../platform/errors.ts";
import * as inflight from "../platform/inflight.ts";
import * as outbound from "../platform/outbound.ts";
import * as validate from "../platform/validate.ts";
import * as shared from "../routes/shared.ts";
import * as encoding from "../security/encoding.ts";
import * as rateLimit from "../security/rate-limit.ts";
import * as analysis from "../services/analysis.ts";
import * as importStores from "../services/data-import-stores.ts";
import * as security from "../services/security.ts";

export const HOST_KEY = Symbol.for("omatalous.host");

export interface ModuleHost {
  readonly apiVersion: 1;
  readonly version: string;
  readonly dir: string;
  addExtension(entry: ServerExtension): void;
  readonly modules: Readonly<Record<string, unknown>>;
}

/** The shared modules by the specifier docs/MODULES.md gives each. A new one is added there first. */
const HOST_MODULES: Readonly<Record<string, unknown>> = Object.freeze({
  hono,
  "@banking/core": core,
  "cli-args": cliArgs,
  "demo-data": demoData,
  "platform/errors": errors,
  "platform/inflight": inflight,
  "platform/outbound": outbound,
  "platform/validate": validate,
  "routes/shared": shared,
  "security/encoding": encoding,
  "security/rate-limit": rateLimit,
  "services/analysis": analysis,
  "services/data-import-stores": importStores,
  "services/security": security,
});

/** A host for one module: it may add one entry, with the manifest's id, and none after its register returned. */
export function moduleHost(opts: { id: string; version: string; dir: string; migrationsDir?: string }): { host: ModuleHost; added: () => ServerExtension | null; close: () => void } {
  let added: ServerExtension | null = null;
  let open = true;
  const host: ModuleHost = Object.freeze({
    apiVersion: 1 as const,
    version: opts.version,
    dir: opts.dir,
    modules: HOST_MODULES,
    addExtension(entry: ServerExtension) {
      if (!open) throw new Error("a module adds its entry while it registers");
      if (added) throw new Error("a module adds one entry");
      if (!entry || typeof entry !== "object" || entry.id !== opts.id || typeof entry.routes !== "function") throw new Error("the entry's id differs from the manifest's");
      if (EXTENSIONS.some((e) => e.id === entry.id)) throw new Error("an entry of this id is already registered");
      entry.migrationsDir = opts.migrationsDir;
      added = entry;
      EXTENSIONS.push(entry);
    },
  });
  return {
    host,
    added: () => added,
    close: () => {
      open = false;
    },
  };
}
