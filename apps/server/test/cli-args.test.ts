import { describe, expect, it } from "vitest";
import { option } from "../src/cli-args.ts";

describe("cli option()", () => {
  it("returns the word after the flag, and undefined when the flag is missing or last", () => {
    expect(option(["user", "create", "anna", "--name", "Anna A"], "--name")).toBe("Anna A");
    expect(option(["ops", "poll", "--helper", "3", "--done", "a,b"], "--done")).toBe("a,b");
    expect(option(["user", "create", "anna"], "--name")).toBeUndefined();
    expect(option(["user", "create", "anna", "--name"], "--name")).toBeUndefined();
  });
});
