# Call API

Status: proposed. Nothing here is implemented. The grammar was checked on Bison's automaton (see [What was checked](#what-was-checked)), and nothing has run against a real service.

The call API lets a DashQL script reach a remote REST service. A `CALL <namespace>.<function>(<option> => <value>, ...)` statement runs as an HTTP request instead of going to the connection's SQL backend. A declarative JSON document, the **function spec**, describes a service: its functions, their attributes, how they page and what they return. A **connector binding** says where the service is and how to authenticate.

- [CDP SQL](call/cdp/overview.md) is the first spec. It covers the Salesforce Data 360 API, and its documents live in [call/cdp/](call/cdp/).
- [The API survey](call/api_survey.md) measures this format against Snowflake, GitHub and Stripe, and records what similar formats do.

## Goals

1. **A new service needs a spec and a binding.** No change to the parser, core or the runtime.
2. **Core knows no service.** It has no word of any API, and it doesn't know about HTTP.
3. **Completion and checks come from the spec.** A script gets exactly the functions, options and nested attributes each position takes.
4. **A spec is data.** It has no expressions and no code. What doesn't fit reaches the script through `_raw` or the escape hatch.
5. **Everything is reachable.** A call or attribute the spec doesn't know yet can still be sent.

## Layers

| Layer | Knows about | Doesn't know about |
|---|---|---|
| **Core** (Rust) | `CALL`, namespaces, functions, typed named arguments, nested schemas, result columns | HTTP, any service |
| **Runtime** (TypeScript) | Building requests, paging, polling, errors, turning responses into result tables | Any service |
| **Connector binding** (TypeScript) | Host URLs, which credentials go to which host, path variables such as the API version | Individual functions |
| **Function spec** (JSON) | Namespace, functions, wire names, paging, schemas, effects | Credentials, absolute URLs |

Dependencies point one way: core never imports the runtime, and the runtime never imports a connector. Core tests use a made-up fixture spec, so they can't start depending on a real one.

## The statement

```sql
CALL tickets.ticket_create (
  project => 'OPS',
  title => 'Disk full',
  labels => ['infra', 'p1'],
  assignee => (id = 42, notify = true),
  affected => (SELECT host FROM alerts WHERE level = 'critical')
);

/* One page, then the next */
CALL tickets.ticket_list (project => 'OPS', page_size => 50);
CALL tickets.ticket_list (project => 'OPS', page_size => 50, _next => 'abc123');

/* Up to 10 pages in one result */
CALL tickets.ticket_list (project => 'OPS', page_size => 200, _pages => 10);

/* Prints the resolved HTTP request, sends nothing */
EXPLAIN CALL tickets.ticket_delete (id => 7);
```

**Top-level options use `=>`, and nested attributes use `=`.** Path parameters, query parameters, headers and body fields are all top-level options, and the spec records where each one goes.

**Values:**

| Script | JSON |
|---|---|
| `'text'`, `$$text$$` | String |
| `1`, `-1.5` | Number |
| `true`, `false`, `null` | Boolean, null |
| `(a = 1, b = 'x')`, `()` | Object |
| `[1, 2]`, `[]` | Array |
| `(SELECT ...)` | String: the SQL text between the parentheses. The query isn't run |
| `:name` | The bound value |
| `secret(name)` | The stored secret, see [Secrets](#secrets) |

- **`$$` strings are verbatim.** Nothing is trimmed, so `$$` followed by a line break starts the value with a line break. They're for text the grammar shouldn't touch: SQL it can't parse, CSV, formulas.
- **`(SELECT ...)` keeps core parsing and completion.** It's analyzed like any other query, and the text is sent as written. A service's SQL dialect isn't enforced, which is what `$$` is for.
- **Strings need unescaping.** Consumers currently read literals by stripping the outer quotes, without unescaping `''` (see [core_quirks.md](core_quirks.md)). Lowering has to unescape them, or a payload with an apostrophe is sent wrong.
- **Spelling comes from the spec or the source text.** `read_identifier` lower-cases unquoted names. Known names take their wire spelling from the spec. Unknown and quoted ones read it from the token's byte span in `ScannerTokens`, because keyword names carry token indexes in their byte-span fields (see [core_quirks.md](core_quirks.md)).

## Grammar

`CALL` is a generic statement. No keyword list changes, because keys reuse `vararg_key`, which already accepts every keyword as a name.

```
statement: ... | call_stmt | EXPLAIN call_stmt

call_stmt:
    CALL_P sql_qualified_name LRB RRB
  | CALL_P sql_qualified_name LRB call_args RRB
  | CALL_P sql_col_id ext_dot_trailing

call_args: call_arg | call_args COMMA call_arg
call_arg: vararg_key EQUALS_GREATER call_value

call_value:
    call_scalar | LSB RSB | LSB call_values RSB | LRB RRB | LRB call_members RRB
call_values: call_value | call_values COMMA call_value
call_members: call_member | call_members COMMA call_member
call_member: vararg_key EQUALS call_value

call_scalar:
    SCONST | DCONST | ICONST | FCONST | MINUS ICONST | MINUS FCONST
  | TRUE_P | FALSE_P | NULL_P
  | sql_colon_param_ref
  | sql_func_expr
  | sql_select_with_parens
```

- **`call_value` is separate from `vararg_value`,** so `SET` doesn't change, and a bare column name isn't a value.
- **`(select = 1)` and `(select 1)` need no scanner help.** LALR(1) decides on the token after `select`, so an attribute can be called `select`, `with`, `table` or `values`.
- **`secret(name)` is an ordinary function call to the parser.** The check below rejects any other function in a value.
- **`DCONST` is the `$$` string,** a new scanner rule. `$$` is a syntax error in core SQL today, and only `call_scalar` takes the token, so `SELECT $$x$$` stays one.
- **`EXPLAIN`** gets its own production, so `EXPLAIN (analyze) CALL ...` doesn't parse.

**Why not generate the API into the grammar?** That was the first design: functions and attributes as keywords in a scanner mode, one rule per schema. It compiled cleanly and gave every completion for free, but:

| | Core today | Generic `CALL` | API in the grammar |
|---|---:|---:|---:|
| Tokens | 511 | 511 | about 2,350 |
| LR states | 2,297 | 2,346 | 29,812 |
| `tables.rs` bytes | 924,094 | 959,477 | 3,100,420 |

- **Every SQL user pays.** `collect_expected_symbols` (`packages/dashql-parser/src/parser/probe.rs`) loops over every token at each completion, so ordinary SQL would do about 4.6 times the checks.
- **The errors are worse.** `syntax_error` (`packages/dashql-parser/src/parser/driver.rs`) drops the expected list once more than 4 tokens qualify, and recovery works per statement, so one bad attribute loses the tree, including the embedded `SELECT`.
- **It rejects valid payloads.** A new attribute that happens to be a keyword elsewhere is a syntax error until the grammar is regenerated, and specs are often narrower than the real API.
- **The scanner needs a mode with boundaries,** and the grammar can't vary per connection or API version.
- **It duplicates the spec,** which the client needs at runtime anyway.

A separate Wasm module doesn't solve this. The script, cursor, analyzer and catalog live in core's linear memory, and embedded `SELECT` needs core's automaton.

## The function spec

One JSON document per namespace. This is the whole shape, with one function:

```json
{
  "format": 1,
  "namespace": "tickets",
  "title": "Ticket Service",
  "hosts": {
    "api": { "base_path": "/api/v{api_version}" }
  },
  "errors": { "message": ["/error/message", "/message"] },
  "pending": { "status": 202, "poll": "header:Location" },
  "schemas": {
    "Assignee": {
      "attributes": [
        { "name": "id", "wire": "id", "type": "integer" },
        { "name": "notify", "wire": "notifyUser", "type": "boolean" }
      ]
    }
  },
  "functions": [
    {
      "name": "ticket_list",
      "family": "Tickets",
      "method": "GET",
      "host": "api",
      "path": "/projects/{project}/tickets",
      "options": [
        { "name": "project", "wire": "project", "in": "path:project", "type": "string", "required": true },
        { "name": "page_size", "wire": "pageSize", "in": "query", "type": "integer" },
        { "name": "page_token", "wire": "pageToken", "in": "query", "type": "string" }
      ],
      "rows": "/items",
      "columns": [
        { "name": "id", "wire": "id", "type": "BIGINT" },
        { "name": "created_at", "wire": "createdAt", "type": "TIMESTAMPTZ" }
      ],
      "paging": { "kind": "token", "from": "/nextPageToken", "option": "page_token" },
      "effect": "read"
    }
  ]
}
```

**Top level:**

| Field | Meaning |
|---|---|
| `format` | The version of this format |
| `namespace` | The prefix of the functions, see [Namespaces](#namespaces) |
| `hosts` | The host names the functions use. Each has a `base_path`, with `{variables}` the binding fills. There are no absolute URLs |
| `errors` | JSON pointers to try for the error message on a non-2xx response |
| `pending` | The default for functions that can answer before they finish, see [Pending results](#pending-results) |
| `schemas` | Named objects, shared by every function that uses them |
| `functions` | One entry per callable function |

**A function:**

| Field | Meaning |
|---|---|
| `name` | The script's name, unique in the namespace |
| `family` | A grouping for documentation and completion, optional |
| `method`, `path`, `host` | The request. `path` is relative, with `{placeholders}` |
| `options` | Top-level options, see below |
| `body` | The body's format: `json` by default, `form`, or a media type such as `text/csv`, whose body is one string option |
| `unknown` | What an unlisted option does, see [Checks](#checks). `error` by default |
| `rows` | JSON pointer to the rows: `/items`, or `""` when the response itself is the array. Absent means one row. A generator must never guess it, see [Results and errors](#results-and-errors) |
| `columns` | Known result columns: `name`, `wire`, `type` |
| `paging` | See [Paging](#paging) |
| `pending` | Overrides the top-level value, or `null` for none |
| `errors` | Overrides, see [Results and errors](#results-and-errors) |
| `sensitive` | Which values must be `secret()`, see [Secrets](#secrets) |
| `effect` | `read` or `write`, see [Running calls](#running-calls) |
| `billed` | Whether a call costs money. Recorded for run gating |
| `raw` | Marks the [escape hatch](#the-escape-hatch) |
| `evidence` | Free text on where the entry came from. The runtime ignores it |

**An option or schema attribute:**

| Field | Meaning |
|---|---|
| `name` | The script's name. Names starting with `_` are reserved, see [Paging](#paging) |
| `wire` | The API's exact spelling |
| `in` | Options only: `path:<placeholder>`, `query`, `header`, `body`, or `body:root` when this option is the whole body |
| `type` | `string`, `integer`, `number`, `boolean`, `sql` or `any` |
| `schema` | A name in `schemas`, in place of `type`, for an object |
| `required` | Missing it is an error |
| `style` | Query options holding arrays or objects: `repeat` (`a=1&a=2`, the default), `csv` (`a=1,2`) or `deep` (`created[gte]=1`) |
| `multi_segment` | Path options whose value may contain `/`, see [Security](#security) |
| `description` | Shown by completion |

**A schema** has `attributes`, plus `unknown` with the same values as on a function. An attribute with a `schema` accepts one object or an array of them, because real APIs and their own examples often disagree on which is right.

**`body: "form"`** encodes the same options as form fields, with nested objects as `a[b]=1`. **`body:root`** can't be combined with other body options, and takes an array or object, for calls such as `POST /warehouses/{name}:set-tags`.

**Generating a spec.** The usual route is an OpenAPI document, an [OpenAPI Overlay](https://spec.openapis.org/overlay/v1.0.0) with what it can't say, and a generator:
- OpenAPI is an input and not the format. None of the Snowflake, GitHub or Stripe documents describe paging in a machine-readable way, and real contracts are often narrower than the payloads they describe.
- The Overlay is the standard form of a list of updates applied in order, so a service's annotations live in a file of their own.
- A generator keeps schemas named. Stripe has 124 recursive references, so unfolding them doesn't terminate in practice.
- It reports the operations it can't express. Non-JSON responses are the expected ones.

**What stays out of a spec:**
- **Authentication and URLs.** They belong to the connection, see [Security](#security).
- **Expressions and hooks.** Only JSON pointers and fixed fields. Similar formats take the other route: Airbyte evaluates values as Jinja2, and dlt falls back to custom Python paginators. Neither fits a [no evaluated code](app_csp.md) app, and a format with hooks turns into a small language. An API outside the vocabulary pages less conveniently, by hand through `_raw`.
- **Workflow knowledge,** such as call order or what a status value means. That belongs in documentation, and the service decides.

## Connector binding

A connector enables a spec by adding a binding to its `ConnectorDescriptor` (`packages/dashql-app/src/connections/connector_descriptor.ts`):

```ts
interface FunctionSpecBinding<Details> {
    /// Load the spec, only when the connection needs it
    loadSpec(): Promise<FunctionSpec>;
    /// Resolve a host that the spec names. Async, since a token may need a refresh or an exchange.
    resolveHost(details: Details, host: string): Promise<{ baseUrl: URL; headers: Record<string, string> }>;
    /// The values of the `{variables}` in the base paths
    variables(details: Details): Record<string, string>;
}
```

When the connection is set up, the binding loads the spec and registers it on the connection's catalog. Requests go through the existing `HttpClient`. `headers` also carries what a service wants on every call, such as an API version header or a token type.

**A service with no SQL backend** would need a connector that runs no `SELECT`, with a setup UI and its own auth flows. That's later work, and it's not needed for a service that sits on an existing connection.

## Namespaces

**A namespace is reserved per connection, not globally.** `CALL cdp.x` on a connection with that spec is a call to the service. On any other connection it goes to the backend as written, because a Trino connection can have its own `cdp` schema.

- **Scope:** every `ConnectionState` owns its catalog, and a session belongs to the catalog it was created with, so registering on the catalog scopes the namespace to the connection.
- **Catalog version:** registering bumps it, so open scripts are analyzed again.
- **Multiple specs:** a connection can have several. Two with the same namespace is a registration error.
- **Shadowing:** on that connection, a registered namespace wins over a backend schema of the same name.

## Checks

The analyzer walks a `CALL` against the signature and reports through the existing diagnostics (`AnalyzerErrorSeverity`). A statement that doesn't parse has no tree, so it only gets a syntax error until it does.

| Text | Result |
|---|---|
| An unknown function | Error, with the closest names |
| An unlisted option or attribute | By the `unknown` setting of the function or schema, with the closest names |
| The same name, quoted (`"new_field" => 1`) | Accepted and sent as written. Quoting is how a script says it means it |
| A missing required option, or a duplicate | Error |
| A literal or `:param` where `sensitive` requires `secret()` | Error |
| A function other than `secret()` in a value | Error |
| A standard option the function doesn't support | Error, see [Paging](#paging) and [Pending results](#pending-results) |

| `unknown` | Unlisted, unquoted name |
|---|---|
| `error` (default) | Error |
| `warning` | Warning, and sent as written. For schemas that may be incomplete, such as ones inferred from examples |
| `allow` | Accepted silently. For free-form maps, whose keys keep the script's spelling |

**Reporting per attribute** means a script sees all its mistakes at once, each at its own location, with the embedded `SELECT` still analyzed.

**Scalar values aren't type-checked.** APIs disagree with their own specs too often, and the server decides. `:param` and `$$` are accepted in place of an object.

**Unions are permissive.** `oneOf` and `anyOf` variants become the union of their attributes. Snowflake has 25 discriminated schemas and Stripe 2,050 `anyOf`s, so completion can offer an attribute a given variant doesn't take. See [Open questions](#open-questions).

**Where unknown options go:** to the body if the function has one, otherwise to the query string. `EXPLAIN` shows the result.

## Completion

`Completion::compute` gets a branch before the dot and keyword logic, following the existing `complete_table_parameter`: if the cursor is in a `CALL` on a registered namespace, it answers from the signature and stops.

| Position | Candidates |
|---|---|
| `CALL tickets.\|` | Every function of the namespace |
| `CALL tickets.ticket_list (\|` | That function's options, minus those already used, required ones first |
| `assignee => (\|` | The attributes of that schema, minus those already used |
| `labels => [(\|` | The attributes of the array's item schema |
| Inside `(SELECT \|` | Core SQL, as usual |
| A free-form value | None |

**The position comes from tokens, not the tree,** because the text being typed usually doesn't parse. From the start of the statement, the walk keeps a stack with the key that opened each `(` and `[`. A `(` followed by `select`, `with`, `table` or `values` (not followed by `=`, or with `values` followed by `(`) starts embedded SQL, which falls through to normal completion. A wrong decision here only affects suggestions, since it isn't part of parsing.

The same walk tells a key position from a value position. Completion inside a string could use a spec's enum lists later.

**Highlighting:** names stay plain `NAME` nodes, so attributes aren't colored as keywords. The analyzer could report resolved options later if that's wanted.

## Parse tree changes

This is the write-up [core_parser.md](core_parser.md#changing-the-parse-tree) asks for.

**Motivation:** the statements above have no representation today, since the grammar has no `CALL` statement.

**New values, appended so existing ordinals don't move:**

| Kind | Values |
|---|---|
| `NodeType` | `OBJECT_SQL_CALL` |
| `AttributeKey` | `SQL_CALL_NAME`, `SQL_CALL_ARGS` |
| `StatementType` | `CALL` |
| `AConstType` | `DOLLAR_STRING` |
| `AnalyzerErrorType` | One value each for an unknown function, an unknown option, a missing option, a duplicate option, a non-secret sensitive value, a function in a value and an unsupported standard option |

**Reused:** `OBJECT_SQL_FUNCTION_ARG` for options, `OBJECT_EXT_VARARG_FIELD` and `OBJECT_EXT_VARARG_ARRAY` for objects and arrays, `OBJECT_SQL_SELECT` for embedded SQL, and `OBJECT_SQL_PARAMETER_REF` for `:param`.

**Names are `NAME` nodes,** not enums, so APIs can grow without changing `parsed_script.fbs`.

**Expressiveness:** no existing rule, node or attribute changes meaning, so every construct still parses as before and stays distinguishable. On the checked grammar, the conflicts resolved by precedence stay at 1,814 with no new conflicts, and no keyword list changes.

**Consumers that must change:**
- `parser/context.rs`: panics on an unknown statement root.
- `dashql-core/src/formatter/`: an unknown node renders as `'<OBJECT_...>'`, which fails the round-trip test.
- `dashql-core-session/src/planner.rs`: see [Running calls](#running-calls).
- `dashql-core-session/src/compiler.rs` and `dashql-core/src/pack.rs`, plus the labels in `dashql_story_decorations.ts`.
- `snapshots/parser`, `formatter`, `analyzer`, `completion` and `planner`.

## Running calls

**Core describes, the runtime sends.** Core turns a `CALL` into plain JSON with the namespace, function and options, unescaped strings and source spellings, with `{"param": "name"}` and `{"secret": "name"}` for what it can't resolve. The runtime applies the spec to it. So the rules for reading literals stay in Rust, and `EXPLAIN` shares the path.

**The planner** treats a `CALL` on a registered namespace as a barrier that the executor hands to the runtime. It stays in session order, and its text never reaches the backend.

**Rules for `effect: write`:**
- It never runs implicitly: not on opening a script, not on a rerun of dependents.
- Its result is never read from or written to the query result cache. `queryResultCaching` is on for most connectors, so this needs an explicit check.
- `ConnectorFeatures.readOnly` describes SQL and is what agents see, so run gating and agent policy have to treat writes separately.

**Other behavior:**
- **Waiting on a job is explicit.** Polling a job means calling its status function. There is no `AWAIT`. [Pending results](#pending-results) cover the different case where the HTTP response itself says it isn't finished.
- **No automatic retries.** Some POSTs aren't safe to repeat.

**Reading a result from another script.** [Script references](script_references.md) read a query like a view, by inlining it, which a `CALL` can't do. So a script with a single `effect: read` call can be referenced only from a script on the LOCAL connection, through the scan path: the call runs first, and its result is written as a Parquet file and scanned. A reference from any other connection is an error, as is a reference to a write. This extends the rule that a referenced script is a single `SELECT`, and it needs a change in the planner. `:param` values can't come from a result, since inputs are literals in `@param` tags, so a script reads more pages with `_pages`, not by passing `_next` from another script.

## Paging

A function has at most one `paging` entry, in one of four kinds:

| Kind | Fields | The next value is | Ends when |
|---|---|---|---|
| `url` | `from` | That URL | The value is absent or empty |
| `token` | `from`, `option`: the option that takes it | That token | The value is absent or empty, or `end` says so |
| `offset` | `option`, `size`, `start`: the first offset, `end` | Offset plus the rows returned | `end` says so |
| `page` | `option`, `size`, `start`: the first page, `end` | Page plus one | `end` says so |

**`from`** says where to read the value:

| `from` | Reads | Example |
|---|---|---|
| `/next/url` | A JSON pointer into the response body | Data 360's `nextPageUrl` |
| `header:Link#next` | The `rel="next"` entry of a `Link` header | Snowflake, GitHub |
| `header:<name>` | A response header | |
| `last_row:/id` | A field of the page's last row | Stripe's `starting_after` |

**`end`** is `empty_page` (the default), `short_page`, `{ "total": "/totalSize" }` or `{ "has_more": "/has_more" }`. It's per function, because a short page doesn't always mean the end. Only a documented rule ends a list early, so `empty_page` can cost one last call, but it can't lose rows.

```json
"paging": { "kind": "url", "from": "header:Link#next" }
"paging": { "kind": "token", "from": "last_row:/id", "option": "starting_after", "end": { "has_more": "/has_more" } }
"paging": { "kind": "offset", "option": "offset", "size": "batch_size", "start": 0, "end": { "total": "/totalSize" } }
"paging": { "kind": "page", "option": "page", "size": "per_page", "start": 1 }
```

### The `_next` column

Every result has a `VARCHAR` column `_next` with the raw next value, without encoding, so `EXPLAIN` and debugging stay readable.

- **Non-NULL means there may be more, and NULL means done.**
- **Offsets advance by the rows returned,** not the requested size, because some endpoints cap the page size.
- **A page with no rows but a next value returns one row** with only the standard columns, as a 204 does. Otherwise, an API that filters after paging would lose its position. The cost is that `count(*)` is off by one in that rare case.

### The `_next` option

Every paged function accepts `_next => <value>`:

| Kind | What the runtime does |
|---|---|
| `url` | Requests that URL with `GET` and no body, after the origin check. It replaces the path and query. Headers still apply |
| `token`, `offset`, `page` | Sets the spec's option. The other options apply as written, so a script repeats them |

- **A URL is always followed with `GET` and no body,** whatever the function's method. Snowflake declares a `Link` on 13 `POST` and `PUT` operations, and following one must not repeat the create.
- `_next => null` means the first page.
- Using `_next` together with the option it sets, such as `page_token`, is an error.
- The runtime can't check that the other options match the earlier call. The server decides what a mismatch does.
- An expired token fails the statement with the server's error.

### The `_pages` option

```sql
CALL tickets.ticket_list (project => 'OPS', page_size => 200, _pages => 10);
```

One call is one page unless a script asks for more, because every page can cost API calls. `_pages` asks for more, with a limit in the script:

- It defaults to 1 and always takes a number, with no `all`.
- Rows are concatenated, and `_next` on every row holds the value after the last page fetched, so a later call can continue.
- If a page fails, the whole statement fails, with no partial result.
- A token or URL that comes back unchanged is an error. The page limit bounds APIs that ignore offsets.
- It's only allowed on `effect: read` functions.

**Who uses what:**

| Consumer | Mechanism |
|---|---|
| A script that wants many rows | `_pages` |
| Someone browsing results | A "Next page" control that re-runs the statement with `_next` applied, without editing the script text, since tokens expire and scripts get shared |
| An agent or a person typing | A literal `_next => '...'` |

## Pending results

Some services answer before they finish. Snowflake declares `202` on 400 of its 418 operations, and [its guide](https://docs.snowflake.com/en/developer-guide/snowflake-rest-api/getting-started) says this happens to requests that take longer than 45 seconds. Without a rule, a create that hasn't finished would look like a success.

```json
"pending": { "status": 202, "poll": "header:Location" }
```

| `poll` | What the runtime does | Example |
|---|---|---|
| `header:<name>` | Requests that URL with `GET` and no body, after the origin check | Snowflake's `Location`, which points to `/api/v2/results/{handle}` |
| `same` | Repeats the request. Only allowed on `effect: read` | GitHub's statistics endpoints |

A status with no `pending` rule is an ordinary success. Data 360's `202`s on deletes are this case.

**The `_poll` column and option.** A function with `pending` has a `VARCHAR` column `_poll` and accepts `_poll => <value>`. It can't share `_next`, because a poll URL and a page token couldn't be told apart. A pending result is one row with only the standard columns, `_status = 202` and `_poll` set, and the UI shows it as not finished. Using `_poll` returns the function's normal result, or another pending one.

**The `_wait` option.** `_wait => 60` polls for up to that many seconds, honoring `Retry-After`. It defaults to 0.
- If the time runs out, the result is the pending row. That isn't an error, since the call is still running.
- It's safe for writes, because `header:` polling never re-sends the request.
- Canceling the statement stops the polling. It doesn't cancel the remote work.
- During `_pages`, a page that comes back pending waits within `_wait`, and otherwise fails the statement.

```sql
CALL snowflake.warehouse_create (name => 'etl', _wait => 120);
CALL snowflake.warehouse_create (_poll => '/api/v2/results/01b66701');
```

## Results and errors

**Every call returns one table.**

| Response | Rows | Columns |
|---|---|---|
| `rows` is set | One row per item | The item's fields. Other response fields go to `_meta` |
| Any other object | One row | The object's fields |
| No body (such as HTTP 204) | One row | Only the standard columns |

**`rows` has to be explicit.** "An object holding one array" isn't a usable rule: Stripe has 197 responses with one array plus other fields, and only 135 of those arrays are `data`. On GitHub, the array is often just `labels` or `topics` on a single object. A generator sets `rows` only from evidence, such as a list operation's documented field.

**Standard columns**, added after a function's own columns:

| Column | Type | Contents |
|---|---|---|
| `_status` | `INTEGER` | The HTTP status |
| `_next` | `VARCHAR` | The value for the next page, or `NULL` on the last page |
| `_poll` | `VARCHAR` | Only on functions with `pending`: the value to poll, or `NULL` when finished |
| `_meta` | `JSON` | Response fields outside the rows, or `NULL` |
| `_raw` | `JSON` | Row fields the spec doesn't list, or `NULL`. A new API field lands here, so no data is lost |

**Column types** are `VARCHAR`, `TIMESTAMPTZ`, `DATE`, `INTEGER`, `BIGINT`, `DOUBLE`, `BOOLEAN` and `JSON`. A value that can't be converted goes to `_raw`, and the column is `NULL`, so a spec that disagrees with a response doesn't fail the statement. JSON keeps the API's spelling, because it's the response as sent. Rows become Arrow through `translateAnyRowsToArrowBatch`, as Trino's do.

**Errors:** a non-2xx response fails the statement, with its status and the message from the `errors` pointers. A function can override this:

| `errors` field | Meaning |
|---|---|
| `error_if` | A pointer that fails the statement when present, for a 200 that carries errors |
| `empty_on` | Statuses that mean an empty result, such as a 404 |
| `message` | Pointers to try, in place of the spec's |
| `message_is_json` | The message is itself a JSON string |

## Secrets

```sql
CALL tickets.webhook_create (url => 'https://example.com/hook', signing_key => secret(hook_key));
```

Scripts get shared, so a secret must never be in one. A literal in a field marked sensitive is an error. `:param` doesn't qualify either, because `@param` values live in script text and bound literals reach the logs. `EXPLAIN` prints `secret(name)`. The store behind `secret()` belongs to the host and comes with session integration, so calls that need it stay unusable until then.

`sensitive` lists JSON pointers, with `*` for array items:

```json
"sensitive": [
  { "pointer": "/signing_key" },
  { "pointer": "/credentials/*/value", "public_when": { "param_name": ["user", "account"] } }
]
```

`public_when` covers lists of name and value pairs, where sensitivity depends on the neighbor. The default stays safe: a value is sensitive unless the listed attribute has a listed value.

## Security

A spec drives a client that holds credentials, so these hold for every spec:

- **A spec names hosts, the binding resolves them.** A spec has relative paths only, so it can't send a token to a host of its choosing.
- **URLs from responses stay on their origin.** A next or poll URL on another origin is an error, and it never receives the token. Relative ones resolve against the host.
- **Path values are percent-encoded,** so a value can't reach a different endpoint. A `multi_segment` option is encoded per segment, and a `.` or `..` segment is an error. GitHub has 68 operations whose path values can contain `/`.
- **Specs come with connectors,** never from script text.
- **`effect` is only trusted on a bundled spec.** If specs can come from elsewhere later, every non-GET counts as `write` whatever it declares, since a spec can't be allowed to talk itself past run gating.

**Browser reach:** CSP isn't a limit, since `connect-src` allows `http:` and `https:`. CORS is, in two ways:
- The app ships no CORS proxy, so a service has to allow the app's origin.
- A browser only shows a script `Link` and `Location` if the service lists them in `Access-Control-Expose-Headers`. Header paging and header polling need that checked per service, even where the request itself works.

Electron has an HTTP proxy (`packages/dashql-native-proxy/src/http_proxy.rs`) that should avoid this, but that path hasn't been traced for these calls.

## EXPLAIN

`EXPLAIN CALL` prints the resolved request and sends nothing: method, host, path with parameters filled in, query string and body. It makes no network calls, so it needs no credentials, and it shows the host's name if the binding can't resolve it.

## The escape hatch

A spec can include a function marked `"raw": true`, which reaches any endpoint with any method:

```sql
CALL tickets.request (method => 'POST', path => '/new-thing', host => 'api', body => (a = 1), someParam => 1);
```

- It takes `method`, `path`, `host` and `body`. Any other option becomes a query parameter.
- `host` is one of the spec's names, and `path` is relative, so the [security rules](#security) still hold.
- Its `body` accepts any value, because the call has no schema.
- Its result is one row with the response in `_raw`.
- It always counts as `write`, unless the method is `GET`.

## What was checked

A scratch copy of the assembled grammar got the rules above, with empty actions, and went through the repo's Bison with the real table skeleton. A small LR driver then ran on the resulting tables, with a Python model of the scanner.

- **Conflicts:** none, and precedence resolutions stay at 1,814, the same as the core grammar.
- **Size:** 49 more states and 3.8% more table text. No new tokens, apart from `DCONST`, which was modeled as `SCONST` and isn't in these figures.
- **Examples:** every `CALL` statement in this document and [the Data 360 documents](call/cdp/functions.md) parses. One block with a `(...)` placeholder was skipped.
- **Fixed cases:** 25 statements that must parse do, and 9 that must not don't. These include `(select = 1)`, `(select 1)`, `(with t as (select 1) select * from t)`, `limit => 1`, `:offset`, `secret(password)`, `SELECT 1 batch_size`, and the rejected `a = 1` at the top level and `EXPLAIN (analyze) CALL`.
- **The format:** [the survey](call/api_survey.md) measured the published specs of Snowflake, GitHub and Stripe against it. That was static analysis, and no spec was generated.

**What this doesn't show:**
- Nothing was compiled, so no Rust was type-checked. The Python scanner model tests the rules, not the Rust.
- The checks and the completion walk don't exist yet. The first design's prototype showed its expected sets exactly matched the options of all 538 Data 360 functions and the attributes of all 270 object options. The same properties become tests here.
- A spec's load time and size aren't measured.
- Nothing ran against a service.

## Roadmap

Each phase lands separately. None of them has started.

1. **Core:** generic `CALL`, `$$` strings, signature registration, checks and completion, formatter and snapshots, all tested with a made-up fixture spec. Until phase 2, a `CALL` on a registered namespace is a planner error, so nothing reaches a backend by accident.
2. **Runtime:** read-only calls, paging, polling and `EXPLAIN`, against a mock `HttpClient`.
3. **Generator:** OpenAPI plus Overlay to a spec. Run it over Data 360, Snowflake, GitHub and Stripe, and report how many operations each can express. It needs no org and no account, so it's a repeatable measure of whether the format stays general.
4. **First spec:** the [Data 360 spec](call/cdp/overview.md) and the Salesforce binding, read-only, followed by the live checks on an org.
5. **Writes:** mutating calls, the secret store, run gating and agent policy. To be designed; `effect` and `billed` are its input.
6. **Publish the format:** document it for other services, once phase 3's coverage is good and a second spec has run against a real service.

## Open questions

1. **Format stability.** `format` allows changes, but anything published has to keep working. This is why publishing comes last.
2. **Specs from elsewhere.** This document covers bundled specs. Loading others needs a trust decision, even with the security rules above.
3. **Variants.** Unions accept any variant's attributes. A `variants` field keyed by a discriminator could narrow completion and checks, but only Snowflake's 25 schemas would use it so far, and Stripe's `anyOf`s aren't discriminated.
4. **Spec size.** Stripe's OpenAPI document is 8 MB, with 18,407 attributes, and GitHub's is 14 MB. A spec has less in it, and it loads lazily, but its size hasn't been measured.
5. **`_next` on an empty page.** The one-row rule covers it, at the cost of `count(*)`. If that turns out to be wrong in practice, the alternative is carrying the value in result metadata, outside the table.
6. **Large uploads.** `$$...$$` works for small bodies. Larger ones probably need a reference to a session attachment.
7. **Non-JSON responses and streaming.** Out of scope for now. A binary or event-stream response has no table shape yet, and the generator leaves such functions out. They're rare: about 10 Snowflake operations, mostly Cortex and Spark Connect.
