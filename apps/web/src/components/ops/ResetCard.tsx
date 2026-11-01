import { useRef, useState } from "react";
import { api, setUnauthenticatedHandler } from "../../api.ts";
import { confirmBody, S } from "./ops-strings.ts";
import { PasswordDialog } from "./PasswordDialog.tsx";
import type { ResetResult } from "./types.ts";
import { Button } from "../ui/Button.tsx";
import { FoldCard } from "../ui/FoldCard.tsx";
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
        <Button variant="primary" href="/">
          {S.signIn}
        </Button>
      </div>
    </div>
  );
}

/**
 * Decision: the admin can start over from the browser, and reads what goes, that a copy is taken first and what the
 * banks need after it before the click. The button is off from the first submit until the server answers (a second request would get a 409).
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
    <FoldCard className="danger-zone" title={S.resetTitle} sub={S.resetSub} folded>
      {done ? (
        <ResetDone result={done} />
      ) : (
        <>
          {S.resetLines.map((line) => (
            <p key={line}>{line}</p>
          ))}
          <div className="form-row">
            <Button disabled={disabled || busy} onClick={() => setAsk(true)}>
              {S.resetTitle}
            </Button>
          </div>
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
    </FoldCard>
  );
}
