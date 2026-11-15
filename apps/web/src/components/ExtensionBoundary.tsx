import { Component, type ReactNode } from "react";
import { markAddOnFailed } from "../extensions.ts";

/**
 * The edge of what an add-on module draws (docs/MODULES.md): a part that throws as it renders is dropped, the shell
 * says that the add-on failed, and the core page around it stays. `fallback` is what a dropped part leaves.
 */
export class ExtensionBoundary extends Component<{ children: ReactNode; fallback?: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    markAddOnFailed();
    console.error("add-on part not drawn:", error instanceof Error ? error.message : String(error));
  }

  render() {
    return this.state.failed ? (this.props.fallback ?? null) : this.props.children;
  }
}
