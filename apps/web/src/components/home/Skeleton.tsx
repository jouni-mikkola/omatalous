import { t } from "../../text.ts";
/**
 * The loading frame of Yhteenveto: the answer, the month, the side column and the figures at their final size, with grey
 * bars where the text stands (the same classes as the finished blocks give them their place, home.css), so nothing moves
 * when the answer lands.
 */
export function HomeSkeleton() {
  return (
    <div className="page-grid front home-skeleton" role="status" aria-live="polite" aria-busy="true">
      <section className="home-answer" aria-hidden="true">
        <div className="home-answer-main">
          <span className="sk-bar sk-answer" />
          <span className="sk-bar sk-line" />
        </div>
        <span className="sk-bar sk-sum" />
      </section>
      <section className="card home-pace" aria-hidden="true">
        <span className="sk-bar sk-line" />
        <span className="sk-bar sk-chart" />
      </section>
      <div className="home-side" aria-hidden="true">
        <section className="card">
          <span className="sk-bar sk-line" />
          <span className="sk-bar sk-rows" />
        </section>
      </div>
      <section className="card home-direction" aria-hidden="true">
        <span className="sk-bar sk-line" />
        <span className="sk-bar sk-figures" />
      </section>
      <span className="sr-only">{t("load.loading")}</span>
    </div>
  );
}
