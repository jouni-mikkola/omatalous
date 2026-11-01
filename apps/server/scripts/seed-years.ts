/**
 * Loads five years of invented history (100 000 rows or more, scripts/history-gen.ts) for the budget checks:
 * pnpm seed:years [username]. Like seed-demo it uses the first administrator without a name; it makes no user.
 */
import { join } from "node:path";
import { loadConfig } from "../src/platform/config.ts";
import { openDatabase } from "../src/db/open.ts";
import { createServices } from "../src/services/context.ts";
import { historyAccounts, loadHistory } from "./history-gen.ts";

const path = process.env.DB_PATH ?? join(process.env.DATA_DIR ?? "./data", "banking.db");
const { db } = await openDatabase(path);
const s = createServices({ db, config: loadConfig(process.env) });

const wanted = process.argv[2];
const user = wanted ? await s.users.findForLogin(wanted) : (await s.users.list()).find((u) => u.role === "admin") ?? null;
if (!user) {
  console.error(wanted ? `user ${wanted} not found` : "no administrator: make one first");
  process.exit(1);
}
const rows = await loadHistory(s.finance(user.id), s.settings, historyAccounts(s.today()));
console.log(`history for ${user.username}: ${rows} transactions → ${path}`);
db.close();
