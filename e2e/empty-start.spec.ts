import { expect, test } from "@playwright/test";
import { makeMember, overflow, removeMember, watch } from "./helpers.ts";

// The page of a household with no account: the centred card the end of Tarkistettavat also is. A heading, one sentence
// on what happens next, the steps in their order with the next one named, and the two buttons in one row. Made for a
// member of their own, who has not linked a bank and has not loaded the example data.
for (const width of [1280, 390]) {
  test(`at ${width} px the empty start is a heading, a sentence, the steps in order with the next one current, and two buttons in one row`, async ({ browser }) => {
    const { state, id } = await makeMember(browser, `e2e-tyhja-${width}`);
    const context = await browser.newContext({ storageState: state, viewport: { width, height: 844 } });
    try {
      const page = await context.newPage();
      const seen = watch(page);
      await page.goto("/#/transactions");
      const start = page.locator(".empty-start");
      const heading = start.getByRole("heading", { name: "Ei vielä tietoja" });
      await expect(heading).toBeVisible();
      // nothing else had the focus: the heading has it, so a reader starts from it
      await expect(heading).toBeFocused();
      await expect(start.locator("p")).toHaveCount(1);
      const steps = start.getByRole("list", { name: "Käyttöönotto" }).locator("li");
      await expect(steps).toHaveCount(3);
      await expect(steps.nth(0)).toContainText("Enable Banking -sovellus ja avain");
      await expect(steps.nth(1)).toContainText("Pankki yhdistetty");
      await expect(steps.nth(2)).toContainText("Ensimmäinen haku tehty");
      // the one current step is the first one not done
      const done = await steps.evaluateAll((els) => els.map((e) => e.classList.contains("done")));
      const current = await steps.evaluateAll((els) => els.map((e) => e.getAttribute("aria-current")));
      const next = done.indexOf(false);
      expect(current).toEqual(done.map((_, i) => (i === next ? "step" : null)));
      await expect(start.getByRole("button")).toHaveText(["Yhdistä pankki", "Lataa esimerkkitiedot"]);
      const [connect, demo] = [await start.getByRole("button").nth(0).boundingBox(), await start.getByRole("button").nth(1).boundingBox()];
      expect(Math.abs(connect!.y - demo!.y), "the two buttons stand in one row").toBeLessThan(2);
      // centred: the heading's middle is the card's
      const [card, head] = [(await start.boundingBox())!, (await heading.boundingBox())!];
      expect(Math.abs(card.x + card.width / 2 - (head.x + head.width / 2))).toBeLessThanOrEqual(2);
      expect(await overflow(page), `the empty start scrolls sideways at ${width}px`).toBeLessThanOrEqual(1);
      expect(seen.problems).toEqual([]);
    } finally {
      await context.close();
      await removeMember(browser, id);
    }
  });
}
