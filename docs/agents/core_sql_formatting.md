# Extending and Validating SQL Formatting

This guide documents the standard workflow to add or improve SQL formatter behavior in DashQL and validate it end-to-end.

## 1) Implement formatter behavior

1. Update formatter logic in the Rust core, `packages/dashql-core/src/formatter/`: `mod.rs` holds the dispatch and the shared helpers, the statement formatters live in `select.rs`, `create.rs`, `insert.rs`, `delete.rs`, `explain.rs`, `json.rs` (SQL/JSON, external streams), `pgq.rs` and `transaction.rs`, `comments.rs` places and wraps comments, and `program.rs` holds the formatting program and its width-aware renderer.
2. Ensure the node is handled in the `Formatter::format_node` dispatch (`mod.rs`).
3. Keep lowercase SQL keywords as the default; honor the configured keyword case without changing identifiers, literals, comments, or current break/indent behavior.
4. Don't use the source text of a node (`text_at`) as escape hatch to copy over the AST node content, instead use a place holder similar to unsupported node types (`format_unimplemented`).
5. Don't format children nodes in parent nodes, let the formatter format children when visiting them and look up the child's `FmtReg` (`reg`, `reg_or_placeholder`).
6. The formatter visits the nodes in post-order (the order of the node array), so the regs of the children are already computed (if we can format them).
7. To try a change on real scripts, run `bazel run //packages/dashql-cli:dashql -- format <file.sql|dir|->`.

Example: for `OBJECT_SQL_ORDER`, read attributes like `SQL_ORDER_VALUE`, `SQL_ORDER_DIRECTION`, and `SQL_ORDER_NULLRULE`, then render the order item text used by `order by` clauses.

### Comments

The formatter places every comment so that formatting its output again places it the same way: the output of a
second run equals the first. Inline mode drops the comments.

- **Between statements.** The comments before a statement are its description, printed on lines of their own before
  it. Runs of line comments are rewrapped to the width, and a blank line between two comments, or after them, is kept:
  it separates paragraphs, which a second run would otherwise join. No rewrapped line starts with a word with `@`,
  which could start a tag. Comments with tags are printed as one canonical comment (see
  `docs/design/vis_comments.md`).
- **After a statement.** Comments on the line of the end of a statement stay on its line after the semicolon, also
  after a statement with syntax errors that is copied as written.
- **Text without symbols.** A block comment without its end after the semicolon of the last statement is copied as
  written with the text after it, like a statement with syntax errors.
- **Inside a statement.** `comments.rs` attaches a comment to the document of a node (`attach_inner_comments`): a line
  comment on the line where a node ends stays at the end of the line of that node, as a line suffix that the renderer
  writes before the next line break (`select a, -- the a`). Any other comment goes in front of the node after it, a
  block comment on the line (`where /* c */ x`), a line comment on a line of its own. A comment goes with the
  outermost document that starts (or ends) with that node, the document that a second run finds for the same text,
  and only with documents that the statement prints once. A line suffix forces the joins and parentheses around it to
  break and moves the text after it to the next line, except a comma or an opening parenthesis (`f( -- c`).
- **Words, not spans.** A node is found by the first and last words of its text, without the parentheses at the
  edges, and takes a comment only if its document prints the same word there. A clause whose text starts with a
  keyword that its parent prints, like the `from` of a from clause, so takes no comment in front of that keyword: the
  comment goes in front of the next node, where a second run finds it.
- **Parentheses.** The opening (or closing) parentheses between a comment and the word of its node are counted. Those
  that the document prints itself count, the comment goes outside of as many of the parentheses around the document
  as remain, whether they are parenthesis documents or texts like `]`. Parentheses that the formatter drops are
  skipped, a second run counts the printed ones.
- **One line comment per document end.** A second line comment at the end of the same document goes in front of the
  node after it, on a line of its own.
- **Without a node.** Comments inside a statement after its last printed node, as in `select (a /* a */)`, follow the
  statement on its line like the comments after it. If they cannot (two line comments, or a comment with a tag), they go
  on lines of their own before the semicolon, where a second run finds them again.
- A comment inside a leaf that is printed as written, like `-/* a */1`, stays inside it.

The round trip test (`formatted_comments_stay_in_place`) puts comments between all symbols of the parser corpus, as
block comments, as line comments on lines of their own, and as line comments at the ends of lines, and checks that
every comment is printed once and that the output formats to itself.

## 2) Add/extend formatter snapshot templates

Formatter snapshot templates live in:
- `tests/snapshots/formatter/*.tpl.yaml`

Generated snapshot files live in:
- `tests/snapshots/formatter/*.yaml`

To add a new category:
1. Create `tests/snapshots/formatter/<category>.tpl.yaml`.
2. Follow template structure used by existing files such as `expressions.tpl.yaml`.
3. Add multiple focused test cases with:
   - `name`
   - `input`
   - `dialects.hyper`
4. Prefer adding `validation.setup` for Hyper-validatable SQL so formatted outputs can be executed in validation tests.
5. Add per-mode overrides in `formatted` only when needed (for example, custom `width` in compact mode).

## 3) Generate snapshots from templates

Run:

```bash
bazel run //tests/snapshots/formatter:update
```

This generates/updates `tests/snapshots/formatter/<category>.yaml` from all `.tpl.yaml` files in the formatter snapshot folder.

## 4) Snapshot tests

No test needs a registration: the first two read every `tests/snapshots/formatter/*.yaml`, the round trip every
`tests/snapshots/parser/*.yaml`.

### Snapshot equality
Target:
- `//packages/dashql-core:formatter_snapshot_test` (`packages/dashql-core/tests/formatter_snapshots.rs`)

Formats the input of every case for every expectation of every dialect that is not skipped. Cases named
`coverage_*` must also be fully formattable, and their output must scan and parse without errors.

### Hyper validation
Target:
- `//packages/dashql-core:formatter_validation_hyper_test` (`packages/dashql-core/tests/formatter_validation_hyper.rs`)

Every case of every formatter snapshot file with a `dialects.hyper.validation` block runs
in a fresh Hyper database. The test executes `validation.setup`, checks that the Rust formatter output equals each
expectation of the `hyper` dialect, and executes it statement by statement. Hyper is reached through
`//tests/hyper:hyper_ffi_rs`, the Rust side of the C ABI `//tests/hyper:hyper_ffi`.

This ensures both textual snapshot checks and executable SQL validation are covered.

### Parser snapshot round trip
Target:
- `//packages/dashql-core:formatter_roundtrip_test` (`packages/dashql-core/tests/formatter_roundtrip.rs`)

Every error-free script of the parser snapshots (`tests/snapshots/parser/*.yaml`) must be fully formattable, and its
output must parse without errors again, to a tree with the same node types and attribute keys. Formatting the output
a second time must not change it. The same holds with comments between all symbols of the scripts, and every comment must be printed once.

## 5) Add a JS API formatting test (recommended)

File:
- `packages/dashql/src/core/api_formatting.test.ts`

Add at least one focused runtime formatting test that:
1. Creates a script via API
2. Inserts SQL input
3. Formats with `FormattingConfigT`
4. Asserts exact output string

This catches integration regressions between core formatter and app-side API/WASM binding behavior.

## 6) Run required Bazel tests

Run the full targets used for acceptance:

```bash
bazel test //packages/dashql-core:formatter_snapshot_test //packages/dashql-core:formatter_validation_hyper_test \
    //packages/dashql-core:formatter_roundtrip_test
bazel test //packages/dashql-core:all
bazel test //packages/dashql:all
bazel test //packages/dashql-app:all
```

If failures occur:
1. Fix formatter or expected snapshots as needed.
2. Re-run `bazel run //tests/snapshots/formatter:update` if templates changed.
3. Re-run the formatter test targets until green.

## 7) Typical change checklist

- [ ] Formatter logic updated in core (`packages/dashql-core/src/formatter/`)
- [ ] New/updated `.tpl.yaml` tests added
- [ ] Snapshots regenerated via `//tests/snapshots/formatter:update`
- [ ] `validation.setup` added for Hyper-validatable cases
- [ ] JS API formatting test added/updated
- [ ] `bazel test //packages/dashql-core:all` passes
- [ ] `//packages/dashql-core:formatter_validation_hyper_test` passes
- [ ] `bazel test //packages/dashql:all` passes
- [ ] `bazel test //packages/dashql-app:all` passes
