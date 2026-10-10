/**
 * How a category affects the money picture:
 *  expense  – consumption ("kulutus"): money spent on goods and services
 *  debt     – debt service: loan repayments, financing, interest, collection
 *  savings  – money set aside: savings accounts, funds, shares, gold, pension
 *  income   – money earned or received
 *  transfer – neutral: moves between the user's own connected accounts, credit drawdowns
 */
export type CategoryKind = "expense" | "debt" | "savings" | "income" | "transfer";

export interface Category {
  id: string;
  label: string;
  kind: CategoryKind;
  /** Report grouping, e.g. "Ruoka" for groceries + restaurants + delivery. */
  group: string;
}

/**
 * Category catalog. Ids are stable (stored in the database), labels and
 * groups are what the UI shows. Order is the order pickers list them in.
 */
export const CATEGORIES: readonly Category[] = [
  // ── consumption ──
  { id: "housing", label: "Vuokra ja vastike", kind: "expense", group: "Asuminen" },
  { id: "utilities", label: "Sähkö, vesi ja lämpö", kind: "expense", group: "Asuminen" },
  { id: "home", label: "Koti ja elektroniikka", kind: "expense", group: "Asuminen" },
  { id: "groceries", label: "Ruokakauppa", kind: "expense", group: "Ruoka" },
  { id: "restaurants", label: "Ravintolat ja kahvilat", kind: "expense", group: "Ruoka" },
  { id: "food_delivery", label: "Ruokalähetit", kind: "expense", group: "Ruoka" },
  { id: "alcohol", label: "Alko", kind: "expense", group: "Ruoka" },
  { id: "transport", label: "Joukkoliikenne ja taksit", kind: "expense", group: "Liikkuminen" },
  { id: "car", label: "Auto, polttoaine ja pysäköinti", kind: "expense", group: "Liikkuminen" },
  { id: "telecom", label: "Puhelin ja netti", kind: "expense", group: "Viestintä ja tilaukset" },
  { id: "subscriptions", label: "Tilaukset ja suoratoisto", kind: "expense", group: "Viestintä ja tilaukset" },
  { id: "health", label: "Terveys ja apteekki", kind: "expense", group: "Terveys ja hyvinvointi" },
  { id: "fitness", label: "Liikunta", kind: "expense", group: "Terveys ja hyvinvointi" },
  { id: "personal_care", label: "Kampaamo ja kauneus", kind: "expense", group: "Terveys ja hyvinvointi" },
  { id: "shopping", label: "Vaatteet ja ostokset", kind: "expense", group: "Ostokset" },
  { id: "kids", label: "Lapset", kind: "expense", group: "Perhe ja lemmikit" },
  { id: "pets", label: "Lemmikit", kind: "expense", group: "Perhe ja lemmikit" },
  { id: "entertainment", label: "Vapaa-aika ja harrastukset", kind: "expense", group: "Vapaa-aika" },
  { id: "travel", label: "Matkat", kind: "expense", group: "Vapaa-aika" },
  { id: "gambling", label: "Rahapelit", kind: "expense", group: "Vapaa-aika" },
  { id: "gifts_donations", label: "Lahjoitukset", kind: "expense", group: "Vapaa-aika" },
  { id: "education", label: "Koulutus", kind: "expense", group: "Koulutus" },
  { id: "insurance", label: "Vakuutukset", kind: "expense", group: "Vakuutukset ja verot" },
  { id: "taxes", label: "Verot, maksut ja sakot", kind: "expense", group: "Vakuutukset ja verot" },
  { id: "memberships", label: "Jäsenmaksut", kind: "expense", group: "Vakuutukset ja verot" },
  { id: "fees", label: "Pankkikulut", kind: "expense", group: "Raha-asiat" },
  { id: "cash", label: "Käteisnostot", kind: "expense", group: "Raha-asiat" },
  { id: "p2p", label: "Maksut henkilöille", kind: "expense", group: "Raha-asiat" },
  { id: "card_bill", label: "Luottokortin lasku", kind: "expense", group: "Raha-asiat" },
  { id: "other", label: "Muut menot", kind: "expense", group: "Muut" },
  // ── debt service ──
  { id: "mortgage", label: "Asuntolaina", kind: "debt", group: "Velanhoito" },
  { id: "loans", label: "Kulutusluotot", kind: "debt", group: "Velanhoito" },
  { id: "student_loan", label: "Opintolaina", kind: "debt", group: "Velanhoito" },
  { id: "interest", label: "Korot ja luottokulut", kind: "debt", group: "Velanhoito" },
  { id: "collection", label: "Perintä", kind: "debt", group: "Velanhoito" },
  // ── savings & investments ──
  { id: "savings", label: "Säästötilille", kind: "savings", group: "Säästöt ja sijoitukset" },
  { id: "investments", label: "Sijoitukset", kind: "savings", group: "Säästöt ja sijoitukset" },
  { id: "pension", label: "Eläkesäästö", kind: "savings", group: "Säästöt ja sijoitukset" },
  // ── income ──
  { id: "salary", label: "Palkka", kind: "income", group: "Tulot" },
  { id: "benefits", label: "Etuudet, eläke ja veronpalautus", kind: "income", group: "Tulot" },
  { id: "investment_income", label: "Osingot ja korot", kind: "income", group: "Tulot" },
  { id: "sales", label: "Myyntitulot", kind: "income", group: "Tulot" },
  { id: "reimbursements", label: "Hyvitykset", kind: "income", group: "Tulot" },
  { id: "p2p_in", label: "Maksut henkilöiltä", kind: "income", group: "Tulot" },
  { id: "income", label: "Muut tulot", kind: "income", group: "Tulot" },
  // ── neutral ──
  { id: "transfer", label: "Omat siirrot", kind: "transfer", group: "Siirrot" },
  { id: "credit_draw", label: "Luotonnostot", kind: "transfer", group: "Siirrot" },
];

export const KIND_LABEL: Record<CategoryKind, string> = {
  expense: "Kulutus",
  debt: "Velanhoito",
  savings: "Säästöt ja sijoitukset",
  income: "Tulot",
  transfer: "Siirrot",
};

const BY_ID = new Map(CATEGORIES.map((c) => [c.id, c]));

export function getCategory(id: string): Category {
  return BY_ID.get(id) ?? { id, label: id, kind: "expense", group: "Muut" };
}

export function isKnownCategory(id: string): boolean {
  return BY_ID.has(id);
}

/** Groups in catalog order, for reports. */
export const CATEGORY_GROUPS: readonly string[] = [...new Set(CATEGORIES.map((c) => c.group))];
