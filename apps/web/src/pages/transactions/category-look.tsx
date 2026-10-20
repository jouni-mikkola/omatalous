/**
 * How a category looks on a row, in the picker and on the filter chip: its own icon and its group's colour slot.
 * Presentation, not data. The slot is a stand-in until core sends `colorSlot` per category (ENGINE.md 2.5): it follows
 * the group, fixed in the catalogue's order, so a filter never repaints a chip.
 */
import type { Category } from "../../types.ts";

/** The seven largest everyday groups get a series hue; every other group the rest hue (VD0's answer). */
const SLOT: Record<string, number> = {
  Asuminen: 1,
  Ruoka: 2,
  Liikkuminen: 3,
  "Vapaa-aika": 4,
  Ostokset: 5,
  "Terveys ja hyvinvointi": 6,
  "Perhe ja lemmikit": 7,
};

export const slotOf = (c: Pick<Category, "group"> | undefined): number | "rest" => (c && SLOT[c.group]) || "rest";

/** 16 by 16 line icons drawn with the current colour, one per category, so Alko and Ruokakauppa no longer share a basket. */
export const CATEGORY_ICON: Record<string, string> = {
  housing: "M2.5 7.5 8 3l5.5 4.5M4 6.5V13h8V6.5M6.5 13V9.5h3V13",
  utilities: "M9 2.5 4.5 9H8l-1 4.5L11.5 7H8z",
  home: "M3 8.5V7a1.5 1.5 0 0 1 3 0v1.5h4V7a1.5 1.5 0 0 1 3 0v1.5M2.5 8.5h11V12h-11zM4 12v1.5M12 12v1.5",
  groceries: "M2.5 6h11l-1.2 6.2a1 1 0 0 1-1 .8H4.7a1 1 0 0 1-1-.8zM5.5 6 7 2.5M10.5 6 9 2.5",
  restaurants: "M4.5 2.5v4a1.5 1.5 0 0 0 3 0v-4M6 6.5v7M11 13.5v-11c-1.5 1-2 3-2 5h2",
  food_delivery: "M2.5 11.5a1.5 1.5 0 1 0 3 0 1.5 1.5 0 0 0-3 0zM10.5 11.5a1.5 1.5 0 1 0 3 0 1.5 1.5 0 0 0-3 0zM5.5 11.5h5L9 6H7.5M9 6h2.5M2.5 4.5h4v3h-4z",
  alcohol: "M7 2.5h2M7.25 2.5v3L6 7.5V13.5h4V7.5L8.75 5.5v-3M6 9.5h4",
  transport: "M4 2.5h8a1 1 0 0 1 1 1v7.5H3V3.5a1 1 0 0 1 1-1zM3 7.5h10M5 13.5V11M11 13.5V11M5.5 9.25h.01M10.5 9.25h.01",
  car: "M3 13.5V4a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 9 4v9.5M2 13.5h8M4.5 5.5h3M9 7.5h1.5a1 1 0 0 1 1 1V11a1 1 0 0 0 2 0V6l-2-2",
  vehicle_purchase: "M2.5 11V8.5L4 5.5h5l1.5 3V11zM2.5 11v1.5M10.5 11v1.5M4.5 9h.01M8.5 9h.01M11.5 3.5h2v2l-1.5 1.5-2-2z",
  leasing: "M2.5 12V9.5L4 6.5h5l1.5 3V12zM4.5 10h.01M8.5 10h.01M10 2.5h3.5v3.5H10zM10 3.75h3.5",
  telecom: "M5 2.5h6v11H5zM7.5 11.5h1",
  subscriptions: "M3 3h10v10H3zM7 6v4l3-2z",
  health: "M6.5 2.5h3v4h4v3h-4v4h-3v-4h-4v-3h4z",
  fitness: "M2.5 6v4M4.5 4.5v7M11.5 4.5v7M13.5 6v4M4.5 8h7",
  personal_care: "M4.5 5a1.75 1.75 0 1 0 0-.01zM4.5 12.5a1.75 1.75 0 1 0 0-.01zM6 5.8l7.5 5M6 11.7l7.5-5",
  shopping: "M3.5 5.5h9l-.7 8h-7.6zM6 5.5V4a2 2 0 0 1 4 0v1.5",
  kids: "M6 4.5a1.5 1.5 0 1 0 0-.01zM4 13.5l1-4.5h2l1 4.5M5 9V7h2v2M11.5 11.5a1.75 1.75 0 1 0 0-.01z",
  pets: "M8 13.5c-2 0-3.5-1.2-3.5-2.7S6.2 8 8 8s3.5 1.3 3.5 2.8-1.5 2.7-3.5 2.7zM4 7a1 1 0 1 0 0-.01zM6.5 4.5a1 1 0 1 0 0-.01zM9.5 4.5a1 1 0 1 0 0-.01zM12 7a1 1 0 1 0 0-.01z",
  entertainment: "M2.5 5h11v2a1 1 0 0 0 0 2v2h-11V9a1 1 0 0 0 0-2zM10 5v6",
  travel: "M2.5 9.5 13.5 4l-1 2.5-4 2 1 4.5-1.5.5-2-3.5-2.5 1-1.5-1z",
  gambling: "M3 3h10v10H3zM5.75 5.75h.01M10.25 5.75h.01M8 8h.01M5.75 10.25h.01M10.25 10.25h.01",
  gifts_donations: "M2.5 6h11v2.5h-11zM3.5 8.5v5h9v-5M8 6v7.5M8 6C7 3.5 4.5 3.5 5 5.2 5.3 6 8 6 8 6zM8 6c1-2.5 3.5-2.5 3-.8C10.7 6 8 6 8 6z",
  education: "M2 6 8 3l6 3-6 3zM4.5 7.3v3.2c1 1 2.2 1.5 3.5 1.5s2.5-.5 3.5-1.5V7.3M13.5 6v4",
  insurance: "M8 2.5l5 2v3.5c0 3-2.2 5-5 6-2.8-1-5-3-5-6V4.5z",
  taxes: "M4 2.5h5.5l2.5 2.5v8.5H4zM9.5 2.5V5H12M6 7.5h4M6 9.5h2M10 12a1.25 1.25 0 1 0 0-.01z",
  memberships: "M2.5 4h11v8h-11zM5.5 7.5a1 1 0 1 0 0-.01zM4 10.5c.3-1 .9-1.5 1.5-1.5s1.2.5 1.5 1.5M9 7h3M9 9h2",
  fees: "M2.5 6.5 8 3.5l5.5 3M3.5 6.5v5M6.5 6.5v5M9.5 6.5v5M12.5 6.5v5M2.5 13h11",
  cash: "M2 4.5h12v7H2zM8 8a1.5 1.5 0 1 0 0-.01zM4 6.5v3M12 6.5v3",
  p2p: "M5.5 6a2 2 0 1 0 0-.01zM2 13c0-2.2 1.6-3.8 3.5-3.8S9 10.8 9 13M10.5 8h3.5M12.5 6.5 14 8l-1.5 1.5",
  card_bill: "M2 4h12v8H2zM2 6.5h12M4 10h3",
  other: "M4 8h.01M8 8h.01M12 8h.01",
  mortgage: "M2.5 7.5 8 3l5.5 4.5M4 6.5V13h8V6.5M8 9.5a1.25 1.25 0 1 0 0-.01zM8 10.75V12.5",
  loans: "M4 12 12 4M5 6.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM11 12.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z",
  student_loan: "M2.5 3.5h4.5a1 1 0 0 1 1 1v9a1 1 0 0 0-1-1H2.5zM13.5 3.5H9a1 1 0 0 0-1 1v9a1 1 0 0 1 1-1h4.5zM9.5 10.5l3-4M10 6.5h.01M12 10.5h.01",
  interest: "M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11zM5.75 10.25l4.5-4.5M6.25 6.25h.01M9.75 9.75h.01",
  collection: "M2 4h12v8.5H2zM2 4l6 4.5L14 4M8 9.5V9M8 11h.01",
  savings: "M3 8.5a5 3.75 0 0 1 9.5-1.5H14v2.5h-1.25L11.5 12H10v1.5H8V12H6v1.5H4V11.7A3.8 3.8 0 0 1 3 8.5zM6 5.5a1.5 1.5 0 0 1 2.5-1.2M10.5 8h.01",
  investments: "M2.5 12.5l3.5-4 2.5 2 5-6M10 4.5h3.5V8",
  pension: "M4.5 2.5h7M4.5 13.5h7M5 2.5c0 3 3 3.5 3 5.5s-3 2.5-3 5.5M11 2.5c0 3-3 3.5-3 5.5s3 2.5 3 5.5",
  salary: "M2.5 5.5h11v7h-11zM6 5.5V4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.5M2.5 8.5h11",
  benefits: "M2 11.5h2.5l3 1.5 5.5-2.5a1 1 0 0 0-.8-1.8L9 9.5H7M4.5 9.5 6.5 8.5h2.5M10 5.5a2 2 0 1 0 0-.01z",
  investment_income: "M6 13.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM10 2.5h3.5V6M13.5 2.5 9 7",
  sales: "M2.5 2.5h5l6 6-5 5-6-6zM5.25 5.25h.01",
  reimbursements: "M9 13.5a4.5 4.5 0 1 0 0-9H4M6 2.5 4 4.5 6 6.5",
  p2p_in: "M10.5 6a2 2 0 1 0 0-.01zM7 13c0-2.2 1.6-3.8 3.5-3.8S14 10.8 14 13M2 8h3.5M4 6.5 5.5 8 4 9.5",
  income: "M8 2.5v6M5.5 6 8 8.5 10.5 6M2.5 9.5h3l1 2h3l1-2h3v4h-11z",
  transfer: "M3 5.5h9.5M10 3l2.5 2.5L10 8M13 10.5H3.5M6 8l-2.5 2.5L6 13",
  credit_draw: "M2 4h10v7H2zM2 6.5h10M14 9.5v4M12.5 12 14 13.5 15.5 12",
};

/** A group's icon for a category the map has no entry for: the first category of the group drawn. */
const GROUP_FIRST: Record<string, string> = {
  Asuminen: "housing",
  Ruoka: "groceries",
  Liikkuminen: "transport",
  "Viestintä ja tilaukset": "telecom",
  "Terveys ja hyvinvointi": "health",
  Ostokset: "shopping",
  "Perhe ja lemmikit": "kids",
  "Vapaa-aika": "entertainment",
  Koulutus: "education",
  "Vakuutukset ja verot": "insurance",
  "Raha-asiat": "fees",
  Muut: "other",
  Velanhoito: "loans",
  "Säästöt ja sijoitukset": "savings",
  Tulot: "income",
  Siirrot: "transfer",
};

export function CategoryIcon({ category }: { category: Pick<Category, "id" | "group"> | undefined }) {
  const d = (category && (CATEGORY_ICON[category.id] ?? CATEGORY_ICON[GROUP_FIRST[category.group] ?? "other"])) ?? CATEGORY_ICON.other;
  return (
    <svg className="tx-icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}
