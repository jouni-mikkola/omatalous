/** Share own accounts with household members (read-only, per account). */
import { useEffect, useState } from "react";
import { api } from "../../api.ts";
import type { Meta } from "../../types.ts";
import { sharedUseText } from "./account-use.ts";

export function Sharing({ meta, onChange }: { meta: Meta; onChange: () => void }) {
  const others = meta.members.filter((m) => m.id !== meta.user.id);
  // optimistic: the checkbox flips at once and is reverted if the server refuses
  const [shares, setShares] = useState(meta.shares);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setShares(meta.shares), [meta.shares]);
  if (!others.length) return null;

  const isShared = (accountId: string, userId: string) => shares.some((s) => s.accountId === accountId && s.userId === userId);
  const toggle = async (accountId: string, userId: string, on: boolean) => {
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
    <div className="card">
      <div className="card-head">
        <div>
          <h2>Tilien jakaminen</h2>
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Oma tili</th>
              {others.map((m) => (
                <th key={m.id}>{m.displayName}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {meta.accounts.map((a) => (
              <tr key={a.id}>
                <td>{a.name}</td>
                {others.map((m) => (
                  <td key={m.id}>
                    <label className="small">
                      <input type="checkbox" checked={isShared(a.id, m.id)} onChange={(e) => void toggle(a.id, m.id, e.target.checked)} /> jaettu
                    </label>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {!meta.accounts.length && <div className="empty">Ei tilejä.</div>}
        {error && <div className="error">{error}</div>}
      </div>
      {meta.sharedAccounts.length > 0 && (
        <div className="small muted">
          Sinulle jaettu:
          <ul className="shared-list">
            {meta.sharedAccounts.map((a) => (
              <li key={a.id}>
                {a.name} ({a.ownerName}){sharedUseText(a, meta.user.id) ? `, ${sharedUseText(a, meta.user.id)}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
