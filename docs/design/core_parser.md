# Core Parser

The DashQL parser transforms source text into a flat, FlatBuffer-serializable AST.
It runs in two phases—scanning then parsing—and produces a contiguous array of fixed-size nodes rather than a heap-allocated tree.

## Architecture Overview

```
Source text
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Scanner (Flex)                                      │
│  - Tokenizes into a ChunkBuffer<symbol_type>        │
│  - Resolves identifiers vs keywords                 │
│  - Performs 1-token lookahead to emit NOT_LA,        │
│    NULLS_LA, WITH_LA for LALR(1) compatibility      │
│  - Tracks line breaks, comments, name registry      │
└─────────────────────────────────────────────────────┘
    │
    │  ScannedScript (all tokens materialized)
    ▼
┌─────────────────────────────────────────────────────┐
│ Parser (Bison LALR(1))                              │
│  - Consumes pre-scanned token buffer via            │
│    ParseContext::NextSymbol()                        │
│  - Grammar actions build nodes using projection     │
│    helpers (Object, Array, List, Attr, Expr, …)     │
│  - Nodes are appended to a ChunkBuffer<Node>        │
│  - Statements are finalized via AddStatement()      │
└─────────────────────────────────────────────────────┘
    │
    │  ParsedScript { nodes: Vec<Node>, statements: Vec<Statement> }
    ▼
  FlatBuffer serialization (parsed_script.fbs)
```

## Flat AST Design

### The Node struct

Every AST node is a fixed-size 24-byte FlatBuffer struct (`proto/fb/dashql/parsed_script.fbs`):

```
struct Node {
    symbol_span: SymbolSpan;        // 8 bytes: {offset, length} in token-index space
    node_type: NodeType;            // 2 bytes
    attribute_key: AttributeKey;    // 2 bytes
    parent: uint32;                 // 4 bytes: index into the node array
    children_begin_or_value: uint32;// 4 bytes: first child index, or inline scalar
    children_count: uint32;         // 4 bytes
}
```

All nodes live in a single flat vector.
Parent/child relationships are encoded as array indices—`children_begin_or_value` points to the first child, the next `children_count` consecutive nodes are the children.
When a node is a leaf (literal, enum, name), `children_begin_or_value` stores the value inline instead (e.g., a name ID or boolean).

### Node kinds

Nodes are categorized by their `NodeType`:

| Category | Examples | Children |
|----------|----------|----------|
| Terminals | `NAME`, `BOOL`, `LITERAL_INTEGER`, `LITERAL_STRING`, `OPERATOR` | None; value in `children_begin_or_value` |
| Enums | `ENUM_SQL_JOIN_TYPE`, `ENUM_SQL_EXPRESSION_OPERATOR`, … | None; enum discriminant in `children_begin_or_value` |
| Arrays | `ARRAY` | Children are ordered elements |
| Objects | `OBJECT_SQL_SELECT`, `OBJECT_SQL_COLUMN_REF`, … | Children are attribute nodes (keyed by `attribute_key`) |

### Attribute encoding

Object children carry an `attribute_key` that names their role within the parent.
For example, a SELECT object's children might be:

```
[parent] NodeType: OBJECT_SQL_SELECT
    ├─ [child 0] attribute_key: SQL_SELECT_TARGETS, node_type: ARRAY
    ├─ [child 1] attribute_key: SQL_SELECT_FROM,    node_type: ARRAY
    └─ [child 2] attribute_key: SQL_SELECT_WHERE,   node_type: OBJECT_SQL_NARY_EXPRESSION
```

Null (omitted) attributes are simply not stored—the parser uses `Null()` which produces `NodeType::NONE` and gets filtered out when materializing.

### Statements

Each top-level statement is tracked in a `Statement` record:

```
table Statement {
    statement_type: StatementType;  // SELECT, CREATE_TABLE, VIS_VISUALISE, …
    root_node: uint32;              // Index of root node
    nodes_begin: uint32;            // First node index belonging to this statement
    node_count: uint32;             // Total nodes in the statement
}
```

The node array is partitioned by statement—each statement owns a contiguous slice.

## Grammar Assembly

The grammar is modular and assembled at build time by `grammar/assemble_grammar.py`.
The final `.y` file is composed in this order:

1. **Prologue** (`prologue.y`) — Bison skeleton config, `%locations`, `YYLLOC_DEFAULT`, includes
2. **Keyword token declarations** — generated from `lists/*.list` files
3. **Precedences** (`precedences.y`) — operator precedence and associativity
4. **Type declarations** (`rules/*.yh`) — `%type` directives mapping nonterminals to C++ types
5. **`%%`** — start of rules section
6. **Keyword identity rules** — generated pass-through rules for keyword categories
7. **Rule files** (`rules/*.y`) — the actual grammar productions
8. **`%%`** — end

### Rule files

| File | Scope |
|------|-------|
| `ext_statement.y` | Top-level dispatch: `statement → sql_query_statement` |
| `sql_select.y` | SELECT, set operations, expressions, types (~110 KB) |
| `sql_create.y` | CREATE TABLE |
| `sql_view.y` | CREATE VIEW |
| `sql_function.y` | CREATE FUNCTION, function calls |
| `ext_visualize.y` | VISUALISE extension |
| `ext_set.y` | SET variable statements |
| `ext_varargs.y` | Nested key/value field syntax |
| `ext_explain.y` | EXPLAIN wrapper |

### Type files (`.yh`)

Each rule file has a companion `.yh` declaring the Bison `%type` for its nonterminals.
The three semantic value types used are:

- **`buffers::parser::Node`** — a single materialized node (terminal, object, enum)
- **`BackedUniquePtr<NodeList>`** — a temporary linked list of nodes (not yet committed to the node array)
- **`ExpressionVariant`** — either a `Node` or a `BackedUniquePtr<NAryExpression>` (allows flattening chains of AND/OR)

## Bison Projections

Grammar actions construct nodes through helpers defined in `parser/grammar/nodes.h` and `ParseContext`.
The term "projection" refers to the pattern of mapping a grammar production into flat AST nodes.

### Core helpers

```cpp
// Wrap a node with an attribute key
Attr(AttributeKey key, Node node) → Node

// Allocate a temporary working list
ctx.List({node1, node2, …}) → BackedUniquePtr<NodeList>

// Materialize a list into a contiguous ARRAY node
ctx.Array(loc, list) → Node

// Materialize attributes into an OBJECT node
ctx.Object(loc, NodeType, {attr1, attr2, …}) → Node

// Concatenate temporary lists (cheap, just pointer manipulation)
Concat(list1, list2, {extra_attrs…}) → BackedUniquePtr<NodeList>
```

### Projection patterns

**Pattern 1: Direct object construction**

When a rule maps directly to one AST object:

```bison
sql_common_table_expr:
    sql_name sql_opt_name_list AS LRB sql_preparable_stmt RRB {
        $$ = ctx.Object(@$, NodeType::OBJECT_SQL_CTE, {
            Attr(Key::SQL_CTE_NAME, $1),
            Attr(Key::SQL_CTE_COLUMNS, ctx.Array(@2, std::move($2))),
            Attr(Key::SQL_CTE_STATEMENT, $5),
        });
    }
```

**Pattern 2: Deferred object construction via lists**

SELECT statements accumulate attributes across multiple productions using `List` and `Concat`, deferring `Object()` to the top:

```bison
sql_simple_select:
    SELECT sql_opt_all_clause sql_opt_target_list sql_from_clause sql_where_clause … {
        $$ = ctx.List({
            Attr(Key::SQL_SELECT_ALL, $2),
            Attr(Key::SQL_SELECT_TARGETS, ctx.Array(@3, std::move($3))),
            Attr(Key::SQL_SELECT_FROM, ctx.Array(@4, std::move($4))),
            Attr(Key::SQL_SELECT_WHERE, $5),
            …
        });
    }

sql_select_no_parens:
    sql_select_clause sql_sort_clause {
        $$ = Concat(std::move($1), {
            Attr(Key::SQL_SELECT_ORDER, $2),
        });
    }

// Final materialization at the top-level dispatch:
sql_query_statement:
    sql_select_stmt {
        $$ = ctx.Object(@$, NodeType::OBJECT_SQL_SELECT, std::move($1));
    }
```

This avoids intermediate object allocations for partial SELECT parse states.

**Pattern 3: Expression flattening**

Binary expressions like `a AND b AND c` are represented as a single n-ary node rather than nested binary trees.
`TryMerge` checks whether adjacent expressions share the same operator and collapses them:

```bison
sql_a_expr:
    sql_a_expr AND sql_a_expr {
        $$ = Expr(ctx, @$, Operator(@2), std::move($1), std::move($3));
    }
```

The `Expr()` helper calls `ctx.TryMerge()`. If both operands are already AND-chains, their argument lists are merged into a single `OBJECT_SQL_NARY_EXPRESSION` with one flat args array.
The intermediate `NAryExpression` is heap-allocated in a pool and only materialized into the node array at the end via `ctx.Expression()`.

**Pattern 4: Terminal construction**

Leaf values are constructed inline without touching the node array:

```cpp
Const(loc, AConstType::INTEGER)       // literal with type tag
Bool(loc, true)                        // inline boolean
Enum(loc, ExpressionOperator::NEGATE)  // enum discriminant
NameFromIdentifier(loc, name_id)       // name referencing the name registry
Operator(loc)                          // operator marker (text from source)
```

These return `Node` values that only get committed when passed to `Array()` or `Object()`.

## Scanner / Lexer

### Two-phase tokenization

The scanner runs **completely before parsing begins**.
All tokens are materialized into `ScannedScript::symbols` (a `ChunkBuffer<Parser::symbol_type>`).
The parser then iterates this buffer via `ParseContext::NextSymbol()`.

This design enables:
- The parser can recover from errors without re-scanning
- Token metadata (types, offsets) is available for syntax highlighting independent of parsing
- Lookahead disambiguation happens once during scanning

### Flex configuration

```
%option reentrant noyywrap batch caseless prefix="dashql_yy"
```

Key characteristics:
- **Reentrant** — no global state
- **Case-insensitive** — keywords matched regardless of case
- **Batch mode** — no interactive I/O

### Exclusive states

The scanner uses exclusive states for multi-character tokens:

| State | Purpose |
|-------|---------|
| `<xb>` | Bit string literals (`B'...'`) |
| `<xc>` | C-style block comments |
| `<xd>` | Double-quoted identifiers |
| `<xbt>` | Backtick-quoted identifiers |
| `<xh>` | Hex string literals (`X'...'`) |
| `<xq>` | Standard single-quoted strings |

### Identifier resolution

When the scanner matches an unquoted identifier, it:
1. Lower-cases the text
2. Looks it up in the keyword table (`Keyword::Find`)
3. If found: returns the keyword token with `std::string_view` to the canonical spelling
4. If not found: registers the name in `ScannedScript::name_registry` and returns `IDENT` with the name ID

### Lookahead rewrites

Some tokens require 1-token lookahead to resolve LALR(1) conflicts.
The scanner's `Scan()` method wraps raw `yylex` calls with a lookahead check:

- `NOT` → `NOT_LA` when followed by `BETWEEN`, `IN`, `LIKE`, `ILIKE`, `SIMILAR`
- `NULLS` → `NULLS_LA` when followed by `FIRST` or `LAST`
- `WITH` → `WITH_LA` when followed by `TIME` or `ORDINALITY`

## Location Tracking

### SymbolSpan

Locations are represented as `SymbolSpan { offset: uint32, length: uint32 }`.

During **scanning**, offset/length refer to byte positions in the source text.
During **parsing**, the parser remaps locations to **token indices**—`NextSymbol()` stamps each token with `SymbolSpan(next_token_index, 1)`.
This means parse-time `@N` locations reference positions in the token stream, not the source text.

The scanner-phase byte locations are preserved in the `ScannerTokens` table (`token_offsets`, `token_lengths`) so downstream consumers can map back to source positions.

### YYLLOC_DEFAULT

Bison's default location merge is overridden in `prologue.y`:

```cpp
#define YYLLOC_DEFAULT(Cur, Rhs, N) { \
    if (N) { \
        uint32_t o = YYRHSLOC(Rhs, 1).offset(); \
        uint32_t l = YYRHSLOC(Rhs, N).offset() + YYRHSLOC(Rhs, N).length() - o; \
        (Cur) = SymbolSpan(o, l); \
    } else { \
        uint32_t o = YYRHSLOC(Rhs, 0).offset() + YYRHSLOC(Rhs, 0).length(); \
        (Cur) = SymbolSpan(o, 0); \
    } \
}
```

For a non-empty production, the result span covers from the first symbol's start to the last symbol's end.
For an empty production, the span is zero-length positioned after the preceding symbol.

### Manual span merging

When a grammar action needs a span that doesn't match the full production (e.g., just the parenthesized portion), `Loc()` merges arbitrary spans:

```cpp
Loc({@2, @3, @4})  // span covering symbols 2 through 4
```

## Memory Management

### ChunkBuffer

Nodes are stored in a `ChunkBuffer<Node>`—a chunked vector that never invalidates references on growth.
This is critical because node construction happens incrementally and earlier nodes must remain stable.

### Temporary pools

Grammar actions use pooled allocators for working structures that are discarded after materialization:

- `NodeList::ListPool` — for `BackedUniquePtr<NodeList>` working lists
- `NodeList::ListElementPool` — for list elements
- `TempNodePool<NAryExpression>` — for intermediate n-ary expression chains

`BackedUniquePtr` is a unique pointer whose memory is backed by a pool. On `Destroy()` the destructor runs (returning memory to the pool). This avoids heap allocation overhead during parsing.

### Materialization

Working lists (`BackedUniquePtr<NodeList>`) are "materialized" when passed to `ctx.Array()` or `ctx.Object()`.
Materialization walks the list, appends each non-null node to the `ChunkBuffer`, sets parent pointers, and returns a single `Node` whose `children_begin_or_value` points to the start of the newly appended range.
After materialization, the temporary list is destroyed back to its pool.
