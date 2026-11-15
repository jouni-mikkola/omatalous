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
/** `service` is the administrator's set-up of the bank service, `connect` the connection of a bank, `fetch` the first fetch. */
export interface FirstRunStep {
  id: "service" | "connect" | "fetch";
  label: string;
  done: boolean;
}

/** The bank is linked: the last step of the wizard may say Valmis. */
export function bankLinked(meta: Pick<Meta, "connections">): boolean {
  return meta.connections.some((c) => c.state === "active" && !c.history);
}

/** The administrator has set up the bank service (the household's application or one's own key): only then can a bank be connected. */
export function bankServiceReady(meta: Pick<Meta, "bank">): boolean {
  return meta.bank.source !== null;
}

/**
 * What is left before the pages hold data, read from what /api/meta says. Nothing here is money. The set-up of the bank
 * service is the administrator's work and is a step only while it is undone: a household that already has the service
 * has nothing to tick there, and a member's list starts at the bank.
 */
export function firstRunSteps(meta: Pick<Meta, "bank" | "connections" | "lastSync">, member = false): FirstRunStep[] {
  const linked = bankLinked(meta);
  const fetched = meta.lastSync?.status === "ok" || meta.lastSync?.status === "partial";
  const steps: FirstRunStep[] = [
    { id: "connect", label: t("start.step_bank"), done: linked },
    { id: "fetch", label: t("start.step_fetch"), done: linked && fetched },
  ];
  return member || bankServiceReady(meta) ? steps : [{ id: "service", label: t("start.step_service"), done: false }, ...steps];
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
  // another member's accounts are in the household: they can be shared, and the example data would only mislead
  const shared = !!meta?.householdHasAccounts;
  const showDemo = !shared;
  // no bank app at all: the bank list would only end in "ask the administrator", so the statement file comes first
  const noApp = ownWay;
  // the administrator's bank connection waits for the set-up of the bank service: no connecting is offered before it
  const needsService = !!meta && !member && !bankServiceReady(meta) && !linked;
  const steps = meta && !ownWay ? firstRunSteps(meta, member) : [];
  const next = steps.findIndex((st) => !st.done);
  return (
    <Empty
      className="empty-start"
      title={t("start.title")}
      headingRef={heading}
      action={
        <>
          {needsService && (
            <Button variant="primary" onClick={() => { window.location.hash = settingsHash("banks", SETTINGS_ANCHOR.bankApp); }}>
              {t("start.setup_service")}
            </Button>
          )}
          {noApp || needsService ? (
            <Button variant={noApp ? "primary" : "secondary"} onClick={() => { window.location.hash = settingsHash("banks", SETTINGS_ANCHOR.statement); }}>
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
        {ownWay ? t("start.no_app") : needsService ? t("start.no_service") : linked ? t("start.linked") : t("start.unlinked")}
        {shared && !linked && ` ${t("start.shared_hint")}`}
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
