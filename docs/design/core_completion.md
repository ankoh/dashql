# Core Completion

The completion system provides context-aware suggestions as the user types SQL in the editor.
It spans two layers: a C++ core that computes and scores candidates, and a TypeScript frontend that renders inline hints and handles keyboard interaction.

## Completion strategies

The cursor's AST context determines the active strategy:

| Strategy          | When                                          | Effect on scoring                        |
|-------------------|-----------------------------------------------|------------------------------------------|
| `DEFAULT`         | No special context                            | All name types equally likely (base 20)  |
| `TABLE_REF`       | Cursor is inside a table reference            | Tables/schemas boosted, columns demoted  |
| `TABLE_REF_ALIAS` | Cursor is at a table alias position           | Skips name-index search entirely         |
| `COLUMN_REF`      | Cursor is inside a column reference           | Columns/aliases boosted, tables demoted  |

## Candidate types

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

## Candidate sources

### Name-index candidates

Identifiers (tables, columns, functions, schemas, databases) come from the `NameSearchIndex`, a suffix-indexed btree over all registered names in the catalog.
The search walks the index with a case-insensitive prefix of the text under the cursor.
These candidates receive a base score from the strategy-specific scoring table.

### Keyword candidates

Expected grammar symbols at the cursor position are extracted by `Parser::ParseUntil`, which runs the parser up to the cursor's symbol and collects all valid next tokens.
Keywords bypass the candidate registration and enter the result heap directly.
They receive an `EXPECTED_KEYWORD_MATCH` modifier (+20) when matching the user's input, plus a prevalence modifier for common keywords (e.g. `SELECT` +3, `AS` +2).

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

## Dot-completion resolution

Given a name path like `a.b._`, the resolution depends on the strategy:

**TABLE_REF context:**
- 1 sealed name (`a._`): resolves `a` as either a schema name (yielding tables) or a database name (yielding schemas).
- 2 sealed names (`a.b._`): resolves `a` as database, `b` as schema, yielding tables.

**COLUMN_REF context:**
- 1 sealed name (`a._`): resolves `a` as a table alias in the current naming scope, yielding its columns.
- 2 sealed names (`a.b._`): resolves `a.b` as a qualified table, yielding columns.

The cursor text after the last dot acts as a prefix filter on the resolved candidates.

## Scoring and ranking

See [completion_ranking.md](completion_ranking.md) for the full scoring system.

In brief: each candidate accumulates `CandidateTag` flags during collection and promotion passes.
The final score is `base_score + sum(tag_modifiers)`.
Ties are broken lexicographically (case-insensitive, smaller name wins).

## Promotion passes

After initial candidate collection, three promotion passes tag candidates with additional context:

1. **PromoteTablesAndPeersForUnresolvedColumns** — If the current statement has unresolved column references, tables containing those columns get `RESOLVING_TABLE` (+5). Sibling columns of unresolved ones get `UNRESOLVED_PEER` (+1).

2. **PromoteIdentifiersInScope** — Walks the cursor's naming scopes (innermost first) and tags reachable candidates with `IN_NAME_SCOPE` (+10).

3. **PromoteIdentifiersInScripts** — Uses the script registry to find candidates referenced in the same statement, same script, or other scripts. Tags with `IN_SAME_STATEMENT` (+1), `IN_SAME_SCRIPT` (+1), `IN_OTHER_SCRIPT` (+1).

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

## Script registry integration

The `ScriptRegistry` indexes computations and filters across all analyzed scripts.
It is orthogonal to the catalog: the catalog stores identifiers, the registry stores how those identifiers are *used*.

### What it indexes

- **Column filters** — WHERE-clause predicates referencing a specific column (e.g. `WHERE status = 'active'`).
- **Column computations** — expressions that transform a column (e.g. `DATE_TRUNC('month', created_at)`).

Both are indexed by `QualifiedCatalogObjectID` (database + schema + table + column) in btree sets for prefix search.

### How it participates in completion

1. **Promotion** (`PromoteIdentifiersInScripts`): The registry tells the scoring system which candidates appear in other scripts, boosting their rank with `IN_SAME_SCRIPT` / `IN_OTHER_SCRIPT` tags.

2. **Snippets** (`FindIdentifierSnippetsForTopCandidates`): After top-k selection, the engine queries the registry for filter and computation snippets associated with each winning catalog object. These become the templates offered in step 3.

### Lazy cleanup

The registry uses lazy invalidation: when a script is modified, stale entries are cleaned up on the next lookup rather than eagerly.
This means the btree may temporarily contain references to outdated script analyses, but false positives are harmless — they are detected and removed when accessed.

## Compute pipeline summary

```
Completion::Compute(cursor, k, registry)
│
├─ Validate cursor has scanner location
├─ Select target symbol (current vs. previous)
├─ Detect dot-completion context
├─ Skip non-completable symbols (constants, operators, punctuation)
├─ Parser::ParseUntil() → expected symbols, expects_identifier
├─ Detect definition position (AST attribute keys)
│
├─ [dot-completion]
│  └─ FindCandidatesForNamePath()
│
├─ [normal completion]
│  ├─ AddExpectedKeywordsAsCandidates()
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
