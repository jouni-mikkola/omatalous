import { expect, test } from "@playwright/test";
import { fakeBank, linkFakeBank, makeMember, metaWhileSyncing, plain, removeMember, waitForSync } from "./helpers.ts";

// The first fetch of a new bank says how many rows have come so far (docs/design/README.md, section 4). The fetch here is
// a real one that is still running: the fake bank answers the rows of the first account asked and holds the other
// accounts' rows until the spec lets them go (PUT /fake/hold-rows), so the server's own count is what the page reads.
async function holdRows(hold: boolean): Promise<void> {
  const answer = await fetch(`${fakeBank().url}/fake/hold-rows`, { method: "PUT", body: JSON.stringify({ hold }) });
  expect(answer.status, "PUT /fake/hold-rows").toBe(204);
}

test("a running first fetch says Haetaan tapahtumia with the rows fetched so far, and the card goes when the fetch ends", async ({ browser }) => {
  const member = await makeMember(browser, "ensihaku-laskee");
  await holdRows(true);
  try {
    const context = await browser.newContext({ storageState: member.state });
    const page = await context.newPage();
    await linkFakeBank(page);

    // the fetch has got past its first account and waits at the bank for the next one: its count stands still
    await expect
      .poll(async () => ((await (await fetch(`${fakeBank().url}/fake/hold-rows`)).json()) as { waiting: number }).waiting, { message: "the fetch did not ask for the rows of a second account", timeout: 30_000 })
      .toBeGreaterThan(0);
    const run = (await metaWhileSyncing(context))?.lastSync;
    expect(run?.status).toBe("running");
    const fetched = run?.fetched ?? 0;
    expect(fetched).toBeGreaterThan(0);

    await page.goto("/#/overview");
    const card = page.locator(".first-fetch");
    await expect(card).toContainText("Ensimmäinen haku on kesken", { timeout: 15_000 });
    const line = card.locator(".first-fetch-rows");
    await expect(line).toBeVisible();
    expect(plain(await line.innerText())).toBe(`Haetaan tapahtumia… ${plain(new Intl.NumberFormat("fi-FI").format(fetched))} haettu`);
    // the held accounts are the ones the card still waits for
    await expect(card).toContainText("odottaa hakua");

    await holdRows(false);
    await waitForSync(context);
    // the page looks again by itself: every account has its answer, so there is nothing left to say
    await expect(card).toHaveCount(0, { timeout: 20_000 });
    const ended = (await metaWhileSyncing(context))?.lastSync;
    expect(ended?.status).toBe("ok");
    expect(ended?.fetched).toBeGreaterThan(fetched);
    await context.close();
  } finally {
    await holdRows(false);
    await removeMember(browser, member.id);
  }
});
