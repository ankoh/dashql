# Gate multi-step completion suggestions to the write front

## Context

Commit `34a137af6` added *suffix compatibility* to completion: when the cursor is
mid-statement (there is a real token after it), each expected **keyword candidate** is
probed against that suffix via `ProbeSuffixBatchFromSnapshot`, and incompatible keywords
are demoted (`SUFFIX_INCOMPATIBLE` penalty). This makes single-keyword completion
behave well when editing *within* an existing SQL statement.

The two **multi-step** follow-on suggestions never got the same treatment. Both are
derived *after* candidate scoring and are blind to the suffix:

1. **Keyword continuations** — `DeriveKeywordSnippetsForTopCandidates`
   (`completion.cc:1115-1182`) feeds the candidate through `ParseUntilAfter` and attaches
   the best expected-next keyword (e.g. `group` → ` by`). It runs unconditionally
   (`completion.cc:1606`). Mid-statement this can offer a continuation that duplicates or
   conflicts with what already follows the cursor — e.g. completing at `... GROUP| BY x`
   suggests `group by` even though `BY` is already there.

2. **Constant-expression / template snippets** — `FindIdentifierSnippetsForTopCandidates`
   (`completion.cc:1095-1113`) pulls filter/computation templates (the constant-expression
   RHS snippets, e.g. `= 'value'`) from the `ScriptRegistry` and attaches them as the
   step-3 template insertion. It is gated on `!between_symbols` but never against the
   suffix, so at `SELECT col| = 5 FROM t` it can splice a `col = <value>` template in front
   of the existing `= 5`.

**Decision (confirmed with user):** apply a simple, consistent **write-front gate** to
both multi-step suggestions. When a real post-cursor token exists, suppress continuation
derivation and template-snippet collection entirely. Definition of "write front" is the
*local* signal already computed for the keyword probe: the next real scanner token past the
feed point is EOF (`have_post_cursor_token == false`). We accept losing the rare
valid mid-statement continuation/template in exchange for never emitting a broken one.

## Approach

Lift the existing `have_post_cursor_token` computation out of
`AddExpectedKeywordsAsCandidates` into a reusable `Completion` member, then gate the two
multi-step derivations on it.

### 1. Compute the write-front signal once, store on the instance

`have_post_cursor_token` is currently a local in `AddExpectedKeywordsAsCandidates`
(`completion.cc:646-671`), derived from `target_scanner_symbol`, `relative_pos`, and the
scanner's `IsAtEOF` / `S_YYEOF` check.

- Add a member to `completion.h` (near `between_symbols`, `completion.h:113-117`):
  ```cpp
  /// Is there a real token after the cursor's feed point? (false ⇒ cursor is at the write
  /// front). Multi-step suggestions are only offered at the write front.
  bool has_post_cursor_token = false;
  ```
- Compute it early in `Compute` where `target_scanner_symbol` / `between_symbols` are
  already resolved (before the candidate-adding branches around `completion.cc:1490-1551`),
  reusing the exact `feed_id` / `post_id` / `replace_target` logic from
  `completion.cc:646-671`. Simplest: factor that block into a small private helper
  (e.g. `bool computeHasPostCursorToken() const`) and call it from both `Compute` and
  `AddExpectedKeywordsAsCandidates` (the latter can then read the member instead of
  recomputing).

### 2. Gate keyword continuations

In `Compute`, guard the unconditional call at `completion.cc:1606`:
```cpp
// Multi-step continuations only at the write front; a real post-cursor token means the
// continuation could conflict with existing text.
if (!has_post_cursor_token) {
    completion->DeriveKeywordSnippetsForTopCandidates();
}
```
(Equivalent alternative: early-return inside `DeriveKeywordSnippetsForTopCandidates` when
`has_post_cursor_token`. Prefer the guard at the call site for symmetry with the snippet
gate below.)

### 3. Gate constant-expression / template snippets

Extend the condition wrapping `FindIdentifierSnippetsForTopCandidates`
(`completion.cc:1572-1604`). It already requires `!between_symbols` and clause checks; add
`!has_post_cursor_token` so template snippets are only collected at the write front:
```cpp
if (registry && !skip_snippets && !completion->has_post_cursor_token) {
    completion->FindIdentifierSnippetsForTopCandidates(*registry);
}
```

## Critical files

- `packages/dashql-core/include/dashql/analyzer/completion.h` — new `has_post_cursor_token`
  member (+ optional helper decl).
- `packages/dashql-core/src/analyzer/completion.cc` — compute the signal
  (`Compute`, ~`:1490`), refactor `AddExpectedKeywordsAsCandidates` (`:646-671`) to reuse
  it, gate `DeriveKeywordSnippetsForTopCandidates` (`:1606`) and
  `FindIdentifierSnippetsForTopCandidates` (`:1601`).

## Reuse

- `have_post_cursor_token` logic already exists at `completion.cc:646-671` — do not
  reinvent; lift it.
- No parser changes: the probe infra (`ProbeSuffixBatchFromSnapshot`, `PrefixSnapshot`) is
  untouched; we are only *suppressing* the two derivations, not probing them.

## Verification

1. **Add snapshot cases** to `snapshots/completion/right_context.tpl.yaml` (the existing
   suffix-validation suite) covering the two gaps:
   - A keyword-continuation case with a conflicting suffix, e.g. cursor at
     `... group| by x` — assert no `keyword_continuation` of `by` is emitted.
   - A template-snippet case mid-expression, e.g. `select col| = 5 from tbl` — assert no
     filter/computation template is attached to the `col` candidate.
   Also add a write-front counter-case (cursor at true end of statement) confirming the
   continuation/template *is* still offered, to prove the gate is not over-broad.
2. **Regenerate** the `.yaml` from the `.tpl.yaml` and review the diff. Watch for the
   inferred-tables / snippet churn noted in prior memory — only commit the intended
   continuation/template removals, not unrelated snapshot noise.
3. **Build & test via bazel** (never `npx vitest` / raw gtest):
   ```
   bazel test //packages/dashql-core:completion_tests
   ```
   Expect existing write-front continuation/snippet snapshots (e.g.
   `keyword_continuations.yaml`) to stay green — cursor there is at end of input, so
   `has_post_cursor_token` is false and behavior is unchanged.
4. Optionally sanity-check `registry_tests` since template snippets originate in the
   `ScriptRegistry`, though its snapshots should be unaffected (we only change whether the
   *completion* pulls them).
