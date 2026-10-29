# Session Publishing

DashQL sessions can be published as ordinary, reviewable files on any static host with CORS, such as
GitHub Pages, without a `.dashql` archive or a DashQL-hosted publishing service. A link points
https://dashql.app at the session file, and the app imports the tree as an editable local session. The
bundled example sessions use the same mechanism.

## Published Tree

A published session is a session folder (see `storage_layout.md`) plus the catalogs of its connections:

```text
dashql-session.json
scripts/
  01_setup.sql
  02_report.sql
attachments/
  sales.csv
connections/<connection-id>/
  dashql-catalog-relations.sql
  dashql-catalog-functions.sql
```

Static HTTP servers cannot enumerate folders, so `dashql-session.json` lists the scripts and attachments
(schema `proto/json/dashql/app_session.json`):

```json
{
  "formatVersion": 8,
  "sessionId": "…",
  "connections": [
    { "connectionId": "22bdfa32-…", "params": { "…": "…" } },
    { "connectionId": "9f0c6e1a-…", "params": { "…": "…" } }
  ],
  "scripts": [
    { "name": "01_setup.sql", "connectionId": "22bdfa32-…" },
    { "name": "02_report.sql", "connectionId": "9f0c6e1a-…" }
  ],
  "attachments": [{ "name": "sales.csv" }],
  "metadata": { "…": "…" }
}
```

- `connections` holds a copy of every connection the scripts use and nothing else, in the order the scripts
  first use them, so the tree is self-contained. A session without scripts holds the one connection its first
  script will run on. Unlisted script files run on the connection of the script before them. Exports drop the
  connections that no script uses.
- An embedded database (`"protocol": "WASM"`) is never a choice on import: the app holds a single connection
  to its embedded Hyper, every embedded database of an imported session uses it.
- The script list is authoritative for the order of the scripts and for the connection each script is
  analyzed and executed with. File names carry no meaning: a numeric prefix like `01_` is an ordinary part
  of the name, and reordering scripts only rewrites the list.
- The attachment list is kept in natural order.
- `connections/<id>/` carries the relation and function catalogs of each connection of the session
  (`bundleCatalogPath`, `packages/dashql-app/src/app/storage/session_bundle.ts`). The catalog changes of
  executed statements are not published. Bundles of format 6 and older carry top-level catalog files, which
  are read for the default connection of that format.

## Reconciling Lists and Files

Every loader, local or remote, reconciles the lists with the files it finds
(`packages/dashql-app/src/app/storage/session_files.ts`):

- `sanitizeSessionFiles` drops entries with unsafe names (empty, longer than 255 characters, separators, NUL,
  `.` or `..`), non-`.sql` scripts, `dashql-draft.sql`, and invalid connection ids. Duplicates are detected
  case-insensitively after NFC normalization; the first wins. Lists are capped at 2048 entries.
- `reconcileSessionScripts` drops entries without a file, adopts the file's spelling for case or NFC variants,
  and appends unlisted script files in natural order on the default connection.
- A script whose connection cannot be resolved runs on the default connection, and the session file keeps
  its original reference (`session_script_connections.ts`). Unused connections are pruned from the list.

Older formats are migrated: v5 moved the order of `dashql-session-index.json` into the script list, v6
turned `mainDatabase` and `attachedDatabases` into the connection list, and v7 moved the catalogs out of the
session folder into the connections (`packages/dashql-app/src/migration/session/`). Remote sessions of older
formats are migrated in memory.

## Links and Loading

A published link carries the URL of the session file:

```text
https://dashql.app/?session=https%3A%2F%2Fowner.github.io%2Frepository%2Fexample%2Fdashql-session.json
```

The `session` parameter (or the legacy `notebook`) is consumed with `history.replaceState` before any
asynchronous work, so a refresh does not repeat the import
(`packages/dashql-app/src/platform/events/event_listener_provider.tsx`). Pasting a DashQL link and opening
an example raise the same `SETUP_SESSION_URL` event.

```mermaid
flowchart TD
    A[SETUP_SESSION_URL] --> B[Validate URL, fetch session file]
    B --> C[Best-effort scripts, attachments, catalogs]
    C --> D[SessionBundle]
    D --> E[Import card: Import, Replace, Create new, Close]
    E --> F[Resolve connections onto existing ones]
    F --> G[importPortableBundleWithChoice]
```

`readSessionBundleFromHttp` (`packages/dashql-app/src/app/session/persistence/http_session_bundle.ts`):

- accepts public `https:` URLs, `app://bundle` URLs of bundled sessions, and loopback `http:` in development
  builds, without credentials or fragment, ending in `dashql-session.json` (or the legacy
  `dashql-notebook.json`),
- requires only the session file; listed scripts, attachments and catalogs are optional and skipped when
  unavailable, so stale lists degrade gracefully,
- builds file URLs as `scripts/<name>`, `attachments/<name>` and `connections/<id>/<file>` relative to the
  session file, so all fetches stay below its directory on the same origin,
- fetches with `credentials: 'omit'`: plain `GET`s without cookies, authorization or custom headers,
- limits the session file to 1 MiB, each script and catalog to 8 MiB, and the total to 32 MiB. Over budget,
  all optional files are dropped and only the session metadata is imported,
- reports the session as incomplete when entries were dropped, files were missing, or the budget was
  exceeded.

The app loads the bundle during setup with progress phases and shows it on a `SessionImportCard`
(`packages/dashql-app/src/app/loading/shared_session_import.tsx`), including where a session with the same
UUID already lives. Imported catalogs are parse-validated and only seed connections that have no catalog
yet.

The imported tree becomes an editable OPFS session. Its metadata records `HTTP` provenance and the original
URL; later edits do not write back to the host.

## UUID Collisions

Remote trees use the portable import path of `.dashql` files and inline ZIP links
(`packages/dashql-app/src/app/session/persistence/session_import_provider.tsx`):

- No conflict: keep the published UUID.
- Create new: allocate a fresh UUID and append ` (copy)` to a non-empty name.
- Replace: stage the bundle under a fresh UUID, verify it, then swap it in
  (`packages/dashql-app/src/app/storage/session_import_transaction.ts`).
- Close: no storage changes.

OPFS and registered native sessions both participate in the UUID check.

## Imported Connections

Exports give every connection a fresh id, so an import finds the connections of the app by their params
(`planConnectionImport`, `packages/dashql-app/src/app/session/persistence/session_connection_import.ts`):

- A connection that the app knows under the same id and the same params (ignoring secrets) is used silently.
- A server connection whose params match connections of the app asks the user whether to use one of them or
  keep a connection of its own. Unknown connections are registered.
- An embedded database (`"protocol": "WASM"`) always uses the embedded database of the app, without a question.
  Its id is rewritten in `connections`, in the `connectionId` of every script and in the names of its catalogs.
  The restoration of the app does the same for an embedded database with an unknown id
  (`resolveSessionConnection`, `packages/dashql-app/src/app/session/persistence/app_state_loader.ts`).

**Open problem: attached databases of the embedded database.** The params of an embedded database may list
`attachedDatabases` (e.g. `tpch.hyper`). An imported session takes the params of the embedded database of the
app, so the databases that the session attached are dropped and scripts that read from them fail until the user
attaches them again. Before the app held a single embedded database, such a session registered an embedded
database of its own. A solution could merge the attached databases into the embedded database of the app or
attach them per session; it has to settle what happens when two sessions attach different files under the
same alias.

## Bundled Examples

The Bazel build stages `examples/sessions/` under Vite's `publicDir`, excluding `.DS_Store` files and
`cache/` folders. Vite copies the tree unchanged into the Pages, Electron and reloc builds:

```text
https://dashql.app/static/examples/sessions/<name>/dashql-session.json
```

- `bundled_sessions.ts` is the typed registry of the example session files. Paths resolve against the
  current origin on the web and under `app://bundle/static/examples/sessions/` in the desktop app. The files
  stay separate static resources rather than being embedded into a JavaScript chunk.
- `_headers` serves the example subtree with `Cache-Control: no-store, max-age=0, must-revalidate`, so every
  open requests the files again.
- Cloudflare Pages treats a deployment without a root `404.html` as an SPA. A directory-local
  `static/404.html` makes a missing optional file return a real 404 instead of the application HTML.

## GitHub URL Forms

GitHub Pages:

```text
https://owner.github.io/repository/path/dashql-session.json
```

Raw GitHub also works, but the URL must include a branch, tag, or commit:

```text
https://raw.githubusercontent.com/owner/repository/main/path/dashql-session.json
```

Public GitHub Pages and Raw responses provide `Access-Control-Allow-Origin: *`.
