import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
// Usage: node tools/relay-hash.mjs  (rewrites the CSP hashes in every relay/<page>/index.html after an edit)
const root = new URL("../relay/", import.meta.url);
const hash = (s) => "sha256-" + createHash("sha256").update(s).digest("base64");
for (const dir of readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory())) {
  const f = new URL(`${dir.name}/index.html`, root);
  let h = readFileSync(f, "utf8");
  // a page without a script has no script-src, so nothing can run on it
  const script = /<script>([\s\S]*?)<\/script>/.exec(h);
  const style = /<style>([\s\S]*?)<\/style>/.exec(h)[1];
  if (script) h = h.replace(/script-src '[^']*'/, `script-src '${hash(script[1])}'`);
  h = h.replace(/style-src '[^']*'/, `style-src '${hash(style)}'`);
  writeFileSync(f, h);
}
