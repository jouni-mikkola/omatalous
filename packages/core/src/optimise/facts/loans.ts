/**
 * Facts of the loans area.
 *
 * Euribor: monthly means of the 3, 6 and 12 month rates (act/360), read on 11.10.2026 from Suomen Pankki's table
 * "Euribor-korot ja Eonia-korko, kuukauden keskiarvo", which leaves out the month in progress. The series ages as
 * one: every row has the last month's end as `asOf`. Ids are `<reference>:<month>` with the reference ids of the
 * `loan_rate` input, so a loan's reference reads its own rows.
 *
 * Margin: the sample offers Taloustaito got from nine banks for a 150 000 € mortgage, published 16.9.2026. They are
 * examples, not an offer to this household, so they are kind `sample` and cost a certainty step.
 */
import { LOAN_REFERENCE_LABEL } from "../inputs.ts";
import type { LoanReference } from "../types.ts";
import type { Fact } from "./index.ts";

const EURIBOR_SOURCE = {
  title: "Suomen Pankki: Euribor-korot ja Eonia-korko, kuukauden keskiarvo",
  url: "https://www.suomenpankki.fi/fi/tilastot/taulukot-ja-kuviot/korot/taulukot2/korot_taulukot/euribor_korot_long_fi/",
};
const MARGIN_SOURCE = {
  title: "Taloustaito 16.9.2026: Asuntolaina 150 000 euroa, vertailussa 9 pankin tarjoukset",
  url: "https://www.taloustaito.fi/koti/2026/asuntolaina-150-000-euroa--vertailussa-9-pankin--tarjoukset/",
};

/** Month, then the 3, 6 and 12 month means in percent, as the table gives them. */
const EURIBOR: readonly [string, number, number, number][] = [
  ["2024-10", 3.167, 3.002, 2.691],
  ["2024-11", 3.007, 2.788, 2.506],
  ["2024-12", 2.825, 2.632, 2.436],
  ["2025-01", 2.704, 2.614, 2.525],
  ["2025-02", 2.525, 2.46, 2.407],
  ["2025-03", 2.442, 2.385, 2.398],
  ["2025-04", 2.249, 2.202, 2.143],
  ["2025-05", 2.087, 2.116, 2.081],
  ["2025-06", 1.984, 2.05, 2.081],
  ["2025-07", 1.986, 2.055, 2.079],
  ["2025-08", 2.021, 2.084, 2.114],
  ["2025-09", 2.027, 2.102, 2.172],
  ["2025-10", 2.034, 2.107, 2.187],
  ["2025-11", 2.042, 2.131, 2.217],
  ["2025-12", 2.05, 2.141, 2.268],
  ["2026-01", 2.028, 2.136, 2.245],
  ["2026-02", 2.011, 2.144, 2.221],
  ["2026-03", 2.109, 2.322, 2.565],
  ["2026-04", 2.175, 2.454, 2.747],
  ["2026-05", 2.225, 2.536, 2.803],
  ["2026-06", 2.339, 2.596, 2.798],
  ["2026-07", 2.425, 2.647, 2.855],
  ["2026-08", 2.513, 2.713, 2.954],
  ["2026-09", 2.635, 2.922, 3.247],
];

/** The Euribor references and their column in `EURIBOR`; the names are the one list of `LOAN_REFERENCE_LABEL`. */
const TENORS: readonly [Exclude<LoanReference, "fixed">, number][] = [
  ["euribor_3", 1],
  ["euribor_6", 2],
  ["euribor_12", 3],
];

const euribor: Fact[] = EURIBOR.flatMap((row) =>
  TENORS.map(([reference, column]): Fact => {
    const month = row[0];
    return {
      id: `${reference}:${month}`,
      label: `${LOAN_REFERENCE_LABEL[reference]} ${Number(month.slice(5, 7))}/${month.slice(0, 4)}`,
      value: row[column] as number,
      unit: "%",
      kind: "rate",
      status: "valid",
      validFrom: `${month}-01`,
      period: month,
      asOf: "2026-09-30",
      expires: "2027-03-30",
      source: EURIBOR_SOURCE,
      verifiedAt: "2026-10-11",
    };
  }),
);

const margin = (id: string, label: string, value: number): Fact => ({
  id,
  label,
  value,
  unit: "%",
  kind: "sample",
  status: "valid",
  validFrom: "2026-09-16",
  asOf: "2026-09-16",
  expires: "2027-09-16",
  source: MARGIN_SOURCE,
  verifiedAt: "2026-10-11",
});

export const LOANS_FACTS: readonly Fact[] = [
  ...euribor,
  margin("mortgage_margin_sample_low", "Esimerkkitarjousten pienin marginaali", 0.5),
  margin("mortgage_margin_sample_high", "Esimerkkitarjousten suurin marginaali", 0.8),
];
