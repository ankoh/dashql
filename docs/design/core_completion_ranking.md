# Completion Candidate Ranking

The completion system scores candidates additively using a tag-based system.
Each candidate accumulates `CandidateTag` flags during collection, and the final score is a sum of the modifiers associated with each active tag.

## Two candidate sources

There are two fundamentally different kinds of candidates, and they enter the scoring pipeline differently:

### Name-index candidates

Identifiers (table names, column names, function names, schema names, etc.) are discovered through the `NameSearchIndex`, which holds every suffix of every registered name, sorted case-insensitively on the first search (`catalog/names.rs`).
The search walks the index with a case-insensitive prefix of the text under the cursor.

These candidates receive a **base score** determined by the completion strategy and the name's coarse analyzer tag:

| Strategy     | SCHEMA | DATABASE | TABLE | TABLE_ALIAS | COLUMN | FUNCTION |
|--------------|--------|----------|-------|-------------|--------|----------|
| DEFAULT      | 20     | 20       | 20    | 20          | 20     | 20       |
| TABLE_REF    | 20     | 20       | 20    | 10          | 10     | 10       |
| COLUMN_REF   | 10     | 10       | 10    | 20          | 20     | 10       |

The base score is the maximum across all name tags the candidate carries (a name can appear in multiple roles).

### Keyword candidates

Expected grammar symbols at the cursor position are extracted by `probe::parse_until_with_snapshot`.
Keywords have no base score from the name-scoring table.
Instead, they receive an extra +20 keyword-substring bonus when both `EXPECTED_PARSER_SYMBOL` and `SUBSTRING_MATCH` are set — i.e. the user is typing toward a keyword the grammar accepts here. This levels the playing field with name-index candidates.

Keywords also carry a prevalence tier reflecting how commonly they appear in SQL:

| Tier         | Score | Examples                                                    |
|--------------|-------|-------------------------------------------------------------|
| KEYWORD_A    | +4    | `SELECT`, `FROM`, `WHERE`                                   |
| KEYWORD_B    | +3    | `AND`, `GROUP`, `ORDER`                                     |
| KEYWORD_C    | +2    | `AS`, `BY`, `CASE`, `CAST`, `LIMIT`, `OFFSET`, `WITH`, ... |
| KEYWORD_D    | 0     | everything else                                             |

## Score modifiers

After the base score, tags contribute additive modifiers:

| Tag                                                  | Modifier | When it fires                                                |
|------------------------------------------------------|----------|--------------------------------------------------------------|
| `SUBSTRING_MATCH`                                    | +30      | User's input appears as a substring of the candidate name    |
| `EXPECTED_PARSER_SYMBOL` ∧ `SUBSTRING_MATCH` (combo) | +20      | Substring-matched expected keyword (applied on top of `SUBSTRING_MATCH`) |
| `EXACT_MATCH`                                        | +15      | User's input is exactly equal to the candidate name          |
| `IN_NAME_SCOPE`                                      | +10      | Candidate is reachable through the current naming scope      |
| `PREFIX_MATCH`                                       | +5       | User's input is a prefix of the candidate name               |
| `RESOLVING_TABLE`                                    | +5       | Table that would resolve currently unresolved column refs    |
| `KEYWORD_A`                                          | +4       | Keyword in the highest prevalence tier                       |
| `KEYWORD_B`                                          | +3       | Keyword in the second prevalence tier                        |
| `THROUGH_CATALOG`                                    | +2       | Candidate reached through the catalog (vs. local-only)       |
| `DOT_RESOLUTION_*`                                   | +2       | Candidate reached through dot-completion (schema/table/col)  |
| `KEYWORD_C`                                          | +2       | Keyword in the third prevalence tier                         |
| `UNRESOLVED_PEER`                                    | +1       | Column that shares a table with an unresolved column         |
| `SUFFIX_DEPTH_MANY`                                  | +1       | Candidate + post-cursor suffix shifts ≥2 real tokens or parses to EOF |
| `SUFFIX_DEPTH_ONE`                                   | 0        | Candidate + suffix shifts exactly 1 real post-cursor token   |
| `SUFFIX_INCOMPATIBLE`                                | -15      | Candidate shifts but the next real post-cursor token rejects it (mid-statement noise) |

The `SUFFIX_*` tags come from the suffix probe (see `core_completion.md`).
The penalty is large enough to bury an otherwise-strong keyword (e.g. `FROM` with the keyword-substring bonus +20 + `KEYWORD_A` +4 + `SUBSTRING_MATCH` +30 = 54 → 39) but not large enough to remove it from the candidate set, so users editing in a partly-broken statement still see all options.
Only `SUFFIX_DEPTH_MANY` carries a bonus today; `SUFFIX_DEPTH_ONE` is tagged but contributes zero, so single-token-suffix candidates rank with the rest of the k=1-compatible keywords.
The bonus on `MANY` is intentionally small (+1) so that legitimately-fitting keywords don't outrank substring-matching catalog identifiers.

## Final score

`select_top_candidates` scores every name candidate:

```
candidate_score = base_score + object_score
```

The object score is `compute_candidate_score(object.candidate_tags)` of the *lowest* of the candidate's top 24 catalog objects, which keep the descending order of their own scores (see the completion quirks in [core_quirks.md](core_quirks.md)).
A candidate without catalog objects, e.g. a CTE from the name scopes, uses `compute_candidate_score(candidate.candidate_tags)` instead.

Keywords skip this step: `add_expected_keywords_as_candidates` inserts them into the heap with

```
candidate_score = compute_candidate_score(candidate.candidate_tags)
```

The identity candidate enters the heap with its fixed score (see Identity candidate).

## Tiebreaking

When two candidates have the same score, the one with the lexicographically smaller name (case-insensitive) wins.
This is implemented via the min-heap comparator: lower score OR same score with larger name gets evicted first.

## Design invariants

The constants are chosen so that these relations hold; nothing in the code asserts them:

- An unlikely name that is a substring match outweighs a likely name that isn't (`10 + 30 > 20`).
- Being in scope outweighs being a prefix (`10 > 5`).
- An exact match outweighs being in scope (`15 > 10`).
- A likely catalog name with `THROUGH_CATALOG` outranks an expected keyword with substring bonus alone (`20+2 > 20`).

## Worked examples

### `select amo| from orders` with catalog tables `orders(amount)` and `amounts`

The cursor is in a column reference, so the strategy is `COLUMN_REF`. Both names are found through the catalog, and `amount` is a column of the table `orders` in scope.

| Candidate          | Base | SUBSTRING | PREFIX | THROUGH_CATALOG | IN_SCOPE | Total  |
|--------------------|------|-----------|--------|-----------------|----------|--------|
| `amount` (col)     | 20   | 30        | 5      | 2               | 10       | **67** |
| `amo` (identity)   |      |           |        |                 |          | **59** |
| `amounts` (table)  | 10   | 30        | 5      | 2               | 0        | **47** |

The in-scope column ranks first. The table ranks below the identity candidate because tables are unlikely in a column reference.

### `select * fr` with column `from_sql` in scope

| Candidate       | Base | SUBSTRING | PREFIX | KW_SUBSTRING_BONUS | KEYWORD_A | IN_SCOPE | Total |
|-----------------|------|-----------|--------|--------------------|-----------|----------|-------|
| `from` (keyword)| 0    | 30        | 5      | 20                 | 4         | 0        | **59**|
| `from_sql` (col)| 20   | 30        | 5      | 0                  | 0         | 10       | **65**|

`KW_SUBSTRING_BONUS` is the +20 combo bonus that fires when both `EXPECTED_PARSER_SYMBOL` and `SUBSTRING_MATCH` are set.
The column still wins here because it is in scope.
But once the user completes the full word `from`, the exact match modifier fires:

### `select * from` with column `from_sql` in scope

| Candidate       | Base | SUBSTRING | PREFIX | EXACT | KW_SUBSTRING_BONUS | KEYWORD_A | IN_SCOPE | Total |
|-----------------|------|-----------|--------|-------|--------------------|-----------|----------|-------|
| `from` (keyword)| 0    | 30        | 5      | 15    | 20                 | 4         | 0        | **74**|
| `from_sql` (col)| 20   | 30        | 5      | 0     | 0                  | 0         | 10       | **65**|

The keyword `from` now wins.

## Identity candidate

When the cursor is on an identifier and the grammar expects one, the system inserts an *identity candidate* — a synthetic candidate whose text matches exactly what the user has typed.
This provides a stable "keep what I typed" option so that accepting a completion never feels forced.

The identity candidate is tagged with `IDENTITY` and rendered with a distinct gray "ID" badge in the UI.

### Context-dependent scoring

The identity candidate's score varies by context to avoid suppressing strong contextual matches:

| Context              | Score | Rationale                                                        |
|----------------------|-------|------------------------------------------------------------------|
| Definition position  | max   | User is naming something new — always preserve their text        |
| DEFAULT strategy     | max   | Context is ambiguous — play it safe                              |
| TABLE_REF strategy   | 50    | Any substring-matching catalog table (≥52) wins                  |
| TABLE_REF_ALIAS      | 50    | Prefix-matching keywords (e.g. WHERE=59) win over alias text     |
| COLUMN_REF strategy  | 59    | In-scope substring-matching columns (≥60) win                    |

At **definition positions** (detected via AST attribute keys like `SQL_CREATE_TABLE_NAME`, `SQL_RESULT_TARGET_NAME`, `SQL_CTE_NAME`, etc.), name-index search is also suppressed entirely — no catalog suggestions appear.

### Score arithmetic

In TABLE_REF (identity=50):
- Table with substring match: NAME_TAG_LIKELY(20) + SUBSTRING(30) + THROUGH_CATALOG(2) = 52 > 50 ✓
- Non-matching table: 20 + 2 = 22 < 50, identity wins ✓

In TABLE_REF_ALIAS (identity=50):
- Prefix-matching keyword (WHERE): KW_SUBSTRING_BONUS(20) + SUBSTRING(30) + PREFIX(5) + KEYWORD_A(4) = 59 > 50 ✓
- Non-matching keyword: 0 < 50, identity wins ✓

In COLUMN_REF (identity=59):
- In-scope column with substring match: 20 + 30 + 10 = 60 > 59 ✓
- Out-of-scope column prefix-only: 20 + 30 + 5 = 55 < 59, identity wins ✓
- Best keyword (KEYWORD_A + KW_SUBSTRING_BONUS + substring + prefix): 4 + 20 + 30 + 5 = 59, tie broken lexicographically

## Definition positions

The system detects "definition" positions — places where the user is defining a new name, not referencing an existing one.
At these positions:

1. The identity candidate gets max score (always #1)
2. Name-index search is suppressed (no table/column/function suggestions from the catalog)
3. Keywords still appear if they match the prefix

Detection uses the AST path from cursor to root, checking `attribute_key()` against:
`SQL_CREATE_TABLE_NAME`, `SQL_CREATE_AS_NAME`, `SQL_VIEW_NAME`, `SQL_COLUMN_DEF_NAME`, `SQL_RESULT_TARGET_NAME`, `SQL_CTE_NAME`, `SQL_WINDOW_DEF_NAME`, `SQL_CREATE_FUNCTION_NAME`, `SQL_FUNCTION_PARAM_NAME`.

Table aliases (`FROM t AS alias`) are handled separately by the `TABLE_REF_ALIAS` strategy which already skips name-index search.

## Pipeline

The full completion pipeline in `Completion::compute`:

1. Determine cursor context (dot-completion, table ref, column ref, default).
2. If dot-completing: `find_candidates_for_name_path` — restrict to the resolved dot context.
3. Otherwise:
   a. `add_expected_keywords_as_candidates` — insert scored keywords into the heap.
   b. Insert identity candidate (score depends on strategy and definition context).
   c. `find_candidates_in_indexes` — find all name-index matches (skipped at definition positions and alias positions).
   d. `find_candidates_in_scope` — add CTEs and script-local relations and their columns from the name scopes.
   e. `promote_tables_and_peers_for_unresolved_columns` — boost tables that resolve missing columns.
4. `promote_identifiers_in_scope` — tag candidates reachable through naming scopes (not between symbols).
5. `select_top_candidates` — compute final scores, select top-k via a min-heap.
6. `qualify_top_candidates` — derive qualified names for the winners (not between symbols).
7. `derive_keyword_continuations` — attach keyword continuations, suffix-checked mid-statement (see `core_completion.md`).
