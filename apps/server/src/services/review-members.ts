/**
 * Money in from another member of the household that nothing explained, as Tarkistettavat's payer questions: one per
 * payer, answered with PUT /api/payer-roles like every payer. It reads the other members' account numbers and the names
 * their own accounts give, and sends nothing of them: only the viewer's own rows leave.
 */
import { addDays, type HouseholdMember, memberMoney, normalizeIban, PAYER_ROLES, type PayerRole, payerRoleOf, userNameOf } from "@banking/core";
import { requestInputs } from "./analysis.ts";
import type { Services } from "./context.ts";

/** What a member's money can be: never the viewer's own money at another bank. */
const OPTIONS: readonly PayerRole[] = PAYER_ROLES.filter((role) => role !== "own_money");

/** A question as the queue takes it: the payer's key, the money over the year, and the rows it counts. */
interface MemberMoneyItem {
  kind: "payer";
  id: string;
  cents: number;
  key: string;
  merchant: string;
  count: number;
  lastDate: string;
  options: readonly PayerRole[];
  steady: boolean;
  proposal: null;
  rowIds: string[];
}

/** The members with the name their own accounts give and the numbers of those accounts. */
async function membersOf(s: Services): Promise<HouseholdMember[]> {
  const [users, accounts] = await Promise.all([s.users.list(), s.household.allAccounts()]);
  return users.map((u) => {
    const own = accounts.filter((a) => a.userId === u.id);
    return { id: u.id, name: userNameOf(own), ibans: new Set(own.flatMap((a) => normalizeIban(a.iban) ?? [])) };
  });
}

/** No guess: what a member's money is, only the household says. */
export async function memberMoneyItems(s: Services, userId: string): Promise<MemberMoneyItem[]> {
  const { ctx, accounts } = await s.analysis.get(s, userId, "own");
  const { inputs } = await requestInputs(s, userId, accounts);
  const { payers } = inputs;
  if (!payers) return [];
  const members = await membersOf(s);
  const from = addDays(s.today(), -364);
  return memberMoney(ctx.txs, members, userId, from, (t) => payerRoleOf(payers.roles, t, payers.memberId) !== null).map((m) => ({
    kind: "payer",
    id: `payer:${m.key}`,
    cents: m.cents,
    key: m.key,
    merchant: m.merchant,
    count: m.count,
    lastDate: m.lastDate,
    options: OPTIONS,
    steady: false,
    proposal: null,
    rowIds: m.rowIds,
  }));
}
