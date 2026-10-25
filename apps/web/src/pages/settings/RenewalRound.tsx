/**
 * Decision: whether to renew every consent that ends or has ended now, one after the other, instead of one row at a time.
 * Two or more consents due offer the round; a begun round lists each consent as renewed or left, and the next one is one
 * press. The server keeps the round and reads what is done from the consents (core `consent-round.ts`).
 */
import { logoForInstitution } from "../../banks.ts";
import { BankLogo } from "../../components/BankLogo.tsx";
import { dueText, roundLabel, roundText } from "../../consent-notices.ts";
import type { Meta } from "../../types.ts";

export function RenewalRound({ meta, disabled, busy, onStart, onNext, onClose }: {
  meta: Meta;
  /** No bank can be started yet, or another press is on its way. */
  disabled: boolean;
  busy: string | null;
  onStart: () => void;
  onNext: (bank: string) => void;
  onClose: () => void;
}) {
  const { due, round } = meta.renewal;
  const offered = meta.bank.banks;
  const nameOf = (id: string) => offered.find((b) => b.id === id)?.name ?? id;
  const labelOf = (list: readonly { connection: string; bank: string }[], c: { connection: string; bank: string }) =>
    roundLabel(c.connection, c.bank, nameOf(c.bank), list, meta.accounts);

  if (!round) {
    if (due.length < 2) return null;
    return (
      <div className="notice warning renewal">
        <p>{dueText(due.map((c) => labelOf(due, c)))}</p>
        <p className="small">Uusi ne yhdellä kierroksella: yhteys kerrallaan, ja tästä näet, mitkä ovat valmiit.</p>
        <button className="btn btn-primary" type="button" disabled={disabled} aria-busy={busy === "connect-round" || undefined} onClick={onStart}>
          Uusi kaikki yhteydet
        </button>
      </div>
    );
  }

  const next = round.consents.find((c) => !c.done);
  return (
    <div className={round.finished ? "notice good renewal" : "notice warning renewal"} role="status">
      <p>
        <strong>Yhteyksien uusiminen</strong> · {roundText(round)}
      </p>
      <ul>
        {round.consents.map((c) => {
          const name = nameOf(c.bank);
          const logo = logoForInstitution(name, offered);
          return (
            <li key={c.connection}>
              {logo && <BankLogo src={logo} name={name} size="sm" />} {labelOf(round.consents, c)}
              <span className={c.done ? "badge good" : "badge warn"}>{c.done ? "uusittu" : "odottaa"}</span>
            </li>
          );
        })}
      </ul>
      <div className="form-row" style={{ margin: 0 }}>
        {next && (
          <button className="btn btn-primary" type="button" disabled={disabled} aria-busy={busy === `connect-${next.bank}` || undefined} onClick={() => onNext(next.bank)}>
            Uusi {labelOf(round.consents, next)}
          </button>
        )}
        <button className="btn" type="button" disabled={busy !== null} aria-busy={busy === "round-close" || undefined} onClick={onClose}>
          {round.finished ? "Sulje" : "Lopeta kierros"}
        </button>
      </div>
    </div>
  );
}
