/**
 * What the build puts into the service worker (`shellWorker` in vite.config.ts): the files of the app that it keeps so the
 * app opens with no network, and a cache name made from their content. Node only: the web app never imports this.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

/** The address of every file of the built app that the worker keeps, sorted. The worker itself stays out, and so do the old `.woff` fonts (a browser with a worker reads `.woff2`) and the `.br` and `.gz` copies the server sends in place of a file. */
export function shellFiles(outDir: string): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else found.push("/" + relative(outDir, path).split(sep).join("/"));
    }
  };
  walk(outDir);
  return found.filter((f) => f !== "/sw.js" && !f.endsWith(".woff") && !f.endsWith(".br") && !f.endsWith(".gz")).sort();
}

/** The worker's source with `__SHELL__` replaced: `{ name: "shell-<hash of the files' names and bytes>", files }`. A changed file is a changed worker, which a browser installs and the old one's cache goes. */
export function shellWorkerSource(template: string, outDir: string, files: readonly string[]): string {
  const hash = createHash("sha256");
  for (const f of files) hash.update(f).update(readFileSync(join(outDir, f)));
  const shell = { name: `shell-${hash.digest("hex").slice(0, 12)}`, files };
  if (!template.includes("__SHELL__")) throw new Error("sw.js has no __SHELL__ to fill in");
  return template.replace("__SHELL__", JSON.stringify(shell));
}
