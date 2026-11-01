/**
 * The names of the categories and their groups in a language. The catalogue (`categories.ts`) keeps the Finnish label and
 * group, which stay the keys; the display text comes from the message catalogue, and a category with no entry keeps its Finnish one.
 */
import type { Category } from "./categories.ts";
import { DEFAULT_LANGUAGE, type Language } from "./locale.ts";
import { messageFromWire } from "./messages.ts";

/** The code part of each group's message (`cgroup.<code>`). */
const GROUP_CODE: Record<string, string> = {
  Asuminen: "housing",
  Ruoka: "food",
  Liikkuminen: "moving",
  "Viestintä ja tilaukset": "comms",
  "Terveys ja hyvinvointi": "health",
  Ostokset: "shopping",
  "Perhe ja lemmikit": "family",
  "Vapaa-aika": "leisure",
  Koulutus: "education",
  "Vakuutukset ja verot": "insurance",
  "Raha-asiat": "money",
  Velanhoito: "debt",
  Muut: "other",
  "Säästöt ja sijoitukset": "savings",
  Tulot: "income",
  Siirrot: "transfers",
};

/** The label of a category in a language. */
export const categoryLabel = (c: Pick<Category, "id" | "label">, lang: Language = DEFAULT_LANGUAGE): string => messageFromWire(`category.${c.id}`, undefined, lang) ?? c.label;

/** The name of a group (the Finnish group is the key) in a language. */
export const groupLabel = (group: string, lang: Language = DEFAULT_LANGUAGE): string => messageFromWire(`cgroup.${GROUP_CODE[group] ?? ""}`, undefined, lang) ?? group;
