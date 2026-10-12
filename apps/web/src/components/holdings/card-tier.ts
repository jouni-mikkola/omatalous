/**
 * What a card face looks like, from the account's own name. The bank sends no card class, so the name is the only
 * thing to read: "Gold" or "Kultakortti" gives gold, "Platinum" or "Platinakortti" platinum, any other name plain.
 * A word counts when it starts with one of the stems, so a compound such as "kultakortti" is found too.
 */
type CardTier = "gold" | "platinum" | "plain";

const GOLD = ["gold", "kulta"];
const PLATINUM = ["platinum", "platina"];

export function cardTier(name: string): CardTier {
  const words = name.toLowerCase().match(/\p{L}+/gu) ?? [];
  const has = (stems: readonly string[]) => words.some((w) => stems.some((s) => w.startsWith(s)));
  if (has(PLATINUM)) return "platinum";
  return has(GOLD) ? "gold" : "plain";
}

/**
 * How much of the bar under a card face is filled, in whole percent: the used part of the limit, at least 2 % while
 * anything is used (so a small debt still shows) and the full width at and over the limit. Only the width is worked out
 * here: that the card is over its limit, and every figure beside the bar, are the card's own.
 */
export function barPercent(usedCents: number, limitCents: number): number {
  return usedCents > 0 ? Math.min(100, Math.max(2, Math.round((usedCents / limitCents) * 100))) : 0;
}
