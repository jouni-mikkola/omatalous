# Add-on modules

An install can run one add-on module (lisäosa) that is built and released outside this repository. The public app
knows nothing of what a module does. It holds the generic hooks a module plugs into, a loader that fetches a signed
bundle when the owner has entered a code, and the trust root that decides which bundles may run.

Without a code the app has no module, loads nothing, makes no request for one and shows only the empty field in
Asetukset > Palvelin ja ylläpito > Lisäosa. Once a module is loaded, Asetukset has a tab of its own, Lisäosa, after the
six: the module's own card first, then the card of the code, its version and its state (admin only), which leaves
Palvelin ja ylläpito. A member sees the tab only when the module has a card.

## The code

The owner pastes one line into "Syötä lisäosan koodi":

```
omt1.<base64url of {"repo":"<owner>/<name>","token":"<read-only token>"}>
```

- `repo`: a GitHub repository, `^[A-Za-z0-9][A-Za-z0-9-]{0,38}/[A-Za-z0-9._-]{1,100}$`.
- `token`: a token that can read that repository's releases, `^[A-Za-z0-9_]{20,255}$`.
- No other key. The whole code is at most 1024 characters. Anything else is refused with one sentence and nothing is
  stored.

The public tree names no module repository: the code carries it. The server keeps the code sealed with the app secret
(settings key `instance_module`, AAD `instance:module`, re-sealed by the secret rotation like the other instance keys).
It is never returned by any route, written to a log, a security event, an error or the household's export. Only the
admin can set or remove it.

## The bundle

A release of the module repository carries two assets:

- `module-<version>.tar.gz`
- `module-<version>.tar.gz.sig`

`<version>` is `MAJOR.MINOR.PATCH`. Drafts and prereleases are ignored.

The tar (ustar, gzip) holds exactly these paths, all relative:

| Path | Required | What |
|---|---|---|
| `manifest.json` | yes | below |
| `server.mjs` | yes | the server half, an ES module |
| `web.mjs` | yes | the web half, an ES module |
| `web.css` | no | its styles |
| `migrations/NNNN_name.sql` | no | its migrations, `9001` to `9899`, each with a compat floor at or below the running version |
| `assets/<file>` | no | further web files (`.mjs`, `.css`, `.svg`, `.png`, `.woff2`), one level |

Directory entries for `migrations/` and `assets/` are allowed. Every other entry is refused: a symlink, a hard link, a
device, a pax or GNU header, an absolute path, a `.` or `..` segment, a backslash, a name outside the table, a second
entry of the same name. Limits: 200 entries, 10 MB a file, 50 MB in all, 25 MB compressed.

### manifest.json

```json
{
  "id": "example",
  "version": "1.4.0",
  "host": ">=0.9.0 <0.11.0",
  "server": "server.mjs",
  "web": "web.mjs",
  "css": "web.css",
  "migrations": "migrations/"
}
```

- `id`: `^[a-z][a-z0-9-]{1,30}$`. Its route prefix (`/api/<id>`), its page id (`#/<id>`) and its folder. Never renamed.
  An id the app uses itself (a first segment of a shared `/api` route, a shared page or CLI command, `RESERVED_IDS` in
  `modules/bundle.ts`) is refused, as it would shadow the shared one.
- `version`: equal to the `<version>` of the asset name.
- `host`: the versions of this app it was built against. Comparators `>=`, `>`, `<=`, `<`, `=`, `^`, `~` or a bare
  version, separated by spaces (all must hold), alternatives joined by `||`. The running version is compared without
  its prerelease part.
- `server`, `web`: exactly `server.mjs` and `web.mjs`. `css`: `web.css` or left out. `migrations`: `migrations/` or
  left out.
- No other key.

### Signature

```sh
ssh-keygen -Y sign -f <release key> -n omatalous-module module-1.4.0.tar.gz
```

The host runs `ssh-keygen -Y verify -f <signers> -I omatalous-module -n omatalous-module -s <sig>` over the tar. The
signers file is `release/module_signers` in this repository, copied into the image as `/app/module_signers`. A line
there reads

```
omatalous-module namespaces="omatalous-module" ssh-ed25519 AAAA...
```

with no comment after the key. The file ships with no key: an install then refuses every bundle. The trust root is
never in the code, the bundle, the environment or the database.

## What the host does

1. **Check** (on `PUT /api/modules/code`, after each start on a new app version, and once a day): lists the releases of
   the code's repository through `https://api.github.com/repos/<repo>/releases` with the token, takes the five newest
   versions that carry both assets, and for each, newest first: downloads both (HTTPS only, the token goes only to
   `api.github.com`, a redirect is followed only to an `https` address and without the token), verifies the
   signature, reads the manifest, checks the version and the host range, and checks every tar entry. The first that
   passes is installed. A bundle that fails any step is refused and none of it is written outside a temporary folder
   or run. A release older than the installed module is skipped, unless the installed one waits for another app
   version: an old signature stays valid, so a release list without the newer ones does not bring an old bundle back.
   The highest version installed of each id is kept in the database (settings key `module_floor`), and a release
   below it is refused with the same exception. Removing the code keeps that floor, so a new code does not bring an
   old bundle back either.
2. **Install**: the verified tar and its signature go to `<DATA_DIR>/modules/<id>/<version>/`, and
   `<DATA_DIR>/modules/active.json` names `{ "id", "version" }`. Older versions of the same id are deleted. The app
   restarts through the maintenance helper when one is linked; otherwise the status says that the module starts at the
   next restart.
3. **Start**: before the database opens, the host reads `active.json`, verifies the kept tar's signature again, checks
   the manifest's host range against the running version, extracts the tar afresh into
   `<DATA_DIR>/modules/<id>/<version>/files/`, imports `server.mjs` and calls its `register(host)`. Then the database
   opens with the module's migrations beside the shared ones. Any failure leaves the module out: the app starts without
   it and the status says why in one line. A migration of the module that fails (`openWithModule` in
   `modules/load.ts`) leaves it out too: the database opens again without the module's files, the security log gets a
   `module_refused` event and the next start tries the module again. A failing shared migration stops the start as before.
4. **Remove** (`DELETE /api/modules/code`): deletes the sealed code and `<DATA_DIR>/modules/`. The module's tables and
   its version floor stay.
   Its migrations are additive with a compat floor (`-- migrate: compat X.Y.Z`), so the app opens that database
   without them. The running process keeps the module until the next restart.

The status the admin sees (`GET /api/modules`, admin only):

| `state` | Line in Asetukset |
|---|---|
| `none` | Ei yhdistetty. |
| `connected` | Yhdistetty, versio X. |
| `connected`, `noCode` | Käytössä, versio X. Koodia ei ole tallennettu, joten uusia versioita ei haeta. |
| `pending` | Asennettu, käytössä uudelleenkäynnistyksen jälkeen. |
| `waiting` | Odottaa tähän versioon sopivaa lisäosaa. |
| `refused` | Hylätty: (one reason, never the code). |

The start reads `active.json` before the database opens, so a module whose files were put in place by hand, or whose
code the database lost (one restored from before the code), runs with no code. Its line then names the running version
and says that no check looks for a newer one until the code is entered.

Security events: `module_code_set`, `module_code_removed`, `module_installed`, `module_refused`.

## Server half

`server.mjs` has a default export `register(host)`. The host object is also on
`globalThis[Symbol.for("omatalous.host")]` while `server.mjs` is evaluated, so the bundle's shims can read the shared
modules at import time.

```ts
interface ModuleHost {
  apiVersion: 1;
  /** The running app version. */
  version: string;
  /** The module's extracted folder. */
  dir: string;
  /** Adds its entry to EXTENSIONS. Called once; the id must equal the manifest's. */
  addExtension(entry: ServerExtension): void;
  /** Shared modules, by import specifier. */
  modules: Readonly<Record<string, unknown>>;
}
```

`ServerExtension` is the type in the server's extension file: `id`, `label`, `routes(s)` (mounted at `/api/<id>` behind the
signed-in user), `tokenReads?`, `stores?`, `leftOut?`, `sealed?`, `securityEvents?`, `demo?`, `removeDemo?`, `cli?`,
`cliUsage?`, `hourly?`, `rowFields?`, `rowParts?`. The host sets `migrationsDir` from the manifest; an entry's own value
is ignored. A registered extension is on: the code is the switch, and there is no flag of its own to turn off.

`host.modules` holds, by specifier:

- `hono`, `@banking/core`
- the server's own files, by their path under `apps/server/src` without `.ts`: `cli-args`, `demo-data`,
  `platform/errors`, `platform/inflight`, `platform/outbound`, `platform/validate`, `routes/shared`,
  `security/encoding`, `security/rate-limit`, `services/analysis`, `services/data-import-stores`, `services/security`

Type-only imports (`db/rows`, `db/types`, `services/context`, `db/data-export-stores`, `services/users`,
`extensions`) need nothing at run time. The bundle carries no copy of these modules: its build maps each import that
resolves to one of them to the host's object (an esbuild plugin that emits
`module.exports = globalThis[Symbol.for("omatalous.host")].modules["<specifier>"]`). Node built-ins stay imports. A new
shared module the module needs is added to this list here first.

## Web half

`web.mjs` has a default export `register(host)`. Before it is imported, the host sets `globalThis.__omatalous`:

```ts
interface WebModuleHost {
  apiVersion: 1;
  /** Adds its entry to WEB_EXTENSIONS. */
  addExtension(entry: WebExtension): void;
  modules: Readonly<Record<string, unknown>>;
}
```

`WebExtension` is the type in the web app's extension file: `id`, `settingsCard?`, `settingsAnchor?`, `page?` (`label`,
`component`), `securityLabels?`, `rowPart?`, `rowMark?`.

`host.modules` holds `react`, `react/jsx-runtime`, `react-dom`, `@banking/core`, and the web's own files by their path
under `apps/web/src` without the extension: `api`, `hooks`, `format`, `routes`, `types`, `css`, `design/tokens`,
`charts/Axes`, `charts/CalendarHeat`, `charts/draw`, `charts/kit/Readout`,
`charts/kit/marks`, `charts/scale`, `components/ErrorCard`, `components/Figure`,
`components/Loading`, `components/More`, `components/Section`, `components/Why`, `components/table/Cells`,
`components/table/KeyValue`, `components/table/Table`, `components/table/selection`, `components/ui/Button`,
`components/ui/Notice` (`apps/web/src/module-host.ts`). A shared stylesheet the module needs is copied into its `web.css`;
stylesheets hold no state.

### Where the host draws it

| Point | Fed by | Where |
|---|---|---|
| `page` | the module | its own address `#/<id>`, its tab after the others, in the header and in the phone's tab bar (`Shell.tsx`) |
| `settingsCard` | the module | Asetukset > Lisäosa (`#/settings/addon`), above the add-on's own card; an address of its `settingsAnchor` opens it there |
| `rowMark` | `rowFields` | on the line of a row of Tapahtumat, beside its tags; it keeps the row one line high |
| `rowPart` | `rowFields` | in the opened row of Tapahtumat, above the payee's months |
| category parts | `rowParts` | Raportit > Menot > Menot osittain: each category the server split, its parts under its name and figure |

`rowMark` and `rowPart` get the row as `/api/transactions` returns it, with the fields `rowFields` added, and draw
nothing (return `null`) for a row they know nothing of (`components/ExtensionRowParts.tsx`). The category parts are
the `parts` of the categories report (core `analysis/row-parts.ts`); the web draws them as the server gave them and
adds nothing up (`pages/reports/sections/CategoryParts.tsx`). Without a module none of these points draws an element
or makes a request, and the card of Menot osittain is not there.

### Loading in the browser

When a module is loaded on the server, the page (`index.html`) carries
`<meta name="omatalous-module" content="/modules/<id>/<version>/">`; without one the page is the build's own file,
byte for byte. `main.tsx` reads the tag before the first render, sets `globalThis.__omatalous`, imports
`<content>web.mjs` and adds `<content>web.css` as a stylesheet. A failure is logged and the app renders without the
module. The files under `/modules/` are served only to a signed-in user, from the extracted folder, with the app's own
CSP; a signed-out page loads the module after the sign-in reloads it.

## Building a module (in its own repository)

1. Bundle the server half with esbuild (`format: "esm"`, `platform: "node"`), the shared imports mapped as above.
2. Bundle the web half the same way for the browser (`jsx: "automatic"`), React and the shared files mapped to
   `globalThis.__omatalous.modules`.
3. Write `manifest.json`, tar with `tar --format=ustar -czf module-<version>.tar.gz <files>` (no symlinks), sign, and
   attach both files to a release.

The tests of this repository build such a bundle in a temporary folder, sign it with a throwaway key and load it
(`apps/server/test/modules.test.ts`).
