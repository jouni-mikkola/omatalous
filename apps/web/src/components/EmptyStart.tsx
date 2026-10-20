import { useEffect, useRef, useState } from "react";
import { navigate } from "../hooks.ts";
import type { Meta } from "../types.ts";

export interface FirstRunStep {
  label: string;
  done: boolean;
}

/** What is left before the pages hold data, read from what /api/meta says. Nothing here is money. */
export function firstRunSteps(meta: Pick<Meta, "bank" | "connections" | "lastSync">): FirstRunStep[] {
  const linked = meta.connections.some((c) => c.state === "active" && !c.history);
  const fetched = meta.lastSync?.status === "ok" || meta.lastSync?.status === "partial";
  return [
    { label: "Enable Banking -sovellus ja avain", done: meta.bank.source !== null },
    { label: "Pankki yhdistetty", done: linked },
    { label: "Ensimmäinen haku tehty", done: linked && fetched },
  ];
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
export function EmptyStart({ onDemo, meta }: { onDemo: () => Promise<void>; meta?: Pick<Meta, "bank" | "connections" | "lastSync"> }) {
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
  const steps = meta ? firstRunSteps(meta) : [];
  const next = steps.findIndex((st) => !st.done);
  return (
    <section className="card empty-card empty-start" aria-labelledby="empty-start-h">
      <h2 id="empty-start-h" ref={heading} tabIndex={-1}>
        Ei vielä tietoja
      </h2>
      <p>Kun pankki on yhdistetty, tapahtumat haetaan ja sivut täyttyvät. Esimerkkitiedoilla näet sivut heti.</p>
      {steps.length > 0 && (
        <ol className="empty-steps" aria-label="Käyttöönotto">
          {steps.map((st, i) => (
            <li key={st.label} className={st.done ? "done" : undefined} aria-current={i === next ? "step" : undefined}>
              {st.label}
              {st.done && <span className="sr-only"> (tehty)</span>}
            </li>
          ))}
        </ol>
      )}
      <div className="form-row">
        <button className="btn btn-primary" type="button" onClick={() => navigate("settings", { add: "1" })}>
          Yhdistä pankki
        </button>
        <button className="btn" type="button" onClick={() => void loadDemo()} disabled={demo.busy} aria-busy={demo.busy || undefined}>
          {demo.busy ? "Ladataan…" : "Lataa esimerkkitiedot"}
        </button>
      </div>
      {demo.error && (
        <div className="error" role="alert">
          {demo.error}
        </div>
      )}
    </section>
  );
}
