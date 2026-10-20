/**
 * Facts of the kids area: the maximum monthly fee of full-time early childhood education (varhaiskasvatus) for the
 * youngest child, set every other August by an index notice of the Ministry of Education and Culture. Read on
 * 11.10.2026 from the notices in Suomen säädöskokoelma (Finlex PDF text). The rise between two rows is the statutory
 * rise a municipal fee follows.
 */
import type { Fact } from "./index.ts";

export const KIDS_FACTS: readonly Fact[] = [
  {
    id: "daycare_max_fee",
    label: "Varhaiskasvatuksen enimmäismaksu",
    value: 31_100,
    unit: "snt",
    kind: "law",
    status: "valid",
    validFrom: "2024-08-01",
    validTo: "2026-07-31",
    asOf: "2024-08-01",
    expires: "2026-07-31",
    source: { title: "Finlex 1062/2023: Opetus- ja kulttuuriministeriön ilmoitus indeksillä tarkistetuista varhaiskasvatuksen asiakasmaksuista", url: "https://www.finlex.fi/fi/lainsaadanto/saadoskokoelma/2023/1062" },
    verifiedAt: "2026-10-11",
  },
  {
    id: "daycare_max_fee",
    label: "Varhaiskasvatuksen enimmäismaksu",
    value: 33_500,
    unit: "snt",
    kind: "law",
    status: "valid",
    validFrom: "2026-08-01",
    asOf: "2026-08-01",
    expires: "2027-10-11",
    source: { title: "Finlex 1028/2025: Opetus- ja kulttuuriministeriön ilmoitus indeksillä tarkistetuista varhaiskasvatuksen asiakasmaksuista", url: "https://www.finlex.fi/fi/lainsaadanto/saadoskokoelma/2025/1028" },
    verifiedAt: "2026-10-11",
  },
];
