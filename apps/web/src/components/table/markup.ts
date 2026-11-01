import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";

export const markupOf = (node: ReactNode): string => renderToStaticMarkup(node);
