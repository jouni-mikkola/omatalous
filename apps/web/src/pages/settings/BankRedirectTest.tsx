/** "Testaa paluuosoite" (admin): asks Enable Banking whether it accepts the app's return address, one line for each answer. */
import { useState } from "react";
import { api } from "../../api.ts";
import { CopyValue } from "./CopyValue.tsx";

type Answer = "ok" | "redirect_not_allowed" | "error";

export function BankRedirectTest({ redirectUrl }: { redirectUrl: string }) {
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const test = async () => {
    setBusy(true);
    setAnswer(null);
    try {
      setAnswer((await api<{ result: Answer }>("/api/admin/bank-app/redirect-test", { method: "POST" })).result);
    } catch {
      setAnswer("error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="form-row" style={{ margin: 0 }}>
      <button className="btn" type="button" disabled={busy} aria-busy={busy || undefined} onClick={() => void test()}>
        {busy ? "Testataan…" : "Testaa paluuosoite"}
      </button>
      {answer === "ok" && <span className="notice good" role="status">Paluuosoite toimii.</span>}
      {answer === "error" && <span className="notice warning" role="status">Testi epäonnistui.</span>}
      {answer === "redirect_not_allowed" && (
        <span className="notice warning" role="status">
          Osoite puuttuu Redirect URLs -kohdasta: <CopyValue value={redirectUrl} label="paluuosoite" />
        </span>
      )}
    </div>
  );
}
