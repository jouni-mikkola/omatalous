import { SETTINGS_ANCHOR } from "../routes.ts";
import "../styles/questions.css";

/** Over this share of the spending unitemised, a conclusion drawn from it is only a direction. */
export const UNKNOWN_SHARE_LIMIT = 0.2;

/** The percent to print, or null while the unknown share is not over the limit. */
export function unknownPercent(share: number): number | null {
  return share > UNKNOWN_SHARE_LIMIT ? Math.round(share * 100) : null;
}

/** One line under a heading whose figures rest on spending that is mostly not itemised, with the way to Tietojen laatu. */
export function UnknownShare({ share }: { share: number }) {
  const percent = unknownPercent(share);
  if (percent === null) return null;
  return (
    <p className="question-line">
      Menoista {percent} % on vielä erittelemättä, joten luvut ovat suuntaa-antavia. <a href={`#/settings#${SETTINGS_ANCHOR.quality}`}>Tietojen laatu</a>
    </p>
  );
}
