/**
 * Feature flags: a half-built module can be merged and shipped while it stays off. The server keeps the admin's
 * overrides, answers 404 for the routes of a disabled module (`gated()` in the server) and sends the resolved state in
 * `/api/meta`, from which the web app hides the nav entry. A flag is added here, nowhere else.
 */

export interface FeatureDef {
  /** Shown to the admin in Asetukset > Palvelin. */
  label: string;
  /** dev: unfinished. preview: usable, may change. stable: finished, the flag is only a switch. */
  stage: "dev" | "preview" | "stable";
  /** The state when the admin has not chosen. */
  default: boolean;
}

export const FEATURES = {
  optimise: { label: "Optimointi", stage: "dev", default: false },
} as const satisfies Record<string, FeatureDef>;

export type FeatureId = keyof typeof FEATURES;
export type FeatureState = Readonly<Record<FeatureId, boolean>>;
/** What an admin has switched: a flag that is missing follows its default. */
export type FeatureOverrides = Readonly<Partial<Record<FeatureId, boolean>>>;

export const FEATURE_IDS = Object.keys(FEATURES) as readonly FeatureId[];

export function isFeatureId(id: string): id is FeatureId {
  return Object.hasOwn(FEATURES, id);
}

/** Every flag with the admin's choice where there is one, else its default. */
export function resolveFeatures(overrides: FeatureOverrides = {}): FeatureState {
  return Object.fromEntries(FEATURE_IDS.map((id) => [id, overrides[id] ?? FEATURES[id].default])) as FeatureState;
}
