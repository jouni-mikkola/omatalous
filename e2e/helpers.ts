import type { Page } from "@playwright/test";

/** Everything a visitor would call "broken": console errors, uncaught errors, failed requests and any 4xx or 5xx. */
export function watch(page: Page): { problems: string[] } {
  const seen = { problems: [] as string[] };
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "assert") seen.problems.push(`console ${m.type()}: ${m.text()} (${m.location().url})`);
  });
  page.on("pageerror", (e) => seen.problems.push(`page error: ${e.message}`));
  page.on("requestfailed", (r) => {
    // The app never aborts a request itself, so an aborted GET is one that a reload or navigation cut off.
    if (r.method() === "GET" && r.failure()?.errorText === "net::ERR_ABORTED") return;
    seen.problems.push(`request failed: ${r.method()} ${r.url()} ${r.failure()?.errorText}`);
  });
  page.on("response", (r) => {
    if (r.status() >= 400) seen.problems.push(`HTTP ${r.status()}: ${r.request().method()} ${r.url()}`);
  });
  return seen;
}

/** How far the page scrolls sideways, in pixels. */
export async function overflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}
