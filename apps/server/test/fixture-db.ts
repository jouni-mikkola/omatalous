import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const FIXTURES = new URL("./fixtures/db/", import.meta.url);

/**
 * Writes a frozen release dump (`fixtures/db/<name>`) into a new database file. A dump is a few hundred statements and
 * each one is a commit of its own, so with a flush to disk per commit a load takes 300 ms and several seconds on a busy
 * machine. Nothing reads the file before it is closed, so a flush buys nothing: the load takes 5 ms.
 */
export function loadFixture(file: string, name: string): void {
  const db = new DatabaseSync(file);
  db.exec("PRAGMA synchronous = OFF");
  db.exec(readFileSync(new URL(name, FIXTURES), "utf8"));
  db.close();
}
