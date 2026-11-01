import { expect, test } from "@playwright/test";
import { watch } from "./helpers.ts";

// The style policy has no 'unsafe-inline'. This spec proves the two halves of that: the header says so, and a style
// attribute really is blocked and shows up as a policy report that watch() turns into a failure of every other spec.
test("the response allows no inline style, and a blocked one is reported", async ({ page, request, baseURL }) => {
  const head = (await request.get(`${baseURL}/`)).headers()["content-security-policy"] ?? "";
  expect(head).toMatch(/style-src 'self'(;|$)/);
  expect(head).not.toContain("unsafe-inline");

  const seen = watch(page);
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  expect(seen.problems, "the front page raises no policy report").toEqual([]);

  // an inline style attribute written as HTML is blocked; one set through the CSSOM is not
  await page.evaluate(() => {
    document.body.insertAdjacentHTML("beforeend", '<i id="html-style" style="width: 33px"></i>');
    const el = document.createElement("i");
    el.id = "cssom-style";
    el.style.setProperty("width", "44px");
    document.body.append(el);
  });
  await expect.poll(() => seen.problems.length).toBeGreaterThan(0);
  expect(seen.problems.join("\n")).toContain("policy report: style-src-attr");
  expect(await page.locator("#cssom-style").evaluate((el) => (el as HTMLElement).style.width)).toBe("44px");
  expect(await page.locator("#html-style").evaluate((el) => (el as HTMLElement).style.width)).toBe("");
});
