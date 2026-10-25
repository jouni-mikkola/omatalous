import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { ocrFolder, ocrSources, thirdPartyLicences } from "./ocr-build.ts";
import { shellFiles, shellWorkerSource } from "./shell-build.ts";

/**
 * The files the picture reader of Asetukset > Lainat loads while it runs: the Tesseract worker, its WASM core (the one
 * with SIMD or the one without, by what the browser can do) and the Finnish and English data. The worker loads them by
 * address, so the bundler never sees them and they are copied here. The app serves them itself: no browser fetches
 * them from another host. Their folder under assets/ is named by their content, so the server caches them like every
 * hashed file. One file of third-party licences goes into dist with them (THIRD-PARTY-LICENSES.txt).
 */
function ocrFiles(): Plugin {
  const sources = ocrSources();
  const dir = ocrFolder(sources);
  return {
    name: "ocr-files",
    config: () => ({ define: { __OCR_DIR__: JSON.stringify(dir) } }),
    // `pnpm dev`: the same addresses, straight from node_modules
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const [, name] = new RegExp(`^/${dir}/([^/?]+)`).exec(req.url ?? "") ?? [];
        const path = name && sources.get(name);
        if (!path) return next();
        res.setHeader("Content-Type", name.endsWith(".js") ? "text/javascript" : "application/gzip");
        res.end(readFileSync(path));
      });
    },
    generateBundle() {
      for (const [name, path] of sources) {
        // the packages' workers end by naming a source map that is not shipped, and a public bundle names none
        const body = readFileSync(path);
        const source = name.endsWith(".js") ? body.toString("utf8").replace(/\n?\/\/# sourceMappingURL=\S+\s*$/, "\n") : body;
        this.emitFile({ type: "asset", fileName: `${dir}/${name}`, source });
      }
      this.emitFile({ type: "asset", fileName: "THIRD-PARTY-LICENSES.txt", source: thirdPartyLicences() });
    },
  };
}

/**
 * `sw.js`, the service worker that keeps the app's own files so it opens offline (see sw.js). It is written after the
 * build has copied everything, since it lists the files and hashes them. `pnpm dev` has none: the page registers it
 * only in the build.
 */
function shellWorker(): Plugin {
  let outDir = "";
  return {
    name: "shell-worker",
    apply: "build",
    enforce: "post",
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      writeFileSync(join(outDir, "sw.js"), shellWorkerSource(readFileSync(new URL("./sw.js", import.meta.url), "utf8"), outDir, shellFiles(outDir, ocrFolder(ocrSources()))));
    },
  };
}

export default defineConfig({
  plugins: [react(), ocrFiles(), shellWorker()],
  server: {
    // a second clone runs its dev servers beside the first with WEB_PORT and API_PORT
    port: Number(process.env.WEB_PORT ?? 5173),
    proxy: { "/api": `http://localhost:${process.env.API_PORT ?? 8080}` },
  },
  // the image ships minified bundles and no map back to the source; written out so a change cannot turn maps on quietly
  build: { sourcemap: false, minify: true },
});
