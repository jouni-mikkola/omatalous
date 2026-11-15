import { t } from "../../text.ts";
import "../../styles/ops.css";
import { useState } from "react";
import { clockTime, dateTime } from "../../format.ts";
import { ENABLE_DOC, S } from "./ops-strings.ts";
import type { HelperInfo } from "./types.ts";
import { Button } from "../ui/Button.tsx";
import { Notice } from "../ui/Notice.tsx";
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
      <Button onClick={() => void copy()}>
        {copied ? t("ops.copied") : t("ops.copy")}
      </Button>
    </div>
  );
}

export function HelperStatus({ helper }: { helper: HelperInfo }) {
  if (helper.status === "off") {
    return (
      <Notice tone="warning" role="status">
        <strong>{S.helperNever}</strong>
        <p className="ops-line">{helper.reason === "stale" ? S.helperStale : S.helperNeverHelp}</p>
        <Command text={helper.reason === "stale" ? "systemctl --user list-timers 'talous-ops-*'" : helper.enableCommand} />
        {helper.reason === "stale" && (
          <>
            <p className="ops-line">Jos ajastinta ei ole, asenna apuri uudelleen:</p>
            <Command text={helper.enableCommand} />
          </>
        )}
        <a className="btn-link" href={ENABLE_DOC} target="_blank" rel="noopener noreferrer">
          {S.helperDoc}
        </a>
      </Notice>
    );
  }
  const seen = helper.seenAt ?? "";
  return (
    <>
      {helper.status === "ok" ? (
        <Notice tone="good" role="status">{S.helperOk(clockTime(seen))}</Notice>
      ) : (
        <Notice tone="warning" role="status">{S.helperSlow(dateTime(seen))}</Notice>
      )}
      {helper.outdated && (
        <Notice tone="warning" role="status">
          {S.helperOutdated}
          <Command text={helper.enableCommand} />
        </Notice>
      )}
    </>
  );
}
