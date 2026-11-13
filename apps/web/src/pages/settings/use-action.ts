/** The run of one form of the second factor in Asetukset > Turvallisuus. */
import { type FormEvent, useState } from "react";

/** Runs a form's action with a busy flag and the server's sentence as the error. */
export function useAction() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = (fn: () => Promise<void>) => async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return { error, busy, run };
}
