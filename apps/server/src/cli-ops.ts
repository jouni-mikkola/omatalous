/**
 * The host helper's side of the maintenance channel, run as
 *   docker compose exec -T banking node dist/node.js ops poll --helper <ver> --done <id,id>
 *   docker compose exec -T banking node dist/node.js ops report [--helper <ver>]   (JSON on stdin)
 *   docker compose exec -T banking node dist/node.js ops state [--helper <ver>]    (JSON on stdin)
 * Each prints one JSON object on stdout and exits 0 unless the database is unreachable. Secrets and
 * results go through stdin and stdout, never argv.
 */
import type { Services } from "./services/context.ts";
import { UserError } from "./services/errors.ts";
import { pollOps, reportOps, stateOps } from "./services/ops.ts";

function option(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

const MAX_STDIN = 64 * 1024;

export async function runOpsCli(s: Services, args: string[], readStdin: () => Promise<string>): Promise<number> {
  const print = (v: unknown) => console.log(JSON.stringify(v));
  const [sub] = args;
  const helper = option(args, "--helper");
  try {
    if (sub === "poll") {
      const done = (option(args, "--done") ?? "").split(",").filter(Boolean);
      print({ request: await pollOps(s, { helper, done }) });
      return 0;
    }
    if (sub === "report" || sub === "state") {
      const text = await readStdin();
      if (text.length > MAX_STDIN) throw new UserError("Syöte on liian pitkä.");
      let payload: unknown;
      try {
        payload = JSON.parse(text);
      } catch {
        throw new UserError("Syöte ei ole kelvollista JSONia.");
      }
      if (sub === "report") await reportOps(s, payload, helper);
      else await stateOps(s, payload, helper);
      print({ ok: true });
      return 0;
    }
  } catch (err) {
    // bad input from the helper is reported in the JSON and does not make it retry for ever
    if (err instanceof UserError) {
      print({ ok: false, error: err.message });
      return 0;
    }
    throw err;
  }
  console.error("Käyttö: ops poll --helper <versio> --done <tunnukset> | ops report | ops state");
  return 1;
}
