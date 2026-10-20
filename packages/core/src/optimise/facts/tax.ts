/**
 * Facts of the tax area: the household deduction (kotitalousvähennys) for work bought from a business. Read on
 * 11.10.2026 from Verohallinto's page "Kotitalousvähennyksen määrä" (updated 16.6.2026), which gives the same figures
 * for 2025 and 2026, and from its release of 16.6.2026 on the government's proposal to raise the deduction for 2026
 * and 2027. The proposal is pending: its rows are `proposed`, so they show only as a calc line.
 */
import type { Fact } from "./index.ts";

const PAGE = { title: "Verohallinto: Kotitalousvähennyksen määrä", url: "https://www.vero.fi/henkiloasiakkaat/vahennykset/kotitalousvahennys/kotitalousvahennyksen-maara/" };
const PROPOSAL = {
  title: "Verohallinto: Kotitalousvähennykseen ehdotetaan korotusta (16.6.2026)",
  url: "https://www.vero.fi/tietoa-verohallinnosta/uutishuone/lehdist%C3%B6tiedotteet/2026/kotitalousvahennykseen-ehdotetaan-korotusta-matkakulujen-omavastuu-pienenee/",
};

/** In force since 2025: no end date, so each row expires a year after it was verified. */
const law = { kind: "law", status: "valid", validFrom: "2025-01-01", asOf: "2025-01-01", expires: "2027-10-11", source: PAGE, verifiedAt: "2026-10-11" } as const;
/** The proposal covers the payment years 2026 and 2027 and would apply from 1.1.2026. */
const proposal = { kind: "law", status: "proposed", validFrom: "2026-01-01", validTo: "2027-12-31", asOf: "2026-06-16", expires: "2027-12-31", source: PROPOSAL, verifiedAt: "2026-10-11" } as const;

export const TAX_FACTS: readonly Fact[] = [
  { id: "household_deduction_rate", label: "Vähennys työn osuudesta", value: 35, unit: "%", ...law },
  { id: "household_deduction_deductible", label: "Omavastuu", value: 15_000, unit: "snt", ...law },
  { id: "household_deduction_cap", label: "Enimmäismäärä henkilöltä", value: 160_000, unit: "snt", ...law },
  { id: "household_deduction_rate", label: "Vähennys työn osuudesta", value: 40, unit: "%", ...proposal },
  { id: "household_deduction_cap", label: "Enimmäismäärä henkilöltä", value: 210_000, unit: "snt", ...proposal },
];
