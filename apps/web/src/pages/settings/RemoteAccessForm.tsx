/** The address and who may sign in: turns remote access on, or, when it is on, changes the list. Both go through the yes-step. */
import { type FormEvent, useState } from "react";
import type { RemoteAccessState } from "./remote-access-api.ts";
import { cleanHostname, emailProblem, parseEmails, startEmails, startHostname } from "./remote-access-model.ts";

export function TurnOnForm({ s, onSubmit }: { s: RemoteAccessState; onSubmit: (hostname: string, emails: string[]) => void }) {
  const start = startHostname(s);
  const [host, setHost] = useState(start.host);
  const [text, setText] = useState(startEmails(s).join("\n"));
  const [problem, setProblem] = useState<{ field: "host" | "emails"; text: string } | null>(null);
  const on = s.access.on;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const hostname = cleanHostname(host);
    if (!hostname) return setProblem({ field: "host", text: "Anna osoite muodossa talous.oma.fi (ilman https://-alkua ja polkua)." });
    const emails = parseEmails(text);
    const bad = emailProblem(emails);
    if (bad) return setProblem({ field: "emails", text: bad });
    setProblem(null);
    onSubmit(hostname, emails);
  };

  return (
    <form className="setup-form remote-block" onSubmit={submit} noValidate>
      <h4 className="field-label">{on ? "Muuta sallittuja sähköpostiosoitteita" : "Ota etäkäyttö käyttöön"}</h4>
      <label>
        <span className="field-label">Osoite</span>
        <input
          name="hostname"
          type="text"
          value={host}
          readOnly={start.locked}
          onChange={(e) => setHost(e.target.value)}
          placeholder="talous.oma.fi"
          spellCheck={false}
          autoComplete="off"
          maxLength={253}
          aria-invalid={problem?.field === "host" ? true : undefined}
        />
        <span className="field-help">
          {start.locked
            ? "Osoitetta ei voi vaihtaa. Ota etäkäyttö ensin pois käytöstä."
            : "Ilman https://-alkua. Osoitteen pitää kuulua tunnisteen verkkotunnukseen, ja verkkotunnuksen edessä saa olla vain yksi osa."}
        </span>
        {problem?.field === "host" && <span className="error">{problem.text}</span>}
      </label>
      <label>
        <span className="field-label">Sallitut sähköpostiosoitteet</span>
        <textarea
          name="emails"
          rows={4}
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          autoComplete="off"
          aria-invalid={problem?.field === "emails" ? true : undefined}
        />
        <span className="field-help">
          Yksi osoite riville. Vain nämä osoitteet pääsevät kirjautumaan.{" "}
          {on ? "Poistettu osoite pääsee silti sisään, kunnes sen avoin kirjautuminen päättyy." : "Oman osoitteesi pitää olla listalla."}
        </span>
        {problem?.field === "emails" && <span className="error">{problem.text}</span>}
      </label>
      <div className="form-row">
        <button className="btn btn-primary" type="submit">
          {on ? "Tallenna sallitut osoitteet" : "Ota etäkäyttö käyttöön"}
        </button>
      </div>
    </form>
  );
}
