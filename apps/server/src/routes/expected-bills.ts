/** Bills the signed-in user typed in. Own rows only. */
import { addDays, type ExpectedBill, type ExpectedCadence, getCategory, isKnownCategory } from "@banking/core";
import { Hono } from "hono";
import { NotFound, UserError } from "../platform/errors.ts";
import { randomToken } from "../platform/ids.ts";
import { isIsoDate, strictObject } from "../platform/validate.ts";
import type { AppEnv, Services } from "../services/context.ts";
import { body } from "./shared.ts";

const CADENCES: readonly ExpectedCadence[] = ["once", "quarterly", "semiannual", "yearly"];
const MAX_NAME = 80;
/** A million euros: a rare bill is a tax or an insurance, and a typo stays visible. */
const MAX_AMOUNT_CENTS = 100_000_000;
/** A bill that fell due last month is still worth noting; one years ahead is a typo. */
const DAYS_BACK = 31;
const DAYS_AHEAD = 400;
/** Every request reads them all, so a runaway list stays out. */
const MAX_BILLS = 100;

/** The fields of a new bill, checked against allowlists. Throws a UserError with a message safe to show. */
function parseExpectedBill(raw: unknown, today: string): Omit<ExpectedBill, "id"> {
  const input = strictObject(raw, ["name", "amountCents", "dueDate", "cadence", "category"] as const);
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name || name.length > MAX_NAME || /[\x00-\x1f\x7f]/.test(name)) throw new UserError(`Anna laskulle nimi, 1–${MAX_NAME} merkkiä.`);
  const amount = input.amountCents;
  if (typeof amount !== "number" || !Number.isInteger(amount) || amount < 1 || amount > MAX_AMOUNT_CENTS) {
    throw new UserError("Summan pitää olla vähintään 0,01 € ja enintään 1 000 000 €.");
  }
  const due = input.dueDate;
  if (!isIsoDate(due) || due < addDays(today, -DAYS_BACK) || due > addDays(today, DAYS_AHEAD)) {
    throw new UserError(`Eräpäivä voi olla enintään ${DAYS_BACK} päivää sitten ja ${DAYS_AHEAD} päivän päässä.`);
  }
  const cadence = input.cadence;
  if (typeof cadence !== "string" || !CADENCES.includes(cadence as ExpectedCadence)) throw new UserError("Tuntematon toistuvuus.");
  const category = input.category ?? null;
  if (category !== null) {
    if (typeof category !== "string" || !isKnownCategory(category)) throw new UserError("Tuntematon kategoria.");
    const kind = getCategory(category).kind;
    if (kind !== "expense" && kind !== "debt") throw new UserError("Valitse meno- tai velkakategoria.");
  }
  return { name, amountCents: amount, dueDate: due, cadence: cadence as ExpectedCadence, category };
}

export function expectedBillRoutes(s: Services) {
  const app = new Hono<AppEnv>();

  app.get("/expected-bills", async (c) => c.json({ bills: await s.finance(c.get("user").id).listExpectedBills() }));

  app.post("/expected-bills", async (c) => {
    const repo = s.finance(c.get("user").id);
    const input = parseExpectedBill(await body(c), s.today());
    if ((await repo.listExpectedBills()).length >= MAX_BILLS) throw new UserError(`Itse lisättyjä laskuja voi olla enintään ${MAX_BILLS}. Poista ensin turhat.`);
    const bill: ExpectedBill = { id: randomToken(), ...input };
    // bills are read per request, so nothing is cached and no data version moves
    await repo.addExpectedBill(bill, s.now().toISOString());
    return c.json({ bill });
  });

  app.delete("/expected-bills/:id", async (c) => {
    // another member's bill is not this user's row: the same 404 as an id that never existed
    if (!(await s.finance(c.get("user").id).deleteExpectedBill(c.req.param("id")))) throw new NotFound("Laskua ei löydy.");
    return c.json({ ok: true });
  });

  return app;
}
