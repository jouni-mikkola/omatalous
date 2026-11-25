import { Link } from "@tanstack/react-router";
import { Empty } from "./components/ui/Empty.tsx";
import { t } from "./text.ts";

/** An address that names no page: it says so and leads to Yhteenveto, so a mistyped link does not pass for a working one. */
export function NotFound() {
  return (
    <Empty title={t("notfound.title")} action={<Link to="/overview" className="btn">{t("notfound.back")}</Link>}>
      <p>{t("notfound.body")}</p>
    </Empty>
  );
}
