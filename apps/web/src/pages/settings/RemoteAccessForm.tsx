/** The address and who may sign in: turns remote access on, or, when it is on, changes the list. Both go through the yes-step. */
import { type FormEvent, useState } from "react";
import type { RemoteAccessState } from "./remote-access-api.ts";
import { cleanHostname, emailProblem, parseEmails, startEmails, startHostname } from "./remote-access-model.ts";
import { Button } from "../../components/ui/Button.tsx";
import { t } from "../../text.ts";
export function TurnOnForm({ s, onSubmit }: { s: RemoteAccessState; onSubmit: (hostname: string, emails: string[]) => void }) {
  const start = startHostname(s);
  const [host, setHost] = useState(start.host);
  const [text, setText] = useState(startEmails(s).join("\n"));
  const [problem, setProblem] = useState<{ field: "host" | "emails"; text: string } | null>(null);
  const on = s.access.on;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const hostname = cleanHostname(host);
    if (!hostname) return setProblem({ field: "host", text: t("set.rform.enter_the_address_like_talous") });
    const emails = parseEmails(text);
    const bad = emailProblem(emails);
    if (bad) return setProblem({ field: "emails", text: bad });
    setProblem(null);
    onSubmit(hostname, emails);
  };

  return (
    <form className="setup-form remote-block" onSubmit={submit} noValidate>
      <h4 className="field-label">{on ? t("set.rform.change_the_allowed_email_addresses") : t("set.rform.turn_on_remote_access")}</h4>
      <label>
        <span className="field-label">{t("set.rform.address")}</span>
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
            ? t("set.rform.cannot_change_address")
            : t("set.rform.address_help")}
        </span>
        {problem?.field === "host" && <span className="field-error">{problem.text}</span>}
      </label>
      <label>
        <span className="field-label">{t("set.rform.allowed_email_addresses")}</span>
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
          {t("set.rform.one_per_line")} {on ? t("set.rform.removed_still_in") : t("set.rform.own_address_listed")}
        </span>
        {problem?.field === "emails" && <span className="field-error">{problem.text}</span>}
      </label>
      <div className="form-row">
        <Button variant="primary" type="submit">
          {on ? t("set.rform.save_allowed_addresses") : t("set.rform.turn_on_remote_access")}
        </Button>
      </div>
    </form>
  );
}
