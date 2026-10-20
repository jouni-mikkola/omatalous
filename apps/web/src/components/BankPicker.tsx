/**
 * Decision: which bank the household connects now. The section opens wherever a connection starts (Asetukset >
 * Pankkiyhteydet, which the wizard, the empty start and a renewal of an unknown bank all lead to). It lists the banks the
 * server offers, the one used last first, with a search field once there are more than eight. A bank without a logo
 * shows its name on a plain plate.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { bankIdForInstitution, bankLogo } from "../banks.ts";
import type { BankOption, Connection } from "../types.ts";
import { BankLogo } from "./BankLogo.tsx";
import "../styles/bank-picker.css";

/** A list longer than this gets a search field. */
const SEARCH_ABOVE = 8;

/** A name as letters and digits only, without case or accents: "s pankki" finds S-Pankki, "alands" Ålandsbanken. */
function fold(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

/** The bank of the household's newest consent that is on the list, or null. Consents that ended count too. */
export function lastUsedBank(connections: readonly Pick<Connection, "institution" | "createdAt">[], banks: readonly Pick<BankOption, "id" | "name">[]): string | null {
  for (const c of [...connections].sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
    const id = bankIdForInstitution(banks, c.institution);
    if (id) return id;
  }
  return null;
}

/** The list as the server sent it, the bank used last first. */
export function orderBanks(banks: readonly BankOption[], lastUsed: string | null): BankOption[] {
  return [...banks.filter((b) => b.id === lastUsed), ...banks.filter((b) => b.id !== lastUsed)];
}

/** The banks whose name holds the search text, without case, accents, spaces or hyphens. */
export function searchBanks(banks: readonly BankOption[], query: string): BankOption[] {
  const q = fold(query);
  return q ? banks.filter((b) => fold(b.name).includes(q)) : [...banks];
}

/** True when the list holds a bank whose rows are sorted by its own codes: every bank but Nordea. */
export function hasOtherBanks(banks: readonly Pick<BankOption, "id">[]): boolean {
  return banks.some((b) => b.id !== "nordea-fi");
}

export function BankPicker({
  banks,
  lastUsed,
  starting,
  disabled,
  isAdmin,
  focusSignal,
  onPick,
  onClose,
  children,
}: {
  banks: readonly BankOption[];
  lastUsed: string | null;
  /** The id of the bank being started. */
  starting: string | null;
  disabled: boolean;
  isAdmin: boolean;
  /** A new value moves the focus to the heading, so a keyboard user lands in the section that just opened. */
  focusSignal: number;
  onPick: (id: string) => void;
  onClose: () => void;
  /** What is missing before a bank can be started. */
  children?: ReactNode;
}) {
  const [query, setQuery] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, [focusSignal]);

  const searchable = banks.length > SEARCH_ABOVE;
  const ordered = orderBanks(banks, lastUsed);
  const shown = searchable ? searchBanks(ordered, query) : ordered;
  const noteFor = (id: string) => (starting === id ? "Avataan…" : lastUsed === id && banks.length > 1 ? "Viimeksi käytetty" : null);

  return (
    <section className="bank-picker" aria-labelledby="bank-picker-title">
      <div className="bank-picker-head">
        <h3 id="bank-picker-title" ref={heading} tabIndex={-1}>
          Valitse pankki
        </h3>
        <button className="btn btn-small" type="button" onClick={onClose}>
          Sulje
        </button>
      </div>
      {banks.length === 0 ? (
        <div className="notice warning">
          {isAdmin ? (
            <>
              Enable Banking -sovelluksesi pankkilistalla ei ole pankkeja, joita Omatalous tukee. Tarkista sovellus kohdassa <a href="#/settings?section=server">Asetukset &gt; Palvelin</a>.
            </>
          ) : (
            "Enable Banking -sovelluksen pankkilistalla ei ole pankkeja, joita Omatalous tukee. Ylläpitäjän pitää tarkistaa sovellus kohdassa Asetukset > Palvelin."
          )}
        </div>
      ) : (
        <>
          {searchable && <input type="search" className="bank-search" placeholder="Hae pankkia" aria-label="Hae pankkia" autoComplete="off" spellCheck={false} value={query} onChange={(e) => setQuery(e.target.value)} />}
          {shown.length > 0 ? (
            <ul className="bank-grid">
              {shown.map((b) => {
                const note = noteFor(b.id);
                return (
                  <li key={b.id}>
                    <button type="button" className="bank-tile" disabled={disabled} aria-busy={starting === b.id || undefined} onClick={() => onPick(b.id)} aria-label={`Yhdistä ${b.name}`}>
                      <BankLogo src={bankLogo(b.id, b.logo === true)} name={b.name} size="tile" />
                      {note && <span className="bank-tile-note small muted">{note}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="small muted" role="status">
              Haulla ei löydy pankkia.
            </p>
          )}
          {hasOtherBanks(banks) && <p className="small muted">Muiden pankkien kuin Nordean tapahtumat luokitellaan pankin omien koodien mukaan. Tarkista ensimmäisen kuukauden kategoriat.</p>}
          {children}
        </>
      )}
    </section>
  );
}
