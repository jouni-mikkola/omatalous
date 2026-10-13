/** The list of copies on Tekniset asetukset: the five newest rows, the rest behind Näytä lisää, the count in sight. */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BackupList } from "../src/components/ops/BackupList.tsx";
import type { Backup } from "../src/components/ops/types.ts";

const copies = (n: number): Backup[] =>
  Array.from({ length: n }, (_, i) => ({ name: `copy-${i}.db.gz`, size: 1000, at: `2026-10-${String(10 + i).padStart(2, "0")}T03:00:00.000Z`, kind: "daily" }));

const html = (app: Backup[], host: Backup[] = []) =>
  renderToStaticMarkup(createElement(BackupList, { app, host, disabled: false, canDownload: true, onBackup: () => {}, onDownload: () => {} }));

describe("BackupList", () => {
  it("shows the five newest of eight and says how many there are", () => {
    const out = html(copies(8));
    expect(out.match(/<tr/g)).toHaveLength(6); // head + five
    expect(out).toContain("copy-7.db.gz");
    expect(out).not.toContain("copy-2.db.gz");
    expect(out).toContain("1–5 / 8");
    expect(out).toContain("Näytä lisää");
  });
  it("counts the copies of the app and of the host together", () => {
    expect(html(copies(4), copies(3))).toContain("1–5 / 7");
  });
  it("folds nothing when there are five or fewer", () => {
    const out = html(copies(5));
    expect(out.match(/<tr/g)).toHaveLength(6);
    expect(out).not.toContain("Näytä lisää");
  });
});
