# Tools

A tool is a page of its own next to the app, a route of the tools page, for a task that needs a part of DashQL but not
the app: look into a file, check a format, try a component. A tool sets up only the parts it uses, so it is also the
reference for a host that embeds a piece of DashQL without the whole app.

The Tools tab of the internals overlay lists them (`src/diagnostics/tools_view.tsx`). On the web a link opens the tool
in a new tab of the same origin, the desktop app opens it on dashql.app in the browser: its window shows only the app.

## The tools page

`tools.html` (`packages/dashql-app/entrypoints/tools.html`, `src/tools/tools.tsx`) hosts every tool like `demos.html`
hosts the demos: the routes are hashes, `tools.html#/<id>`, so every host serves the page without rewrites, and the
page of a tool is a lazy chunk. Without a route it lists the tools. The page provides the logger and the theme, the
page of a tool the rest of its providers. Its `<meta>` policy allows `'wasm-unsafe-eval'`, the tools load the Wasm of
the core and of Hyper, see [app_csp.md](app_csp.md).

## Adding a tool

| Part | Where |
|------|-------|
| Sources | `packages/dashql-app/src/tools/<id>/`, the default export of the entry module is the page with the providers of the tool |
| Listing | `TOOLS` of `src/tools/tool_registry.ts`: id, title, description, `load()` |
| Page test | `PAGE_TESTS` of `packages/dashql-app/test/browser_page_tests.mjs` |

The build needs no changes: `tools.html` is already an input of vite.

- **Providers.** Only those the tool uses. `StandaloneRuntime` (`src/host/standalone_runtime.tsx`) gives a runtime
  without storage and connections, without an HTTP client if the page sends no requests, for the hooks, models and
  components of `@akohn/dashql-react`. A tool without computations or scripts needs no core at all.

## Unpacker

`tools.html#/unpacker` shows what a `.dashql` file holds ([workbook_tables.md](workbook_tables.md)): a card of the file,
and below it, indented, a card per Parquet file of the archive and the other entries in a list. A line from below the
icon of the file turns to each of them with a round corner, drawn in CSS: the headers of the cards have a fixed height
and the line turns to their middle. A card reads its file when it first opens and shows a preview of
its rows in a fixed height, the first rows like the result of a feed entry. The button next to the header of a read file
and the column names of the preview open the full table in the card of a feed entry's result (`ResultTableOverlay` of
`@akohn/dashql-react`) with the search, the cross filters and a button to enlarge it to the window. The tables are the
data table of the app (`DataTableView`), a cell of either opens its detail in the overlay of the app. The page scrolls,
the body doesn't. Only archives of the current format have Parquet files, an archive of an older version shows its
entries as other entries.

| Part | Module |
|------|--------|
| Providers: logger, embedded Hyper, core, `StandaloneRuntime` | `src/tools/unpacker/unpacker.tsx` |
| Drop zone, file picker, the cards, the preview and the full table of a file (`TableDetails` of `@akohn/dashql-react`, the details of any analyzed table). A Parquet file is a computation (`useTableComputation` of `@akohn/dashql-react/hooks`): Hyper scans it (`readParquetFile` of `platform/hyperdb/hyperdb_parquet_read.ts`, shared with the import), the runtime analyzes it | `unpacker_page.tsx` |
| The ZIP container (zip.js): entries, sizes, the bytes of a file, read into memory with its CRC-32 checked | `unpacker_archive.ts` |
| The card of a file, a component with plain props and the table as a slot | `parquet_file_card.tsx` |

The computation of a file stays while its archive is shown, a card that opens again shows it at once. Another file
replaces the cards and deletes their computations. The table shows no column plots, the analysis skips the column
aggregates. The page loads no flavor.

`src/tools/unpacker/unpacker_page.test.tsx` writes an archive with Hyper and zip.js, drops it on the page, reads a
table and opens and closes its full table. The page test boots the real page and drops a file that is no archive.

## Analyzer

`tools.html#/analyzer` shows what the core knows about a script after each phase. It has two cards: the catalog script,
collapsed when the page opens, the TPC-H schema of `static/examples/tpch/schema.sql`, and the editor script, the
subquery of TPC-H query 2, formatted. Each card has the editor of a feed entry on a script session of its own
(`createScriptSession`), with the highlighting, the completion and the diagnostics of the core. The editors grow with
their scripts, and the page scrolls. The header of an expanded card has the action menu of a feed entry
(`ScriptActionMenu`) with Format Pretty and Format Compact only (`formatScriptEditor`). Pretty formats at the default
width of the formatter (80), compact at the width of the editor, like the format dialog of the shell; the editor applies
the changes. Below the editor of the editor script is a section per phase:

- **Scanner.** The tokens of the parse as a wrapping line, colored by their type, the comments between them.
- **Parser.** The nodes of the AST as a wrapping line of chips in the order of the array of the parser, a label at the
  start of each statement. A chip shows the attribute key and the type of its node, a leaf also its text. The node
  under the pointer highlights its children (green) and its parent (amber).
- **Analyzer.** The errors of the analysis, and its facts as rows of chips by their kind: the declared tables, the table
  references with the kind of their resolution (`catalog`, `script`, `parameter`, `cte`), the column references with
  the table reference they read (`catalog region`, `cte d`), a derived table (`subquery`) or an output column of their
  own SELECT (`output`), the function calls, the roots of the constant subtrees with their kind, the function
  references, the parameters, the inferred schemas and the name scopes, the rarer parts by their count. The analyzer
  records only these expressions: column references, calls and constant subtrees. An AND or a comparison of columns is
  none, so there is no row of "expressions". An unresolved reference is marked. A fact under the pointer highlights its
  AST node and its tokens, a node under the pointer in the AST its facts. A column reference under the pointer
  highlights its table reference in purple, a table reference the column references that read it.

Both sessions share a catalog. A new analysis of the catalog script loads it into the catalog (`loadIntoCatalog`), the
page analyzes the editor script again and hands the update to its editor if the card is expanded. After each analysis
the page reads the phases from the session once (`getParsed`, `getAnalyzed`) and counts the statements and errors of the
summary from them. The spans of the buffers count UTF-8 bytes, the page decodes the text of a span from the bytes of
the script. It needs the core only: no runtime, no database.

| Part | Module |
|------|--------|
| Providers: logger, core | `src/tools/analyzer/analyzer.tsx` |
| The sessions, the catalog, the cards | `analyzer_page.tsx` |
| The editor of a session | `analyzer_editor.tsx` |
| The card of a script, a component with the editor and the phases as slots | `analyzer_card.tsx` |
| The sections of the phases | `script_phases.tsx` |

`src/tools/analyzer/analyzer_page.test.tsx` checks the phases of the editor script, the facts of the analysis, the
highlighting of a node, both formatting modes and that the editor script follows a change of the catalog script. The
page test boots the real page and waits for the analysis.
