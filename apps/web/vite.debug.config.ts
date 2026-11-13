import { mergeConfig, type Plugin } from "vite";
import base from "./vite.config.ts";

const short = (id: string) => id.replace(/^.*\/node_modules\//, "nm:").replace(/^.*\/(apps|packages)\//, "$1/").replace(/^(apps\/web\/src|packages\/core\/src)\//, "");

const modules: Plugin = {
  name: "debug-modules",
  apply: "build",
  generateBundle(_, bundle) {
    const rendered = new Map<string, { len: number; chunk: string }>();
    for (const file of Object.values(bundle)) {
      if (file.type !== "chunk") continue;
      for (const [id, m] of Object.entries(file.modules)) if (m.renderedLength > 0) rendered.set(id, { len: m.renderedLength, chunk: file.fileName.replace(/^assets\//, "").replace(/-[\w-]{8}\.js$/, "") });
    }
    for (const file of Object.values(bundle)) {
      if (file.type !== "chunk") continue;
      const name = file.fileName.replace(/^assets\//, "").replace(/-[\w-]{8}\.js$/, "");
      console.log(`CHUNK ${file.fileName} ${file.code.length} imports=${file.imports.join(",")}`);
      if (name !== "Cells") continue;
      for (const [id, m] of Object.entries(file.modules)) {
        if (m.renderedLength < 1500) continue;
        const info = this.getModuleInfo(id);
        const by = (info?.importers ?? []).filter((i) => rendered.has(i)).map((i) => `${short(i)}[${rendered.get(i)!.chunk}]`);
        console.log(`MOD ${m.renderedLength} ${short(id)} <- ${by.join(" ")}`);
      }
    }
  },
};

export default mergeConfig(base, { plugins: [modules] });
