# Quirks inherited from the C++ core

The Rust core was ported bug for bug from the former C++ core. Every entry below looks wrong but was
kept on purpose, so that the snapshots did not change.

Each quirk can be fixed as an ordinary change with a snapshot update; remove its entry then. Add an
entry when you find another one. The headings name where the behavior lives.

## Scanner (`packages/dashql-parser/src/scanner.rs`)

- **`DOT_DOT` and `RAW_CHAR` are emitted, but no rule uses them.** They always end up as syntax
  errors.
- **Case folding is ASCII only.** Bytes `\200-\377` are identifier bytes and keep their case, like in
  Postgres with a multi-byte encoding.
- **Unimplemented forms.** No dollar-quoted strings, `E''`, `U&` or `N''`. Backslash has no special
  meaning in `'...'`, and quoted strings continue across a line break only for bit and hex strings.
  Consumers read literal values by stripping the outer quotes, so they neither unescape `''` nor join
  continued bit and hex strings.
- **Zero-length quoted identifiers still return an IDENT**, with an empty name, next to the error.

## Parser (`grammar/rules/`, `packages/dashql-parser/src/parser/`)

- **Keyword names carry token indexes as byte spans.** `name_from_keyword` and `name_from_string_literal`
  register names with `TextSpan::new(loc.offset(), ...)` of a `SymbolSpan`, which is a token index
  stored in a byte-span field. Scanner-registered names carry real byte offsets.
- **Names from string literals keep their single quotes.** `name_from_string_literal` trims only double
  quotes, so the parameter `:'mode'` is named `'mode'`. The analyzer strips the quotes of parameter
  names (`unquote` in `analyzer/parameters.rs`).
- **Lenient incomplete statements.** `SELECT * FROM A WHERE` parses without an error, because
  `sql_where_clause: WHERE` accepts a bare keyword. A bare `FROM` keeps the lenient tree, but reports
  "expected a table reference after FROM" unless the input ends right after it.
- **`EOF` is part of rules.** The grammar shifts `EOF` inside rules (`ext_dot_trailing: DOT EOF`).
  Parsing can still finish because the parser keeps reading EOF at the end of input.

## FlatBuffers enums (`proto/fb/dashql/parsed_script.fbs`)

- **`NodeType` ordinals are ranged.** Enums sit between `ENUM_KEYS_` (10) and `OBJECT_KEYS_` (41),
  objects above `OBJECT_KEYS_`. The signatures hash the raw values, so removing or reordering values
  needs a bump of `SCRIPT_SIGNATURE_VERSION`. Pinned by `//packages/dashql-core:dashql_buffers_test`.

## Analyzer (`packages/dashql-core/src/analyzer/`)

- **`AND`/`OR` over constants become binary expressions with function `UNKNOWN`**, because
  `binary_function` (`constants.rs`) has no mapping for them.
- **Function calls without arguments are constant but never constant roots.** Only calls with
  arguments are added to the constant list.
- **Unreadable qualified function names fail the analysis** with the error "bad optional access"
  (`function_calls.rs`).
- **Root scopes iterate in insertion order, and erasing moves the last element into the hole**
  (`RootScopes`). Name resolution visits the roots in that order.

## Completion (`packages/dashql-core/src/completion.rs`)

- **A candidate scores with its lowest top object.** `select_top_candidates` takes the score of the
  last of the descending top 24 catalog objects.
- **Spans mix text offsets and token indexes.** Candidate target locations are `SymbolSpan`s holding
  text offsets, and keyword-registered names keep token indexes in their text location, which the
  "is it the cursor symbol" check compares with text offsets.
- **A dot at the begin of the cursor symbol never completes.** At `BEGIN_OF_SYMBOL`, `compute` returns
  without completing.
- **The analysis of one script records objects for the names of another one.** Derived tables
  (`CREATE VIEW v AS SELECT * FROM t`) push their columns into the resolved objects of the names they
  copy, which can be names of a catalog entry. The analyzer records them for every entry, but only
  applies those of its own script to its name index.
- **Table refs are promoted through the catalog only.** `promote_identifiers_in_scope` looks up the
  resolved tables of the scope in the catalog by id, so tables of the script being edited are only
  promoted once that script is loaded into the catalog.

## Formatter (`packages/dashql-core/src/formatter/`)

- **Attribute lookup picks different duplicates** (`attrs!` in `dashql_parser::attributes`). With one
  key it returns the first matching child; with several keys it returns the last match of each. The
  analyzer relies on the same helper.
- **Comment wrapping splits words at byte offsets** (`append_wrapped_comment_paragraph`) and can cut a
  UTF-8 character in half. `Formatter::format_bytes` returns the raw bytes.
- **Three whitespace sets in comments.** Trimming uses C `isspace` (including `\v`), word splitting
  uses `" \t\r\n\f"`, and the words of `@vis` tags are split at `" \t\r\f\v"` (`split_word`).
- **Keyword upper-casing** (`append_generated_text`) only touches exact lower-case keywords in
  generated text, so source `TRUE` or `Select` stay as written. Line widths count bytes.
- **`format_node_at` does not mark statement roots**, so a CREATE TABLE formatted that way renders
  `'<OBJECT_SQL_CREATE>'`.
- **An empty property graph** formats as `Text("")`, a non-empty document.
- **Unformattable nodes** are recorded in visit order and can repeat.
- **Unknown enum values** are unformattable, and unknown operators get precedence 0, non-associative
  (`get_operator_precedence`).

## Plan view model (`packages/dashql-core-view/src/`)

- **Roots are placed in reverse plan order** (`flatten_operators`).
- **Fragment order.** Execution-target fragments come in reverse root order, before federate fragments
  (`identify_fragments`).
- **Lookups.** `find_number` stops at the first existing name even if it is not a number, a non-array
  `earlyProbes` blocks the `early-probes` fallback, pipeline operator lists keep duplicates, and
  pipeline edge ids count across pipelines.

## Script session (`packages/dashql-core-session/src/script_session.rs`)

- **Offset projection.** In UTF-8 mode, offsets are projected without checks. In UTF-16 mode, spans
  that are not on a code point boundary are dropped, including keyword names whose byte-span fields
  hold token indexes.
- **Field presence differs by offset unit.** In UTF-16 mode, completions leave out empty strings and
  vectors, and a diff without operations has no `ops`; in UTF-8 mode they are kept.
- **Stale spans.** `ScriptSession::diff` and the rewrites of `Script::parsed_for_rewrite`
  (`rewrite_annotation`, `rewrite_vis_renderer`, `rewrite_vis_card`, ...) apply the spans of a possibly
  outdated parse to the current text, unless `parse_if_outdated` is set. In UTF-16 mode, a diff span
  that is then not on a boundary is an error.
- **Cursor bookkeeping.** `analyze` stamps the cursor versions even when placing the cursor failed;
  `apply` does not.
- **`format` allocates the entry id** before rejecting output that is not valid UTF-8 (comment
  wrapping can cut a character).
- **Text padding.** Spans that end past the text read two NUL padding bytes after the text
  (`padded_text` in `dashql-core/src/script_diff.rs`).

## Shell (`packages/dashql-core-shell/src/`)

- **Stale cursor row.** After prompt edits outside the terminal the cursor row is stale, and the
  cursor-down count of a submit wraps around.
- **`\r\n` is one grapheme of width 0** in the prompt layout: clusters that start with a control
  character take no columns.
- **Completion limit 0.** SQL completion returns no candidates, but dot-command completion checks the
  limit only after adding a candidate and returns every matching command.
- **Invalid UTF-8 queries.** `start_query` returns `INTERNAL_ERROR` "rope input must contain valid
  UTF-8".

## Deterministic order

The snapshots pin these orders:

- **Ambiguous column candidates are listed in FROM order** (`NameScope::sources`, and
  `NameScope::cte_definitions` is an ordered map).
- **Duplicate unqualified names resolve in declaration order.** `CatalogEntry::tables_by_unqualified_name`,
  `table_columns_by_name` and `functions_by_unqualified_name` are btree maps of lists that keep the
  insertion order of equal keys.
- **Catalog-wide column lookups visit entries in resolution order** (`resolve_table_columns_with_catalog`),
  by layer and then entry id.
- **The `FlatCatalog` name dictionary is built in resolution order** (`Catalog::flatten`).
