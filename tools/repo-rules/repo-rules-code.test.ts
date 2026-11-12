/** The code rules of the repo (the group is listed in the header of repo-rules.test.ts). */
import { warmParse } from "./warm.ts";
import "./code-rules.ts";
import "./boundaries.ts";
import "./size.ts";
import "./timeouts-rules.ts";
import "./figures-rules.ts";
import "./css-tokens.ts";
import "./limiters-rules.ts";
import "./sheets-rules.ts";

warmParse();
