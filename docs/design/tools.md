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

## Analyzer

`/tools/analyzer` shows what the core knows about a script after each phase. It has two cards: the catalog script,
collapsed when the page opens, the TPC-H schema of `static/examples/tpch/schema.sql`, and the editor script, the
subquery of TPC-H query 2, formatted. Each card has the editor of a feed entry on a script session of its own
(`createScriptSession`), with the highlighting, the completion and the diagnostics of the core. The editors grow with
their scripts, and the page scrolls. The Format button in the header of an expanded card opens Format Pretty and Format
Compact like the action menu of a feed entry. Pretty formats at the default width of the formatter (80), compact at the
width of the editor, like the format dialog of the shell; the editor applies the changes. Below the editor of the editor
script is a section per phase:

- **Scanner.** The tokens of the parse as a wrapping line, colored by their type, the comments between them.
- **Parser.** The nodes of the AST as a wrapping line of chips in the order of the array of the parser, a label at the
  start of each statement. A chip shows the attribute key and the type of its node, a leaf also its text. The node
  under the pointer highlights its children and its parent, draws edges to its first child and its parent, and a line
  below shows its children or value, its parent and its text.
- **Analyzer.** The errors of the analysis, and its facts as rows of chips by their kind: the declared tables, the table
  references with the tables they resolve to, the column references with their tables, the function calls, the roots of
  the constant subtrees with their kind, the function references, the parameters, the inferred schemas and the name
  scopes, the rarer parts by their count. The analyzer records only these expressions: column references, calls and
  constant subtrees. An AND or a comparison of columns is none, so there is no row of "expressions". An unresolved
  reference is marked. A fact under the pointer highlights its AST node and its tokens, a node under the pointer in the
  AST its facts.

Both sessions share a catalog. A new analysis of the catalog script loads it into the catalog (`loadIntoCatalog`), and
the editor of the editor script analyzes it again. The page reads the phases from the session (`getParsed`,
`getAnalyzed`), the spans of the buffers count UTF-8 bytes and the page decodes the text of a span from the bytes of the
script. It needs the core only: no runtime, no database.

| Part | Module |
|------|--------|
| Providers: logger, core | `src/tools/analyzer/analyzer.tsx` |
| The sessions, the catalog, the cards | `analyzer_page.tsx` |
| The editor of a session | `analyzer_editor.tsx` |
| The card of a script, a component with the editor and the phases as slots | `analyzer_card.tsx` |
| The sections of the phases | `script_phases.tsx` |
| The Format button with its menu of Format Pretty and Format Compact | `format_menu.tsx` |

`src/tools/analyzer/analyzer_page.test.tsx` checks the phases of the editor script, the facts of the analysis, the
highlighting of a node, both formatting modes and that the editor script follows a change of the catalog script. The
page test boots the real page and waits for the analysis.
