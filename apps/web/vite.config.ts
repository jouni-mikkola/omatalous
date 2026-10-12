import { readFileSync } from "node:fs";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { ocrFolder, ocrSources, thirdPartyLicences } from "./ocr-build.ts";

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
      for (const [name, path] of sources) this.emitFile({ type: "asset", fileName: `${dir}/${name}`, source: readFileSync(path) });
      this.emitFile({ type: "asset", fileName: "THIRD-PARTY-LICENSES.txt", source: thirdPartyLicences() });
    },
  };
}

export default defineConfig({
  plugins: [react(), ocrFiles()],
  server: {
    port: 5173,
    proxy: { "/api": "http://localhost:8080" },
  },
});
