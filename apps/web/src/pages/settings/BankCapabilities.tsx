/**
 * What the app has seen of each bank (admin): one small table for each bank that has a record, label at the left and
 * the value at the right. A fact not seen yet is "ei vielä nähty"; the server only ever adds to a record.
 */
import { useEffect, useState } from "react";
import { api } from "../../api.ts";
import { bankName } from "../../banks.ts";
import { plural } from "../../format.ts";
import type { BankCapability } from "../../types.ts";

const UNSEEN = "ei vielä nähty";

/** True once a link or a fetch has seen something of the bank: a list alone says nothing of the accounts. */
export function bankSeen(b: BankCapability): boolean {
  return b.cardAccounts || b.pending || b.balanceTypes.length > 0 || b.historyDays !== null;
}

/** The records of Enable Banking's banks, read again when `reload` changes; null while none was read. */
export function useBankCapabilities(reload: unknown): BankCapability[] | null {
  const [banks, setBanks] = useState<BankCapability[] | null>(null);
  useEffect(() => {
    let live = true;
    api<{ banks: BankCapability[] }>("/api/admin/bank-app/capabilities")
      .then((r) => live && setBanks(r.banks))
      .catch(() => live && setBanks(null));
    return () => {
      live = false;
    };
  }, [reload]);
  return banks;
}

function rows(b: BankCapability): [string, string][] {
  const days = (n: number | null) => (n === null ? UNSEEN : plural(n, "päivä", "päivää"));
  const seen = (yes: boolean) => (yes ? "kyllä" : UNSEEN);
  return [
    ["Suostumuksen pituus", days(b.consentDays)],
    ["Korttitilit", seen(b.cardAccounts)],
    ["Odottavat tapahtumat", seen(b.pending)],
    ["Saldotyypit", b.balanceTypes.length ? b.balanceTypes.join(", ") : UNSEEN],
    ["Historia", days(b.historyDays)],
    ["PSU-otsakkeet", b.requiredPsuHeaders?.length ? b.requiredPsuHeaders.join(", ") : UNSEEN],
  ];
}

export function BankCapabilities({ banks }: { banks: readonly BankCapability[] }) {
  if (banks.length === 0) return null;
  return (
    <div className="stack" style={{ gap: 12 }} aria-label="Pankkien tiedot">
      {banks.map((b) => (
        <div key={b.bankId}>
          <h3 className="subhead">{bankName(b.bankId)}</h3>
          <div className="table-wrap">
            <table className="ruled bank-facts" aria-label={bankName(b.bankId)}>
              <tbody>
                {rows(b).map(([label, value]) => (
                  <tr key={label}>
                    <th scope="row">{label}</th>
                    <td className="num">{value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}
