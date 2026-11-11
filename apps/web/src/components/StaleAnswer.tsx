import { dateTime } from "../format.ts";
import { useFault } from "../hooks.ts";
import { useFiguresFrom } from "../offline.ts";
import { t } from "../text.ts";
import { Button } from "./ui/Button.tsx";
import { Notice } from "./ui/Notice.tsx";

/**
 * The one line over an answer that could not be read again (design section 4, error): what failed, the time of the
 * answer that stays on the page, and the button that asks again. It goes when a load succeeds. A page with no answer
 * shows ErrorCard in its place, and this line is not drawn. Nor is it while the shell says that the server cannot be
 * reached and gives the time of the kept figures (`useFiguresFrom`): one line, one time.
 */
export function StaleAnswer() {
  const { fault, retry } = useFault();
  const kept = useFiguresFrom();
  if (!fault || kept) return null;
  return (
    <Notice tone="warning" role="status" className="stale-answer">
      {fault.message || t("load.failed")} {t("ops.checked_at", { time: dateTime(fault.at) })}.{" "}
      <Button variant="link" onClick={retry}>
        {t("load.retry")}
      </Button>
    </Notice>
  );
}
