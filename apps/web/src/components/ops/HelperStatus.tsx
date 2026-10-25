import { useState } from "react";
import { clockTime, dateTime } from "../../format.ts";
import { ENABLE_DOC, S } from "./ops-strings.ts";
import type { HelperInfo } from "./types.ts";

/** A command to run on the machine, with a copy button. The clipboard is missing on plain http, so the text stays selectable. */
export function Command({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // not allowed here: the user selects the text instead
    }
  };
  return (
    <div className="form-row">
      <code className="ops-command">{text}</code>
      <button className="btn btn-small" type="button" onClick={() => void copy()}>
        {copied ? "Kopioitu" : "Kopioi"}
      </button>
    </div>
  );
}

export function HelperStatus({ helper }: { helper: HelperInfo }) {
  if (helper.status === "off") {
    return (
      <div className="notice warning" role="status">
        <strong>{S.helperNever}</strong>
        <p style={{ margin: "4px 0" }}>{helper.reason === "stale" ? S.helperStale : S.helperNeverHelp}</p>
        <Command text={helper.reason === "stale" ? "systemctl --user list-timers 'talous-ops-*'" : helper.enableCommand} />
        {helper.reason === "stale" && (
          <>
            <p style={{ margin: "4px 0" }}>Jos ajastinta ei ole, asenna apuri uudelleen:</p>
            <Command text={helper.enableCommand} />
          </>
        )}
        <a href={ENABLE_DOC} target="_blank" rel="noopener noreferrer">
          {S.helperDoc}
        </a>
      </div>
    );
  }
  const seen = helper.seenAt ?? "";
  return (
    <>
      {helper.status === "ok" ? (
        <div className="notice good" role="status">{S.helperOk(clockTime(seen))}</div>
      ) : (
        <div className="notice warning" role="status">{S.helperSlow(dateTime(seen))}</div>
      )}
      {helper.outdated && (
        <div className="notice warning" role="status">
          {S.helperOutdated}
          <Command text={helper.enableCommand} />
        </div>
      )}
    </>
  );
}
