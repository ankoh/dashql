# Hyper syntax grammar

`sql.y` specifies Hyper's SQL syntax without engine actions. It covers the Hyper statement families,
queries, expressions, SQL/JSON, SQL/PGQ, and keyword categories, including feature-gated syntax.
The grammar is self-contained. Keywords are listed in `keywords.list`; `keywords.py` emits their
independent lookup.

Bazel compiles the grammar with the same Bison Rust table skeleton as the semantic DashQL grammar.
The syntax driver builds tagged concrete syntax trees, rather than duplicating Hyper's semantic
actions. A complete statement must reduce to `Stmt` and consume EOF. There is no error production or
catch-all token rule. Existing DashQL trees are preferred; this grammar is used only for statements
with errors, independently across a script's scanned statement separators.

When extending the language, change the productions and add positive and negative parser cases.
Keep keyword categories, lookahead rewrites in `parser/syntax.rs`, and precedence in sync. Bison
conflicts must be investigated, not hidden with an expected-conflict count. The acceptance tests
cover every family in the compatibility audit. Engine execution and semantic-tree projections are
outside this grammar's responsibility.
