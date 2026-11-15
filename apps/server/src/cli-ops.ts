/**
 * The host helper's side of the maintenance channel, run as
 *   docker compose exec -T banking node dist/node.js ops poll --helper <ver> --done <id,id>
 *   docker compose exec -T banking node dist/node.js ops poll --dry --helper <ver>
 *   docker compose exec -T banking node dist/node.js ops report [--helper <ver>]   (JSON on stdin)
 *   docker compose exec -T banking node dist/node.js ops state [--helper <ver>]    (JSON on stdin)
 *   docker compose exec -T banking node dist/node.js ops progress [--helper <ver>] (one JSON line on stdin)
 *   docker compose exec -T banking node dist/node.js ops access --helper <ver>
 * Each prints one JSON object on stdout and exits 0 unless the database is unreachable. Secrets and
 * results go through stdin and stdout, never argv.
 *
 * `ops poll --dry` is the helper's question "do you answer me": it always prints {"request":null} and writes nothing,
 * so no request is handed out and the helper does not count as seen. A server from before the flag ignores it and
 * polls for real, so the helper asks only a server that has it.
 *
 * `ops progress` stores one step ({"id":"op_...","step":{"n":2,"m":4,"text":"..."}}) on the request that is running with that
 * id, while it runs. Anything else is refused: it prints {"ok":false,...} and exits 1, and nothing is written. A server from
 * before the command answers its usage line and exit 1 (the helper then stops asking in that request).
 *
 * `ops access` is kept for the helpers of older releases (contracts/): remote access is gone, so it always prints
 * {"want":null}, which they read as nothing to apply.
 */
import { option } from "./cli-args.ts";
import type { Services } from "./services/context.ts";
import { UserError } from "./platform/errors.ts";
import { pollOps, reportOps, stateOps } from "./services/ops.ts";
import { progressOps } from "./services/ops-progress.ts";

// the logs action sends up to 48 KiB of text, which JSON escaping can grow
const MAX_STDIN = 160 * 1024;

export async function runOpsCli(s: Services, args: string[], readStdin: () => Promise<string>): Promise<number> {
  const print = (v: unknown) => console.log(JSON.stringify(v));
  const [sub] = args;
  const helper = option(args, "--helper");
  try {
    if (sub === "poll") {
      const done = (option(args, "--done") ?? "").split(",").filter(Boolean);
      print({ request: await pollOps(s, { helper, done, dry: args.includes("--dry") }) });
      return 0;
    }
    if (sub === "access") {
      print({ want: null });
      return 0;
    }
    if (sub === "report" || sub === "state" || sub === "progress") {
      const text = await readStdin();
      if (text.length > MAX_STDIN) throw new UserError("Syöte on liian pitkä.");
      let payload: unknown;
      try {
        payload = JSON.parse(text);
      } catch {
        throw new UserError("Syöte ei ole kelvollista JSONia.");
      }
      if (sub === "progress") {
        await progressOps(s, payload);
        print({ ok: true });
        return 0;
      }
      if (sub === "report") await reportOps(s, payload, helper);
      else await stateOps(s, payload, helper);
      print({ ok: true });
      return 0;
    }
  } catch (err) {
    // bad input from the helper is reported in the JSON and does not make it retry for ever. A refused step is exit 1
    if (err instanceof UserError) {
      print({ ok: false, error: err.message });
      return sub === "progress" ? 1 : 0;
    }
    throw err;
  }
  console.error("Usage: ops poll [--dry] --helper <version> --done <ids> | ops report | ops progress | ops state | ops access --helper <version>");
  return 1;
}
