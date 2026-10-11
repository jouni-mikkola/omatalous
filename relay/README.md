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
