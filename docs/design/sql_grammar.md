
# SQL Grammar

DashQL's SQL grammar is derived from the PostgreSQL grammar.
This document describes the notable deviations of the scanner and grammar from upstream PostgreSQL.

## Parser-only SQL coverage

All SQL constructs are parsed by the single grammar in `grammar/rules/`. Productions project to
semantic AST nodes: SELECT clauses extend existing SELECT, target, grouping, table-reference, type,
function, and window nodes; UPDATE, MERGE, COPY, prepared statements, session commands, cursors,
database commands, and additional DDL use dedicated statement and clause nodes. There is no secondary
recognizer, parse retry, generic rule node, or token-sequence fallback.

The schema has explicit SQL object, attribute, statement, and enum values. The enum node types sit in
the range of the enums, so adding one shifts the ordinals of the objects (`SCRIPT_SIGNATURE_VERSION`). New
flags and optional children are absent for old forms. Ordered lists preserve ordering,
duplicate options, and all operands; command and clause variants remain distinguishable. The tests
assert the statement and clause shapes, not just acceptance. Analyzer, formatter, and runtime support
for newly modeled constructs remain separate work.

The main additions are typed UPDATE assignments and MERGE actions; COPY sources and options;
PREPARE/EXECUTE/DEALLOCATE; settings and cursor operations; database and DDL objects; function bodies,
parameters, and options; SQL/JSON values and behavior clauses; table-valued/lambda arguments; and
SELECT attributes for grouping modifiers, star exclusion, limits, ordering, ordinality, and windows.
All child SQL expressions and subqueries reuse the ordinary expression and SELECT nodes.

The kind of a statement or clause is a flatbuffer enum (`MergeAction`, `MergeMatch`, `FetchDirection`,
`SessionParameter`, `DropObjectType`, `RenameObjectType`, `GrantTargetType`, `FunctionOption`, `SequenceOption`,
`JsonBehavior`, ...) or a boolean (`SQL_*_IF_EXISTS`, `SQL_DROP_CONCURRENTLY`, `SQL_FETCH_MOVE`,
`SQL_SEQUENCE_OPTION_NO`, `SQL_VIEW_CHECK_LOCAL`, ...), never a keyword `NAME`: the highlighting colors a keyword
under a single-symbol `NAME` as an identifier. A combined form is split into its parts, `DROP INDEX CONCURRENTLY IF
EXISTS` is the object type `INDEX` with the flags `SQL_DROP_CONCURRENTLY` and `SQL_DROP_IF_EXISTS`, and a kind that
only repeats the node type (`GRANT`) is not stored. Where the commands share syntax with queries they reuse their
rules and enums: `NumericType` for the type of a sequence, `IntervalType` for intervals, `OrderDirection` and
`OrderNullRule` for index elements.

`INSERT ... ON CONFLICT` is an `OBJECT_SQL_INSERT_ON_CONFLICT` under `SQL_INSERT_ON_CONFLICT`: the conflict target
as index elements (`SQL_INSERT_ON_CONFLICT_TARGET`, the `OBJECT_SQL_INDEX_ELEMENT`s of CREATE INDEX) with the index
predicate (`SQL_INSERT_ON_CONFLICT_TARGET_WHERE`) or a constraint name (`SQL_INSERT_ON_CONFLICT_CONSTRAINT`), the
action (`SQL_INSERT_ON_CONFLICT_ACTION`, an `InsertConflictAction`: `DO_NOTHING`, `DO_UPDATE`), and for `DO UPDATE`
the `OBJECT_SQL_ASSIGNMENT`s of UPDATE (`SQL_INSERT_ON_CONFLICT_ASSIGNMENTS`) and the condition
(`SQL_INSERT_ON_CONFLICT_WHERE`). Hyper doesn't run it.

`SET a.b = v` with a single value is an `OBJECT_EXT_SET` with its key path and value, every other SET form
an `OBJECT_SQL_SET` with its parameter (`SQL_SET_PARAMETER`, a `SessionParameter`) or variable (`SQL_SET_NAME`)
and its values (`SQL_SET_ARGS`), both with `SQL_SET_LOCAL` for `SET LOCAL` (`ctx.set`, `ext_set.y`). `SET
SESSION` is the default and not recorded. The formatter writes the `OBJECT_EXT_SET` with `=` and the values of an
`OBJECT_SQL_SET` variable after `to`, like PostgreSQL's deparser, so that a single value stays an `OBJECT_SQL_SET`;
only values that `to` does not take, a column reference or a function call first, follow `=`. `RESET` is an
`OBJECT_SQL_RESET` that holds another one with the variable (`SQL_RESET_ARG`) or the parameter
(`SQL_RESET_PARAMETER`).

## Trailing Dots

PostgreSQL's scanner emits a single `DOT` token for `.` regardless of context.
When a user is typing an incomplete qualified name like `schema.table.`, the parser sees the trailing dot followed by a token that cannot continue the indirection rule, and the parse fails.

DashQL splits the dot into two tokens in the scanner:

- **`DOT`** — a dot followed by a non-whitespace character (the common case: `a.b`)
- **`DOT_TRAILING`** — a dot followed by whitespace and no following identifier, unreserved keyword, or star

The pattern `\.{space}` matches a possible trailing dot in the scanner; the space is not consumed
(the location is trimmed to length 1). The lookahead filter keeps a normal dot when a name, a keyword that is no
reserved one, or a star follows, so `schema. table` and `table. *` remain valid SQL. A reserved keyword after the
whitespace ends the name, unlike in PostgreSQL: `select t. from t` is the trailing dot of `t` and a FROM clause, not
the column `t.from`.
A helper rule `ext_dot_trailing` accepts either `DOT_TRAILING` or `DOT EOF` so both `a. ` and `a.<eof>` are covered.

The grammar then accepts `ext_dot_trailing` as a `sql_indirection_el` (and in `sql_attrs`), producing an `OBJECT_EXT_TRAILING_DOT` node and the parse error "name has a trailing dot".
Downstream, the completion engine recognizes trailing dots and offers completions for the namespace to the left.

**Files:**
- `packages/dashql-parser/src/scanner.rs` — `{raw_dot_trailing}` pattern (`Initial::DotTrailing`), `DOT_TRAILING` token
- `grammar/prologue.y` — `DOT_TRAILING` token declaration
- `grammar/rules/sql_select.y` — `ext_dot_trailing` rule, usage in `sql_indirection_el` and `sql_attrs`


## Backtick-Quoted Identifiers

PostgreSQL does not support backtick-quoted identifiers.
The backtick character is part of `op_chars` in the upstream grammar, meaning it can appear inside operator tokens.

DashQL removes the backtick from `op_chars` and adds a dedicated lexer state (`xbt`) that mirrors the existing double-quote identifier state (`xd`).
Backtick-quoted identifiers are case-preserving and produce the same `IDENT` token as double-quoted identifiers, so they work everywhere an identifier is accepted.

This allows DashQL to parse SQL dialects that use backticks for identifier quoting (MySQL, Spark, BigQuery) without requiring a dialect-specific lexer mode.

Embedded backticks are supported via doubling (``` `` ```), matching the MySQL convention.

**Files:**
- `packages/dashql-parser/src/scanner.rs` — `xbt` exclusive state (the `Xbt` lexer and `State::Xbt`), backtick removed from `{op_chars}`, the identifier is read by `identifier_stop`


## Transaction Control

`sql_transaction.y` follows `TransactionStmt` in Hyper's `hyper/parser/sql/sql.ypp`:

```text
BEGIN [WORK | TRANSACTION] [transaction_mode ...]
START TRANSACTION [transaction_mode ...]
COMMIT [WORK | TRANSACTION]
END [WORK | TRANSACTION]
ROLLBACK [WORK | TRANSACTION]
ABORT [WORK | TRANSACTION]
SAVEPOINT name
RELEASE [SAVEPOINT] name
ROLLBACK [WORK | TRANSACTION] TO [SAVEPOINT] name
PREPARE TRANSACTION 'id'
COMMIT PREPARED 'id'
ROLLBACK PREPARED 'id'
```

Modes are `ISOLATION LEVEL { READ UNCOMMITTED | READ COMMITTED | REPEATABLE READ | SERIALIZABLE }`,
`READ ONLY`, `READ WRITE`, `DEFERRABLE` and `NOT DEFERRABLE`. A list accepts commas, whitespace,
or both as separators, and preserves mode order and duplicates. Accepting a statement does not
imply that an engine executes it. `SET TRANSACTION` and `SET SESSION CHARACTERISTICS AS TRANSACTION`
are `SET` statements (`StatementType::SET`, `ext_set.y`): they change the modes and neither begin
nor end a transaction, so the transaction check passes over them. The formatter writes the
commands in a canonical form (`formatter/transaction.rs`), the analyzer checks that every transaction
begins and ends in one script (`analyzer/transactions.rs`, see `core_analysis_catalog.md`), and the
planner runs the statements of a transaction as barriers (`planner_dependencies.md`).

The parse tree adds `StatementType::TRANSACTION`, `OBJECT_SQL_TRANSACTION` and
`OBJECT_SQL_TRANSACTION_MODE`. The statement has a `SQL_TRANSACTION_COMMAND` enum
(`ENUM_SQL_TRANSACTION_COMMAND`, a `TransactionCommand`: `BEGIN`, `START`, `COMMIT`, `END`, `ROLLBACK`, `ABORT`,
`SAVEPOINT`, `RELEASE`, `ROLLBACK_TO`, `PREPARE`, `COMMIT_PREPARED`, or `ROLLBACK_PREPARED`), optional
`SQL_TRANSACTION_MODES`, and an optional `SQL_TRANSACTION_TARGET`: a `NAME` for a savepoint, or a string literal for a
prepared transaction. The command alone says what the statement does, the analyzer and the formatter match on it.
`WORK`/`TRANSACTION` and the optional `SAVEPOINT` keyword have no semantic difference and are omitted.

Each mode object holds exactly one attribute: `SQL_TRANSACTION_ISOLATION_LEVEL` (an
`ENUM_SQL_TRANSACTION_ISOLATION_LEVEL`, a `TransactionIsolationLevel`: `READ_UNCOMMITTED`, `READ_COMMITTED`,
`REPEATABLE_READ`, or `SERIALIZABLE`), `SQL_TRANSACTION_READ_ONLY` (a boolean), or `SQL_TRANSACTION_DEFERRABLE` (a
boolean). The command and the isolation level are enums and not keyword `NAME`s: the highlighting colors a keyword
under a single-symbol `NAME` as an identifier (a keyword used as a column name), so a `NAME` would color `begin` and
`serializable` as identifiers. All command kinds, targets and mode values remain distinguishable; aliases retain their
command value.

## Other Deviations

- **Parameters follow Hyper**: `:name`, `:"name"`, `:'name'`, `$0` and `?`, also as table references
  (`sql_param_ref` in `sql_select.y`, see [core_parser.md](core_parser.md#parameters)).
- **SQL/PGQ**: property graphs defined as common table expressions (`g AS PROPERTY GRAPH (...)`), and
  `GRAPH_TABLE (g MATCH ...)` queries (`sql_pgq.y`).
- **CTE options**: `WITH t AS (...) OPTIONS (identifier_resolution 'case_insensitive')` (`sql_cte_options`
  in `sql_select.y`), and `AS SECURE (...)` CTEs (`sql_pgq.y`).
- **`ATTACH [LOCAL] DATABASE path AS alias [WITH (...)]`** (`sql_drop_attach.y`).
- **Sampling**: a `USING SAMPLE` clause of SELECT, and sample counts with a unit (`10%`, `10 PERCENT`,
  `100 ROWS`) or a bare row count (`sql_sample_clause`, `sql_tablesample_entry` in `sql_select.y`).
