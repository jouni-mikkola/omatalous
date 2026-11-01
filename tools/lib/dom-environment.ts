/**
 * The vitest environment of the page tests (`*.dom.test.ts`): happy-dom, read through Vite's server graph. The stock
 * `happy-dom` environment uses the client graph, which cannot load `node:sqlite`, and a page test starts the real server
 * in the same process (apps/web/test/dom-kit.ts). The server's answers are built with Node's own Headers and Response:
 * happy-dom's would drop `Set-Cookie`, which a browser hides from a script but the cookie jar of the kit needs.
 */
import { builtinEnvironments, type Environment } from "vitest/runtime";

const happy = builtinEnvironments["happy-dom"];
const FETCH_CLASSES = ["Headers", "Request", "Response", "fetch"] as const;

export default <Environment>{
  ...happy,
  name: "dom",
  viteEnvironment: "ssr",
  async setup(global, options) {
    const node = Object.fromEntries(FETCH_CLASSES.map((k) => [k, (globalThis as Record<string, unknown>)[k]]));
    const done = await happy.setup(global, options);
    Object.assign(global, node);
    return done;
  },
};
