/**
 * Asetukset > Jäsenet, for the administrator: "Jäsenet ilman tunnusta", the people of the household who have no login
 * and still share an account. A name is added with or without a bank holder name; a holder line that names one of
 * them counts for that person in Raportit > Yhteiset menot (the server matches the names).
 */
import { type FormEvent, useState } from "react";
import { api } from "../../api.ts";
import { useApi } from "../../hooks.ts";
import type { Meta } from "../../types.ts";

interface Member {
  id?: number | string;
  name: string;
}

/** The holder names the accounts show, each once: a holder line of two names is two. */
function holdersOf(meta: Meta): string[] {
  const names = meta.accounts.flatMap((a) => (a.holder ?? "").split(";").map((n) => n.trim()).filter(Boolean));
  return [...new Set(names)];
}

export function NamelessMembers({ meta }: { meta: Meta }) {
  const { data, error: loadError, reload } = useApi<{ members: Member[] }>("/api/admin/household-members");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const holders = holdersOf(meta);

  const put = async (members: Member[]) => {
    setBusy(true);
    setError(null);
    try {
      await api("/api/admin/household-members", { method: "PUT", body: { members } });
      setName("");
      reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const members = data?.members ?? [];
  const add = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim()) void put([...members, { name: name.trim() }]);
  };

  return (
    <div className="card" id="jasenet-ilman-tunnusta">
      <div className="card-head">
        <div>
          <h2>Jäsenet ilman tunnusta</h2>
        </div>
      </div>
      <form className="form-row" onSubmit={add}>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} aria-label="Nimi" placeholder="Nimi" />
        {holders.length > 0 && (
          <select value="" aria-label="Nimi pankin tiedoissa" onChange={(e) => e.target.value && setName(e.target.value)}>
            <option value="">Nimi pankin tiedoissa</option>
            {holders.map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </select>
        )}
        <button className="btn btn-primary" type="submit" disabled={busy || !name.trim()} aria-busy={busy || undefined}>
          Lisää
        </button>
      </form>
      {(error ?? loadError) && <div className="error">{error ?? loadError}</div>}
      {members.length > 0 && (
        <ul className="use-list">
          {members.map((m) => (
            <li key={m.id ?? m.name} className="use-row">
              <span className="use-label">{m.name}</span>
              <span className="use-actions">
                <button
                  className="btn btn-small btn-danger"
                  type="button"
                  disabled={busy}
                  aria-busy={busy || undefined}
                  aria-label={`Poista ${m.name}`}
                  onClick={() => window.confirm(`Poistetaanko ${m.name}?`) && void put(members.filter((x) => x !== m))}
                >
                  Poista
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
