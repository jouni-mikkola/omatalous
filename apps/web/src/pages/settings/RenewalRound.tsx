/**
 * Decision: whether to renew every consent that ends or has ended now, one after the other, instead of one row at a time.
 * Two or more consents due offer the round; a begun round lists each consent as renewed or left, and the next one is one
 * press. The server keeps the round and reads what is done from the consents (core `consent-round.ts`).
 */
import { dueText, roundLabel, roundText } from "../../consent-notices.ts";
import type { Meta } from "../../types.ts";
import { Button } from "../../components/ui/Button.tsx";
import { Notice } from "../../components/ui/Notice.tsx";
import { t } from "../../text.ts";
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
      <Notice tone="warning" className="renewal">
        <p>{dueText(due.map((c) => labelOf(due, c)))}</p>
        <p className="small">{t("set.rr.renew_them_in_one_round")}</p>
        <Button variant="primary" disabled={disabled} aria-busy={busy === "connect-round" || undefined} onClick={onStart}>
          {t("set.rr.renew_all_connections")}
        </Button>
      </Notice>
    );
  }

  const next = round.consents.find((c) => !c.done);
  return (
    <Notice tone={round.finished ? "good" : "warning"} className="renewal" role="status">
      <p>
        <strong>{t("set.rr.renewing_connections")}</strong> · {roundText(round)}
      </p>
      <ul>
        {round.consents.map((c) => (
          <li key={c.connection}>
            {labelOf(round.consents, c)}
            <span className={c.done ? "badge good" : "badge warn"}>{c.done ? t("set.rr.renewed") : t("set.rr.waiting")}</span>
          </li>
        ))}
      </ul>
      <div className="form-row flush">
        {next && (
          <Button variant="primary" disabled={disabled} aria-busy={busy === `connect-${next.bank}` || undefined} onClick={() => onNext(next.bank)}>
            {t("set.rr.renew_label", { label: labelOf(round.consents, next) })}
          </Button>
        )}
        <Button disabled={busy !== null} aria-busy={busy === "round-close" || undefined} onClick={onClose}>
          {round.finished ? t("set.rr.close") : t("set.rr.end_the_round")}
        </Button>
      </div>
    </Notice>
  );
}
