import { Button } from "./ui/Button.tsx";
import { Notice } from "./ui/Notice.tsx";
import { t } from "../text.ts";

/** A failed page request with a way forward. */
export function ErrorCard({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Notice tone="error" title={t("load.failed")} action={<Button onClick={onRetry}>{t("load.retry")}</Button>}>
      {message}
    </Notice>
  );
}
