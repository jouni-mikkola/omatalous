/**
 * Asetukset > Pankit ja tilit, in the edit form of an account: which other members of the household see it (read-only).
 * Each member is one check box that saves at once and is put back if the server refuses.
 */
import { useEffect, useState } from "react";
import { api } from "../../api.ts";
import type { Meta } from "../../types.ts";
import { Notice } from "../../components/ui/Notice.tsx";
import { t } from "../../text.ts";

export function AccountShares({ accountId, meta, onChange }: { accountId: string; meta: Meta; onChange: () => void }) {
  const others = meta.members.filter((m) => m.id !== meta.user.id);
  const [shares, setShares] = useState(meta.shares);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setShares(meta.shares), [meta.shares]);
  if (!others.length) return null;

  const isShared = (userId: string) => shares.some((s) => s.accountId === accountId && s.userId === userId);
  const toggle = async (userId: string, on: boolean) => {
    const before = shares;
    setShares(on ? [...shares, { accountId, userId }] : shares.filter((s) => !(s.accountId === accountId && s.userId === userId)));
    setError(null);
    try {
      await api(`/api/accounts/${accountId}/shares/${userId}`, { method: on ? "PUT" : "DELETE" });
      onChange();
    } catch (err) {
      setShares(before);
      setError((err as Error).message);
    }
  };
  return (
    <fieldset className="share-list">
      <legend className="field-label">{t("set.ash.sharing_the_account")}</legend>
      {others.map((m) => (
        <label key={m.id}>
          <input type="checkbox" checked={isShared(m.id)} onChange={(e) => void toggle(m.id, e.target.checked)} /> {t("set.ash.visible_to", { name: m.displayName })}
        </label>
      ))}
      {error && <Notice tone="error">{error}</Notice>}
    </fieldset>
  );
}
