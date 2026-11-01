/** The rules of the files, the scripts and the registries (the group is listed in the header of repo-rules.test.ts). */
import { warmParse } from "./warm.ts";
import "./parity.ts";
import "./shell-rules.ts";
import "./runners-rules.ts";
import "./modules.ts";
import "./roadmap-rules.ts";

warmParse();
