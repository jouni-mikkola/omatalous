/** "Testaa paluuosoite" (admin): asks Enable Banking whether it accepts the app's return address, one line for each answer. */
import { useState } from "react";
import { api } from "../../api.ts";
import { CopyValue } from "./CopyValue.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Notice } from "../../components/ui/Notice.tsx";
import { rich, t } from "../../text.ts";
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
    <div className="form-row flush">
      <Button busy={busy} onClick={() => void test()}>
        {busy ? t("set.brt.testing") : t("set.brt.test_the_return_address")}
      </Button>
      {answer === "ok" && <Notice tone="good" role="status">{t("set.brt.the_return_address_works")}</Notice>}
      {answer === "error" && <Notice tone="warning" role="status">{t("set.brt.the_test_failed")}</Notice>}
      {answer === "redirect_not_allowed" && (
        <Notice tone="warning" role="status">
          {rich("set.brt.address_missing", {}, { copy: <CopyValue value={redirectUrl} label={t("set.brt.return_address")} /> })}
        </Notice>
      )}
    </div>
  );
}
