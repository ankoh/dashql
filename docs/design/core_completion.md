# Core Completion

The completion system provides context-aware suggestions as the user types SQL in the editor.
It spans two layers: a C++ core that computes and scores candidates, and a TypeScript frontend that renders inline hints and handles keyboard interaction.

## Compute pipeline summary

```
Completion::Compute(cursor, k, registry)
│
├─ Validate cursor has scanner location
├─ Select target symbol (current vs. previous)
├─ Detect dot-completion context
├─ Skip non-completable symbols (constants, operators, punctuation)
├─ Parser::ParseUntilWithSnapshot() → expected symbols + LALR state snapshot
├─ Detect definition position (AST attribute keys)
│
├─ [dot-completion]
│  └─ FindCandidatesForNamePath()
│
├─ [between symbols — passive hints]
│  ├─ Check suppressPassiveHint() → return empty if suppressed
│  └─ AddExpectedKeywordsAsCandidates(prefix snapshot) (keywords only)
│
├─ [normal completion]
│  ├─ AddExpectedKeywordsAsCandidates(prefix snapshot)
│  │   └─ ProbeSuffixBatchFromSnapshot() — replay suffix per candidate (mid-statement only)
│  ├─ Insert identity candidate (score varies by context)
│  └─ FindCandidatesInIndexes()   (if expects_identifier && !at_definition)
│     └─ PromoteTablesAndPeersForUnresolvedColumns()
│
├─ PromoteIdentifiersInScope()
├─ PromoteIdentifiersInScripts(registry)
├─ SelectTopCandidates()          → top-k heap
├─ QualifyTopCandidates()         → derive qualified names
│
├─ [if identifier context && !at_definition]
│  ├─ FindIdentifierSnippetsForTopCandidates(registry)
│  └─ DeriveKeywordSnippetsForTopCandidates()
│
└─ Pack() → FlatBuffer result to frontend
```

The sections below walk through each stage of this pipeline.

## Cursor interaction

### ScriptCursor

The `ScriptCursor` is the bridge between the editor and the completion engine.
It encodes:

- **text_offset** — the byte position of the cursor in the script text.
- **scanner_location** — resolved to the current and previous scanner symbols, including the cursor's relative position within a symbol (begin, mid, end, before, after).
- **context** — a variant of `TableRefContext`, `ColumnRefContext`, or `monostate`, determined by the AST node the cursor sits inside.
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

`ScriptCursor::ReadCursorNamePath` reads the sequence of name components around the cursor (e.g. `schema.table.col`).
Each component is classified as `Name`, `Star`, `TrailingDot`, or `Index`.
The engine determines how many components are *sealed* (fully typed, before a dot) and uses the sealed prefix to resolve the dot context.

## Completion strategies

The cursor's AST context determines the active strategy:

| Strategy          | When                                          | Effect on scoring                        |
|-------------------|-----------------------------------------------|------------------------------------------|
| `DEFAULT`         | No special context                            | All name types equally likely (base 20)  |
| `TABLE_REF`       | Cursor is inside a table reference            | Tables/schemas boosted, columns demoted  |
| `TABLE_REF_ALIAS` | Cursor is at a table alias position           | Skips name-index search entirely         |
| `COLUMN_REF`      | Cursor is inside a column reference           | Columns/aliases boosted, tables demoted  |

## Expected symbols (ParseUntilWithSnapshot)

Expected grammar symbols at the cursor position are extracted by `Parser::ParseUntilWithSnapshot`, which runs the parser up to the cursor's symbol and collects all valid next tokens via Bison's LAC (look-ahead correction).
The same call also returns a `PrefixSnapshot` of the LALR state stack (state numbers only — reduction actions are no-ops in this skeleton, so semantic values aren't needed); the suffix probe reuses that snapshot to avoid re-parsing the prefix.
Keywords bypass the candidate registration and enter the result heap directly.
They receive a +20 keyword-substring bonus when both `EXPECTED_PARSER_SYMBOL` and `SUBSTRING_MATCH` are set on the candidate, plus a prevalence modifier for common keywords (e.g. `SELECT` +4, `AS` +2).

### Suffix probe

LAC is one-sided: it tells you what tokens the grammar would accept at the cursor, but it ignores everything after the cursor.
This is fine at the write front (no post-cursor stream) but produces noisy mid-statement suggestions: a keyword like `FROM` is "expected" after `select * | , b from tbl`, but actually inserting it would yield `select * FROM , b from tbl` — broken.

`Parser::ProbeSuffixBatchFromSnapshot(scanned, feed_id, prefix, candidates, replace_target)` complements LAC for keyword scoring.
For each candidate keyword `K`, it restores the prefix snapshot into a fresh parser, feeds `K` (either replacing the typed token or inserting before the next real token, depending on cursor relative position), and continues consuming real post-cursor tokens until shift fails or accept happens.
The result captures three signals:

- `k1_compatible` — the next real post-cursor token shifts cleanly after `K`.
- `depth_consumed` — how many real post-cursor tokens were shifted before erroring.
- `reached_eof` — parsing accepted the suffix.

The completion engine threads these into scoring via three `CandidateTag` flags: `SUFFIX_INCOMPATIBLE` (penalty), `SUFFIX_DEPTH_ONE` / `SUFFIX_DEPTH_MANY` (small positive bonuses).
See [core_completion_ranking.md](core_completion_ranking.md) for the magnitudes.

The probe is skipped when there is no real post-cursor token (cursor at EOF, or only the synthetic EOF token follows), and only applied to keyword candidates — identifier candidates from the name index are not probed.

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

### Name-index candidates

Identifiers (tables, columns, functions, schemas, databases) come from the `NameSearchIndex`, a suffix-indexed btree over all registered names in the catalog.
The search walks the index with a case-insensitive prefix of the text under the cursor.
These candidates receive a base score from the strategy-specific scoring table.

### Keyword candidates

Keywords enter the candidate set via `AddExpectedKeywordsAsCandidates()`.
They are extracted from the parser state and get a +20 keyword-substring bonus (in `computeCandidateScore`) when both `EXPECTED_PARSER_SYMBOL` and `SUBSTRING_MATCH` are set, plus prevalence modifiers for common keywords.

## Dot-completion resolution

Given a name path like `a.b._`, the resolution depends on the strategy:

**TABLE_REF context:**
- 1 sealed name (`a._`): resolves `a` as either a schema name (yielding tables) or a database name (yielding schemas).
- 2 sealed names (`a.b._`): resolves `a` as database, `b` as schema, yielding tables.

**COLUMN_REF context:**
- 1 sealed name (`a._`): resolves `a` as a table alias in the current naming scope, yielding its columns.
- 2 sealed names (`a.b._`): resolves `a.b` as a qualified table, yielding columns.

The cursor text after the last dot acts as a prefix filter on the resolved candidates.

## Passive inline hints

When the cursor is positioned *between* symbols (whitespace after a token), the completion engine produces **passive hints** — lightweight, single-keyword suggestions shown as ghost text without requiring any user typing.

### Triggering

Passive hints activate when `scanner_location.current.relative_pos == AFTER_SYMBOL` (cursor is in whitespace after a token), or at the very beginning of a statement with no previous symbol.

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
| `VISUALISE` / `VISUALIZE` | User will type a visualization name |

When the previous token is in this list, no passive hint is shown.
This is the sole mechanism for controlling passive hint visibility — keyword prevalence scoring naturally ensures that high-value keywords (FROM, WHERE, etc.) outrank noise when hints are not suppressed.

### Visual behavior

Passive hints suppress the control widgets (Tab/Enter key icons) — they appear as faint ghost text only.
Accepting a passive hint is not interactive; the user simply starts typing the suggested keyword or ignores it.

## Promotion passes

After initial candidate collection, three promotion passes tag candidates with additional context:

1. **PromoteTablesAndPeersForUnresolvedColumns** — If the current statement has unresolved column references, tables containing those columns get `RESOLVING_TABLE` (+5). Sibling columns of unresolved ones get `UNRESOLVED_PEER` (+1).

2. **PromoteIdentifiersInScope** — Walks the cursor's naming scopes (innermost first) and tags reachable candidates with `IN_NAME_SCOPE` (+10).

3. **PromoteIdentifiersInScripts** — Uses the script registry to find candidates referenced in the same statement, same script, or other scripts. Tags with `IN_SAME_STATEMENT` (+1), `IN_SAME_SCRIPT` (+1), `IN_OTHER_SCRIPT` (+1).

## Scoring and ranking

See [core_completion_ranking.md](core_completion_ranking.md) for the full scoring system.

In brief: each candidate accumulates `CandidateTag` flags during collection and promotion passes.
The final score is `base_score + sum(tag_modifiers)`.
Ties are broken lexicographically (case-insensitive, smaller name wins).

## Top-k selection and qualification

`SelectTopCandidates()` extracts the top-k candidates from the scored heap.
`QualifyTopCandidates()` derives qualified names for the winners (e.g. `schema.table` instead of just `table`) when the catalog object prefers qualification.

## Snippets

### Script registry integration

The `ScriptRegistry` indexes computations and filters across all analyzed scripts.
It is orthogonal to the catalog: the catalog stores identifiers, the registry stores how those identifiers are *used*.

#### What it indexes

- **Column filters** — WHERE-clause predicates referencing a specific column (e.g. `WHERE status = 'active'`).
- **Column computations** — expressions that transform a column (e.g. `DATE_TRUNC('month', created_at)`).

Both are indexed by `QualifiedCatalogObjectID` (database + schema + table + column) in btree sets for prefix search.

#### How it participates in completion

1. **Promotion** (`PromoteIdentifiersInScripts`): The registry tells the scoring system which candidates appear in other scripts, boosting their rank with `IN_SAME_SCRIPT` / `IN_OTHER_SCRIPT` tags.

2. **Snippets** (`FindIdentifierSnippetsForTopCandidates`): After top-k selection, the engine queries the registry for filter and computation snippets associated with each winning catalog object. These become the templates offered in step 3 of multi-step completion.

#### Lazy cleanup

The registry uses lazy invalidation: when a script is modified, stale entries are cleaned up on the next lookup rather than eagerly.
This means the btree may temporarily contain references to outdated script analyses, but false positives are harmless — they are detected and removed when accessed.

### Keyword continuations

When a keyword candidate is selected, the engine computes a *continuation* — the most likely keyword that follows it.
For example, `group` gets continuation `by`, `order` gets `by`, `inner` gets `join`.

`DeriveKeywordSnippetsForTopCandidates` runs `Parser::ParseUntilAfter` to simulate feeding the candidate keyword and inspecting what the grammar expects next.
The `find_continuation` heuristic picks a continuation when:
- Exactly one keyword/operator is expected after the feed, OR
- One keyword has a uniquely highest `getKeywordContinuationScore` (a hardcoded priority for keywords like BY, AS, ON, TABLE, SET).

When many unreserved keywords are expected (because IDENT is valid and all unreserved keywords can serve as identifiers), the continuation score disambiguates: only a keyword with a uniquely highest score is selected. Keywords that follow their predecessor in nearly all contexts (BY after GROUP/ORDER, AS after VISUALISE ident) have score 10; context-specific continuations (ASC, DESC, NULLS, etc.) have score 6; everything else has 0.

Identifier candidates also receive a continuation: the engine feeds `IDENT` once and finds the best keyword continuation for the generic identifier case (e.g. identifiers in CTE position get `as`).

The frontend renders the continuation as additional ghost text after the candidate insertion (e.g. typing `gro` shows `group by` as the inline hint).

## Multi-step completion

A completion is not a single atomic action — it progresses through up to three steps, each activated by a keypress.

### Completion status progression

```
AVAILABLE → SELECTED_CANDIDATE → SELECTED_CATALOG_OBJECT → SELECTED_TEMPLATE
```

### Step 1: Candidate selection (Enter or Tab)

The user sees inline hints showing the top candidate's text diff.
Pressing **Enter** or **Tab** applies the candidate patch — replacing the target text with the candidate's completion text.
The status advances to `SELECTED_CANDIDATE`.

### Step 2: Catalog object qualification (Tab)

If the selected candidate has multiple catalog objects (e.g. a column name that exists in multiple tables), the user can cycle through them with **Left/Right arrows** while in `AVAILABLE` status.

After accepting a candidate, if the winning catalog object prefers qualification (e.g. `schema.table` instead of just `table`), **Tab** applies the qualification patch — inserting the prefix/suffix around the already-inserted name.
The status advances to `SELECTED_CATALOG_OBJECT`.

### Step 3: Template insertion (Tab)

If the catalog object has script templates (filters or computations found in the script registry), another **Tab** press inserts the template snippet around the qualified name.
The status advances to `SELECTED_TEMPLATE`.

For functions without templates, a default `()` snippet is inserted with the cursor placed between the parentheses.

### Keyboard bindings

| Key        | AVAILABLE state                | SELECTED_CANDIDATE          | SELECTED_CATALOG_OBJECT     |
|------------|-------------------------------|-----------------------------|-----------------------------|
| Enter      | Accept candidate              | —                           | —                           |
| Tab        | Accept candidate (+ continue) | Apply qualification         | Apply template              |
| Arrow Up   | Previous candidate            | —                           | —                           |
| Arrow Down | Next candidate                | —                           | —                           |
| Arrow Left | Previous catalog object       | —                           | —                           |
| Arrow Right| Next catalog object           | —                           | —                           |
| Escape     | Dismiss completion            | —                           | —                           |

### Visual hints

The editor renders inline decorations for pending patches:
- **Candidate hints** — ghost text showing what Enter/Tab will insert or delete.
- **Catalog object hints** — ghost text showing the qualification prefix/suffix that the next Tab will add.
- **Template hints** — ghost text showing the template snippet that the final Tab will insert.

Each hint category has a distinct visual style (color-coded CSS classes) and a key icon widget indicating which key activates it.

## SelectCandidate / SelectQualifiedCandidate

After the user accepts a candidate, the frontend calls back into the core via `SelectCandidate`.
This re-resolves the cursor's name path at the new text state to produce updated target locations for the qualification and template patches.
If the user accepted a specific catalog object (e.g. picked a particular table for an ambiguous column), `SelectQualifiedCandidate` narrows the result to that single object.

## Frontend rendering

The TypeScript layer is split into four CodeMirror plugins:

| Plugin                         | Role                                                        |
|--------------------------------|-------------------------------------------------------------|
| `DashQLProcessorPlugin`        | State field holding completion buffer, cursor, patch state  |
| `DashQLCompletionHintPlugin`   | Renders inline ghost-text decorations from computed patches |
| `DashQLCompletionListPlugin`   | Virtualized dropdown list of candidates (no React)          |
| `DashQLCompletionListenerPlugin` | Keyboard bindings and scroll/abort handling               |

### Patch computation

`computePatches` derives three arrays of text operations (insert/delete) from the FlatBuffer completion result:
- `candidatePatch` — diff between current text at target location and the candidate's completion text.
- `catalogObjectPatch` — diff for the qualification prefix/suffix.
- `templatePatch` — diff for the template snippet.

The `completionDiff(at, have, want)` function produces minimal patches: if `have` is a substring of `want`, it emits targeted inserts before/after; otherwise it emits a delete + insert.
