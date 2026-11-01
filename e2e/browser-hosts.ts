import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { type Browser, chromium } from "@playwright/test";

/**
 * Writes every host the browser asks for (the `request` event of each context, so a request a spec answers with `route` counts
 * too, and a WebSocket) to a file as `browser\t<host>`, when E2E_HOSTS_DIR is set. Decision: which hosts the browser calls, to hold
 * them to the list in docs/SECURITY.md (tools/lib/outside-hosts.mjs). Imported by the config, which every worker loads: the
 * `browser` fixture launches or connects through the same `chromium`, and every context is made by `browser.newContext` (`newPage` calls it too).
 */
const dir = process.env.E2E_HOSTS_DIR;
if (dir) {
  const file = join(dir, `browser-${process.pid}.log`);
  const note = (address: string) => {
    let url: URL;
    try {
      url = new URL(address);
    } catch {
      return;
    }
    if (/^(https?|wss?):$/.test(url.protocol)) appendFileSync(file, `browser\t${url.hostname}\n`);
  };
  const watch = (browser: Browser) => {
    const newContext = browser.newContext.bind(browser);
    browser.newContext = async (...options) => {
      const context = await newContext(...options);
      context.on("request", (request) => note(request.url()));
      context.on("page", (page) => page.on("websocket", (socket) => note(socket.url())));
      return context;
    };
    return browser;
  };
  // the fixture connects instead of launching when PW_TEST_CONNECT_WS_ENDPOINT is set
  const launch = chromium.launch.bind(chromium);
  chromium.launch = async (...args) => watch(await launch(...args));
  const connect = chromium.connect.bind(chromium);
  chromium.connect = (async (...args: Parameters<typeof connect>) => watch(await connect(...args))) as typeof chromium.connect;
}
