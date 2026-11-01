/** Setup of the tests that draw tables: the lazy parts of a table (the renderer of cells made of components, the toolbar) are there before the first draw. */
import { setMarkup } from "../../apps/web/src/components/table/columns.ts";
import { loadToolbar } from "../../apps/web/src/components/table/LazyToolbar.ts";
import { markupOf } from "../../apps/web/src/components/table/markup.ts";

setMarkup(markupOf);
await loadToolbar();
