/** The English table of set-brt; the Finnish one it must match is in ../messages-set-brt.ts. */
import type { FI_SET_BRT } from "../messages-set-brt.ts";

export const EN_SET_BRT: Record<keyof typeof FI_SET_BRT, string> = {
  "set.brt.testing": "Testing…",
  "set.brt.test_the_return_address": "Test the return address",
  "set.brt.the_return_address_works": "The return address works.",
  "set.brt.the_test_failed": "We could not run the test. Try again.",
  "set.brt.return_address": "return address",
  "set.brt.address_missing": "The address is missing from Redirect URLs: {copy}",
};
