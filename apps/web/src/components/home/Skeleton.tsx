import { t } from "../../text.ts";
/**
 * The loading frame of Yhteenveto: the page's own blocks at their final size, with grey bars where the text stands
 * (the same classes as the finished blocks give them their height, home.css), so nothing moves when the answer lands.
 */
export function HomeSkeleton() {
  return (
    <div className="page-grid front home-skeleton" role="status" aria-live="polite" aria-busy="true">
      <section className="home-answer" aria-hidden="true">
        <span className="sk-bar sk-label" />
        <span className="sk-bar sk-head" />
        <span className="sk-bar sk-answer" />
        <span className="sk-bar sk-line" />
      </section>
      <section className="card home-pace" aria-hidden="true">
        <span className="sk-bar sk-head" />
        <span className="sk-bar sk-chart" />
      </section>
      <span className="sr-only">{t("load.loading")}</span>
    </div>
  );
}
