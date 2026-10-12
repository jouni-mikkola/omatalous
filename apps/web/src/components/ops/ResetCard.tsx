import { useRef, useState } from "react";
import { api, setUnauthenticatedHandler } from "../../api.ts";
import { confirmBody, S } from "./ops-strings.ts";
import { PasswordDialog } from "./PasswordDialog.tsx";
import type { ResetResult } from "./types.ts";

/** What the card shows after the answer: the server's sentence, the copy it made, the connections the bank kept, and the way to sign in. */
export function ResetDone({ result }: { result: ResetResult }) {
  return (
    <div role="status">
      <p>{result.message}</p>
      <p>{S.resetCopy(result.copy)}</p>
      {result.failed > 0 && <p>{S.resetFailed(result.failed)}</p>}
      <p>{S.resetBanks}</p>
      <div className="form-row">
        {/* an address without a fragment loads the page again, and the sign-in page is what it shows */}
        <a className="btn btn-primary" href="/">
          {S.signIn}
        </a>
      </div>
    </div>
  );
}

/**
 * Decision: the admin can start over from the browser, and reads what goes, what stays and how to undo it before the
 * click. The button is off from the first submit until the server answers (a second request would get a 409).
 */
export function ResetCard({ disabled }: { disabled: boolean }) {
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<ResetResult | null>(null);
  const sending = useRef(false);

  const send = async (password: string, confirm: string) => {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    try {
      const result = await api<ResetResult>("/api/ops/reset", { method: "POST", body: confirmBody(password, confirm) });
      // the session is gone: every later call answers 401, and the app would swap this page for the sign-in page at the
      // next one, before the result is read. The link on the card is the way out.
      setUnauthenticatedHandler(() => undefined);
      setDone(result);
      setAsk(false);
    } catch (err) {
      sending.current = false;
      setBusy(false);
      throw err;
    }
  };

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>{S.resetTitle}</h2>
          {!done && <div className="card-sub">{S.resetSub}</div>}
        </div>
        {!done && (
          <button className="btn btn-danger" type="button" disabled={disabled || busy} onClick={() => setAsk(true)}>
            {S.resetTitle}
          </button>
        )}
      </div>
      {done ? (
        <ResetDone result={done} />
      ) : (
        <>
          <p>{S.resetGoes}</p>
          <ul>
            {S.resetNotes.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </>
      )}
      {ask && (
        <PasswordDialog title={S.resetTitle} submitLabel={S.resetSubmit} confirmWord={S.resetWord} danger onCancel={() => setAsk(false)} onSubmit={send}>
          <ul>
            {S.resetDialog.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </PasswordDialog>
      )}
    </div>
  );
}
