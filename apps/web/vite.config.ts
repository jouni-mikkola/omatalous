import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import babel from "@rolldown/plugin-babel";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { compressFolder } from "./compress-build.ts";
import { shellFiles, shellWorkerSource } from "./shell-build.ts";

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
      writeFileSync(join(outDir, "sw.js"), shellWorkerSource(readFileSync(new URL("./sw.js", import.meta.url), "utf8"), outDir, shellFiles(outDir)));
    },
  };
}

/**
 * `.br` and `.gz` copies of the text files of the build, for the server to send as they are. It runs after
 * `shellWorker`, which writes sw.js and lists the files that exist then, so the copies are neither listed there nor
 * missing for sw.js.
 */
function precompress(): Plugin {
  let outDir = "";
  return {
    name: "precompress",
    apply: "build",
    enforce: "post",
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      compressFolder(outDir);
    },
  };
}

/**
 * The layer order line of base.css (`@layer reset, tokens, ...;`) at the top of every stylesheet of the build. The
 * minifier drops the line, and then the order is that of the blocks in whichever sheet the browser loads first. The
 * sheet a lazy page and the first page share (table.css) loads before the main one and put `base` over `components`.
 */
function layerOrder(): Plugin {
  const order = /^@layer [^{;]+;/m.exec(readFileSync(new URL("./src/styles/base.css", import.meta.url), "utf8"))?.[0];
  return {
    name: "layer-order",
    apply: "build",
    enforce: "post",
    generateBundle(_, bundle) {
      if (!order) throw new Error("src/styles/base.css has no @layer order line");
      for (const file of Object.values(bundle)) {
        if (file.type === "asset" && file.fileName.endsWith(".css")) file.source = `${order.replace(/\s+/g, " ")}${file.source}`;
      }
    },
  };
}

export default defineConfig({
  // React Compiler memoises at build time (ADR 0019); a component it breaks opens with "use memo" turned off: "use no memo", with the reason
  plugins: [react(), babel({ presets: [reactCompilerPreset()] }), layerOrder(), shellWorker(), precompress()],
  server: {
    // a second clone runs its dev servers beside the first with WEB_PORT and API_PORT
    port: Number(process.env.WEB_PORT ?? 5173),
    proxy: { "/api": `http://localhost:${process.env.API_PORT ?? 8080}` },
  },
  // the image ships minified bundles and no map back to the source; written out so a change cannot turn maps on quietly
  build: { sourcemap: false, minify: true },
});
