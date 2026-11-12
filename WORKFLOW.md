---
# the models are the lists in each machine's Lineclear project settings (`lineclear settings`): a model or account change
# is one setting there; a machine with no list runs pi's own default
model: lineclear/worker
reviewer_model: lineclear/reviewer
check: CHECK_SLOTS=0 CHECK_WAIT=0 bash tools/check.sh --changed origin/main lint && CORES_HELD=1 node node_modules/vitest/vitest.mjs run --project rules tools/repo-rules/repo-rules-tree.test.ts -t "repo rules. roadmap"
---
