import { t } from "../../text.ts";
/**
 * The loading frame of Nyt: the view's one block at its final size, with grey bars where the text stands (the same
 * classes as the finished block give it its height, home.css), so nothing moves when the answer lands.
 */
export function HomeSkeleton() {
  return (
    <div className="page-grid front home-skeleton" role="status" aria-live="polite" aria-busy="true">
      <section className="home-answer nyt" aria-hidden="true">
        <span className="sk-bar sk-answer" />
        <span className="sk-bar sk-line" />
        <span className="sk-bar sk-line" />
        <span className="sk-bar sk-chart" />
        <span className="sk-bar sk-line" />
      </section>
      <span className="sr-only">{t("load.loading")}</span>
    </div>
  );
}
