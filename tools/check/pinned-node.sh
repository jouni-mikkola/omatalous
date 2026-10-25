# shellcheck shell=bash
# Sourced by tools/check.sh (SELF, ROOT and ORIG set) before the steps that run node.
# The node is the one of .npmrc (use-node-version), a build with TypeScript support. Through `pnpm check` it is already
# first on PATH; a run started by hand goes through `pnpm exec` once. pnpm does not switch when the system node has that
# very version, so the check also refuses a node that cannot read TypeScript.
PINNED=$(sed -n 's/^use-node-version=//p' "$ROOT/.npmrc" 2>/dev/null)
if [[ -n $PINNED && "$(node -v 2>/dev/null)" != "v$PINNED" && -z ${CHECK_PINNED_NODE:-} ]] && command -v pnpm >/dev/null 2>&1; then
  CHECK_PINNED_NODE=1 exec pnpm exec bash "$SELF" "${ORIG[@]}"
fi
if [[ "$(node -p 'process.features.typescript' 2>/dev/null)" != strip && "$(node -p 'process.features.typescript' 2>/dev/null)" != transform ]] || [[ -n $PINNED && "$(node -v)" != "v$PINNED" ]]; then
  echo "check: node ${PINNED:+v$PINNED }with TypeScript support is needed (found $(command -v node || echo none) $(node -v 2>/dev/null)); run it as pnpm check, so pnpm fetches the node of .npmrc" >&2
  exit 1
fi
