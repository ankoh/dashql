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
│  (complete_client_function_call, see client_functions.md)
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
├─ describe_top_candidates()       → derive what a list shows about their objects (not between symbols)
│
├─ derive_keyword_continuations(prefix snapshot)
│   └─ probe::probe_suffix_sequence() — keep continuation if suffix still parses (mid-statement)
│
├─ keep_text_after_cursor()         → a candidate replaces the word only if it contains its text after the cursor
│
├─ find_syntax_error()             → the first syntax error before the word in the statement of the cursor
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
- **statement_id / ast_node_id / ast_path_to_root** — structural position in the AST. The cursor descends into the child that begins last among those that contain the offset or end at it, since children may overlap: the inputs of a join span its condition, the kind of a MERGE WHEN clause spans the clause.
- A column ref is an `OBJECT_SQL_COLUMN_REF` node, or any node that the analyzer registered a column ref expression on, like the `NAME` of a column that UPDATE or MERGE writes.
- **name_scopes** — the stack of naming scopes reachable from the cursor, innermost first.

### Target symbol selection

The completion engine picks a *target symbol* — the symbol whose text the user is currently typing:

1. If the cursor is **inside** a symbol, that symbol is the target.
2. If the cursor is **between** two symbols (e.g. right after a comma), it checks whether the previous symbol ends exactly at the cursor. If so, the previous symbol becomes the target.
3. Constants, operators, and punctuation are never completed — if the cursor lands on one, the engine falls back to the previous symbol or returns empty.
   At the begin of such a symbol, `sum(t.|)` or `sum(t.c|)`, the symbol that ends at the cursor becomes the target before the dot detection, with its own predecessor, so that a dot before it still counts.

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
A keyword after a dot and whitespace continues the name, so `update sch. set a = 1` reads `sch.set`: a name that begins after the cursor is no part of the completion, the candidates are inserted at the cursor and the name stays.
An `AliasDot` has no name path node: its one sealed name is the scanner symbol before the dot (`ScriptCursor::dot_qualifier`), folded like the names of the scopes (`O.` is `o`, `"O".` stays `O`), and it is resolved like the one sealed name of a column ref.

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
While the parser recovers from a syntax error, fewer than three tokens shifted since the error, it drops the tokens that
don't fit, and the expected symbols after the recovery are no guide: `select (a from foo where b` expects only what
follows an expression at `b`. The snapshot records that (`PrefixSnapshot::recovering`), and a name or a keyword at the
cursor then searches the name indexes as if a name were expected.
Keywords bypass the candidate registration and enter the result heap directly.
They receive a +17 keyword-substring bonus when both `EXPECTED_PARSER_SYMBOL` and `SUBSTRING_MATCH` are set on the candidate, plus a prevalence modifier for common keywords (e.g. `SELECT` +4, `AS` +2).

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

`probe_suffix_batch` feeds a *single* symbol per candidate. Keyword continuations need to feed *two* symbols — the candidate keyword followed by its continuation (e.g. `group` + `by`) — before letting the real suffix flow, because the continuation is what actually gets inserted. `probe::probe_suffix_sequence(symbols, target, prefix, feed, replace_target)` generalizes the probe to a feed *sequence*: in replace mode only the first fed symbol stands in for the typed token, and every symbol after it is an insertion (the scanner rewinds so no real token is consumed); the `SuffixProbe` signals then describe only the real suffix shifted *after* the whole fed sequence.

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
| ATTACHMENT | :      | Attachment of the session, after the `:` of a table parameter (`script_references.md`) |
| OPTION     | OPT    | Option or attribute of a client function (`client_functions.md`) |

The type comes from the catalog object of a candidate, the selected one on the selected row. A candidate without objects has only its name tags: the candidates of a client function call carry `SCHEMA_NAME`, `FUNCTION_NAME` or `OPTION_NAME`, the names of the script (CTEs and aliases, derived and output columns) `TABLE_NAME`, `TABLE_ALIAS` or `COLUMN_NAME`, and everything else is a keyword. The fields of `@vis` tags have no name tags and show as keywords.

### Name-index candidates

Identifiers (tables, columns, functions, schemas, databases) come from the `NameSearchIndex` of the script and of every other entry of the catalog snapshot the script was analyzed against (`docs/design/core_analysis_catalog.md`). An index holds the names of one entry and every suffix of every name, sorted case-insensitively on the first search, so a prefix search over the suffixes finds substring matches.
The search walks the index with a case-insensitive prefix of the text under the cursor.
These candidates receive a base score from the strategy-specific scoring table.

### Semantic scope candidates

CTEs and script-local relations are not catalog objects, so completion also enumerates them directly
from the cursor's name scopes. In table-reference contexts, visible CTEs and preceding top-level
CTE relations are added as local table candidates. In column-reference contexts, output
columns from CTE-backed and derived sources in `FROM` that the cursor sees are added as local column candidates:
a derived table sees neither itself nor the FROM items of its query, unless it is LATERAL. These candidates
carry `IN_NAME_SCOPE` without requiring synthetic catalog object IDs.

The name index of the script holds a CTE name too, tagged as a table by its references. A CTE is a table only in its scope, so the name of a CTE that is no table of the script loses that tag; elsewhere in the script it stays a plain name of the index without the base score of a table.

A column ref in ORDER BY or GROUP BY of a SELECT also sees the output columns of its scope, as name resolution does (`output_names_at`): `select a as total from t order by tot` offers `total` as a local column candidate with `IN_NAME_SCOPE`, after a set operation too. An output column with the name of a catalog column keeps the objects of that name.

Non-recursive CTE completion follows declaration order: a CTE suggests earlier siblings but not itself
or later siblings. Recursive CTEs also suggest themselves. Script-local relations are visible only to
later statements.

### Keyword candidates

Keywords enter the candidate set via `add_expected_keywords_as_candidates()`.
They are extracted from the parser state and get a +17 keyword-substring bonus (in `compute_candidate_score`) when both `EXPECTED_PARSER_SYMBOL` and `SUBSTRING_MATCH` are set, plus prevalence modifiers for common keywords.
Outside of a SELECT, `FROM` is only offered when it matches the typed text, never as a proactive suggestion.
The name of a parameter, right after its colon (`:fo`), takes no keyword that the grammar takes only as a name there (`probe::takes_keyword_only_as_name`, see the passive hints), which is every keyword after the colon.

The scanner replaces some keywords with lookahead tokens by the token after them, e.g. `NULLS` before `FIRST` or `LAST` becomes `NULLS_LA` (`core_parser.md`). An expected lookahead token is offered as its keyword (`Keyword::of_lookahead_token`), once, and not if the keyword itself is expected too. At the cursor the next token is often not typed yet: when the probes read a keyword that does not fit but one of its lookahead tokens does, they take the lookahead token, so `order by a nulls ` expects `first` and `last`. The keyword right before the cursor counts with each of its lookahead tokens that fits, since the token typed at the cursor decides which one the scanner reads: `where a not ` expects `null`, and as NOT_LA `between`, `in`, `like`, `ilike`, `glob` and `similar` (`PrefixSnapshot::alternatives`). The suffix probes feed a keyword to the state stack that takes it. The continuation of a keyword candidate looks at the keyword and its lookahead tokens alike, `not` has none since NOT and NOT_LA continue differently (`probe::expected_after_keyword`).

## Dot-completion resolution

Given a name path like `a.b._`, the resolution depends on the strategy:

**TABLE_REF context:**
- 1 sealed name (`a._`): resolves `a` as either a schema name (yielding tables) or a database name (yielding schemas).
- 2 sealed names (`a.b._`): resolves `a` as database, `b` as schema, yielding tables.

**COLUMN_REF context:**
- 1 sealed name (`a._`): resolves `a` as a table alias in the current naming scope, yielding its columns.
- 2 sealed names (`a.b._`): resolves `a.b` as a qualified table, yielding columns. It names the FROM item of a table without alias, with the schema of its table ref, as name resolution reads `a.b.c`; 3 sealed names (`d.a.b._`) add the database.

The one-name alias case supports both catalog tables and CTE-backed relations, including script-local
relations. CTE column lists such as `WITH t(a, b) AS (...)` override the source query's output names. It reads what
the analyzer publishes on the scopes: an aliased join, `(t join u using (a)) as j`, is a `ScopeJoin` with its columns,
so `j._` yields the columns of the join with a `USING` column once, renamed by the column aliases of the join. Outside
of the join, `NameScope::hiding_joins` hides the FROM items inside it, `t._` yields nothing, as in name resolution.

The cursor text after the last dot filters the resolved candidates, of the catalog and of the name scopes alike: a candidate must contain it, and one that begins with it ranks first.

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

A passive hint is also never a keyword that the grammar expects only as a name: where an identifier fits, every unreserved keyword fits as well, `where a = by` reads a column `by`. `probe::takes_keyword_only_as_name` feeds the keyword to the prefix snapshot and checks the state after it: if it shifts nothing and only reduces the keyword to a name (the keyword list rules of the grammar), the keyword is no hint. So `where a = ` hints `case` and `cast` but not `by`, `like` or `set`, while `update t ` keeps `set`, which there both starts the SET clause and could be an alias.
Otherwise keyword prevalence scoring ensures that high-value keywords (FROM, WHERE, etc.) outrank noise.

### Visual behavior

Passive hints suppress the control widget (the Tab key icon) — they appear as faint ghost text only.
Accepting a passive hint is not interactive; the user simply starts typing the suggested keyword or ignores it.

## Promotion passes

After initial candidate collection, two promotion passes tag candidates with additional context:

1. **promote_tables_and_peers_for_unresolved_columns** — If the current statement has unresolved column references, tables containing those columns get `RESOLVING_TABLE` (+5). Sibling columns of unresolved ones get `UNRESOLVED_PEER` (+1).

2. **promote_identifiers_in_scope** — Walks the cursor's naming scopes (innermost first) and tags the columns of resolved catalog tables and of resolved column references with `IN_NAME_SCOPE` (+10). It does not run between symbols. A resolved column ref promotes its column only if the cursor sees its FROM item. The scopes see the FROM items that name resolution gives the column refs at the cursor: a clause of the innermost scope that name resolution publishes can restrict them (`NameScope::visibility_at`), a `WHEN NOT MATCHED` clause of MERGE sees the source only and a `WHEN NOT MATCHED BY SOURCE` clause the target only, the FROM items of UPDATE, the USING items of DELETE and the source of MERGE see no target, and RETURNING of INSERT sees no `excluded`, for the alias of a `a._` too.

## Scoring and ranking

See [core_completion_ranking.md](core_completion_ranking.md) for the full scoring system.

In brief: each candidate accumulates `CandidateTag` flags during collection and promotion passes.
The final score of a name is its base score plus the tag modifiers of its catalog objects.
Ties are broken lexicographically (case-insensitive, smaller name wins).

## Top-k selection and qualification

`select_top_candidates()` extracts the top-k candidates from the scored heap.
`qualify_top_candidates()` derives qualified names for the winners (e.g. `schema.table` instead of just `table`) when the catalog object prefers qualification.
A column of a FROM item that the cursor sees is qualified with the name of the FROM item, the alias of its table ref or the qualified name of a table without alias, with the name that the column aliases of the FROM item give it (`x.p` in `from t as x(p, q)`). Outside of an aliased join, the alias of the join qualifies the columns of the FROM items inside it, `j.a` instead of `t.a`, with the name that the column aliases of the join give it. The FROM items that the cursor doesn't see qualify nothing, the target of MERGE in a `WHEN NOT MATCHED` clause. A table that several FROM items of the innermost scope read, a self-join `from t l join t r`, gives a column a catalog object for each of them, `l.name` and `r.name`, that prefer the qualified name, also the target and `excluded` in the values of ON CONFLICT DO UPDATE, `t.name` and `excluded.name`; after a dot, the FROM item or the aliased join that the qualifier names qualifies the columns, `r.a` after `r.` and `j.c` after `j.` in a subquery that reads `u` itself, `(select j. from u) from (t join u using (a)) as j`. `excluded.id` after `excluded.` in ON CONFLICT DO UPDATE.

The column list of an INSERT, also of the INSERT of a MERGE, takes bare names only: its columns never prefer the qualified name, `insert into t as x (na` offers `name` and not `x.name`.

## The text that a candidate replaces

A candidate replaces its target, the symbol at the cursor or the name after a dot (`target_location`), and the whole
name path with its qualification (`target_location_qualified`). The candidates match the text before the cursor, but the
target reaches to the end of the word. A candidate never drops text that the user typed after the cursor
(`keep_text_after_cursor`, the last step of `Completion::compute`): with the cursor inside the target, a candidate
replaces all of it only if it contains the text after the cursor, case-insensitively and without a closing quote. So
`sel|ct` becomes `select`. Otherwise both spans end at the cursor and the rest of the word stays: `my|orders` becomes
`my_tableorders` with `my_table`, not `my_table`, and the hint shows that before Tab. Its keyword continuation would land
between the candidate and the rest, so such a candidate has none. A cursor at the begin or the end of the target keeps
the whole target, at the begin the candidates match the whole word. The editor and the shell apply the spans as they
are.

## The syntax error of a completion

The parser recovers from a syntax error by dropping tokens or the whole statement (see "Error recovery" in
[core_parser.md](core_parser.md)), so the candidates after an error can miss what the statement would offer: the cursor
has no context, the tables of the statement aren't in scope, or the expected symbols are those of the recovery. A
completion names the error that explains it (`Completion::syntax_error`, `completion_syntax_error.rs`): the first scanner
or parser error before the word at the cursor in the statement of the cursor, with its line, message and hint. The
statement begins after the last `;` before the word, an error in an earlier statement doesn't matter since the next
statement always survives the recovery. An error at the word at the cursor or after it is the text being typed,
`where a = 1 gr|`, and so is an error at a keyword right before the word whose lookahead token the word picks,
`nulls fi|` (NULLS becomes NULLS_LA only before FIRST or LAST). The packed completion carries it as `syntax_error`, its
span in the offsets of the candidates. The snapshots write it as `syntax-error`, `tests/snapshots/completion/syntax_errors.tpl.yaml`
has the cases.

## Candidate info

`CandidateInfo` is what the pane of a list shows about a candidate:

- `detail` is one line: a signature, a type or a table.
- `description` is prose for the selected candidate. It can have inline Markdown: code, bold and links.
- `parameters` is a table of what the candidate takes, with a name, a type and prose for each entry.
- `result_description` tells what a result holds, in prose.
- `columns` is a table of the columns of a result or a table.
- `example` is a call that shows how to write it.
- `facts` are short labels and values.

The core formats all of it, so that snapshots cover the text and the app has no rules of its own. Only the top candidates get an info, and scoring doesn't read it. A catalog object has its own info, so that it follows the object that the arrows select. A candidate without objects has it on the candidate.

| Candidate | `detail` | `description` |
|---|---|---|
| Function | `(a INT, b TEXT) → INT`, with `· aggregate` for an aggregate | None yet |
| Function declared as `name()` returning `any` | None, or `aggregate` | None yet |
| Table | `12 columns`, or `view · 12 columns` | None |
| Column | Its type and table, such as `bigint · orders` | None |
| Client function call | From the spec, see `client_functions.md` | From the spec |

`columns` holds the result of a client function and the columns of a table. A client function's signature lists the options of its spec, and `?` marks an optional one. In the pane it's clamped to three lines above a table with the same parameters. Only client function calls fill the parameters and the example so far. A catalog function's signature is its detail in the pane, and enrichment can fill the same fields through `describe_function`.

Everything known about a catalog function goes through `describe_function`. A function without parameters that returns `any` is one whose signature is unknown: the catalog file of the bundled functions declares all of them like that, and the functions of `pg_proc` whose signature DashQL doesn't model. A table lists up to 200 of its columns as they are written, with the types of a `CREATE TABLE`. Other tables, such as views and table parameters, only know the names. A connection's catalog script writes each type as a quoted name, such as `"id" "bigint"`, since a backend can name types that aren't SQL. The text stays as it is, only in lower case.

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
The status advances to `SELECTED_CANDIDATE`. The list closes until the next input, and only the hint of the next step remains.

### Step 2: Catalog object qualification (Tab)

If the selected candidate has multiple catalog objects (e.g. a column name that exists in multiple tables), the user can cycle through them with **Left/Right arrows** while in `AVAILABLE` status.

After accepting a candidate, if the winning catalog object prefers qualification (e.g. `schema.table` instead of just `table`), **Tab** applies the qualification patch — inserting the prefix/suffix around the already-inserted name.
The status advances to `SELECTED_CATALOG_OBJECT`.

A table of a database other than the default one (`shouldAutoQualifyNonDefaultTable`) skips the second step: the first **Tab** applies the candidate and the qualification patch together and advances straight to `SELECTED_CATALOG_OBJECT`.

### Keyboard bindings

| Key        | AVAILABLE state                | SELECTED_CANDIDATE          | SELECTED_CATALOG_OBJECT     |
|------------|-------------------------------|-----------------------------|-----------------------------|
| Enter      | Insert newline, or accept the candidate after Up, Down, Left, Right, Ctrl-N or Ctrl-P | Insert newline | Insert newline |
| Tab        | Accept candidate (+ continue) | Apply qualification         | —                           |
| Arrow Up, Ctrl-P | Previous candidate      | —                           | —                           |
| Arrow Down, Ctrl-N | Next candidate        | —                           | —                           |
| Arrow Left | Previous catalog object       | —                           | —                           |
| Arrow Right| Next catalog object           | —                           | —                           |
| Escape     | Dismiss completion            | —                           | —                           |

Enter stays with the editor, a newline in a script and the submit of a prompt, until the user steps through the list:
a word typed in full at the end of a line would otherwise take the top candidate. A step marks the completion as
`navigated`, then Enter accepts the selected candidate like Tab, also one without a patch, and the next Enter is a
newline again. Typing starts a new completion that isn't navigated. Ctrl-N and Ctrl-P are Ctrl on macOS too; Chrome on
Linux and Windows keeps Ctrl-N for a new window, the desktop app passes it on.

A click or a tap on an entry of the list selects it and accepts it like Tab (`DashQLCompletionPickCandidateEffect`),
an entry typed out already closes the list. The arrows of an entry step through its catalog objects without accepting
it. The list keeps the focus in the editor, so the keyboard of a touch screen stays open, and its entries are taller on
a touch screen.

### Visual hints

The editor renders inline decorations for pending patches:
- **Candidate hints** — ghost text showing what Tab will insert or delete.
- **Catalog object hints** — ghost text showing the qualification prefix/suffix that the next Tab will add.

At a zero-length completion target, the editor and shell show only the best candidate as an inline hint. The candidate list appears after the user enters the first character of the prefix. Right after a dot both open the list at once, and the editor also opens it at the names of a client function call (`client_function_name`).

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
| `DashQLCompletionListPlugin`   | Dropdown list of candidates and a side pane (no React)      |
| `DashQLCompletionListenerPlugin` | Keyboard bindings and scroll/abort handling               |

### The list

A row shows the type and the name. The pane next to the list shows what is known about the selected candidate, its [info](#candidate-info): a header with the detail and the description, then sections for the parameters, the result or columns, the example and the facts. It scrolls on its own, and a section keeps its title in view. A table is an overview with one row per entry: its name, its type and one line of its prose. The pane is up to 520px wide and gives way to a narrow window first, then hides. A candidate without an info, such as a keyword, has no pane.

A description is rendered through text nodes, with `code` and `strong` elements for its inline Markdown. A link shows its label and can't be clicked, since a click must not leave the editor. A click anywhere in the list keeps the focus in the editor, because a blur ends the completion.

The list is as wide as its content. If that doesn't fit the window, the pane goes first, then the list moves left from the cursor.

The list starts at the target where it is without the hints (`CompletionList.computeAnchor`). A hint can insert text
in front of the target, `my_` before `ord` for `my_orders` or the qualification `db0.public.`, which moves the target to
the right by another width for every candidate. The list takes the right edge of the character before the hints, or the
start of the line, plus the text of the user between the qualification and the target, so it doesn't move with them.

A completion with a [syntax error](#the-syntax-error-of-a-completion) shows it above the candidates: `Line 2:` with the
message, and the hint below it. It stays in view while the list scrolls and wraps at 360px instead of widening the list.
A completion without candidates shows no list, so it shows no error either; the diagnostics of the editor show it.

The view lives in `workbook/editor/completion/completion_list_view.ts` and knows nothing about its host.

### The list in the shell

The prompt of the shell is a CodeMirror editor with a script session on the catalog of the shell, it completes like the
editors of the workbook. Only a dot command gets no SQL assistance, Tab completes its name, see
`packages/dashql-core-shell/SHELL.md`.

### Patch computation

`computePatches` derives text operations (insert/delete) from the FlatBuffer completion result:
- `candidatePatch` — diff between current text at target location and the candidate's completion text.
- `catalogObjectPatch` — diff for the qualification prefix/suffix.

The `completionDiff(at, have, want)` function produces minimal patches: if `have` is a substring of `want`, it emits targeted inserts before/after; otherwise it emits a delete + insert.
