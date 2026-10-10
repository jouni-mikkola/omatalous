import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
// Usage: node scripts/relay-hash.mjs  (rewrites the CSP hashes in relay/paluu/index.html after an edit)
const f = new URL("../relay/paluu/index.html", import.meta.url);
let h = readFileSync(f, "utf8");
const hash = (s) => "sha256-" + createHash("sha256").update(s).digest("base64");
const script = /<script>([\s\S]*?)<\/script>/.exec(h)[1];
const style = /<style>([\s\S]*?)<\/style>/.exec(h)[1];
h = h.replace(/script-src '[^']*'/, `script-src '${hash(script)}'`).replace(/style-src '[^']*'/, `style-src '${hash(style)}'`);
writeFileSync(f, h);
