/**
 * The sum Laskut puts above its timeline is the sum of the rows of the period it names, and Yhteenveto says the same
 * figure as "Maksut ennen palkkapäivää". The demo household: its window runs to the payday and holds a card's bill.
 */
import { describe, expect, it } from "vitest";
import { setupApp } from "./helpers.ts";

describe("the sum of the window", () => {
  it("is the sum of the window's rows, the card's bill among them, and the figure of Yhteenveto", async () => {
    const app = await setupApp();
    expect((await app.admin.call("POST", "/api/demo")).status).toBe(200);
    const { ahead } = (await app.admin.call("GET", "/api/ahead")).body;
    const home = (await app.admin.call("GET", "/api/dashboard")).body.home;

    expect(ahead.reason).toBe("payday");
    const paid = (ahead.rows as { cents: number; source: string }[]).filter((r) => r.cents < 0 && r.source !== "transfer");
    expect(paid.some((r) => r.source === "card")).toBe(true);
    const sum = paid.reduce((total, r) => total - r.cents, 0);
    // the page's one sum, its parts and Yhteenveto's figure are the same cents
    expect(ahead.totals.dueCents).toBe(sum);
    expect(ahead.totals.recurringCents + ahead.totals.typedCents + ahead.totals.cardCents).toBe(sum);
    expect(home.runway.sum.paymentsCents).toBe(sum);
    // the 30 days' sum of the old page is gone: no figure of another period is sent beside it
    expect(ahead.thirtyDaysCents).toBeUndefined();
  });
});
