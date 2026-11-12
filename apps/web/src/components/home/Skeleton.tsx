import { t } from "../../text.ts";
/**
 * The loading frame of Nyt: the answer, the month and the categories at their final size, with grey bars where the text stands (the same
 * classes as the finished block give it its height, home.css), so nothing moves when the answer lands.
 */
export function HomeSkeleton() {
  return (
    <div className="page-grid front home-skeleton" role="status" aria-live="polite" aria-busy="true">
      <div className="nyt" aria-hidden="true">
        <section className="home-answer">
          <span className="sk-bar sk-answer" />
          <span className="sk-bar sk-line" />
          <span className="sk-bar sk-line" />
        </section>
        <section className="home-block">
          <span className="sk-bar sk-line" />
          <span className="sk-bar sk-chart" />
        </section>
        <section className="home-block">
          <span className="sk-bar sk-line" />
          <span className="sk-bar sk-rows" />
        </section>
      </div>
      <span className="sr-only">{t("load.loading")}</span>
    </div>
  );
}
