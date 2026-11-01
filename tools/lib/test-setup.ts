/** Vitest setup file, run for every test file: the hooks every file needs. They sit here and not in a kit a test imports, because with `isolate: false` a kit loads once per worker and its hooks would reach the first file only. */
import "../../packages/core/src/messages-en.ts";
import "../../packages/core/src/messages-late.ts";
import { afterAll } from "vitest";
import { removeMade } from "./tmp-kit.ts";

afterAll(removeMade);
