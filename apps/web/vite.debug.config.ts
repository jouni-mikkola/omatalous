import { mergeConfig, type Plugin } from "vite";
import base from "./vite.config.ts";

const short = (id: string) => id.replace(/^.*\/node_modules\//, "nm:").replace(/^.*\/(apps|packages)\//, "$1/").replace(/^(apps\/web\/src|packages\/core\/src)\//, "");

const modules: Plugin = {
  name: "debug-modules",
  apply: "build",
  generateBundle(_, bundle) {
    const chunks = new Map<string, any>();
    for (const file of Object.values(bundle)) if (file.type === "chunk") chunks.set(file.fileName, file);
    const roots = [...chunks.values()].filter((c) => c.isEntry || /^assets\/(OverviewView|messages-late)-/.test(c.fileName));
    const seen = new Set<string>();
    const visit = (name: string) => {
      if (seen.has(name) || !chunks.has(name)) return;
      seen.add(name);
      for (const next of chunks.get(name).imports) visit(next.startsWith("assets/") ? next : `assets/${next}`);
    };
    roots.forEach((c) => visit(c.fileName));
    for (const name of seen) {
      const c = chunks.get(name);
      console.log(`CHUNK ${name} ${c.code.length}`);
      for (const [id, m] of Object.entries<any>(c.modules)) {
        if (m.renderedLength < 1200 || id.includes("node_modules")) continue;
        console.log(`MOD ${m.renderedLength} ${short(id)} [${name.replace(/^assets\//, "").replace(/-[\w-]{8}\.js$/, "")}]`);
      }
    }
  },
};

export default mergeConfig(base, { plugins: [modules] });
