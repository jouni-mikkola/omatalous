import { describe, expect, it } from "vitest";
import { option, readWords } from "../src/cli-args.ts";

describe("cli option()", () => {
  it("returns the word after the flag, and undefined when the flag is missing or last", () => {
    expect(option(["user", "create", "anna", "--name", "Anna A"], "--name")).toBe("Anna A");
    expect(option(["ops", "poll", "--helper", "3", "--done", "a,b"], "--done")).toBe("a,b");
    expect(option(["user", "create", "anna"], "--name")).toBeUndefined();
    expect(option(["user", "create", "anna", "--name"], "--name")).toBeUndefined();
  });
});

describe("cli readWords()", () => {
  const create = { plain: 1, flags: ["--admin"], values: ["--name", "--days"], mayEnd: ["--name"] };

  it("gives the plain words wherever the flags stand", () => {
    expect(readWords([], {})).toEqual({ plain: [] });
    expect(readWords(["anna"], { plain: 1 })).toEqual({ plain: ["anna"] });
    expect(readWords(["anna", "--admin", "--name", "Anna A"], create)).toEqual({ plain: ["anna"] });
    expect(readWords(["--name", "Anna A", "--admin", "anna"], create)).toEqual({ plain: ["anna"] });
    expect(readWords(["--days", "5", "anna", "--name", "x"], create)).toEqual({ plain: ["anna"] });
    expect(readWords(["a", "b"], { plain: 2 })).toEqual({ plain: ["a", "b"] });
    // a value is not counted as a plain word, nor read as a flag when it is spelled like a plain one
    expect(readWords(["--name", "anna"], create)).toEqual({ plain: [] });
  });

  it("names a flag the command does not have", () => {
    expect(readWords(["anna", "--admn"], create).stray).toBe("Unknown option: --admn");
    expect(readWords(["anna", "--help"], { plain: 1 }).stray).toBe("Unknown option: --help");
    expect(readWords(["--help"], {}).stray).toBe("Unknown option: --help");
    // a flag of another command is as unknown as a misspelled one
    expect(readWords(["anna", "--admin"], { plain: 1 }).stray).toBe("Unknown option: --admin");
  });

  it("names a plain word past those the command takes", () => {
    expect(readWords(["bob", "carl"], { plain: 1 }).stray).toBe("Unexpected word: carl");
    expect(readWords(["extra"], {}).stray).toBe("Unexpected word: extra");
    expect(readWords(["aino", "--name", "x", "bob"], create).stray).toBe("Unexpected word: bob");
    expect(readWords(["bob", "carl"], { plain: 1 }).plain).toEqual(["bob"]);
  });

  it("names a flag whose value is missing or is another flag", () => {
    expect(readWords(["aino", "--name", "x", "--days"], create).stray).toBe("--days needs a value after it.");
    expect(readWords(["bob", "--name", "--admin"], create).stray).toBe("--name needs a value after it, not --admin.");
    expect(readWords(["bob", "--days", "--name", "x"], create).stray).toBe("--days needs a value after it, not --name.");
  });

  it("lets a flag be the last word only where the command says so", () => {
    expect(readWords(["anna", "--name"], create)).toEqual({ plain: ["anna"] });
    expect(readWords(["anna", "--name"], { plain: 1, values: ["--name"] }).stray).toBe("--name needs a value after it.");
  });

  it("names a flag given twice", () => {
    expect(readWords(["anna", "--days", "5", "--days", "9"], create).stray).toBe("--days is given twice.");
    expect(readWords(["anna", "--admin", "--admin"], create).stray).toBe("--admin is given twice.");
  });
});
