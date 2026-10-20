#!/usr/bin/env bash
# Tests for relay/install.sh, the script a household downloads, checks and runs. The release lookup is a stub curl, the
# repository a file:// remote made here, and docker and the clone's installer are stubs. Nothing reaches the network and
# nothing outside a temporary folder changes. The script's test hooks (OPS_TEST=1) point it at those stubs.
#
#   tools/test/bootstrap.test.sh [name-filter]
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
SRC=$(cd "$HERE/../.." && pwd)
SCRIPT=$SRC/relay/install.sh
REAL_GIT=$(command -v git)
FILTER=${1:-}
want() { [[ -z $FILTER || $1 == *$FILTER* ]]; }
PASS=0; FAILED=0
pass() { PASS=$((PASS + 1)); echo "ok   $1"; }
fail() { FAILED=$((FAILED + 1)); echo "FAIL $1"; [[ -z ${2:-} ]] || echo "       $2"; }
check() { local n=$1; shift; if "$@"; then pass "$n"; else fail "$n"; fi; }
not() { ! "$@"; }

TMPBASE=$(mktemp -d)
trap 'rm -rf "$TMPBASE"' EXIT
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.com GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.com
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null

# the stub commands: each logs its call to $CALLS; docker must never be called
write_stubs() {
  cat >"$S/curl" <<'EOF'
#!/usr/bin/env bash
echo "curl $*" >>"$CALLS"
out="" fmt=""
while (($#)); do case $1 in -o) out=$2; shift ;; -w) fmt=$2; shift ;; esac; shift; done
code=${STUB_CODE:-200}
[[ -z $out || $code == 000 ]] || cat "$STUB_BODY" >"$out"
[[ -z $fmt ]] || printf '%s' "$code"
[[ $code != 000 ]]
EOF
  printf '#!/usr/bin/env bash\necho "id $*" >>"$CALLS"\necho "${STUB_UID:-1000}"\n' >"$S/id"
  printf '#!/usr/bin/env bash\necho "docker $*" >>"$CALLS"\n' >"$S/docker"
  printf '#!/usr/bin/env bash\necho "sudo $*" >>"$CALLS"\n[[ ${1:-} != -n ]] || shift\nexec "$@"\n' >"$S/sudo"
  # apt-get "installs" git by linking the real one
  printf '#!/usr/bin/env bash\necho "apt-get $*" >>"$CALLS"\n[[ ${1:-} != install ]] || ln -sf "$REAL_GIT" "$S/git"\n' >"$S/apt-get"
  chmod +x "$S"/*
}

# the hooks of the script: a stub release address, the file:// remote, and the terminal (a file, or none)
set_env() { ENVV=(OPS_TEST=1 TALOUS_API=http://stub.invalid/latest "TALOUS_REPO=$REMOTE" "TALOUS_TTY=${1:-/nonexistent}"); }

# A world: a remote whose main has two commits (the first is release v1.2.3, annotated), stubs in S, an empty home H.
# The clone's installer is a stub that records where it ran, its arguments and the first bytes of its stdin.
new_world() {
  W=$(mktemp -d "$TMPBASE/w.XXXXXX"); S=$W/bin; H=$W/home; OUT=$W/out.txt
  CALLS=$W/calls.log; RECORD=$W/installer.log; BODY=$W/release.json; UNDER=$SCRIPT
  mkdir -p "$S" "$H" "$W/cwd" "$W/seed/scripts"; : >"$CALLS"
  write_stubs
  printf '#!/usr/bin/env bash\n{ echo "pwd=$PWD"; echo "args=$*"; echo "stdin=$(head -c 5)"; } >>"$RECORD"\n' >"$W/seed/scripts/install.sh"
  chmod +x "$W/seed/scripts/install.sh"
  git init -q -b main "$W/seed"
  git -C "$W/seed" add -A; git -C "$W/seed" commit -qm release
  git -C "$W/seed" tag -a v1.2.3 -m release
  echo later >"$W/seed/later.txt"; git -C "$W/seed" add -A; git -C "$W/seed" commit -qm later
  git init -q --bare -b main "$W/origin.git"
  REMOTE=file://$W/origin.git
  git -C "$W/seed" push -q "$REMOTE" main --tags 2>/dev/null
  C1=$(git -C "$W/seed" rev-parse 'v1.2.3^{commit}'); C2=$(git -C "$W/seed" rev-parse main)
  printf '{"url": "x", "tag_name": "v1.2.3", "name": "v1.2.3", "prerelease": false, "body": "Notes"}\n' >"$BODY"
  STUB_CODE=200; STUB_UID=1000; STDIN_TEXT=""; BASEPATH=$PATH
  set_env
}

run_script() {
  (cd "$W/cwd" && env ${ENVV[@]+"${ENVV[@]}"} HOME="$H" PATH="$S:$BASEPATH" CALLS="$CALLS" RECORD="$RECORD" STUB_BODY="$BODY" \
    STUB_CODE="$STUB_CODE" STUB_UID="$STUB_UID" REAL_GIT="$REAL_GIT" S="$S" bash "$UNDER" "$@") >"$OUT" 2>&1
}
# boot ARGS...: runs the script in the world with STDIN_TEXT (or nothing) as stdin; sets RC, the output is in $OUT
boot() {
  if [[ -n $STDIN_TEXT ]]; then printf '%s' "$STDIN_TEXT" | run_script "$@"; else run_script "$@" </dev/null; fi
  RC=$?
}
rec() { sed -n "s/^$1=//p" "$RECORD" 2>/dev/null | tail -n 1; }
calls() { grep -c "^$1" "$CALLS"; }
says() { grep -qF -- "$1" "$OUT"; }
home_empty() { [[ -z $(ls -A "$H") ]]; }
installer_ran() { [[ -s $RECORD ]]; }
# the run stopped with an error, and said this
failed_with() { [[ $RC -ne 0 ]] && says "$1"; }
succeeded_with() { [[ $RC -eq 0 ]] && says "$1"; }
# stopped before it asked GitHub for anything, and made nothing
stopped_early() { [[ $RC -ne 0 && $(calls curl) = 0 ]] && home_empty && ! installer_ran; }

t_bootstrap_checks_out_tag_on_main() {
  new_world; boot
  local d=$H/omatalous
  check "the script succeeds" test "$RC" = 0
  check "the clone is at the release commit" test "$(git -C "$d" rev-parse HEAD 2>/dev/null)" = "$C1"
  check "it is on main, which follows an origin/main that stays at the newest commit" test "$(git -C "$d" symbolic-ref --short HEAD 2>/dev/null)" = main -a "$(git -C "$d" rev-parse 'main@{upstream}' 2>/dev/null)" = "$C2"
  check "the working tree is clean" test -z "$(git -C "$d" status --porcelain 2>&1)"
  check "the release tag is in the clone" git -C "$d" cat-file -e refs/tags/v1.2.3
  check "the installer of the clone ran in the clone with --install-docker" test "$(rec pwd)" = "$d" -a "$(rec args)" = "--install-docker"
  check "GitHub was asked once, at the address of the hook" test "$(calls curl)" = 1 -a "$(grep -c 'stub.invalid/latest' "$CALLS")" = 1
  check "docker was not touched" test "$(calls docker)" = 0
  check "no scratch folder is left next to the clone" test "$(ls -A "$H")" = omatalous
}

t_bootstrap_refuses_root() {
  new_world; STUB_UID=0; boot
  check "as root the script stops and says to use the normal user" failed_with "not as root"
  check "it did not ask GitHub, clone or run the installer, and made nothing" stopped_early
}

t_bootstrap_tag_not_on_main() {
  new_world
  # release v2.0.0 sits on a side branch that main does not contain
  git -C "$W/seed" checkout -q -b side "$C1"
  echo side >"$W/seed/side.txt"; git -C "$W/seed" add -A; git -C "$W/seed" commit -qm side; git -C "$W/seed" tag v2.0.0
  git -C "$W/seed" push -q "$REMOTE" side v2.0.0 2>/dev/null
  printf '{"tag_name": "v2.0.0", "prerelease": false}\n' >"$BODY"
  boot
  check "the script stops and says the release is not on main" failed_with "not on the main branch"
  check "no clone and no scratch folder are left" home_empty
  check "the installer did not run" not installer_ran
}

t_bootstrap_passes_options() {
  new_world; boot --yes --port 8085 --access lan
  check "the remaining options follow --install-docker, in order" test "$(rec args)" = "--install-docker --yes --port 8085 --access lan"
  new_world; boot --dir "$W/custom" --port 8090
  check "--dir puts the clone there and is not passed on" test "$(rec pwd)" = "$W/custom" -a "$(rec args)" = "--install-docker --port 8090" -a "$(git -C "$W/custom" rev-parse HEAD)" = "$C1"
  check "the home stays empty" home_empty
  new_world; boot --dir rel/dir
  check "a relative --dir is taken from the current folder" test "$(rec pwd)" = "$W/cwd/rel/dir"
  new_world; boot --dir
  check "--dir without a value stops before anything is asked or made" failed_with "--dir needs a value"
  check "and nothing was made" stopped_early
  new_world; boot --help
  check "--help prints the usage and does nothing" succeeded_with "Usage: bash omatalous-install.sh"
}

t_bootstrap_terminal_input() {
  # the installer reads the terminal when the script itself came in on stdin (curl ... | bash)
  new_world; printf 'typed' >"$W/tty"; set_env "$W/tty"; STDIN_TEXT=piped; boot
  check "stdin is a pipe and a terminal is there: the installer reads the terminal" test "$(rec stdin)" = typed
  new_world; STDIN_TEXT=piped; boot
  check "no terminal: the installer keeps stdin as it was" test "$RC" = 0 -a "$(rec stdin)" = piped
}

t_bootstrap_new_instance() {
  new_world; boot --new-instance second --port 8090
  check "the second copy is cloned to ~/second at the release" test "$(git -C "$H/second" rev-parse HEAD 2>/dev/null)" = "$C1" -a ! -e "$H/omatalous"
  check "the installer runs there with --name and the other options" test "$(rec pwd)" = "$H/second" -a "$(rec args)" = "--install-docker --port 8090 --name second"
  new_world; boot --new-instance 'Bad Name'
  check "a name with capitals or spaces is refused" failed_with "lowercase letters"
  new_world; boot --new-instance ../escape
  check "a name that is a path is refused" failed_with "lowercase letters"
  check "nothing was made" stopped_early
  new_world; boot --new-instance
  check "--new-instance without a name stops" failed_with "--new-instance needs a value"
}

# the run: block of the step "Check the install script" in pages.yml
pages_step() {
  awk '/- name: Check the install script/ { f = 1; next } f && /^ +run: \|/ { r = 1; next } r && /^          / { sub(/^          /, ""); print; next } r { exit }' \
    "$SRC/.github/workflows/pages.yml"
}

t_bootstrap_hash_file() {
  local h f d step rc zero owner
  h=$(cut -d' ' -f1 "$SRC/relay/install.sh.sha256"); zero=$(printf '%064d' 0)
  # the Pages address is the repository owner's: the name is read from the address the script clones, so there is one
  owner=$(grep -o '^  REPO_URL=https://github.com/[A-Za-z0-9-]*/' "$SCRIPT" | cut -d/ -f4)
  check "the script names the owner of the repository it clones" test -n "$owner"
  check "install.sh.sha256 is one line in sha256sum's format" grep -Eq '^[0-9a-f]{64}  install\.sh$' "$SRC/relay/install.sh.sha256"
  check "it is the hash of relay/install.sh" bash -c "cd '$SRC/relay' && sha256sum -c --status install.sh.sha256"
  for f in README.md docs/INSTALL.md; do
    check "$f has the command that downloads, checks that hash and runs the script" grep -Fq "echo \"$h  omatalous-install.sh\" | sha256sum -c && bash omatalous-install.sh" "$SRC/$f"
    check "$f downloads it from the Pages address of that owner into omatalous-install.sh" grep -Fq "curl -fsSLo omatalous-install.sh https://${owner,,}.github.io/omatalous/install.sh && echo " "$SRC/$f"
  done
  # the check step of pages.yml, run on copies: the files as they are pass, any one of the three changed fails
  d=$(mktemp -d "$TMPBASE/w.XXXXXX"); step=$d.step.sh
  pages_step >"$step"
  check "pages.yml has a step that checks the install script" test -s "$step"
  copies() { rm -rf "$d"; mkdir -p "$d/relay" "$d/docs"; cp "$SRC/relay/install.sh" "$SRC/relay/install.sh.sha256" "$d/relay/"; cp "$SRC/README.md" "$d/"; cp "$SRC/docs/INSTALL.md" "$d/docs/"; }
  try() { (cd "$d" && bash -e "$step") >"$d.out" 2>&1; }
  refused() { [[ $rc -ne 0 ]] && grep -q -- "$1" "$d.out"; }
  copies; try; rc=$?
  check "the step passes when the three agree" test "$rc" = 0
  copies; echo '# changed' >>"$d/relay/install.sh"; try; rc=$?
  check "it refuses a script that differs from install.sh.sha256" refused 'install.sh.sha256'
  copies; echo "$zero  install.sh" >"$d/relay/install.sh.sha256"; try; rc=$?
  check "it refuses a hash file that differs from the script" refused 'install.sh.sha256'
  copies; sed -i "s/$h/$zero/" "$d/README.md"; try; rc=$?
  check "it refuses a README.md with another hash" refused 'README.md'
  copies; sed -i "s/$h/$zero/" "$d/docs/INSTALL.md"; try; rc=$?
  check "it refuses a docs/INSTALL.md with another hash" refused 'docs/INSTALL.md'
}

t_bootstrap_existing_clone() {
  new_world; git clone -q "$REMOTE" "$H/omatalous" 2>/dev/null; boot --port 9000
  check "a clone of the same repository: its own installer runs" test "$RC" = 0 -a "$(rec pwd)" = "$H/omatalous" -a "$(rec args)" = "--install-docker --port 9000"
  check "the clone is not moved, and GitHub is not asked" test "$(git -C "$H/omatalous" rev-parse HEAD)" = "$C2" -a "$(calls curl)" = 0
  git -C "$H/omatalous" remote set-url origin "$REMOTE/"; rm -f "$RECORD"; boot
  check "the same address with a trailing slash is the same repository" installer_ran
  git -C "$H/omatalous" remote set-url origin "${REMOTE%.git}"; rm -f "$RECORD"; boot
  check "and without .git" installer_ran
  new_world; git clone -q "$REMOTE" "$H/omatalous" 2>/dev/null; git -C "$H/omatalous" remote set-url origin file:///elsewhere.git; boot
  check "a clone of another repository stops the script" failed_with "is not a clone of Omatalous"
  check "and its installer did not run" not installer_ran
  new_world; mkdir "$H/omatalous"; echo mine >"$H/omatalous/notes.txt"; boot
  check "a folder with other things in it stops the script" failed_with "is not a clone of Omatalous"
  check "and is left alone" test "$(cat "$H/omatalous/notes.txt")" = mine -a "$(calls curl)" = 0
  new_world; echo mine >"$H/omatalous"; boot
  check "a file in the way stops it as well, and stays" failed_with "is not a clone of Omatalous"
  check "the file is untouched" test "$(cat "$H/omatalous")" = mine
  new_world; git init -q "$H"; mkdir "$H/omatalous"; echo mine >"$H/omatalous/notes.txt"; boot
  check "a folder inside some other repository is not taken for a clone" failed_with "is not a clone of Omatalous"
  new_world; mkdir "$H/omatalous"; boot
  check "an empty folder is used for the clone" test "$RC" = 0 -a "$(git -C "$H/omatalous" rev-parse HEAD 2>/dev/null)" = "$C1" -a "$(ls -A "$H")" = omatalous
}

t_bootstrap_dir_is_a_link() {
  # a link in the way is not followed to make a clone there: the script stops, and the link and its target stay
  new_world; mkdir "$W/real"; ln -s "$W/real" "$H/omatalous"; boot
  check "a link to an empty folder stops the script" failed_with "is not a clone of Omatalous"
  check "it did not ask GitHub or run the installer" test "$(calls curl)" = 0 -a ! -s "$RECORD"
  check "the link and the folder it points to are as they were" test "$(readlink "$H/omatalous")" = "$W/real" -a -z "$(ls -A "$W/real")"
  new_world; ln -s "$W/missing" "$H/omatalous"; boot
  check "a link that points nowhere stops it as well" failed_with "is not a clone of Omatalous"
  check "and stays, with nothing made behind it" test -L "$H/omatalous" -a ! -e "$W/missing" -a "$(calls curl)" = 0
  new_world; git clone -q "$REMOTE" "$W/real" 2>/dev/null; ln -s "$W/real" "$H/omatalous"; boot
  check "a link to a clone of Omatalous is that clone: its installer runs, GitHub is not asked" test "$RC" = 0 -a -s "$RECORD" -a "$(calls curl)" = 0
}

t_bootstrap_clone_env_untouched() {
  # the .env of an existing clone holds the household's settings: the script runs the installer and leaves the file as it was
  new_world; git clone -q "$REMOTE" "$H/omatalous" 2>/dev/null
  printf 'PORT=8085\nSECRET=made-up\n' >"$H/omatalous/.env"; chmod 600 "$H/omatalous/.env"
  boot --yes
  check "the installer of the existing clone ran" test "$RC" = 0 -a "$(rec pwd)" = "$H/omatalous"
  check ".env has the same text and mode" test "$(cat "$H/omatalous/.env")" = "$(printf 'PORT=8085\nSECRET=made-up')" -a "$(stat -c %a "$H/omatalous/.env")" = 600
  check "the clone was not moved, and no other file was made" test "$(git -C "$H/omatalous" rev-parse HEAD)" = "$C2" -a "$(git -C "$H/omatalous" status --porcelain)" = "?? .env" -a "$(ls -A "$H")" = omatalous
}

t_bootstrap_scratch_from_environment() {
  # SCRATCH in the caller's environment is nobody's scratch folder of this script: it is never removed
  local why
  for why in 404 clone; do
    new_world; mkdir "$W/precious"; echo mine >"$W/precious/keep.txt"
    ENVV+=("SCRATCH=$W/precious")
    case $why in
      404) STUB_CODE=404 ;;
      clone) printf '{"tag_name": "v9.9.9", "prerelease": false}\n' >"$BODY" ;; # stops after the scratch folder was made
    esac
    boot
    check "a run that stops ($why) ends with its exit trap" test "$RC" -ne 0
    check "the folder SCRATCH names is untouched ($why)" test "$(cat "$W/precious/keep.txt")" = mine
    check "and no scratch folder of the script is left ($why)" home_empty
  done
  new_world; mkdir "$W/precious"; echo mine >"$W/precious/keep.txt"; ENVV+=("SCRATCH=$W/precious"); boot
  check "a run that goes through installs, and the folder is untouched" test "$RC" = 0 -a "$(cat "$W/precious/keep.txt")" = mine -a "$(ls -A "$H")" = omatalous
}

t_bootstrap_ctrl_c_in_clone() {
  # Ctrl-C reaches the whole foreground group while git clones: the script ends and the scratch folder goes with it
  new_world
  # a git whose clone waits, as a slow network would; every other call is the real git
  cat >"$S/git" <<'EOF'
#!/usr/bin/env bash
if [[ ${1:-} == clone ]]; then : >"$(dirname "$CALLS")/cloning"; sleep 30; fi
exec "$REAL_GIT" "$@"
EOF
  chmod +x "$S/git"
  local pid i
  set -m; run_script </dev/null & pid=$!; set +m
  for ((i = 0; i < 200; i++)); do [[ -e $W/cloning ]] && break; sleep 0.1; done
  check "the clone began, in a scratch folder next to the target" test -e "$W/cloning" -a -d "$H" -a -n "$(ls -A "$H")"
  kill -INT -- "-$pid" 2>/dev/null
  wait "$pid" 2>/dev/null; RC=$?
  check "the script ended with an error" test "$RC" -ne 0
  check "nothing is left in the home folder" home_empty
  check "the installer did not run" not installer_ran
}

t_bootstrap_name_in_existing_dir() {
  # --new-instance with --dir on a folder that is already a clone: that clone's installer runs for the name
  new_world; git clone -q "$REMOTE" "$W/inst" 2>/dev/null; boot --new-instance second --dir "$W/inst"
  check "its installer runs there with the name" test "$RC" = 0 -a "$(rec pwd)" = "$W/inst" -a "$(rec args)" = "--install-docker --name second"
  check "no second clone is made for the name, and GitHub is not asked" test ! -e "$H/second" -a "$(calls curl)" = 0
  check "and the clone stays at its commit" test "$(git -C "$W/inst" rev-parse HEAD)" = "$C2"
}

t_bootstrap_no_release() {
  local body
  new_world; STUB_CODE=404; boot
  check "no release: the script stops and says so" failed_with "no release yet"
  check "it prints the commands to run by hand" says "git clone $REMOTE $H/omatalous"
  check "with the installer line" says "./scripts/install.sh --install-docker"
  check "and leaves nothing behind" home_empty
  check "the installer did not run" not installer_ran
  new_world; STUB_CODE=404; boot --new-instance second
  check "the commands for a second copy name the instance" says "--install-docker --name second"
  new_world; STUB_CODE=000; boot
  check "no answer from GitHub: it stops with the same commands" failed_with "did not answer"
  check "the commands are there" says "git clone $REMOTE"
  new_world; STUB_CODE=403; boot
  check "an error answer is named" failed_with "HTTP 403"
  for body in '{"name": "no tag"}' '{"tag_name": "v1.2.3-rc1"}' '{"tag_name": "../../etc"}' '{"tag_name": "v1.2"}' '{"tag_name": "main"}'; do
    new_world; printf '%s\n' "$body" >"$BODY"; boot
    check "an answer with $body is not a release" failed_with "no release of the form vX.Y.Z"
  check "nothing was made" home_empty
  done
  new_world; printf '{"tag_name": "v1.2.3", "prerelease": true}\n' >"$BODY"; boot
  check "a release marked as a pre-release is not installed" failed_with "pre-release"
  check "nothing was made" home_empty
  new_world; printf '{"tag_name": "v1.2.3", "prerelease": false, "body": "the notes say \\"prerelease\\": true"}\n' >"$BODY"; boot
  check "the words in release notes do not count as the flag" test "$RC" = 0
  new_world; printf '{"tag_name": "v9.9.9", "prerelease": false}\n' >"$BODY"; boot
  check "a release whose tag is not in the repository stops" failed_with "is not in the repository"
  check "with nothing left" home_empty
}

t_bootstrap_hooks_need_ops_test() {
  # without OPS_TEST=1 the hooks do nothing: the real address is asked, over https only
  new_world; STUB_CODE=404; ENVV=(TALOUS_API=http://stub.invalid/latest "TALOUS_REPO=$REMOTE" TALOUS_TTY=/nonexistent); boot
  check "TALOUS_API is ignored" grep -Eq 'https://api\.github\.com/repos/[^ /]+/omatalous/releases/latest' "$CALLS"
  check "the stub address was never used" not grep -q 'stub.invalid' "$CALLS"
  check "curl is held to https" grep -q -- '--proto =https --proto-redir =https ' "$CALLS"
  check "TALOUS_REPO is ignored: the commands by hand name GitHub" says "git clone https://github.com/"
  check "not the remote of the hook" not says "file://"
}

t_bootstrap_needs_git() {
  new_world
  # a PATH with every system tool but git
  mkdir "$W/sys"; ln -s /usr/bin/* "$W/sys/" 2>/dev/null; rm -f "$W/sys/git"
  BASEPATH=$W/sys
  boot
  check "git missing and no terminal to ask: it stops and names the apt command" failed_with "sudo apt-get update && sudo apt-get install -y git"
  check "it ran no sudo and asked GitHub nothing" test "$(calls sudo)" = 0 -a "$(calls curl)" = 0
  printf 'n\n' >"$W/tty"; set_env "$W/tty"; boot
  check "the answer n installs nothing" test "$RC" -ne 0 -a "$(calls sudo)" = 0
  printf '\n' >"$W/tty"; boot
  check "Enter runs apt-get update and apt-get install -y git through sudo" grep -qx 'sudo apt-get update' "$CALLS"
  check "install line" grep -qx 'sudo apt-get install -y git' "$CALLS"
  check "and the install goes on with the git it got" test "$RC" = 0 -a "$(git -C "$H/omatalous" rev-parse HEAD 2>/dev/null)" = "$C1"
  rm -f "$S/git"; rm -rf "$H/omatalous"; : >"$CALLS"; boot --yes
  check "--yes asks nothing and keeps sudo from asking for a password" grep -qx 'sudo -n apt-get install -y git' "$CALLS"
}

t_bootstrap_cut_runs_nothing() {
  # A download cut at any point runs nothing: every line start, the middle of every line, and each of the last bytes
  new_world
  local size n bad=0 offsets
  size=$(wc -c <"$SCRIPT")
  offsets=$({ awk 'BEGIN { off = 0 } { print off; print off + int(length($0) / 2); off += length($0) + 1 }' "$SCRIPT"; seq $((size - 150)) $((size - 2)); } | sort -nu)
  UNDER=$W/cut.sh
  for n in $offsets; do
    head -c "$n" "$SCRIPT" >"$UNDER"
    : >"$CALLS"; run_script </dev/null
    if [[ -s $CALLS ]] || ! home_empty; then bad=$((bad + 1)); echo "       cut at byte $n ran something"; fi
  done
  check "a cut at any line start, in the middle of any line or in any of the last 150 bytes calls no command and makes no file" test "$bad" = 0
  UNDER=$SCRIPT; : >"$CALLS"; run_script </dev/null
  check "the whole file does run" test -s "$CALLS"
}

# the script without its comment lines
code_lines() { grep -v '^[[:space:]]*#' "$SCRIPT"; }
no_shell_pipe() { ! code_lines | grep -E '\|[[:space:]]*(ba|da)?sh([[:space:]]|$)' >/dev/null; }
no_eval() { ! code_lines | grep -E '(^|[^a-z_])eval[[:space:]]' >/dev/null; }
# The calls of curl in the script $1: curl as a command word, so not in a comment, in a message ("... (curl -I url)") or
# in a list of names ("for cmd in curl git"). Double-quoted text is cut out first.
curl_calls() { grep -v '^[[:space:]]*#' "$1" | sed 's/"[^"]*"//g' | grep -Eo '(^|[;&|(]|[[:space:]]then|[[:space:]]do)[[:space:]]*(command[[:space:]]+)?curl[[:space:]]' | wc -l; }

t_bootstrap_lint() {
  local top
  check "bash -n is clean" bash -n "$SCRIPT"
  if command -v shellcheck >/dev/null; then check "shellcheck is clean" shellcheck -S warning "$SCRIPT"; else pass "shellcheck is not installed, bash -n only"; fi
  top=$(awk '/^$/ || /^[[:space:]]/ || /^#/ || /^\}$/ || /^set -euo pipefail$/ || /^[a-z_]+\(\) \{/ || /^main "\$@" --end-of-script$/ { next } { print NR ": " $0 }' "$SCRIPT")
  check "at the top level only comments, set -euo pipefail, functions and the last-line call" test -z "$top"
  check "the last line calls main with the end marker" test "$(tail -n 1 "$SCRIPT")" = 'main "$@" --end-of-script'
  check "no eval" no_eval
  check "nothing is piped into a shell" no_shell_pipe
  check "curl is called once, for the release" test "$(curl_calls "$SCRIPT")" = 1
  cat >"$TMPBASE/calls.sh" <<'EOF'
# curl -s a
echo "try (curl -I b)"
for c in curl git; do :; done
x=$(curl -s c)
curl -s d | cat
EOF
  check "the count sees a call of curl anywhere and not a comment, a message or a list of names" test "$(curl_calls "$TMPBASE/calls.sh")" = 2
}

for t in $(declare -F | awk '{print $3}' | grep '^t_'); do
  want "$t" || continue
  echo "── ${t#t_}"
  "$t"
done
echo
echo "$PASS passed, $FAILED failed"
((FAILED == 0))
