/**
 * The web half of an add-on module (docs/MODULES.md): the shared files it may import, and its loading before the first
 * render. main.tsx imports this file only when the page names a module, so a page without one never loads it.
 */
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import * as ReactDom from "react-dom";
import * as core from "@banking/core";
import { moduleApiOf } from "@banking/core";
import * as api from "./api.ts";
import * as hooks from "./hooks.ts";
import * as format from "./format.ts";
import * as routes from "./routes.ts";
import * as types from "./types.ts";
import * as css from "./css.ts";
import * as tokens from "./design/tokens.ts";
import * as Axes from "./charts/Axes.tsx";
import * as CalendarHeat from "./charts/CalendarHeat.tsx";
import * as draw from "./charts/draw.ts";
import * as Readout from "./charts/kit/Readout.tsx";
import * as marks from "./charts/kit/marks.ts";
import * as scale from "./charts/scale.ts";
import * as ErrorCard from "./components/ErrorCard.tsx";
import * as Figure from "./components/Figure.tsx";
import * as Loading from "./components/Loading.tsx";
import * as More from "./components/More.tsx";
import * as Section from "./components/Section.tsx";
import * as Why from "./components/Why.tsx";
import * as Cells from "./components/table/Cells.tsx";
import * as KeyValue from "./components/table/KeyValue.tsx";
import * as Table from "./components/table/Table.tsx";
import * as selection from "./components/table/selection.tsx";
import * as Button from "./components/ui/Button.tsx";
import * as Notice from "./components/ui/Notice.tsx";
import { markAddOnFailed, WEB_EXTENSIONS, type WebExtension } from "./extensions.ts";

/**
 * The shared files an add-on may import. Installed add-ons name these keys and exports, so none goes without a new
 * `apiVersion` (contracts/<version>/module-host.json, checked by test/module-host-contract.test.ts).
 */
export const MODULES: Readonly<Record<string, unknown>> = Object.freeze({
  react: React,
  "react/jsx-runtime": jsxRuntime,
  "react-dom": ReactDom,
  // a module's `categorize` reads a user's rule by its direction, like the app's own rows do (repo rule 51)
  "@banking/core": moduleApiOf(core),
  api,
  hooks,
  format,
  routes,
  types,
  css,
  "design/tokens": tokens,
  "charts/Axes": Axes,
  "charts/CalendarHeat": CalendarHeat,
  "charts/draw": draw,
  "charts/kit/Readout": Readout,
  "charts/kit/marks": marks,
  "charts/scale": scale,
  "components/ErrorCard": ErrorCard,
  "components/Figure": Figure,
  "components/Loading": Loading,
  "components/More": More,
  "components/Section": Section,
  "components/Why": Why,
  "components/table/Cells": Cells,
  "components/table/KeyValue": KeyValue,
  "components/table/Table": Table,
  "components/table/selection": selection,
  "components/ui/Button": Button,
  "components/ui/Notice": Notice,
});

/** What `__omatalous.apiVersion` says. Removing a key or an export of `MODULES` needs a higher number. */
export const HOST_API_VERSION = 1;

/** Only a base the server could have written: `/modules/<id>/<version>/`. */
const BASE = /^\/modules\/[a-z][a-z0-9-]{1,30}\/\d+\.\d+\.\d+\/$/;

/**
 * Imports the module's web half and its stylesheet; a failure leaves the app as it is without the module and marks the
 * load as failed, which the shell tells once. Only the page of a signed-in request names a module.
 */
export async function loadWebModule(base: string): Promise<void> {
  if (!BASE.test(base)) {
    markAddOnFailed();
    return;
  }
  const id = base.split("/")[2];
  let added = 0;
  (globalThis as { __omatalous?: unknown }).__omatalous = {
    apiVersion: HOST_API_VERSION,
    addExtension(entry: WebExtension) {
      if (added++ > 0 || entry.id !== id) throw new Error("an add-on module adds one extension, under its own id");
      WEB_EXTENSIONS.push(entry);
    },
    modules: MODULES,
  };
  try {
    const mod = (await import(/* @vite-ignore */ `${base}web.mjs`)) as { default?: (host: unknown) => void };
    if (typeof mod.default !== "function") throw new Error("web.mjs has no register function");
    mod.default((globalThis as { __omatalous?: unknown }).__omatalous);
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = `${base}web.css`;
    link.onerror = () => link.remove();
    document.head.append(link);
  } catch (err) {
    WEB_EXTENSIONS.splice(0);
    markAddOnFailed();
    console.error("add-on module not loaded:", err instanceof Error ? err.message : String(err));
  }
}
