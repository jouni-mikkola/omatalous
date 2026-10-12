import { useEffect, useState } from "react";
import { api } from "../../api.ts";
import { dateTime } from "../../format.ts";
import { confirmBody, formatSize, restoreView, restoreWait, S } from "./ops-strings.ts";
import { PasswordDialog } from "./PasswordDialog.tsx";
import type { RestoreCopy, RestoreState } from "./types.ts";

/**
 * Decision: the admin can take the newest intact database copy back after a mistake, knowing which copy it is and what
 * is lost. The card names the copy's time first, because the newest copy may have been made after the mistake.
 */

/** After the request the app stops itself and Docker starts it again. The first check waits for the stop. */
const FIRST_MS = 1500;
const EVERY_MS = 2500;
/** An answer from the old process before it stopped does not count; with no failed check seen, this long is enough. */
const AT_LEAST_MS = 20_000;

/** Reads /api/health until it answers again. Anything but a 200 (a proxy's 502, the app's own 503) counts as still down. */
function useAppBack(active: boolean) {
  const [back, setBack] = useState(false);
  const [waited, setWaited] = useState(0);
  useEffect(() => {
    if (!active) return;
    const started = Date.now();
    let seenDown = false;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      let up = true;
      try {
        await api("/api/health");
      } catch {
        up = false;
      }
      if (stopped) return;
      const ms = Date.now() - started;
      setWaited(ms);
      if (!up) seenDown = true;
      if (up && (seenDown || ms >= AT_LEAST_MS)) {
        setBack(true);
        return;
      }
      timer = setTimeout(() => void tick(), EVERY_MS);
    };
    timer = setTimeout(() => void tick(), FIRST_MS);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [active]);
  return { back, waited };
}

/** What the card says before the request: the copy and what is lost, or why there is no button. */
export function RestoreFacts({ state, error }: { state: RestoreState | null; error: string | null }) {
  if (error && !state) return <div className="error" role="alert">{error}</div>;
  const view = restoreView(state);
  if (view === "loading") return <div className="muted">{S.restoreLoading}</div>;
  if (view === "none") return <div className="empty">{S.restoreNone}</div>;
  if (view === "pending") return <p>{S.restorePending}</p>;
  const copy = state!.copy!;
  return (
    <>
      <div className="field-label">{S.restoreCopyLabel}</div>
      <p style={{ fontSize: 21, fontWeight: 500, margin: "2px 0" }}>{dateTime(copy.at)}</p>
      <div className="card-sub">
        {copy.name} · {formatSize(copy.size)}
      </div>
      <p>{S.restoreLoses}</p>
      <p>{copy.kind === "pre-reset" ? S.restoreUndoesReset : S.restoreMistake}</p>
    </>
  );
}

/**
 * Asetukset > Ylläpito: the newest intact copy and the button that takes it back. The copy is read when the card opens
 * and again when the list of copies changes (`listKey`), never on a timer: each read checks the whole copy. A restore
 * is only asked for here. Whether it was done is told by the notice after the start, so the card never says it was.
 */
export function RestoreLatest({ listKey, disabled }: { listKey: string; disabled: boolean }) {
  const [state, setState] = useState<RestoreState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ask, setAsk] = useState(false);
  const [asked, setAsked] = useState<RestoreCopy | null>(null);
  const [stillPending, setStillPending] = useState<boolean | null>(null);
  const { back, waited } = useAppBack(asked !== null);

  useEffect(() => {
    if (asked) return;
    let cancelled = false;
    api<RestoreState>("/api/ops/restore-latest")
      .then((r) => {
        if (cancelled) return;
        setState(r);
        setError(null);
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [listKey, asked]);

  // one read after the app is back: a request that still waits means the restore has not been done
  useEffect(() => {
    if (!back) return;
    api<RestoreState>("/api/ops/restore-latest")
      .then((r) => setStillPending(r.pending))
      // no answer (the session may not exist in the restored database): the notice is still what tells
      .catch(() => setStillPending(false));
  }, [back]);

  const send = async (password: string, confirm: string) => {
    const r = await api<{ copy: RestoreCopy }>("/api/ops/restore-latest", { method: "POST", body: confirmBody(password, confirm) });
    setAsked(r.copy);
    setAsk(false);
  };

  const copy = state?.copy ?? null;
  const canAsk = !asked && restoreView(state) === "copy";
  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>{S.restoreTitle}</h2>
          <div className="card-sub">{S.restoreSub}</div>
        </div>
        {canAsk && (
          <button className="btn btn-danger" type="button" disabled={disabled} onClick={() => setAsk(true)}>
            {S.restoreTitle}
          </button>
        )}
      </div>
      {asked ? (
        <div role="status">
          <p>{S.restoreAsked(dateTime(asked.at))}</p>
          {back ? (
            stillPending !== null && (
              <>
                <p>{stillPending ? S.restoreStillPending : S.restoreBack}</p>
                <div className="form-row">
                  <button className="btn btn-primary" type="button" onClick={() => window.location.reload()}>
                    {S.reload}
                  </button>
                </div>
              </>
            )
          ) : (
            restoreWait(waited).map((line) => <p key={line}>{line}</p>)
          )}
        </div>
      ) : (
        <RestoreFacts state={state} error={error} />
      )}
      {ask && copy && (
        <PasswordDialog title={S.restoreTitle} submitLabel={S.restoreSubmit} confirmWord={S.restoreWord} danger onCancel={() => setAsk(false)} onSubmit={send}>
          <ul>
            {S.restoreDialog(dateTime(copy.at)).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </PasswordDialog>
      )}
    </div>
  );
}
