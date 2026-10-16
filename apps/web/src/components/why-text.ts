/**
 * The words of an estimate's panel: what the forecast read and what it assumes, as core names them, in plain Finnish.
 * Core's answer holds keys, never sentences (`window:<from>..<to>`, `rows.<source>:<count>`).
 */
import type { Explanation } from "@banking/core";
import { dayMonth, plural } from "../format.ts";

type Estimate = Extract<NonNullable<Explanation["method"]>, { kind: "estimate" }>;

const REASON: Record<string, string> = {
  payday: "Jakso päättyy seuraavaan palkkapäivään",
  late: "Palkka on myöhässä",
  none: "Palkkapäivä ei ole tiedossa",
};

/** What each kind of payment of the window is called, in the singular and the plural. */
const SOURCE: Record<string, [string, string]> = {
  income: ["saapuva maksu", "saapuvaa maksua"],
  recurring: ["toistuva maksu", "toistuvaa maksua"],
  expected: ["itse lisätty lasku", "itse lisättyä laskua"],
  card: ["luottokortin lasku", "luottokortin laskua"],
  transfer: ["siirto", "siirtoa"],
};

const ASSUMPTION: Record<string, string> = {
  "pay.not_added": "Seuraavaa palkkaa ei ole laskettu mukaan",
  "everyday_spending.not_taken_off": "Päivittäisiä ostoksia ei ole vähennetty",
  "bills.repeat_from_history": "Toistuvien maksujen summat on arvioitu aiempien perusteella",
};

function inputLine(key: string): string {
  const [name, value = ""] = [key.slice(0, key.indexOf(":")), key.slice(key.indexOf(":") + 1)];
  if (name === "window") {
    const [from, to] = value.split("..");
    return `Jakso ${dayMonth(from!)}–${dayMonth(to!)}`;
  }
  if (name === "window.reason") return REASON[value] ?? value;
  if (name === "accounts") return Number(value) === 1 ? "Mukana yhden tilin saldo" : `Mukana ${value} tilin saldot`;
  const source = SOURCE[name.replace("rows.", "")];
  return source ? plural(Number(value), source[0], source[1]) : key;
}

/** The inputs and the assumptions of an estimate, each a line. */
export function estimateLines(method: Estimate): { inputs: string[]; assumptions: string[] } {
  return { inputs: method.inputs.map(inputLine), assumptions: method.assumptions.map((a) => ASSUMPTION[a] ?? a) };
}
