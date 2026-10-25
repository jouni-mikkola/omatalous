/**
 * "Tee myöhemmin" of the first-run wizard closes it in this browser and writes nothing, so it opens again next time.
 * The tests go through the real wiring: Wizard (hooks stubbed, tree walked) and the gate App uses.
 */
import { type ReactElement, type ReactNode, isValidElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Meta } from "../src/types.ts";

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: (init: unknown) => [typeof init === "function" ? (init as () => unknown)() : init, vi.fn()],
    useRef: (v: unknown) => ({ current: v }),
    useEffect: () => {},
  };
});
vi.mock("../src/hooks.ts", () => ({ useApi: () => ({ data: null, error: null, loading: true, reload: () => {} }) }));

const { Wizard, WizardSkip, firstRunWizard } = await import("../src/pages/Wizard.tsx");

afterEach(() => vi.unstubAllGlobals());

const meta = (setupDone: boolean) => ({ setupDone }) as Meta;

/** The element of a type anywhere in an unrendered tree. */
function find(node: ReactNode, type: unknown): ReactElement<any> | null {
  if (Array.isArray(node)) {
    for (const n of node) {
      const hit = find(n, type);
      if (hit) return hit;
    }
    return null;
  }
  if (!isValidElement(node)) return null;
  const el = node as ReactElement<any>;
  return el.type === type ? el : find(el.props.children, type);
}

describe("Wizard: Tee myöhemmin", () => {
  it("closes the wizard without any request, so the setup stays unfinished", () => {
    const fetchSpy = vi.fn(() => Promise.reject(new Error("no request expected")));
    vi.stubGlobal("fetch", fetchSpy);
    const onSkip = vi.fn();
    const onDone = vi.fn();
    const skip = find(Wizard({ meta: meta(false), onDone, onSkip }), WizardSkip);
    expect(skip).not.toBeNull();
    skip!.props.onSkip();
    expect(onSkip).toHaveBeenCalledOnce();
    expect(onDone).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("firstRunWizard (what App shows first)", () => {
  const gate = (over: Partial<Parameters<typeof firstRunWizard>[0]> = {}) => {
    const o = { role: "admin", meta: meta(false), closed: false, close: vi.fn(), reloadMeta: vi.fn(), goToSettings: vi.fn(), ...over };
    return { o, el: firstRunWizard(o) as ReactElement<any> | null };
  };

  it("shows the wizard to an admin while the setup is not done", () => {
    expect(gate().el?.type).toBe(Wizard);
  });

  it("shows nothing to a member, after the setup, or once closed in this browser", () => {
    expect(gate({ role: "member" }).el).toBeNull();
    expect(gate({ meta: meta(true) }).el).toBeNull();
    expect(gate({ closed: true }).el).toBeNull();
  });

  it("skipping only closes it: meta is not reloaded and nothing is finished", () => {
    const { o, el } = gate();
    el!.props.onSkip();
    expect(o.close).toHaveBeenCalledOnce();
    expect(o.reloadMeta).not.toHaveBeenCalled();
    expect(o.goToSettings).not.toHaveBeenCalled();
  });

  it("finishing closes it, reloads meta and opens the bank step only for 'connect'", () => {
    const a = gate();
    a.el!.props.onDone("overview");
    expect(a.o.close).toHaveBeenCalledOnce();
    expect(a.o.reloadMeta).toHaveBeenCalledOnce();
    expect(a.o.goToSettings).not.toHaveBeenCalled();
    const b = gate();
    b.el!.props.onDone("connect");
    expect(b.o.goToSettings).toHaveBeenCalledOnce();
  });
});
