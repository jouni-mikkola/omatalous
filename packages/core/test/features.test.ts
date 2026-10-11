import { describe, expect, it } from "vitest";
import { FEATURES, FEATURE_IDS, isFeatureId, resolveFeatures } from "../src/index.ts";

describe("feature flags", () => {
  it("resolve to the defaults when nothing is chosen", () => {
    const state = resolveFeatures();
    expect(Object.keys(state).sort()).toEqual([...FEATURE_IDS].sort());
    for (const id of FEATURE_IDS) expect(state[id]).toBe(FEATURES[id].default);
  });

  it("the optimise module ships on as a preview", () => {
    expect(FEATURES.optimise).toEqual({ label: "Optimointi", stage: "preview", default: true });
    expect(resolveFeatures({}).optimise).toBe(true);
  });

  it("an override wins over the default in both directions", () => {
    expect(resolveFeatures({ optimise: true }).optimise).toBe(true);
    expect(resolveFeatures({ optimise: false }).optimise).toBe(false);
  });

  it("only names in FEATURES are ids, so an inherited property is not one", () => {
    expect(isFeatureId("optimise")).toBe(true);
    expect(isFeatureId("constructor")).toBe(false);
    expect(isFeatureId("__proto__")).toBe(false);
    expect(isFeatureId("nope")).toBe(false);
  });

  it("every flag has a Finnish label and a known stage", () => {
    for (const id of FEATURE_IDS) {
      expect(FEATURES[id].label.length).toBeGreaterThan(0);
      expect(["dev", "preview", "stable"]).toContain(FEATURES[id].stage);
    }
  });
});
