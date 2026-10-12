# Return page

`callback/index.html` is the page Enable Banking sends the browser to after a bank login when Omatalous runs on plain
http at home. It reads `state`, checks that it names a private, loopback or `.local` address, and forwards the
browser to `<that address>/api/connections/callback` with only `code` (or `error`) and `state`. It stores and loads
nothing. The workflow `.github/workflows/pages.yml` publishes it from the public repository, on release tags and on pushes to main that change relay/

`privacy/index.html` and `terms/index.html` are the privacy and terms pages that Enable Banking's registration form asks
for. They are plain text, Finnish first and English below, with no script, no cookies and nothing loaded from elsewhere.
Omatalous shows their addresses in the setup steps, built from the return page's address (`EB_RELAY_URL`), so a copy of
`relay/` on another host serves them as well.

Each page is a single file with a Content-Security-Policy meta tag that names the SHA-256 of its style, and of its script
on the return page. After editing either, run `node tools/relay-hash.mjs`; a test fails when the hashes are stale. The
address rule is a copy of `packages/core/src/local-origin.ts`, and both run the same test table.

`install.sh` is the script of the install command in `README.md` and `docs/INSTALL.md`: a household downloads it from the
published site, checks its sha256 against the one in the command and runs it. It asks GitHub for the latest release,
clones the repository into `~/omatalous` at that tag when the tag is on `main`, and starts `scripts/install.sh`. Its
whole body is the function `main`, called on the last line with an end marker, so a cut download runs nothing.
`install.sh.sha256` holds its hash. The hash in the command, the hash file and the script must agree: the workflow
refuses to publish otherwise, and `tools/test/bootstrap.test.sh` fails first. After editing the script, from the
repository root:

```bash
old=$(cut -d' ' -f1 relay/install.sh.sha256)
(cd relay && sha256sum install.sh >install.sh.sha256)
sed -i "s/$old/$(cut -d' ' -f1 relay/install.sh.sha256)/" README.md docs/INSTALL.md
```

Release lookup and clone address can be replaced (`TALOUS_API`, `TALOUS_REPO`, `TALOUS_TTY`) only with `OPS_TEST=1`.
