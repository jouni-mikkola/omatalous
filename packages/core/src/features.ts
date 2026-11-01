/**
 * Feature flags: a half-built module can be merged and shipped while it stays off. The server keeps the admin's
 * overrides, answers 404 for the routes of a disabled module (`gated()` in the server) and sends the resolved state in
 * `/api/meta`, from which the web app hides the nav entry. The flags of the build's own modules are declared by their
 * extension (`apps/server/src/extensions.ts`). Core has none: a module that is finished loses its flag, as Säästövinkit
 * did. The first core flag is an entry in a `FEATURES` record here, with `FeatureId` its keys.
 */

export interface FeatureDef {
  label: string;
  /** dev: unfinished. preview: usable, may change. stable: finished, the flag is only a switch. */
  stage: "dev" | "preview" | "stable";
  /** The state when the admin has not chosen. */
  default: boolean;
}

/** The ids of core's flags: none. */
export type FeatureId = never;
export type FeatureState = Readonly<Record<FeatureId, boolean>>;
/** What an admin has switched: a flag that is missing follows its default. */
export type FeatureOverrides = Readonly<Partial<Record<FeatureId, boolean>>>;
