import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { IMPORT_PARSERS, parseBankCsv, parserFor } from "../src/index.ts";

const SOURCES = new URL("../src/sources/", import.meta.url);

const NORDEA = ["Kirjauspäivä;Määrä;Nimi;Otsikko", "2026/09/30;-12,50;K-Market;Korttiosto"].join("\n");

describe("import parser registry", () => {
  it("lists exactly the folders of sources/, so a new parser cannot be forgotten", () => {
    const folders = readdirSync(SOURCES, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    const imported = [...readFileSync(new URL("registry.ts", SOURCES), "utf8").matchAll(/from "\.\/([^/"]+)\/index\.ts"/g)].map((m) => m[1]!).sort();
    expect(folders.length).toBeGreaterThan(0);
    expect(imported).toEqual(folders);
    expect(IMPORT_PARSERS).toHaveLength(folders.length);
  });

  it("gives every parser its own id", () => {
    const ids = IMPORT_PARSERS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("nordea-csv");
  });
});

describe("parserFor and sniff", () => {
  const nordea = IMPORT_PARSERS.find((p) => p.id === "nordea-csv")!;

  it("recognises a header with a date and an amount column, with or without a byte order mark", () => {
    expect(nordea.sniff(NORDEA)).toBe(1);
    expect(nordea.sniff(`﻿${NORDEA}`)).toBe(1);
    expect(parserFor(NORDEA)).toBe(nordea);
  });

  it("scores a file without such a header 0 and still hands it to the first parser, whose messages explain it", () => {
    const text = "hello;world\n1;2";
    expect(nordea.sniff(text)).toBe(0);
    expect(parserFor(text)).toBe(IMPORT_PARSERS[0]);
    expect(parserFor(text).parse(text).errors[0]).toMatch(/ei tunnistettu/);
  });

  it("parses the same as parseBankCsv", () => {
    expect(nordea.parse(NORDEA)).toEqual(parseBankCsv(NORDEA));
    expect(nordea.parse(NORDEA).transactions).toHaveLength(1);
  });
});
