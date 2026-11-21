# Tools

A tool is a page of its own next to the app, for a task that needs a part of DashQL but not the app: look into a file,
check a format, try a component. A tool sets up only the parts it uses, so it is also the reference for a host that
embeds a piece of DashQL without the whole app.

The Tools tab of the internals overlay lists them (`src/diagnostics/tools_view.tsx`). On the web a link opens the tool
in a new tab of the same origin, the desktop app opens it on dashql.app in the browser: its window shows only the app.

## Adding a tool

| Part | Where |
|------|-------|
| Entry page | `packages/dashql-app/entrypoints/tools/<id>.html`, built as `tools/<id>.html` |
| Sources | `packages/dashql-app/src/tools/<id>/`, the entry module renders the providers of the tool |
| Listing | `TOOLS` of `src/tools/tool_registry.ts` |
| Page test | `PAGE_TESTS` of `packages/dashql-app/test/browser_page_tests.mjs` |

- **URL.** Cloudflare Pages serves `tools/<id>.html` as `/tools/<id>` and redirects the `.html` URL there. The dev
  server and the server of the browser tests serve the page under the same path. `_headers` revalidates `/tools/*`
  like the other entry pages.
- **Build.** Every html file of `entrypoints/tools/` is an input of the build (`toolInputs` in `vite.config.tpl.ts`),
  no config changes. The page reaches the sources and favicons with `../../src` and `../../static`.
- **Content-Security-Policy.** The page carries its own `<meta>` policy like every entry page, with
  `'wasm-unsafe-eval'` only if it loads a Wasm module, see [app_csp.md](app_csp.md).
- **Providers.** Only those the tool uses. `StandaloneRuntime` (`src/host/standalone_runtime.tsx`) gives a runtime
  without storage and connections, without an HTTP client if the page sends no requests, for the hooks, models and
  components of `@akohn/dashql-react`. A tool without computations or scripts needs no core at all.

## Unpack

`/tools/unpack` shows what a `.dashql` file holds ([workbook_tables.md](workbook_tables.md)): a card per Parquet file of
the archive, and the other entries in a list below. A card reads its file when it first opens, and the data table of
`@akohn/dashql-react` shows its rows. Only archives of the current format have Parquet files, an archive of an older
version shows its entries as other entries.

| Part | Module |
|------|--------|
| Providers: logger, embedded Hyper, core, `StandaloneRuntime` | `src/tools/unpack/unpack.tsx` |
| Drop zone, file picker, the cards | `unpack_page.tsx` |
| The ZIP container (zip.js): entries, sizes, the bytes of a file | `unpack_archive.ts` |
| A Parquet file as a computation: Hyper scans it (`readParquetFile` of `platform/hyperdb/hyperdb_parquet_read.ts`, shared with the import), the runtime analyzes it (`analyzeTable`) | `use_parquet_computation.ts` |
| The card of a file, a component with plain props and the table as a slot | `parquet_file_card.tsx` |

The computation of a file stays while its archive is shown, a card that opens again shows it at once. Another file
replaces the cards and deletes their computations. The table shows no column plots, the analysis skips the column
aggregates. The page loads no client function specs, no flavor and no cell detail with its editor.

`src/tools/unpack/unpack_page.test.tsx` writes an archive with Hyper and zip.js, drops it on the page and reads a table.
The page test boots the real page and drops a file that is no archive.
