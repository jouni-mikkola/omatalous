/**
 * Asetukset > Pankit ja tilit, in the edit form of an account: which other members of the household see it (read-only).
 * Each member is one check box that saves at once and is put back if the server refuses. The saves go one after the
 * other in the order of the clicks, so the last click is what the server ends with; an answer to an earlier click never
 * redraws a box the reader has clicked since, and the page's own copy is read again only when no save is left.
 */
import { useEffect, useRef, useState } from "react";
import { api } from "../../api.ts";
import type { Meta } from "../../types.ts";
import { Notice } from "../../components/ui/Notice.tsx";
import { t } from "../../text.ts";

export function AccountShares({ accountId, meta, onChange }: { accountId: string; meta: Meta; onChange: () => void }) {
  const others = meta.members.filter((m) => m.id !== meta.user.id);
  const [shares, setShares] = useState(meta.shares);
  const [error, setError] = useState<string | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const pending = useRef(0);
  /** The number of the latest click on each member's box. */
  const latest = useRef(new Map<string, number>());
  useEffect(() => {
    if (pending.current === 0) setShares(meta.shares);
  }, [meta.shares]);
  if (!others.length) return null;

  const isShared = (userId: string) => shares.some((s) => s.accountId === accountId && s.userId === userId);
  const toggle = (userId: string, on: boolean) => {
    const other = (s: { accountId: string; userId: string }) => !(s.accountId === accountId && s.userId === userId);
    const set = (cur: typeof shares, value: boolean) => (value ? [...cur.filter(other), { accountId, userId }] : cur.filter(other));
    const click = (latest.current.get(userId) ?? 0) + 1;
    latest.current.set(userId, click);
    setShares((cur) => set(cur, on));
    setError(null);
    pending.current++;
    queue.current = queue.current.then(async () => {
      try {
        await api(`/api/accounts/${accountId}/shares/${userId}`, { method: on ? "PUT" : "DELETE" });
      } catch (err) {
        // put back only this box, and only if the reader has not clicked it again since
        if (latest.current.get(userId) === click) setShares((cur) => set(cur, !on));
        setError((err as Error).message);
      } finally {
        pending.current--;
        if (pending.current === 0) onChange();
      }
    });
  };
  return (
    <fieldset className="share-list">
      <legend className="field-label">{t("set.ash.sharing_the_account")}</legend>
      {others.map((m) => (
        <label key={m.id}>
          <input type="checkbox" checked={isShared(m.id)} onChange={(e) => toggle(m.id, e.target.checked)} /> {t("set.ash.visible_to", { name: m.displayName })}
        </label>
      ))}
      {error && <Notice tone="error">{error}</Notice>}
    </fieldset>
  );
}
