import { expect, test } from "@playwright/test";
import { finnishIn } from "./finnish-words.ts";
import type { Page } from "@playwright/test";
import { linkFakeBank, makeMember, removeMember } from "./helpers.ts";

// English beside Finnish, the Done-when: every page in English shows no Finnish text. All visible text of a page is
// compared with the Finnish word list. A page whose texts are not in the catalogue yet is scanned for its frame only (the
// header, the menus and the footer); moving a page to "all" is part of moving its texts, and the scan then holds it.
const PAGES: { path: string; scan: "all" | "frame" }[] = [
  { path: "overview", scan: "all" },
  { path: "bills", scan: "all" },
  { path: "transactions", scan: "all" },
  { path: "transactions?view=merchants", scan: "all" },
  { path: "reports", scan: "all" },
  // every question page of Raportit; the first one is the page above
  ...["kuukausi", "menot", "tulot", "kiinteat", "velat", "saldot", "yhteiset"].map((q) => ({ path: `reports?q=${q}`, scan: "all" as const })),
  { path: "optimise", scan: "all" },
  { path: "review", scan: "all" },
  // the tabs of Asetukset a member sees; the administrator's tabs are scanned by the test below
  ...["banks", "household", "security", "data"].map((tab) => ({ path: `settings/${tab}`, scan: "all" as const })),
];

const FETCH = { "X-Requested-With": "fetch" };

/** Opens each page and returns the Finnish words found on it, as `path: word`. */
async function scanPages(page: Page, pages: { path: string; scan: "all" | "frame" }[]): Promise<string[]> {
  const found: string[] = [];
  for (const { path, scan } of pages) {
    await page.goto(`/#/${path}`);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.locator("header.topbar")).toBeVisible();
    // the page has settled when the loading text is gone
    await page.waitForLoadState("networkidle");
    await expect(page.getByText("Loading…")).toHaveCount(0);
    await expect(page.locator("[aria-busy=true]")).toHaveCount(0);
    const parts = scan === "all" ? [page.locator("body")] : [page.locator("header.topbar"), page.locator("footer.sheet-foot")];
    for (const part of parts) {
      // the user menu is closed: its items are read from the page text all the same; the language picker names itself in both languages on purpose
      const text = await part.evaluate((el) => {
        return (el as HTMLElement).innerText + " " + Array.from(el.querySelectorAll("[aria-label], [title]")).map((e) => `${e.getAttribute("aria-label") ?? ""} ${e.getAttribute("title") ?? ""}`).join(" ");
      });
      for (const word of finnishIn(text.replaceAll("Kieli / Language", "").replaceAll("Suomi", ""))) found.push(`${path}: ${word}`);
    }
  }
  return found;
}

test("the scan sees Finnish: a page in Finnish fails it", async ({ browser }) => {
  const { state, id } = await makeMember(browser, "skannaajafi");
  const member = await browser.newContext({ storageState: state });
  try {
    const page = await member.newPage();
    await page.goto("/#/overview");
    await expect(page.locator("html")).toHaveAttribute("lang", "fi");
    const text = await page.locator("header.topbar").innerText();
    expect(finnishIn(text)).toContain("tarkistettavat");
  } finally {
    await member.close();
    await removeMember(browser, id);
  }
});

test("every page in English shows no Finnish text", async ({ browser }) => {
  const { state, id } = await makeMember(browser, "skannaajaen");
  const member = await browser.newContext({ storageState: state });
  try {
    // a linked household, so the pages show their figures and not only their empty states (linking is done in Finnish)
    const first = await member.newPage();
    await linkFakeBank(first);
    await first.close();
    const setup = await member.request.put("/api/language", { headers: { "X-Requested-With": "fetch" }, data: { language: "en" } });
    expect(setup.ok()).toBe(true);
    const page = await member.newPage();
    const found = await scanPages(page, PAGES);
    expect(found, "Finnish words on a page in English").toEqual([]);
  } finally {
    await member.close();
    await removeMember(browser, id);
  }
});

test("the administrator's tabs of Asetukset in English show no Finnish text", async ({ browser }) => {
  const { state, id } = await makeMember(browser, "skannaajaadm", "admin");
  const member = await browser.newContext({ storageState: state });
  try {
    const setup = await member.request.put("/api/language", { headers: FETCH, data: { language: "en" } });
    expect(setup.ok()).toBe(true);
    const page = await member.newPage();
    const found = await scanPages(page, ["members", "server"].map((tab) => ({ path: `settings/${tab}`, scan: "all" as const })));
    expect(found, "Finnish words on a page in English").toEqual([]);
  } finally {
    await member.close();
    await removeMember(browser, id);
  }
});

test("the sign-in screen reads the language kept on the device and shows no Finnish text", async ({ browser }) => {
  // nobody is signed in: the device's language is the only one there is. The picker offers it on the screen itself.
  const device = await browser.newContext();
  try {
    const page = await device.newPage();
    await page.goto("/");
    await page.getByLabel("Kieli / Language").selectOption("en");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByLabel("Kieli / Language")).toHaveValue("en");
    const text = await page.locator("body").innerText();
    expect(finnishIn(text.replaceAll("Kieli / Language", "").replaceAll("Suomi", "")), "Finnish words on the sign-in screen").toEqual([]);
    // the choice stays after a reload, with nobody signed in
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  } finally {
    await device.close();
  }
});
