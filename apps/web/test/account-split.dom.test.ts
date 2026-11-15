/**
 * Asetukset > Tilit, under a joint account: one control says how its costs are cut. The ways of the use and the ways of
 * an agreement are buttons of the one "Jakotapa", the pressed one is what cuts the costs now (the agreement in force,
 * else the use). With none in force the shares are the use unless a day is typed; while one holds a way is a new
 * agreement from a day and the use stays.
 * Names and sums are made up.
 */
import { createElement } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { Accounts } from "../src/pages/settings/Accounts.tsx";
import { queryClient } from "../src/query-client.ts";
import type { Account, Meta } from "../src/types.ts";
import { stubApi } from "./dom-kit.ts";

const AINO = "u-aino";
const EERO = "u-eero";
const TODAY = "2026-11-11";
const joint = {
  id: "j1", userId: AINO, name: "Yhteistili", bankName: "Yhteistili", customName: null, holder: "Aino, Eero", cardMask: null, creditLimitCents: null, iban: null, currency: "EUR",
  type: "checking", provider: "enablebanking", connectionId: "c1", balanceCents: 100_000, balanceAt: null, lastSyncedAt: null, problem: null,
  use: { users: [{ userId: AINO, label: "Aino", weight: 1 }, { userId: EERO, label: "Eero", weight: 1 }], source: "said" },
} as unknown as Account;
const meta = {
  user: { id: AINO, role: "member", displayName: "Aino" }, members: [{ id: AINO, displayName: "Aino" }, { id: EERO, displayName: "Eero" }], shares: [], today: TODAY,
  bank: { configured: true, banks: [], redirectMode: "own", source: "user" }, connections: [], accounts: [joint], renewal: { due: [], round: null },
} as unknown as Meta;
const users = [{ owner: `u:${AINO}`, name: "Aino" }, { owner: `u:${EERO}`, name: "Eero" }];
const income = { validFrom: "2026-01-01", kind: "income", value: { who: users.map((u) => u.owner) }, setAt: "2026-01-01T10:00:00Z" };

// each test's answers are its own: the cache would serve the agreements of the one before
beforeEach(() => queryClient.clear());

function open(agreements: unknown[]) {
  const seen = stubApi({
    "GET /api/foreign-rows": {},
    "GET /api/accounts/j1/use/suggestion": { unseen: [] },
    "GET /api/settlement/agreements/j1": { accountId: "j1", users, removed: [], agreements },
    "PUT /api/settlement/agreements/j1": { accountId: "j1", users, removed: [], agreements },
    "PUT /api/accounts/j1/use": {},
  });
  render(createElement(Accounts, { meta, onChange: () => {} }));
  return seen;
}

/** The control once the agreements are read: before that it has no ways to press. */
const split = async () => {
  const group = await screen.findByRole("group", { name: "Tilin Yhteistili jako" }, { timeout: 5000 });
  await within(group).findByRole("group", { name: "Jakotapa" });
  return group;
};
const pressed = (group: HTMLElement) => within(within(group).getByRole("group", { name: "Jakotapa" })).getAllByRole("button", { pressed: true }).map((b) => b.textContent);

describe("the split of a joint account", () => {
  it("is one control with every way, the use's way pressed when no agreement holds", async () => {
    open([]);
    const group = await split();
    expect(screen.getAllByRole("group", { name: /jako$/ })).toHaveLength(1);
    expect(within(within(group).getByRole("group", { name: "Jakotapa" })).getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Sen mukaan, kuka tilille on maksanut",
      "Tasan",
      "Osuuksien mukaan",
      "Tulojen suhteessa",
      "Kiinteä summa",
    ]);
    expect(pressed(group)).toEqual(["Tasan"]);
    // no second choice of the same thing: no select of a way and no button that opens one
    expect(screen.queryByRole("combobox", { name: "Jakotapa" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Muuta jakoa" })).toBeNull();
  });

  it("presses the agreement in force, offers no who paid then, and saves Tasan as an agreement from the day typed", async () => {
    const seen = open([income]);
    const group = await split();
    await waitFor(() => expect(pressed(group)).toEqual(["Tulojen suhteessa"]));
    expect(within(group).queryByRole("button", { name: "Sen mukaan, kuka tilille on maksanut" })).toBeNull();
    fireEvent.click(within(group).getByRole("button", { name: "Tasan" }));
    const form = within(group).getByRole("form", { name: "Muuta tilin Yhteistili jakoa" });
    fireEvent.change(within(form).getByLabelText("Voimassa alkaen"), { target: { value: "2026-11-01" } });
    fireEvent.click(within(form).getByRole("button", { name: "Tallenna" }));
    await waitFor(() => expect(seen.filter((s) => s.method === "PUT").map((s) => s.path)).toEqual(["/api/settlement/agreements/j1"]));
    expect(seen.find((s) => s.method === "PUT")!.body).toEqual({ validFrom: "2026-11-01", kind: "equal", value: { who: users.map((u) => u.owner) } });
  });

  it("saves the shares as the use with no day, and as an agreement from a day the user types", async () => {
    const seen = open([]);
    const group = await split();
    fireEvent.click(within(group).getByRole("button", { name: "Osuuksien mukaan" }));
    const form = within(group).getByRole("form", { name: "Muuta tilin Yhteistili jakoa" });
    expect(within(form).getByLabelText("Voimassa alkaen")).toHaveProperty("value", "");
    fireEvent.change(within(form).getByLabelText("Aino %"), { target: { value: "60" } });
    fireEvent.click(within(form).getByRole("button", { name: "Tallenna" }));
    await waitFor(() => expect(seen.filter((s) => s.method === "PUT").map((s) => s.path)).toEqual(["/api/accounts/j1/use"]));
    expect(seen.find((s) => s.method === "PUT")!.body).toEqual({ users: [{ userId: AINO, weight: 600 }, { userId: EERO, weight: 400 }] });

    fireEvent.click(within(group).getByRole("button", { name: "Osuuksien mukaan" }));
    const again = within(group).getByRole("form", { name: "Muuta tilin Yhteistili jakoa" });
    fireEvent.change(within(again).getByLabelText("Aino %"), { target: { value: "75" } });
    fireEvent.change(within(again).getByLabelText("Voimassa alkaen"), { target: { value: "2026-10-01" } });
    fireEvent.click(within(again).getByRole("button", { name: "Tallenna" }));
    await waitFor(() => expect(seen.filter((s) => s.method === "PUT").map((s) => s.path)).toEqual(["/api/accounts/j1/use", "/api/settlement/agreements/j1"]));
    expect(seen.filter((s) => s.method === "PUT")[1]!.body).toEqual({ validFrom: "2026-10-01", kind: "share", value: { weights: { [`u:${AINO}`]: 750, [`u:${EERO}`]: 250 } } });
  });
});
