---
check: CHECK_SLOTS=0 CHECK_WAIT=0 bash tools/check.sh --changed origin/main lint && CORES_HELD=1 node node_modules/vitest/vitest.mjs run --project rules tools/repo-rules/repo-rules-tree.test.ts -t "repo rules. roadmap"
---
