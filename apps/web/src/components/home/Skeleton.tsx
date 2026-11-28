import { t } from "../../text.ts";
/**
 * The loading frame of Yhteenveto: what is left to the payday and the balance chart at their final size, with grey
 * bars where the text stands (the same classes as the finished blocks give them their place, home.css), so nothing moves
 * when the answer lands.
 */
export function HomeSkeleton() {
  return (
    <div className="page-grid front home-skeleton" role="status" aria-live="polite" aria-busy="true">
      <section className="card home-now" aria-hidden="true">
        <span className="sk-bar sk-line" />
        <span className="sk-bar sk-fig" />
      </section>
      <section className="card home-days" aria-hidden="true">
        <span className="sk-bar sk-line" />
        <span className="sk-bar sk-days" />
      </section>
      <span className="sr-only">{t("load.loading")}</span>
    </div>
  );
}
