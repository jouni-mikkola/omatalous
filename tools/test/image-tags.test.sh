#!/usr/bin/env bash
# Tests for what the updates do to the images of an instance, against the stub world of tools/test/ops-world.sh with a
# Docker that keeps images and their tags (the model below):
#   - two updates, then the cleaning (the Siivoa button): the oldest image has no tag any more and the cleaning frees it, and
#     only it. This holds only because fetch_release_image removes the registry tag of the image it pulled
#   - another instance on the same Docker that fetches the same version at the same moment removes that registry tag between
#     this instance's pull and its tag: the update goes through all the same
# Nothing here touches a real Docker, a real registry or GitHub. The model is this suite's own: ops-world.sh keeps one file per
# tag, so an image that lost its last tag, or a tag that went while another held the image, cannot be told in it.
#
#   tools/test/image-tags.test.sh [name-filter]
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
# shellcheck disable=SC2034 # read by ops-world.sh
SRC=${OPS_TEST_SRC:-$(cd "$HERE/../.." && pwd)}
FILTER=${1:-}
want() { [[ -z $FILTER || $1 == *$FILTER* ]]; }
# shellcheck source=ops-world.sh
. "$HERE/ops-world.sh"
unprivileged image-tags.test.sh "$@"

# The Docker of this suite, laid over the world's. An image is a file in S/dk/img (its version, commit and compose layout, as the
# labels), a tag a file in S/dk/tag that holds the id of the image it names. An image is named by a tag, by its id (id-<version>,
# what stays right whatever tags it lost), or by its digest by the registry, which it has only while it holds a tag of the
# registry's repository. A tag that moves leaves its old image without a tag; removing the last tag of an image deletes it.
# `image prune` deletes the images without a tag that no container uses. Every other command is the world's own.
# S/dk/hook holds a pattern: after the next command that matches it, the script S/dk/hook.sh runs once (S/dk/hook-keep: every
# time), which plays another instance on this Docker finishing its own fetch of the same version.
write_model() {
  mv "$S/bin/docker" "$S/bin/docker.world"
  mkdir -p "$S/dk/img" "$S/dk/tag"
  cat >"$S/bin/docker" <<'EOF'
#!/usr/bin/env bash
S=$(cd "${0%/*}/.." && pwd); D=$S/dk; REG=ghcr.io/jouni-mikkola/omatalous # not from the environment: the helper's compose check runs with none
case ${1:-}:${2:-} in pull:* | image:* | compose:up) ;; *) exec "$S/bin/docker.world" "$@" ;; esac
[[ -n ${OTHER:-} ]] || printf 'docker %s\n' "$(printf '%s ' "$@" | tr '\n' ' ' | cut -c1-420)" >>"$S/calls.log"
key() { printf '%s' "$1" | tr '/:@' '___'; }
digest_of() { printf '%s@sha256:%s' "$REG" "$(printf %s "$1" | sha256sum | cut -c1-64)"; }
tagged() { grep -lx "$1" "$D"/tag/* >/dev/null 2>&1; }                  # tagged ID: some tag names the image
registered() { grep -lx "$1" "$D/tag/$(key "$REG")"_* >/dev/null 2>&1; }  # registered ID: a tag of the registry's repository does
in_use() { [[ -e $S/container && $1 == "id-$(cat "$S/cver" 2>/dev/null)" ]]; }
resolve() { # resolve REF: the id of the image a name stands for
  local f v
  case $1 in
    id-*) [[ -f $D/img/$1 ]] && echo "$1" ;;
    "$REG"@sha256:*)
      for f in "$D"/img/*; do
        [[ -f $f ]] || continue
        v=$(cut -d'|' -f1 "$f")
        if [[ $(digest_of "$v") == "$1" ]] && registered "${f##*/}"; then echo "${f##*/}"; return 0; fi
      done
      return 1 ;;
    *) [[ -f $D/tag/$(key "$1") ]] && cat "$D/tag/$(key "$1")" ;;
  esac
}
run() {
  local id v c cp f
  case $1 in
    pull)
      [[ ! -e $S/pullfail ]] || return 1
      v=${2##*:}; [[ -f $S/registry/$v ]] || return 1
      [[ -f $D/img/id-$v ]] || cp "$S/registry/$v" "$D/img/id-$v"
      printf '%s\n' "id-$v" >"$D/tag/$(key "$2")"; echo pulled ;;
    compose)
      [[ ! -e $S/failup ]] || return 1
      id=$(resolve banking-app:latest) || return 1
      touch "$S/running" "$S/container"; echo "${id#id-}" >"$S/cver" ;;
    image)
      case $2 in
        tag)
          id=$(resolve "$3") || { echo "Error response from daemon: No such image: $3" >&2; return 1; }
          printf '%s\n' "$id" >"$D/tag/$(key "$4")" ;;
        rm)
          [[ -e $D/keep-registry-tags && $3 == "$REG":* ]] && return 0
          [[ -f $D/tag/$(key "$3") ]] || { echo "Error response from daemon: No such image: $3" >&2; return 1; }
          id=$(<"$D/tag/$(key "$3")"); rm -f "$D/tag/$(key "$3")"; echo "Untagged: $3"
          tagged "$id" || { rm -f "$D/img/$id"; echo "Deleted: $id"; } ;;
        inspect)
          id=$(resolve "${*: -1}") || { echo "Error: No such image: ${*: -1}" >&2; return 1; }
          IFS='|' read -r v c cp <"$D/img/$id"
          case $* in
            *RepoDigests*) if registered "$id"; then digest_of "$v"; fi ;;
            *talous.commit*) echo "$c" ;;
            *talous.version*) echo "$v" ;;
            *talous.compose*) echo "$cp" ;;
            *.Id*) echo "$id" ;;
          esac ;;
        prune)
          echo "Deleted Images:"
          for f in "$D"/img/*; do
            [[ -f $f ]] || continue
            tagged "${f##*/}" || in_use "${f##*/}" || { rm -f "$f"; echo "deleted: ${f##*/}"; }
          done
          echo "Total reclaimed space: 1MB" ;;
      esac ;;
  esac
  return 0
}
rc=0; run "$@" || rc=$?
if [[ -f $D/hook && $* =~ $(cat "$D/hook") ]]; then
  [[ -e $D/hook-keep ]] || rm -f "$D/hook"
  bash "$D/hook.sh" >/dev/null 2>&1 # another process: its output is not this command's
fi
exit $rc
EOF
  chmod +x "$S/bin/docker"
}
# a world whose Docker is the model: the running 0.1.0 is an image with the tag banking-app:latest
image_world() {
  new_world; write_model
  echo "0.1.0|$C1|1" >"$S/dk/img/id-0.1.0"
  echo id-0.1.0 >"$S/dk/tag/banking-app_latest"
  : >"$S/calls.log"
}
# After the next docker command that matches PATTERN, another instance on this Docker ("other-app") finishes its own fetch of
# 0.2.0: it tags the image for itself and removes the registry tag, as fetch_release_image does. Once, or every time (keep).
other_instance_finishes_after() { # other_instance_finishes_after PATTERN [keep]
  printf '%s\n' "$1" >"$S/dk/hook"
  printf 'export OTHER=1\n%q image tag %s other-app:latest\n%q image rm %s\n' "$S/bin/docker" "$REG:0.2.0" "$S/bin/docker" "$REG:0.2.0" >"$S/dk/hook.sh"
  [[ ${2:-} != keep ]] || : >"$S/dk/hook-keep"
}
# what a tag names ("-" when it names nothing), the images there are, and the tags of the registry that are left
names() { cat "$S/dk/tag/$1" 2>/dev/null || echo -; }
images() { ls "$S/dk/img" | sort | tr '\n' ' '; }
registry_tags() { local n=0 f; for f in "$S"/dk/tag/ghcr.io_*; do [[ ! -e $f ]] || n=$((n + 1)); done; echo "$n"; }
pulls() { n_calls "^docker pull $REG:0.2.0"; }
# each request has an id of its own: the helper skips one it has seen
REQ=0
request() { REQ=$((REQ + 1)); poll "$1" "$(printf 'op_%016x' "$REQ")"; tick; }
update() { request update; }

t_two_updates_then_the_cleaning() {
  image_world
  release 0.2.0; update
  check "update 1: it was done" reported ok
  check "update 1: banking-app:latest is 0.2.0, banking-app:previous is 0.1.0" test "$(names banking-app_latest)" = id-0.2.0 -a "$(names banking-app_previous)" = id-0.1.0
  check "update 1: the registry tag of the pulled image is gone" test "$(registry_tags)" = 0
  release 0.3.0; update
  check "update 2: it was done" reported ok
  check "update 2: banking-app:latest is 0.3.0, banking-app:previous is 0.2.0" test "$(names banking-app_latest)" = id-0.3.0 -a "$(names banking-app_previous)" = id-0.2.0
  check "update 2: no tag of the registry is left" test "$(registry_tags)" = 0
  check "update 2: the oldest image is still there, with no tag" test "$(images)" = "id-0.1.0 id-0.2.0 id-0.3.0 " -a -z "$(grep -lx id-0.1.0 "$S"/dk/tag/* 2>/dev/null)"
  request prune
  check "cleaning: it was done, with one plain image prune" bash -c "[[ \$(grep -c '\"status\":\"ok\"' '$S/reports/$(nreports).json') = 1 && $(n_calls '^docker image prune -f *$') = 1 ]]"
  check "cleaning: the oldest image is freed and the other two stay" test "$(images)" = "id-0.2.0 id-0.3.0 "
  check "cleaning: latest and previous still name their images, and the app runs on latest" test "$(names banking-app_latest)" = id-0.3.0 -a "$(names banking-app_previous)" = id-0.2.0 -a "$(cver)" = 0.3.0
}
# An image the updates pulled is freed in its turn, one update after it stopped being previous. The control holds the registry
# tags back (what fetch_release_image would do without its `image rm`): then the model keeps that image for good.
three_updates() { release 0.2.0; update; release 0.3.0; update; release 0.4.0; update; request prune; }
t_an_image_that_an_update_pulled_is_freed_too() {
  image_world; three_updates
  check "three updates and the cleaning: the update that was done last" test "$(names banking-app_latest)" = id-0.4.0 -a "$(names banking-app_previous)" = id-0.3.0
  check "only latest and previous are left" test "$(images)" = "id-0.3.0 id-0.4.0 "
}
t_control_registry_tags_kept() {
  image_world; : >"$S/dk/keep-registry-tags"; three_updates
  check "control: with the registry tags kept, 0.2.0 stays after the cleaning, held by its registry tag alone" test "$(images)" = "id-0.2.0 id-0.3.0 id-0.4.0 " -a "$(grep -lx id-0.2.0 "$S"/dk/tag/* | wc -l)" = 1
}
t_another_instance_finishes_between_pull_and_read() {
  image_world; release 0.2.0
  other_instance_finishes_after "^pull $REG:0.2.0"
  update
  check "the other instance took the registry tag after the pull: the update is done" reported ok
  check "the image was pulled once more, no oftener" test "$(pulls)" = 2
  check "banking-app:latest is 0.2.0 and the app runs it" test "$(names banking-app_latest)" = id-0.2.0 -a "$(cver)" = 0.2.0
  check "the other instance keeps its tag, and no tag of the registry is left" test "$(names other-app_latest)" = id-0.2.0 -a "$(registry_tags)" = 0
}
t_another_instance_finishes_between_read_and_tag() {
  image_world; release 0.2.0
  other_instance_finishes_after "talous.compose"
  update
  check "the other instance took the registry tag after the labels were read: the update is done" reported ok
  check "no second pull was needed" test "$(pulls)" = 1
  check "banking-app:latest is 0.2.0 and the app runs it" test "$(names banking-app_latest)" = id-0.2.0 -a "$(cver)" = 0.2.0
  check "the other instance keeps its tag, and no tag of the registry is left" test "$(names other-app_latest)" = id-0.2.0 -a "$(registry_tags)" = 0
}
t_the_tag_is_lost_again_after_the_second_pull() {
  # one more pull and no more: when the other instance is quicker every time, the update stops with the old version running
  image_world; release 0.2.0
  other_instance_finishes_after "^pull $REG:0.2.0" keep
  update
  check "the tag is lost after each pull: the update fails" reported failed
  check "two pulls and no third" test "$(pulls)" = 2
  check "nothing was tagged for banking-app: latest is still 0.1.0 and runs" test "$(names banking-app_latest)" = id-0.1.0 -a "$(cver)" = 0.1.0
  check "the image was not used: no tag of banking-app names it" test -z "$(grep -lx id-0.2.0 "$S"/dk/tag/banking-app_* 2>/dev/null)"
}
t_an_unsigned_image_is_never_tagged() {
  image_world; release 0.2.0; : >"$S/cosignfail"
  update
  check "the signature does not hold: the update fails" reported failed
  check "no tag of banking-app names the new image, and latest is still 0.1.0" test "$(names banking-app_latest)" = id-0.1.0 -a -z "$(grep -lx id-0.2.0 "$S"/dk/tag/banking-app_* 2>/dev/null)"
  check "one pull, and the registry tag is not removed by a run that did not use the image" test "$(pulls)" = 1 -a "$(registry_tags)" = 1
}

for t in $(declare -F | awk '{print $3}' | grep '^t_'); do
  want "$t" || continue
  echo "── ${t#t_}"
  "$t"
done
echo
echo "$PASS passed, $FAILED failed"
((FAILED == 0))
