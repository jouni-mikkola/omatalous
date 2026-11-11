import { afterEach, beforeEach, vi } from "vitest";

// A date leaves out the running year, so what a test reads must not follow the real clock. A test file that imports
// this runs every test on 11.11.2026: a day of 2026 reads "9.10." and a day of another year keeps its year.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-11T10:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});
