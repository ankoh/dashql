# Core Completion

The completion system provides context-aware suggestions as the user types SQL in the editor.
It spans two layers: a Rust core that computes and scores candidates, and a TypeScript frontend that renders inline hints and handles keyboard interaction.
The core is `packages/dashql-core/src/completion.rs` and `cursor.rs`, with the LR probes in `packages/dashql-parser/src/parser/probe.rs`.

## Compute pipeline summary

```
Completion::compute(cursor, k)
│
├─ [inside a comment] complete comment tags and `@vis` tags, then stop (see vis_comments.md)
├─ Validate cursor has scanner location
├─ [the name of a table parameter in table position, `from :fo|`] the names of the scripts with a result, then stop
│  (complete_table_parameter, see script_references.md)
├─ [in a CALL of a namespace with client functions] its functions, options and attributes, then stop
│  (complete_client_function_call, see extensions.md)
├─ Select target symbol (current vs. previous)
├─ Detect dot-completion context
├─ Skip non-completable symbols (constants, operators, punctuation)
├─ probe::parse_until_with_snapshot() → expected symbols + LR state snapshot
├─ Detect definition position (AST attribute keys)
│
├─ [dot-completion]
│  └─ find_candidates_for_name_path()
│
├─ [between symbols — passive hints]
│  ├─ Check suppress_passive_hint() → return empty if suppressed
│  └─ add_expected_keywords_as_candidates(prefix snapshot) (keywords only)
│
├─ [normal completion]
│  ├─ add_expected_keywords_as_candidates(prefix snapshot)
│  │   └─ probe::probe_suffix_batch() — replay suffix per candidate (mid-statement only)
│  ├─ Insert identity candidate (score varies by context)
│  └─ (if expects_identifier && !at_definition && strategy != TABLE_REF_ALIAS)
│     ├─ find_candidates_in_indexes()
│     ├─ find_candidates_in_scope()
│     └─ promote_tables_and_peers_for_unresolved_columns()
│
├─ promote_identifiers_in_scope()  (not between symbols)
├─ select_top_candidates()         → top-k heap
├─ qualify_top_candidates()        → derive qualified names (not between symbols)
│
├─ derive_keyword_continuations(prefix snapshot)
│   └─ probe::probe_suffix_sequence() — keep continuation if suffix still parses (mid-statement)
│
└─ pack_completion() (pack.rs) → FlatBuffer result to frontend
```

The sections below walk through each stage of this pipeline.

## Cursor interaction

### ScriptCursor

The `ScriptCursor` is the bridge between the editor and the completion engine.
It encodes:

- **text_offset** — the byte position of the cursor in the script text.
- **scanner_location** — resolved to the current and previous scanner symbols, including the cursor's relative position within a symbol (begin, mid, end, before, after).
- **context** — a `CursorContext`, determined by the AST node the cursor sits inside: `None`, `TableRef { table_reference_id, at_alias }`, `ColumnRef { expression_id }`, or `AliasDot` (an `alias.` that the parser recovered without a column ref node).
- **statement_id / ast_node_id / ast_path_to_root** — structural position in the AST.
- **name_scopes** — the stack of naming scopes reachable from the cursor, innermost first.

### Target symbol selection

The completion engine picks a *target symbol* — the symbol whose text the user is currently typing:

1. If the cursor is **inside** a symbol, that symbol is the target.
2. If the cursor is **between** two symbols (e.g. right after a comma), it checks whether the previous symbol ends exactly at the cursor. If so, the previous symbol becomes the target.
3. Constants, operators, and punctuation are never completed — if the cursor lands on one, the engine falls back to the previous symbol or returns empty.

### Dot detection

Dot-completion activates when:
- The current symbol is a `.` (inner dot) and the cursor is at or past its end.
- The current symbol is a trailing dot (dot followed by whitespace).
- The previous symbol is an inner dot and the current symbol is an identifier the parser expects.

When dot-completion is active, the engine restricts candidates to those reachable through the qualified name path.

### Name path reading

`ScriptCursor::read_cursor_name_path` reads the sequence of name components around the cursor (e.g. `schema.table.col`).
Each component is classified as `Name`, `Star`, `TrailingDot`, or `Index`.
The engine determines how many components are *sealed* (fully typed, before a dot) and uses the sealed prefix to resolve the dot context.

## Completion strategies

The cursor's `CursorContext` determines the active strategy (`Completion::new`):

| Strategy          | When                                                        | Effect on scoring                        |
|-------------------|-------------------------------------------------------------|------------------------------------------|
| `DEFAULT`         | `CursorContext::None`                                       | All name types equally likely (base 20)  |
| `TABLE_REF`       | `CursorContext::TableRef` (not at the alias)                | Tables/schemas boosted, columns demoted  |
| `TABLE_REF_ALIAS` | `CursorContext::TableRef` with `at_alias`                   | Skips name-index search entirely         |
| `COLUMN_REF`      | `CursorContext::ColumnRef` or `CursorContext::AliasDot`     | Columns/aliases boosted, tables demoted  |

## Expected symbols (parse_until_with_snapshot)

Expected grammar symbols at the cursor position are extracted by `probe::parse_until_with_snapshot`, which runs the LR automaton up to the cursor's symbol and collects all valid next tokens with the driver's LAC (look-ahead correction) check, `lac_check`.
The same call also returns a `PrefixSnapshot` of the LR state stack (state numbers only — the probes run the automaton without grammar actions, so semantic values aren't needed); the suffix probe reuses that snapshot to avoid re-parsing the prefix.
Keywords bypass the candidate registration and enter the result heap directly.
They receive a +20 keyword-substring bonus when both `EXPECTED_PARSER_SYMBOL` and `SUBSTRING_MATCH` are set on the candidate, plus a prevalence modifier for common keywords (e.g. `SELECT` +4, `AS` +2).

### Suffix probe

LAC is one-sided: it tells you what tokens the grammar would accept at the cursor, but it ignores everything after the cursor.
This is fine at the write front (no post-cursor stream) but produces noisy mid-statement suggestions: a keyword like `FROM` is "expected" after `select * | , b from tbl`, but actually inserting it would yield `select * FROM , b from tbl` — broken.

`probe::probe_suffix_batch(symbols, feed_id, prefix, candidates, replace_target)` complements LAC for keyword scoring.
For each candidate keyword `K`, it restores the prefix snapshot into a fresh parser, feeds `K` (either replacing the typed token or inserting before the next real token, depending on cursor relative position), and continues consuming real post-cursor tokens until shift fails or accept happens.
The result captures three signals:

- `k1_compatible` — the next real post-cursor token shifts cleanly after `K`.
- `depth_consumed` — how many real post-cursor tokens were shifted before erroring.
- `reached_eof` — parsing accepted the suffix.

The completion engine threads these into scoring via three `CandidateTag` flags: `SUFFIX_INCOMPATIBLE` (penalty), `SUFFIX_DEPTH_ONE` / `SUFFIX_DEPTH_MANY` (small positive bonuses).
See [core_completion_ranking.md](core_completion_ranking.md) for the magnitudes.

The probe is skipped when there is no real post-cursor token (cursor at EOF, or only the synthetic EOF token follows), and only applied to keyword candidates — identifier candidates from the name index are not probed.

`Completion::has_post_cursor_token` (computed by `compute_has_post_cursor_token`, using the same feed-point / replace-vs-insert logic) records whether a real token follows the cursor. It gates the batch probe above and — via the sequence probe below — the suffix-aware filtering of keyword continuations.

#### Sequence probe (continuations)

`probe_suffix_batch` feeds a *single* symbol per candidate. Keyword continuations need to feed *two* symbols — the candidate keyword followed by its continuation (e.g. `group` + `by`) — before letting the real suffix flow, because the continuation is what actually gets inserted. `probe::probe_suffix_sequence(symbols, feed_id, prefix, feed_symbols, replace_target)` generalizes the probe to a feed *sequence*: in replace mode only the first fed symbol stands in for the typed token, and every symbol after it is an insertion (the scanner rewinds so no real token is consumed); the `SuffixProbe` signals then describe only the real suffix shifted *after* the whole fed sequence.

This lets continuation derivation stay suffix-aware rather than blanket-gated. At the write front every continuation is kept; mid-statement, a continuation is kept only if feeding `[candidate, continuation]` leaves the actual post-cursor stream parseable (`k1_compatible || reached_eof`). So `select a from tbl gro| a` keeps `group by` (the bare `group` candidate may itself be `SUFFIX_INCOMPATIBLE`, but `group by a` parses cleanly), while `select bar as ba| from foo` drops the `into` continuation (`background into from` is broken) and `select a from tbl gro| where b = 1` drops `by` (`group by where` can't parse).

## Candidate sources

### Candidate types

Each candidate carries a coarse type used for visual identification:

| Type       | Symbol | Description                                      |
|------------|--------|--------------------------------------------------|
| KEYWORD    | SQL    | SQL keyword from the grammar                     |
| DATABASE   | DB     | Database name                                    |
| SCHEMA     | NS     | Schema name                                      |
| TABLE      | TBL    | Table name                                       |
| COLUMN     | COL    | Column name                                      |
| FUNCTION   | FN     | Function name                                    |
| IDENTITY   | ID     | Identity candidate (matches what the user typed) |
| SCRIPT     | :      | Script of the session, after the `:` of a table parameter (`script_references.md`) |

### Name-index candidates

Identifiers (tables, columns, functions, schemas, databases) come from the `NameSearchIndex` of the script and of every other entry of the catalog snapshot the script was analyzed against (`docs/design/core_analysis_catalog.md`). An index holds the names of one entry and every suffix of every name, sorted case-insensitively on the first search, so a prefix search over the suffixes finds substring matches.
The search walks the index with a case-insensitive prefix of the text under the cursor.
These candidates receive a base score from the strategy-specific scoring table.

### Semantic scope candidates

CTEs and script-local relations are not catalog objects, so completion also enumerates them directly
from the cursor's name scopes. In table-reference contexts, visible CTEs and preceding top-level
CTE relations are added as local table candidates. In column-reference contexts, output
columns from CTE-backed sources in `FROM` are added as local column candidates. These candidates
carry `IN_NAME_SCOPE` without requiring synthetic catalog object IDs.

Non-recursive CTE completion follows declaration order: a CTE suggests earlier siblings but not itself
or later siblings. Recursive CTEs also suggest themselves. Script-local relations are visible only to
later statements.

### Keyword candidates

Keywords enter the candidate set via `add_expected_keywords_as_candidates()`.
They are extracted from the parser state and get a +20 keyword-substring bonus (in `compute_candidate_score`) when both `EXPECTED_PARSER_SYMBOL` and `SUBSTRING_MATCH` are set, plus prevalence modifiers for common keywords.
Outside of a SELECT, `FROM` is only offered when it matches the typed text, never as a proactive suggestion.

## Dot-completion resolution

Given a name path like `a.b._`, the resolution depends on the strategy:

**TABLE_REF context:**
- 1 sealed name (`a._`): resolves `a` as either a schema name (yielding tables) or a database name (yielding schemas).
- 2 sealed names (`a.b._`): resolves `a` as database, `b` as schema, yielding tables.

**COLUMN_REF context:**
- 1 sealed name (`a._`): resolves `a` as a table alias in the current naming scope, yielding its columns.
- 2 sealed names (`a.b._`): resolves `a.b` as a qualified table, yielding columns.

The one-name alias case supports both catalog tables and CTE-backed relations, including script-local
relations. CTE column lists such as `WITH t(a, b) AS (...)` override the source query's output names.

The cursor text after the last dot acts as a prefix filter on the resolved candidates.

## Passive inline hints

When the cursor is positioned *between* symbols (whitespace after a token), the completion engine produces **passive hints** — lightweight, single-keyword suggestions shown as ghost text without requiring any user typing.

### Triggering

Passive hints activate when `scanner_location.current.relative_pos == AFTER_SYMBOL` (cursor is in whitespace after a token), or at `BEFORE_SYMBOL` with no previous symbol (the very beginning of the script).

### Suppression

Certain tokens suppress passive hints entirely because the user is about to type an identifier or expression, not a keyword:

| Token | Reason |
|-------|--------|
| `SELECT` | User will type column expressions |
| `FROM` | User will type a table name |
| `JOIN` | User will type a table name |
| `WHERE` | User will type a filter expression |
| `ON` | User will type a join condition |
| `AND` | User will type an expression |
| `OR` | User will type an expression |
| `BY` | User will type a column reference |

When the previous token is in this list, no passive hint is shown.
This is the sole mechanism for controlling passive hint visibility — keyword prevalence scoring naturally ensures that high-value keywords (FROM, WHERE, etc.) outrank noise when hints are not suppressed.

### Visual behavior

Passive hints suppress the control widget (the Tab key icon) — they appear as faint ghost text only.
Accepting a passive hint is not interactive; the user simply starts typing the suggested keyword or ignores it.

## Promotion passes

After initial candidate collection, two promotion passes tag candidates with additional context:

1. **promote_tables_and_peers_for_unresolved_columns** — If the current statement has unresolved column references, tables containing those columns get `RESOLVING_TABLE` (+5). Sibling columns of unresolved ones get `UNRESOLVED_PEER` (+1).

2. **promote_identifiers_in_scope** — Walks the cursor's naming scopes (innermost first) and tags the columns of resolved catalog tables and of resolved column references with `IN_NAME_SCOPE` (+10). It does not run between symbols.

## Scoring and ranking

See [core_completion_ranking.md](core_completion_ranking.md) for the full scoring system.

In brief: each candidate accumulates `CandidateTag` flags during collection and promotion passes.
The final score of a name is its base score plus the tag modifiers of its catalog objects.
Ties are broken lexicographically (case-insensitive, smaller name wins).

## Top-k selection and qualification

`select_top_candidates()` extracts the top-k candidates from the scored heap.
`qualify_top_candidates()` derives qualified names for the winners (e.g. `schema.table` instead of just `table`) when the catalog object prefers qualification.

## Keyword continuations

When a keyword candidate is selected, the engine computes a *continuation* — the most likely keyword that follows it.
For example, `group` gets continuation `by`, `order` gets `by`, `inner` gets `join`.

`derive_keyword_continuations` runs `probe::parse_until_after` to simulate feeding the candidate keyword and inspecting what the grammar expects next.
The `find_continuation` heuristic picks a continuation when:
- Exactly one keyword/operator is expected after the feed, OR
- One keyword has a uniquely highest `keyword_continuation_score` (a hardcoded priority for keywords like BY, AS, ON, TABLE, SET).

When many unreserved keywords are expected (because IDENT is valid and all unreserved keywords can serve as identifiers), the continuation score disambiguates: only a keyword with a uniquely highest score is selected. Keywords that follow their predecessor in nearly all contexts (such as BY after GROUP/ORDER) have score 10; context-specific continuations (ASC, DESC, NULLS, etc.) have score 6; everything else has 0.

Identifier candidates also receive a continuation: the engine feeds `IDENT` once and finds the best keyword continuation for the generic identifier case (e.g. identifiers in CTE position get `as`).

A chosen continuation is then validated against the post-cursor stream. At the write front it is always kept; mid-statement, `derive_keyword_continuations` runs the [sequence probe](#sequence-probe-continuations) on `[candidate, continuation]` and keeps the continuation only if the real suffix still parses. This drops continuations that would collide with trailing text (e.g. `into` before `from`, or a `by` that a reserved `where` follows) while keeping valid mid-statement ones. Note the probe uses the parser's k=1 test, so an unreserved keyword that follows (e.g. a column literally named `by`) leaves the continuation compatible.

The frontend renders the continuation as additional ghost text after the candidate insertion (e.g. typing `gro` shows `group by` as the inline hint).

## Multi-step completion

A completion can progress through candidate selection and catalog-object qualification, each activated by a keypress.

### Completion status progression

```
AVAILABLE → SELECTED_CANDIDATE → SELECTED_CATALOG_OBJECT
```

### Step 1: Candidate selection (Tab)

The user sees inline hints showing the top candidate's text diff.
Pressing **Tab** applies the candidate patch — replacing the target text with the candidate's completion text.
The status advances to `SELECTED_CANDIDATE`.

### Step 2: Catalog object qualification (Tab)

If the selected candidate has multiple catalog objects (e.g. a column name that exists in multiple tables), the user can cycle through them with **Left/Right arrows** while in `AVAILABLE` status.

After accepting a candidate, if the winning catalog object prefers qualification (e.g. `schema.table` instead of just `table`), **Tab** applies the qualification patch — inserting the prefix/suffix around the already-inserted name.
The status advances to `SELECTED_CATALOG_OBJECT`.

A table of a database other than the default one (`shouldAutoQualifyNonDefaultTable`) skips the second step: the first **Tab** applies the candidate and the qualification patch together and advances straight to `SELECTED_CATALOG_OBJECT`.

### Keyboard bindings

| Key        | AVAILABLE state                | SELECTED_CANDIDATE          | SELECTED_CATALOG_OBJECT     |
|------------|-------------------------------|-----------------------------|-----------------------------|
| Enter      | Insert newline                 | Insert newline              | Insert newline              |
| Tab        | Accept candidate (+ continue) | Apply qualification         | —                           |
| Arrow Up   | Previous candidate            | —                           | —                           |
| Arrow Down | Next candidate                | —                           | —                           |
| Arrow Left | Previous catalog object       | —                           | —                           |
| Arrow Right| Next catalog object           | —                           | —                           |
| Escape     | Dismiss completion            | —                           | —                           |

### Visual hints

The editor renders inline decorations for pending patches:
- **Candidate hints** — ghost text showing what Tab will insert or delete.
- **Catalog object hints** — ghost text showing the qualification prefix/suffix that the next Tab will add.

At a zero-length completion target, the editor and shell show only the best candidate as an inline hint. The candidate list appears after the user enters the first character of the prefix.

Each hint category has a distinct visual style (color-coded CSS classes) and a Tab key icon widget.

## Selection effects

The steps after the completion are frontend-only; the core is not called again.
Accepting a candidate dispatches `DashQLCompletionSelectCandidateEffect` (`dashql_processor.ts`): the processor sets the status to `SELECTED_CANDIDATE` and recomputes the patches on the new text with `computePatches(..., UpdatePatchStartingFrom.CatalogObject)`, so only the qualification patch of the chosen catalog object remains.
Applying the qualification dispatches `DashQLCompletionSelectCatalogObjectEffect`, which sets the status to `SELECTED_CATALOG_OBJECT` and clears the patches.
Both effects reset the completion if the selected candidate or catalog object index is no longer valid.

## Frontend rendering

The TypeScript layer is split into four CodeMirror plugins:

| Plugin                         | Role                                                        |
|--------------------------------|-------------------------------------------------------------|
| `DashQLProcessorPlugin`        | State field holding completion buffer, cursor, patch state  |
| `DashQLCompletionHintPlugin`   | Renders inline ghost-text decorations from computed patches |
| `DashQLCompletionListPlugin`   | Virtualized dropdown list of candidates (no React)          |
| `DashQLCompletionListenerPlugin` | Keyboard bindings and scroll/abort handling               |

### Patch computation

`computePatches` derives text operations (insert/delete) from the FlatBuffer completion result:
- `candidatePatch` — diff between current text at target location and the candidate's completion text.
- `catalogObjectPatch` — diff for the qualification prefix/suffix.

The `completionDiff(at, have, want)` function produces minimal patches: if `have` is a substring of `want`, it emits targeted inserts before/after; otherwise it emits a delete + insert.
