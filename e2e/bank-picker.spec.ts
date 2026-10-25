import { expect, test, type Page } from "@playwright/test";
import { join } from "node:path";
import { overflow, watch } from "./helpers.ts";

// The bank picker in Asetukset > Pankkiyhteydet with the list the server offers: seventeen banks, one, none, the
// renewal of a consent whose bank is on the list or is not, and the logos the server serves. The server has the
// administrator already (e2e/run.mjs makes it).
const STATE = join(process.env.E2E_DIR ?? ".", "admin-state.json");

const NAMES: [string, string][] = [
  ["nordea-fi", "Nordea"],
  ["op-fi", "OP"],
  ["danske-fi", "Danske Bank"],
  ["s-pankki-fi", "S-Pankki"],
  ["saastopankki-fi", "Säästöpankki"],
  ["omasp-fi", "Oma Säästöpankki"],
  ["pop-fi", "POP Pankki"],
  ["aktia-fi", "Aktia"],
  ["alandsbanken-fi", "Ålandsbanken"],
  ["bank-norwegian-fi", "Bank Norwegian"],
  ["resurs-fi", "Resurs Bank"],
  ["morrow-fi", "Morrow Bank"],
  ["eurocard-fi", "Eurocard"],
  ["finnair-plus-fi", "Finnair Plus Mastercard"],
  ["sas-eurobonus-fi", "SAS EuroBonus Mastercard"],
  ["holvi-fi", "Holvi"],
  ["revolut-fi", "Revolut"],
];
const offer = (n: number) => NAMES.slice(0, n).map(([id, name]) => ({ id, name, country: "FI" }));

const consent = (id: string, institution: string, state: string, createdAt: string) => ({
  id,
  institution,
  status: state === "active" ? "active" : "expired",
  state,
  history: false,
  replaced: false,
  validUntil: state === "active" ? "2027-03-20T00:00:00Z" : "2026-09-01T00:00:00Z",
  createdAt,
  lastSyncedAt: null,
  daysLeft: state === "active" ? 160 : null,
});

/** A page of the signed-in administrator whose server offers `banks` and who has `connections`. Starting a bank is recorded, not made. */
async function open(browser: import("@playwright/test").Browser, banks: ReturnType<typeof offer>, connections: ReturnType<typeof consent>[], width = 1280) {
  const context = await browser.newContext({ storageState: STATE, viewport: { width, height: 900 } });
  const page = await context.newPage();
  const seen = watch(page);
  await page.route("**/api/meta", async (route) => {
    // the page reads /api/meta by itself: a read still on its way when the page reloads or the context closes has no response left to change
    const response = await route.fetch().catch(() => null);
    const json = await response?.json().catch(() => null);
    if (!response || !json) return;
    json.connections = connections;
    json.bank = { ...json.bank, configured: true, redirectMode: "own", banks };
    await route.fulfill({ response, json });
  });
  const started: { bank?: string }[] = [];
  await page.route("**/api/connections/start", async (route) => {
    started.push(route.request().postDataJSON());
    await route.fulfill({ json: { url: "/#/settings?connected=1" } });
  });
  return { context, page, seen, started };
}

const tiles = (page: Page) => page.locator(".bank-tile");

test("seventeen banks: searchable, the bank used last first, reachable by keyboard and without sideways scroll at 390 px", async ({ browser }) => {
  const { context, page, seen, started } = await open(browser, offer(17), [consent("c1", "OP", "active", "2026-09-20T00:00:00Z"), consent("c0", "Nordea", "lapsed", "2026-01-10T00:00:00Z")]);
  await page.goto("/#/settings");
  await page.getByRole("button", { name: "Yhdistä pankki" }).click();
  await expect(page.getByRole("heading", { name: "Valitse pankki" })).toBeVisible();

  // all of them, OP (the newest consent) first and marked, a name on a plain plate where there is no logo
  await expect(tiles(page)).toHaveCount(17);
  await expect(tiles(page).first()).toHaveAccessibleName("Yhdistä OP");
  await expect(page.locator(".bank-picker").getByText("Viimeksi käytetty")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Yhdistä Nordea" }).getByRole("img", { name: "Nordea" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Yhdistä Holvi" })).toContainText("Holvi");
  await expect(page.getByText("Muiden pankkien kuin Nordean tapahtumat luokitellaan pankin omien koodien mukaan.")).toBeVisible();

  // the search ignores case and accents and says so when nothing matches
  const search = page.getByRole("searchbox", { name: "Hae pankkia" });
  await search.fill("SAASTO");
  await expect(tiles(page)).toHaveText(["Säästöpankki", "Oma Säästöpankki"]);
  await search.fill("xyz");
  await expect(tiles(page)).toHaveCount(0);
  await expect(page.getByText("Haulla ei löydy pankkia.")).toBeVisible();

  // keyboard only: the search, then the first match, Enter starts that bank
  await search.fill("danske");
  await search.press("Tab");
  await expect(tiles(page).first()).toBeFocused();
  await page.keyboard.press("Enter");
  await expect.poll(() => started.length).toBe(1);
  expect(started[0]).toMatchObject({ bank: "danske-fi" });

  // a phone: two plates in a row, nothing wider than the screen
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto("/#/settings?add=1");
  await search.fill("");
  await expect(tiles(page)).toHaveCount(17);
  expect(await overflow(page)).toBeLessThanOrEqual(1);
  const tops = await tiles(page).evaluateAll((els) => els.slice(0, 2).map((e) => Math.round(e.getBoundingClientRect().top)));
  expect(tops[0], "two plates share a row at 390 px").toBe(tops[1]);
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("one bank: no search and no line about other banks, the list names Nordea alone", async ({ browser }) => {
  const { context, page, seen } = await open(browser, offer(1), []);
  await page.goto("/#/settings?add=1");
  await expect(page.getByRole("heading", { name: "Valitse pankki" })).toBeVisible();
  await expect(tiles(page)).toHaveCount(1);
  await expect(tiles(page).first()).toHaveAccessibleName("Yhdistä Nordea");
  await expect(page.getByRole("searchbox")).toHaveCount(0);
  await expect(page.locator(".bank-picker").getByText("Viimeksi käytetty")).toHaveCount(0);
  await expect(page.getByText("pankin omien koodien")).toHaveCount(0);
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("no bank on the list: it says what is wrong and links to the application in Asetukset > Palvelin", async ({ browser }) => {
  const { context, page, seen } = await open(browser, [], []);
  await page.goto("/#/settings?add=1");
  await expect(page.getByRole("heading", { name: "Valitse pankki" })).toBeVisible();
  await expect(tiles(page)).toHaveCount(0);
  await expect(page.getByText("ei ole pankkeja, joita Omatalous tukee")).toBeVisible();
  await page.getByRole("link", { name: "Asetukset > Palvelin" }).click();
  await expect.poll(() => new URL(page.url()).hash).toBe("#/settings?section=server");
  await expect(page.getByRole("heading", { name: "Palvelin", exact: true })).toBeVisible();
  expect(seen.problems).toEqual([]);
  await context.close();
});

test("a renewal starts the bank it finds by name, and opens the picker for a bank that is not on the list", async ({ browser }) => {
  // the list has Nordea, OP and Oma Säästöpankki, not Aktia
  const list = [offer(17)[0]!, offer(17)[1]!, offer(17)[5]!];
  const { context, page, seen, started } = await open(browser, list, [consent("a", "Oma Säästöpankki", "lapsed", "2026-02-01T00:00:00Z"), consent("b", "Aktia", "lapsed", "2026-01-01T00:00:00Z")]);
  await page.goto("/#/settings");
  const renew = page.getByRole("table").getByRole("button", { name: "Yhdistä uudelleen" });
  await expect(renew).toHaveCount(2);

  // Säästöpankki and Oma Säästöpankki are two banks: the longer name wins
  await page.getByRole("row", { name: /Oma Säästöpankki/ }).getByRole("button", { name: "Yhdistä uudelleen" }).click();
  await expect.poll(() => started.length).toBe(1);
  expect(started[0]).toMatchObject({ bank: "omasp-fi" });
  await expect(page.getByRole("heading", { name: "Valitse pankki" })).toHaveCount(0);

  // the Aktia consent has no bank on the list: the picker opens and takes the focus
  // (the mocked start only changes the hash, so the page is loaded again: a real start leaves the page, and its buttons stay disabled until then)
  await page.goto("/#/settings");
  await page.reload();
  await page.getByRole("row", { name: /Aktia/ }).getByRole("button", { name: "Yhdistä uudelleen" }).click();
  await expect(page.getByRole("heading", { name: "Valitse pankki" })).toBeFocused();
  await expect(tiles(page)).toHaveCount(3);
  expect(started).toHaveLength(1);
  expect(seen.problems).toEqual([]);
  await context.close();
});

// Two pictures made here, as the server would serve them: a wide wordmark cut to its edges, with no size of its own,
// and a square mark. The server's side of a logo is in apps/server/test/bank-logos.test.ts.
const WIDE = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 48"><rect width="48" height="48" rx="10" fill="#0b4a8f"/><rect x="62" y="5" width="178" height="15" rx="4" fill="#0b4a8f"/><rect x="62" y="28" width="118" height="15" rx="4" fill="#0b4a8f"/></svg>';
const SQUARE = '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><circle cx="48" cy="48" r="48" fill="#a3261d"/><circle cx="48" cy="48" r="20" fill="#fff"/></svg>';
/** Set by a run that wants pictures of the page: SHOTS_DIR=$TMPDIR/shots pnpm e2e e2e/app.spec.ts e2e/bank-picker.spec.ts */
const SHOTS = process.env.SHOTS_DIR;

test("served logos: a wide wordmark and a square mark fit the plate at 1366 and 390 px, and the name stays where the picture fails", async ({ browser }) => {
  // OP and Danske Bank have a picture, S-Pankki's fails, and the server has none for the other banks
  const pictures: Record<string, string | null> = { "op-fi": WIDE, "danske-fi": SQUARE, "s-pankki-fi": null };
  const banks = offer(6).map((b) => (b.id in pictures ? { ...b, logo: true } : b));
  const { context, page, seen } = await open(browser, banks, [], 1366);
  const requested: string[] = [];
  page.on("request", (r) => requested.push(r.url()));
  const asked: string[] = [];
  let answer!: () => void;
  const held = new Promise<void>((done) => (answer = done));
  await page.route("**/api/bank/logos/*", async (route) => {
    const id = new URL(route.request().url()).pathname.split("/").pop() ?? "";
    asked.push(id);
    await held;
    const picture = pictures[id];
    if (!picture) return route.fulfill({ status: 404, json: { error: "Logoa ei löydy." } });
    await route.fulfill({ status: 200, contentType: "image/svg+xml", body: picture });
  });
  await page.goto("/#/settings?add=1");
  const tile = (name: string) => page.getByRole("button", { name: `Yhdistä ${name}`, exact: true });

  // until the picture has loaded the plate holds the bank's name
  await expect(tile("OP")).toHaveText("OP");
  await expect(tile("Danske Bank")).toHaveText("Danske Bank");
  await expect(tile("OP").locator("img")).toBeHidden();
  await expect.poll(() => [...asked].sort()).toEqual(["danske-fi", "op-fi", "s-pankki-fi"]);
  answer();

  // then the picture carries the plate, with the bank's name as its alt
  await expect(tile("OP").getByRole("img", { name: "OP" })).toBeVisible();
  await expect(tile("OP")).toHaveText("");
  await expect(tile("Danske Bank").getByRole("img", { name: "Danske Bank" })).toBeVisible();
  // a picture that fails leaves the name, as does a bank without a logo; bundled artwork is not asked from the server
  await expect(tile("S-Pankki").locator("img")).toHaveCount(0);
  await expect(tile("S-Pankki")).toHaveText("S-Pankki");
  await expect(tile("Säästöpankki")).toHaveText("Säästöpankki");
  await expect(tile("Nordea").getByRole("img", { name: "Nordea" })).toHaveAttribute("src", "/banks/nordea.png");
  expect([...asked].sort()).toEqual(["danske-fi", "op-fi", "s-pankki-fi"]);

  for (const width of [1366, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const [name, shape] of [
      ["OP", 240 / 48],
      ["Danske Bank", 1],
    ] as const) {
      const fit = await tile(name)
        .locator("img")
        .evaluate((img) => {
          const plate = img.parentElement!.getBoundingClientRect();
          const box = img.getBoundingClientRect();
          return { width: box.width, height: box.height, inside: box.left >= plate.left && box.right <= plate.right && box.top >= plate.top && box.bottom <= plate.bottom, plate: getComputedStyle(img.parentElement!).backgroundColor };
        });
      expect(fit.inside, `${name} stays inside its plate at ${width} px`).toBe(true);
      expect(fit.height, `${name} is large enough to read at ${width} px`).toBeGreaterThanOrEqual(16);
      expect(Math.abs(fit.width / fit.height / shape - 1), `${name} keeps its shape at ${width} px`).toBeLessThan(0.04);
      expect(fit.plate).toBe("rgb(255, 255, 255)");
    }
    expect(await overflow(page)).toBeLessThanOrEqual(1);
    if (SHOTS) await page.screenshot({ path: join(SHOTS, `bank-logos-${width}.png`), fullPage: true });
  }

  // the plate is white in dark mode too: a logo keeps its own colours
  await page.emulateMedia({ colorScheme: "dark" });
  expect(await tile("OP").locator(".bank-logo").evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(255, 255, 255)");
  if (SHOTS) await page.screenshot({ path: join(SHOTS, "bank-logos-390-dark.png"), fullPage: true });

  // every picture came from the app's own address, and the one failure is the logo that was made to fail
  const origin = new URL(page.url()).origin;
  expect(requested.filter((url) => !url.startsWith(`${origin}/`) && !url.startsWith("data:"))).toEqual([]);
  expect(seen.problems.filter((p) => !p.includes("/api/bank/logos/s-pankki-fi"))).toEqual([]);
  await context.close();
});

test("a connection's row shows the logo the server serves for its bank, and none for a bank without one", async ({ browser }) => {
  const banks = offer(6).map((b) => (b.id === "op-fi" ? { ...b, logo: true } : b));
  const { context, page, seen } = await open(browser, banks, [consent("c1", "OP", "active", "2026-09-20T00:00:00Z"), consent("c2", "S-Pankki", "active", "2026-09-01T00:00:00Z")]);
  await page.route("**/api/bank/logos/*", (route) => route.fulfill({ status: 200, contentType: "image/svg+xml", body: WIDE }));
  await page.goto("/#/settings");
  const logo = page.locator(".bank-logo-sm img");
  await expect(logo).toHaveCount(1);
  await expect(logo).toBeVisible();
  await expect(logo).toHaveAttribute("src", "/api/bank/logos/op-fi");
  await expect(logo).toHaveAttribute("alt", "OP");
  const fit = await logo.evaluate((img) => {
    const plate = img.parentElement!.getBoundingClientRect();
    const box = img.getBoundingClientRect();
    return { inside: box.left >= plate.left && box.right <= plate.right && box.top >= plate.top && box.bottom <= plate.bottom, plate: getComputedStyle(img.parentElement!).backgroundColor };
  });
  expect(fit).toEqual({ inside: true, plate: "rgb(255, 255, 255)" });
  if (SHOTS) await page.screenshot({ path: join(SHOTS, "bank-logos-connections.png") });
  expect(seen.problems).toEqual([]);
  await context.close();
});
