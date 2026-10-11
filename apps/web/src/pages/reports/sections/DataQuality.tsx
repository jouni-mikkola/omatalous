// Decision: connect or fetch what is missing before trusting a number
import { query } from "../../../api.ts";
import { accountsInNumbers, consentText, lastFetched } from "../../../components/DataScope.tsx";
import { ACCOUNT_TYPE_LABEL, dateTime } from "../../../format.ts";
import { Section } from "../parts.tsx";
import type { ReportSection, SectionProps } from "../types.ts";
import "../../../styles/quality.css";

const PROVIDER_LABEL: Record<string, string> = { enablebanking: "pankkiyhteys", csv: "CSV", demo: "demo" };

/** Which accounts the numbers are made of, when each was last fetched and when its bank consent ends. */
function AccountsInNumbers({ ctx }: SectionProps) {
  const { meta, scope } = ctx;
  const accounts = accountsInNumbers(meta, scope);
  if (!accounts.length) {
    return (
      <p className="muted">
        Luvuissa ei ole vielä yhtään tiliä. Yhdistä pankki tai tuo CSV kohdassa <a href="#/settings">Asetukset</a>.
      </p>
    );
  }
  return (
    <div className="table-wrap">
      <table className="scope-table">
        <thead>
          <tr>
            <th>Luvuissa mukana</th>
            <th>Haettu viimeksi</th>
            <th>Pankkiyhteys</th>
          </tr>
        </thead>
        <tbody>
          {accounts.map((a) => {
            const consent = consentText(meta.connections.find((c) => c.id === a.connectionId));
            return (
              <tr key={a.id}>
                <td>
                  {a.name}
                  {a.ownerName ? ` (${a.ownerName})` : ""}
                  <div className="sub muted">
                    {ACCOUNT_TYPE_LABEL[a.type] ?? a.type} · {PROVIDER_LABEL[a.provider] ?? a.provider}
                  </div>
                </td>
                <td>{dateTime(lastFetched(a))}</td>
                <td className={consent?.urgent ? "scope-warn" : undefined}>{consent?.text ?? "–"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function DataQuality({ ctx }: SectionProps) {
  const r = ctx.data.dataQuality;
  return (
    <Section section={section} sub="Näissä kohdissa luvut voivat poiketa todellisesta.">
      <AccountsInNumbers ctx={ctx} />
      {r.signals.length ? (
        <ul className="plain">
          {r.signals.map((s) => (
            <li key={s.id} style={{ margin: "0 0 10px" }}>
              <strong>{s.title}</strong>
              <div className="muted">
                {s.detail}
                {s.category && (
                  <>
                    {" "}
                    <a href={`#/transactions${query({ category: s.category, from: ctx.range.from, to: ctx.range.to })}`}>Näytä tapahtumat</a>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">Ei huomautettavaa. Tähän tulevat katkot tapahtumissa ja luokittelemattomat menot.</p>
      )}
    </Section>
  );
}

export const section: ReportSection = {
  id: "laatu",
  title: "Tietojen laatu",
  order: 10,
  reports: ["dataQuality"],
  Component: DataQuality,
};
