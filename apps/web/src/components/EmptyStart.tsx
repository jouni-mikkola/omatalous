import { use, useEffect, useRef, useState } from "react";
import { navigate } from "../hooks.ts";
import { SETTINGS_ANCHOR, settingsHash } from "../routes.ts";
import { t } from "../text.ts";
import type { Meta } from "../types.ts";
import { Button } from "./ui/Button.tsx";
import { Notice } from "./ui/Notice.tsx";
import { SessionContext } from "../shell-context.ts";
import { useLookAgain, waitsForFirstFetch } from "../first-fetch.ts";
import { Empty } from "./ui/Empty.tsx";
export interface FirstRunStep {
  label: string;
  done: boolean;
}

/** What is left before the pages hold data, read from what /api/meta says. Nothing here is money. The app and its key are the administrator's work, so a member's list starts at the bank. */
export function firstRunSteps(meta: Pick<Meta, "bank" | "connections" | "lastSync">, member = false): FirstRunStep[] {
  const linked = meta.connections.some((c) => c.state === "active" && !c.history);
  const fetched = meta.lastSync?.status === "ok" || meta.lastSync?.status === "partial";
  const steps = [
    { label: t("start.step_bank"), done: linked },
    { label: t("start.step_fetch"), done: linked && fetched },
  ];
  return member ? steps : [{ label: t("start.step_app"), done: meta.bank.source !== null }, ...steps];
}

/** The bank is linked: the last step of the wizard may say Valmis. */
export function bankLinked(meta: Pick<Meta, "bank" | "connections" | "lastSync">): boolean {
  return firstRunSteps(meta)[1]!.done;
}

/**
 * Shown on every data page while the user has no accounts, so nobody meets a blank chart or a row of zeros that looks
 * like real data. The same centred card as the end of Tarkistettavat: a heading, one sentence on what happens next, the
 * steps in their order (done ones ticked, the next one named as the current step) and the two ways on. The heading takes
 * the focus when nothing else has it, as after the example data is removed.
 */
export function EmptyStart({ onDemo, meta, onReload }: { onDemo: () => Promise<void>; meta?: Pick<Meta, "bank" | "connections" | "lastSync" | "accounts" | "householdHasAccounts">; onReload?: () => void }) {
  const [demo, setDemo] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (document.activeElement === document.body || document.activeElement === null) heading.current?.focus();
  }, []);
  const loadDemo = async () => {
    setDemo({ busy: true, error: null });
    try {
      await onDemo();
    } catch (err) {
      setDemo({ busy: false, error: (err as Error).message });
    }
  };
  const linked = meta ? bankLinked(meta) : false;
  useLookAgain(!!meta && waitsForFirstFetch(meta.connections, meta.accounts) && onReload !== undefined, () => onReload?.());
  const member = use(SessionContext)?.user.role === "member";
  // a member with no bank app of the household has two ways on, both named: their own bank or an account another member shares
  const ownWay = member && !!meta && meta.bank.source === null && !linked;
  // the example data is for a household that has none: with another member's accounts in it the button would only mislead
  const showDemo = !meta?.householdHasAccounts;
  // no bank app at all: the bank list would only end in "ask the administrator", so the statement file comes first
  const noApp = ownWay;
  const steps = meta && !ownWay ? firstRunSteps(meta, member) : [];
  const next = steps.findIndex((st) => !st.done);
  return (
    <Empty
      className="empty-start"
      title={t("start.title")}
      headingRef={heading}
      action={
        <>
          {noApp ? (
            <Button variant="primary" onClick={() => { window.location.hash = settingsHash("banks", SETTINGS_ANCHOR.statement); }}>
              {t("start.statement")}
            </Button>
          ) : (
            <Button variant="primary" onClick={() => navigate("settings", { add: "1" })}>
              {t("start.connect")}
            </Button>
          )}
          {showDemo && (
            <Button onClick={() => void loadDemo()} busy={demo.busy}>
              {demo.busy ? t("start.loading") : t("start.demo")}
            </Button>
          )}
        </>
      }
    >
      <p>
        {ownWay ? t("start.no_app") : linked ? t("start.linked") : t("start.unlinked")}
        {showDemo && !linked && ` ${t("start.demo_hint")}`}
      </p>
      {steps.length > 0 && (
        <ol className="empty-steps" aria-label={t("start.setup")}>
          {steps.map((st, i) => (
            <li key={st.label} className={st.done ? "done" : undefined} aria-current={i === next ? "step" : undefined}>
              {st.label}
              {st.done && <span className="sr-only"> {t("start.done")}</span>}
            </li>
          ))}
        </ol>
      )}
      {demo.error && (
        <Notice tone="error">
          {demo.error}
        </Notice>
      )}
    </Empty>
  );
}
