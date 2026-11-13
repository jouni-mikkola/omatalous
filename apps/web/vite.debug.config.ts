import { mergeConfig, type Plugin } from "vite";
import base from "./vite.config.ts";

const modules: Plugin = {
  name: "debug-modules",
  apply: "build",
  generateBundle(_, bundle) {
    for (const file of Object.values(bundle)) {
      if (file.type !== "chunk") continue;
      const list = Object.entries(file.modules)
        .map(([id, m]) => [m.renderedLength, id.replace(/^.*\/node_modules\//, "nm:").replace(/^.*\/omatalous\//, "")] as const)
        .sort((a, b) => b[0] - a[0])
        .slice(0, 25);
      console.log(`CHUNK ${file.fileName} ${file.code.length} imports=${file.imports.join(",")}`);
      for (const [len, id] of list) console.log(`   MOD ${len} ${id}`);
    }
  },
};

export default mergeConfig(base, { plugins: [modules] });
