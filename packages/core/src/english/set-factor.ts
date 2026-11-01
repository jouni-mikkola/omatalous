/** The English table of set-factor; the Finnish one it must match is in ../messages-set-factor.ts. */
import type { FI_SET_FACTOR } from "../messages-set-factor.ts";

export const EN_SET_FACTOR: Record<keyof typeof FI_SET_FACTOR, string> = {
  "set.fac.recovery_codes": "Recovery codes",
  "set.fac.the_codes_are_shown_only": "The codes are shown only now.",
  "set.fac.copied": "Copied",
  "set.fac.copy_codes": "Copy codes",
  "set.fac.done": "Done",
  "set.fac.password": "Password",
  "set.fac.code_from_the_app_or": "Code from the app or a recovery code",
  "set.fac.cancel": "Cancel",
  "set.fac.continue": "Continue",
  "set.fac.key": "Key",
  "set.fac.key_2": "key",
  "set.fac.open_in_the_app": "Open in the app",
  "set.fac.code_from_the_app": "Code from the app",
  "set.fac.turn_on": "Turn on",
  "set.fac.in_use": "In use",
  "set.fac.not_used_yet": "not used yet",
  "set.fac.two_step_sign_in": "Two-step sign-in",
  "set.fac.make_new_recovery_codes": "Make new recovery codes",
  "set.fac.turn_off": "Turn off",
  "set.fac.not_in_use": "Not in use.",
  "set.fac.make_new_codes": "Make new codes",
  "set.fac.in_use_since": "In use since {date}",
  "set.fac.last_used": "last used {time}",
  "set.fac.codes_left": "recovery codes left: {count}",
};
