# Completion Candidate Ranking

The completion system scores candidates additively using a tag-based system.
Each candidate accumulates `CandidateTag` flags during collection, and the final score is a sum of the modifiers associated with each active tag.

## Two candidate sources

There are two fundamentally different kinds of candidates, and they enter the scoring pipeline differently:

### Name-index candidates

Identifiers (table names, column names, function names, schema names, etc.) are discovered through the `NameSearchIndex`, a suffix-indexed btree over all registered names.
The search walks the index with a case-insensitive prefix of the text under the cursor.

These candidates receive a **base score** determined by the completion strategy and the name's coarse analyzer tag:

| Strategy     | SCHEMA | DATABASE | TABLE | TABLE_ALIAS | COLUMN | FUNCTION |
|--------------|--------|----------|-------|-------------|--------|----------|
| DEFAULT      | 20     | 20       | 20    | 20          | 20     | 20       |
| TABLE_REF    | 20     | 20       | 20    | 10          | 10     | 10       |
| COLUMN_REF   | 10     | 10       | 10    | 20          | 20     | 10       |

The base score is the maximum across all name tags the candidate carries (a name can appear in multiple roles).

### Keyword candidates

Expected grammar symbols at the cursor position are extracted by `Parser::ParseUntil`.
Keywords have no base score from the name-scoring table.
Instead, they receive `EXPECTED_KEYWORD_MATCH` (+20) when they match the user's input, which levels the playing field with name-index candidates.

Keywords also carry a prevalence modifier reflecting how commonly they appear in SQL:

| Prevalence    | Score | Examples                              |
|---------------|-------|---------------------------------------|
| VERY_POPULAR  | 3     | `SELECT`, `FROM`, `WHERE`, `GROUP`    |
| POPULAR       | 2     | `AS`, `BY`, `CASE`, `LIMIT`, `WITH`   |
| DEFAULT       | 0     | everything else                       |

## Score modifiers

After the base score, tags contribute additive modifiers:

| Tag                      | Modifier | When it fires                                                |
|--------------------------|----------|--------------------------------------------------------------|
| `SUBSTRING_MATCH`        | +30      | User's input appears as a substring of the candidate name    |
| `EXPECTED_KEYWORD_MATCH` | +20      | Expected keyword whose name matches the user's input         |
| `EXACT_MATCH`            | +15      | User's input is exactly equal to the candidate name          |
| `IN_NAME_SCOPE`          | +10      | Candidate is reachable through the current naming scope      |
| `PREFIX_MATCH`           | +5       | User's input is a prefix of the candidate name               |
| `RESOLVING_TABLE`        | +5       | Table that would resolve currently unresolved column refs    |
| `DOT_RESOLUTION_*`       | +2       | Candidate reached through dot-completion (schema/table/col)  |
| `IN_SAME_STATEMENT`      | +1       | Candidate referenced elsewhere in the same statement         |
| `IN_SAME_SCRIPT`         | +1       | Candidate referenced in the same script                      |
| `IN_OTHER_SCRIPT`        | +1       | Candidate referenced in another script in the registry       |
| `UNRESOLVED_PEER`        | +1       | Column that shares a table with an unresolved column         |

## Final score

For name-index candidates with catalog objects:

```
candidate_score = base_score + max(object_scores)
```

where each object score is `computeCandidateScore(object.candidate_tags)`.

For keywords (no catalog objects):

```
candidate_score = computeCandidateScore(candidate.candidate_tags)
```

## Tiebreaking

When two candidates have the same score, the one with the lexicographically smaller name (case-insensitive) wins.
This is implemented via the min-heap comparator: lower score OR same score with larger name gets evicted first.

## Design invariants

These are enforced at compile time via `static_assert`:

- An unlikely name that is a substring match outweighs a likely name that isn't (`10 + 30 > 20`).
- Being in scope outweighs being a prefix (`10 > 5`).
- An exact match outweighs being in scope (`15 > 10`).
- Substring match outweighs all cross-reference bonuses combined (`30 > 1+1+1`).
- Being in scope outweighs all cross-reference bonuses combined (`10 > 1+1+1`).

## Worked examples

### `select count` with column `row_count` in scope

| Candidate       | Base | SUBSTRING | PREFIX | EXACT | IN_SCOPE | Total |
|-----------------|------|-----------|--------|-------|----------|-------|
| `count` (func)  | 20   | 30        | 5      | 15    | 10       | **80**|
| `row_count` (col)| 20  | 30        | 0      | 0     | 10       | **60**|

The function `count` ranks first because it is an exact match.

### `select * fr` with column `from_sql` in scope

| Candidate       | Base | SUBSTRING | PREFIX | KEYWORD_MATCH | PREVALENCE | IN_SCOPE | Total |
|-----------------|------|-----------|--------|---------------|------------|----------|-------|
| `from` (keyword)| 0    | 30        | 5      | 20            | 3          | 0        | **58**|
| `from_sql` (col)| 20   | 30        | 5      | 0             | 0          | 10       | **65**|

The column still wins here because it is in scope.
But once the user completes the full word `from`, the exact match modifier fires:

### `select * from` with column `from_sql` in scope

| Candidate       | Base | SUBSTRING | PREFIX | EXACT | KEYWORD_MATCH | PREVALENCE | IN_SCOPE | Total |
|-----------------|------|-----------|--------|-------|---------------|------------|----------|-------|
| `from` (keyword)| 0    | 30        | 5      | 15    | 20            | 3          | 0        | **73**|
| `from_sql` (col)| 20   | 30        | 5      | 0     | 0             | 0          | 10       | **65**|

The keyword `from` now wins.

## Pipeline

The full completion pipeline in `Completion::Compute`:

1. Determine cursor context (dot-completion, table ref, column ref, default).
2. If dot-completing: `FindCandidatesForNamePath` — restrict to the resolved dot context.
3. Otherwise: `AddExpectedKeywordsAsCandidates` — insert scored keywords into the heap, then `FindCandidatesInIndexes` — find all name-index matches.
4. `PromoteTablesAndPeersForUnresolvedColumns` — boost tables that resolve missing columns.
5. `PromoteIdentifiersInScope` — tag candidates reachable through naming scopes.
6. `PromoteIdentifiersInScripts` — tag candidates referenced in other scripts.
7. `SelectTopCandidates` — compute final scores, select top-k via a min-heap.
8. `QualifyTopCandidates` — derive qualified names for the winners.
9. `FindIdentifierSnippetsForTopCandidates` — attach code snippets from the script registry.


