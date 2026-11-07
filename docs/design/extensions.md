# Extensions

Status: proposed, with [the core](#the-core), [a read-only runtime](#the-runtime) and [the first spec](../../extensions/d360/clfn/docs/overview.md#the-spec-is-the-source) implemented. Salesforce connections register the spec, so scripts get checks and completion, but a client function call can't run in the app yet, and nothing has run against a real service.

An **extension** adds what DashQL needs for a service, in a folder of `extensions/`. It holds client functions and snippets so far. Extensions are bundled with the app and declarative: nothing gets installed, and an extension runs no code of its own.

A **client function** (`clfn` in paths) lets a DashQL script reach a remote REST service. `CALL <name>(<option> => <value>, ...)` is a generic statement, and client functions shadow one namespace on a connection: a call in that namespace runs in the client as an HTTP request and never reaches the connection's SQL backend. **Any other `CALL` goes to the backend as written.**

A declarative JSON document, the **spec**, describes the client functions of a service: its functions, their attributes, how they page and what they return. A **connector binding** says where the service is and how to authenticate.

- [CDP SQL](../../extensions/d360/clfn/docs/overview.md) is the first spec. It covers the Salesforce Data 360 API, and its documents live in [extensions/d360/clfn/docs/](../../extensions/d360/clfn/docs/).
- [The API survey](extensions/api_survey.md) measures this format against Snowflake, GitHub and Stripe, and records what similar formats do.

## Goals

1. **A new service needs a spec and a binding.** No change to the parser, core or the runtime.
2. **Core knows no service.** It has no word of any API, and it doesn't know about HTTP.
3. **`CALL` stays general.** It isn't reserved for API clients: a call outside the namespaces with a spec reaches the backend unchanged.
4. **Completion and checks come from the spec.** A script gets exactly the functions, options and nested attributes each position takes.
5. **A spec is data.** It has no expressions and no code. What doesn't fit reaches the script through `_raw` or the escape hatch.
6. **Everything is reachable.** A call or attribute the spec doesn't know yet can still be sent.

## Layers

| Layer | Knows about | Doesn't know about |
|---|---|---|
| **Core** (Rust) | `CALL`, namespaces, functions, typed named arguments, nested schemas, result columns | HTTP, any service |
| **Runtime** (TypeScript) | Building requests, paging, polling, errors, turning responses into result tables | Any service |
| **Connector binding** (TypeScript) | Host URLs, which credentials go to which host, path variables such as the API version | Individual functions |
| **Spec** (JSON) | Namespace, functions, API names, paging, schemas, effects | Credentials, absolute URLs |

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

- **`$$` strings are verbatim.** Nothing is trimmed, so `$$` followed by a line break starts the value with a line break. They're for text the grammar shouldn't touch: SQL it can't parse, CSV, formulas.
- **`(SELECT ...)` keeps core parsing and completion.** It's analyzed like any other query, and the text is sent as written. A service's SQL dialect isn't enforced, which is what `$$` is for.
- **Strings need unescaping.** Consumers currently read literals by stripping the outer quotes, without unescaping `''` (see [core_quirks.md](core_quirks.md)). Lowering has to unescape them, or a payload with an apostrophe is sent wrong.
- **Spelling comes from the spec or the source text.** `read_identifier` lower-cases unquoted names. Known names take their API spelling from the spec. Unknown and quoted ones read it from the token's byte span in `ScannerTokens`, because keyword names carry token indexes in their byte-span fields (see [core_quirks.md](core_quirks.md)).

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
- **A function is an ordinary call to the parser.** The check below rejects it in a value, with a better message than a syntax error.
- **`DCONST` is the `$$` string,** a scanner state of its own. It's a `LITERAL_STRING` node, and its text tells it from a quoted string. Only `call_scalar` takes the token, so `SELECT $$x$$` stays a syntax error.
- **`EXPLAIN`** gets its own production, so `EXPLAIN (analyze) CALL ...` doesn't parse.

**Why not generate the API into the grammar?** That was the first design: functions and attributes as keywords in a scanner mode, one rule per schema. It compiled cleanly and gave every completion for free, but:

| | Core today | Generic `CALL` | API in the grammar |
|---|---:|---:|---:|
| Tokens | 511 | 512 | about 2,350 |
| LR states | 2,297 | 2,347 | 29,812 |
| `tables.rs` bytes, without actions | 924,094 | 958,029 | 3,100,420 |

- **Every SQL user pays.** `collect_expected_symbols` (`packages/dashql-parser/src/parser/probe.rs`) loops over every token at each completion, so ordinary SQL would do about 4.6 times the checks.
- **The errors are worse.** `syntax_error` (`packages/dashql-parser/src/parser/driver.rs`) drops the expected list once more than 4 tokens qualify, and recovery works per statement, so one bad attribute loses the tree, including the embedded `SELECT`.
- **It rejects valid payloads.** A new attribute that happens to be a keyword elsewhere is a syntax error until the grammar is regenerated, and specs are often narrower than the real API.
- **The scanner needs a mode with boundaries,** and the grammar can't vary per connection or API version.
- **It duplicates the spec,** which the client needs at runtime anyway.

A separate Wasm module doesn't solve this. The script, cursor, analyzer and catalog live in core's linear memory, and embedded `SELECT` needs core's automaton.

## The spec

One JSON document per namespace, in an extension named for the API, which needn't equal the namespace. `extensions/d360/` holds the client functions of `cdp`:

| Folder | Holds |
|---|---|
| `clfn/spec/` | The source of `spec.json`, or the file itself. Data 360 generates it from YAML, and the app bundles what Bazel generates |
| `clfn/tests/` | A fixture per family: calls, the requests they should send, and responses with the tables they should give |
| `snippets/` | Workflows for the snippet browser, whose steps build on each other |
| `clfn/docs/` | The reference documents |

This is the whole shape of a spec, with one function:

```json
{
  "format": 1,
  "namespace": "tickets",
  "title": "Ticket Service",
  "hosts": {
    "api": { "base_path": "/api/v{api_version}" }
  },
  "errors": { "message": ["/error/message", "/message"] },
  "pending": { "status": 202, "poll": { "header": "Location" } },
  "schemas": {
    "Assignee": {
      "attributes": [
        { "name": "id", "api_name": "id", "type": "integer" },
        { "name": "notify", "api_name": "notifyUser", "type": "boolean" }
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
        { "name": "project", "api_name": "project", "in": "path", "type": "string", "required": true },
        { "name": "page_size", "api_name": "pageSize", "in": "query", "type": "integer" },
        { "name": "page_token", "api_name": "pageToken", "in": "query", "type": "string" }
      ],
      "rows": "/items",
      "columns": [
        { "name": "id", "api_name": "id", "type": "BIGINT" },
        { "name": "created_at", "api_name": "createdAt", "type": "TIMESTAMPTZ" }
      ],
      "paging": { "kind": "token", "from": { "body": "/nextPageToken" }, "option": "page_token" },
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
| `columns` | Known result columns: `name`, `api_name`, `type` |
| `paging` | See [Paging](#paging) |
| `pending` | Overrides the top-level value, or `null` for none |
| `errors` | Overrides, see [Results and errors](#results-and-errors) |
| `effect` | `read` or `write`, see [Running calls](#running-calls) |
| `billed` | Whether a call costs money. Recorded for run gating |
| `raw` | Marks the [escape hatch](#the-escape-hatch) |
| `evidence` | Free text on where the entry came from. The runtime ignores it |

**An option or schema attribute:**

| Field | Meaning |
|---|---|
| `name` | The script's name. Names starting with `_` are reserved, see [Paging](#paging) |
| `api_name` | The API's exact spelling |
| `in` | Options only: `path`, `query`, `header`, `body`, or `body_root` when this option is the whole body. A `path` option fills the placeholder of its `api_name`, which isn't sent any other way, so the placeholder is the spelling |
| `type` | `string`, `integer`, `number`, `boolean`, `object`, `sql` or `any`. Values aren't checked against it |
| `enum`, `format` | The values and the format of a scalar, such as `date-time`. Not checked either |
| `array`, `map` | The nesting of a value: how many arrays, and whether it's a map |
| `schema` | A name in `schemas`, in place of `type`, for an object |
| `required` | Missing it is an error |
| `style` | Query options holding arrays or objects: `repeat` (`a=1&a=2`, the default), `csv` (`a=1,2`) or `deep` (`created[gte]=1`) |
| `multi_segment` | Path options whose value may contain `/`, see [Security](#security) |
| `description` | For completion, which doesn't show it yet |

**Names are mapped explicitly, not converted by a rule.** A script writes `name`, and the request carries `api_name`, the API's exact spelling. A rule couldn't do this: APIs mix `primaryDMO`, `orderBy`, `orderby` and `dataSpace`, and some of those spellings differ per endpoint. A generator can derive `name` from `api_name`, but the spec records both. A missing `api_name` means the two are the same, and a name the spec doesn't list is sent as written, so `new_field` is not turned into `newField`.

There are three places to see the actual names: the reference of a spec, such as the **API name** column and the verb and path of every function in [the Data 360 reference](../../extensions/d360/clfn/docs/functions.md), the spec itself, and `EXPLAIN CALL`, which prints the request with its API names. Completion shows the script's names only, on purpose.

**A schema** has `attributes`, plus `unknown` with the same values as on a function. An attribute with a `schema` accepts one object or an array of them, because real APIs and their own examples often disagree on which is right.

**A union** is a schema with `variants` instead of `attributes`, for `oneOf` and `anyOf`. A value has to fit one variant, so a union is never flattened into one list of attributes:

```json
"Route": {
  "variants": ["SnowflakeRoute", "RedshiftRoute"],
  "tag": { "attribute": "type", "values": { "Snowflake": "SnowflakeRoute", "Redshift": "RedshiftRoute" } }
}
```

- `tag` is optional. The value of its attribute selects the variant, whatever the case of the value. A value that isn't listed, or that isn't known yet such as a `:param`, selects nothing.
- A name means one thing in a union: variants that share an attribute give it the same `api_name` and `schema`. A runtime can then spell a request without knowing the variant, and the core rejects a spec that breaks this.
- A variant is a plain schema, not another union. It's named on its own, so the same one can appear in several unions.

**`body: "form"`** encodes the same options as form fields, with nested objects as `a[b]=1`. **`body_root`** can't be combined with other body options, and takes an array or object, for calls such as `POST /warehouses/{name}:set-tags`.

**Generating a spec.** A spec can be written by hand or generated. [Data 360](../../extensions/d360/clfn/docs/overview.md#the-spec-is-the-source) edits YAML by hand and generates its spec and documents from it, so no fact has to be read back from prose. For another service, the usual route is an OpenAPI document, `annotations.yaml` with what it can't say, and a generator:
- OpenAPI is an input and not the format. None of the Snowflake, GitHub or Stripe documents describe paging in a machine-readable way, and real contracts are often narrower than the payloads they describe.
- The annotations use the [OpenAPI Overlay](https://spec.openapis.org/overlay/v1.0.0) format, a standard list of updates applied in order.
- A generator keeps schemas named. Stripe has 124 recursive references, so unfolding them doesn't terminate in practice.
- It reports the operations it can't express. Non-JSON responses are the expected ones.

**What stays out of a spec:**
- **Authentication and URLs.** They belong to the connection, see [Security](#security).
- **Expressions and hooks.** Only JSON pointers and fixed fields. Similar formats take the other route: Airbyte evaluates values as Jinja2, and dlt falls back to custom Python paginators. Neither fits a [no evaluated code](app_csp.md) app, and a format with hooks turns into a small language. An API outside the vocabulary pages less conveniently, by hand through `_raw`.
- **Workflow knowledge,** such as call order or what a status value means. That belongs in documentation, and the service decides.

## Connector binding

A connector enables a spec by adding a binding to its `ConnectorDescriptor` (`packages/dashql-app/src/connections/connector_descriptor.ts`):

```ts
interface ClientFunctionBinding {
    /// Load the spec, only when a connection needs it
    loadSpec(): Promise<ClientFunctionSpec>;
}
```

This is all that exists so far, and it's enough for checks and completion. Running a call will add two more, to resolve a host that the spec names, async since a token may need a refresh or an exchange, and to fill the `{variables}` of the base paths. Requests will go through the existing `HttpClient`, with the headers of the host also carrying what a service wants on every call, such as an API version header or a token type.

**A connection has its client functions as soon as it exists,** before any login, so a script gets its checks and completion without a token. `syncConnectionClientFunctions` (`connections/connection_client_functions.ts`) loads the spec and registers it on the connection's catalog. The catalog loader runs it on every change of the registry, and it drops the spec if the connection switches to a connector without it.

**A service with no SQL backend** would need a connector that runs no `SELECT`, with a setup UI and its own auth flows. That's later work, and it's not needed for a service that sits on an existing connection.

## Namespaces

**A spec shadows its namespace on a connection.** Everything under `cdp.` belongs to the spec, so a function it doesn't know is an error, and nothing under `cdp.` reaches the backend, even if the backend has a schema of that name. Every other `CALL` goes to the backend as written: another namespace, and `CALL cdp.x` on a connection without that spec, since a Trino connection can have its own `cdp` schema.

- **Scope:** every `ConnectionState` owns its catalog, and a session belongs to the catalog it was created with, so registering on the catalog scopes the namespace to the connection.
- **Catalog version:** registering bumps it, and the app marks the scripts of the connection as outdated, so they are analyzed again.
- **Clearing the catalog keeps the specs:** they come with the connector and not from the backend, so a reset of the connection doesn't change what a script may call.
- **Multiple specs:** a connection can have several. Two with the same namespace is a registration error.

## Checks

The analyzer walks a `CALL` against the signature and reports through the existing diagnostics (`AnalyzerErrorSeverity`). A statement that doesn't parse has no tree, so it only gets a syntax error until it does.

| Text | Result |
|---|---|
| A function the spec doesn't know | Error, with the closest name. The namespace is shadowed, so the backend never gets it |
| An unlisted option or attribute | By the `unknown` setting of the function or schema, with the closest names |
| The same name, quoted (`"new_field" => 1`) | Accepted and sent as written. Quoting is how a script says it means it |
| A missing required option, or a duplicate | Error |
| A function in a value | Error |
| A standard option the function doesn't support | Error, see [Paging](#paging) and [Pending results](#pending-results) |

| `unknown` | Unlisted, unquoted name |
|---|---|
| `error` (default) | Error |
| `warning` | Warning, and sent as written. For schemas that may be incomplete, such as ones inferred from examples |
| `allow` | Accepted silently. For free-form maps, whose keys keep the script's spelling |

**Reporting per attribute** means a script sees all its mistakes at once, each at its own location, with the embedded `SELECT` still analyzed.

**Scalar values aren't type-checked.** APIs disagree with their own specs too often, and the server decides. `:param` and `$$` are accepted in place of an object.

**A union checks one variant.** Its `tag` selects the variant if the value says which. Then every attribute in script order keeps the variants that take it:

| Script | Result |
|---|---|
| An attribute the selected variant doesn't take | Error at the attribute: `no attribute account_url when type is 'Redshift'` |
| An attribute that no variant left takes | Error at the attribute: `broker_endpoints does not fit the attributes before it` |
| Either of them, quoted | Accepted and sent as written, like any quoted name |
| A name that no variant takes | Same as any unlisted name, by the `unknown` of the variants left |
| Required attributes | One variant has to be satisfied. The closest one says what's missing, and a tie is a choice: `needs one of the attributes cron, event` |

**Where unknown options go:** to the body if the function has one, otherwise to the query string. `EXPLAIN` shows the result.

## Completion

`Completion::compute` has a branch before the dot and keyword logic, like `complete_table_parameter`: if the cursor is in a `CALL` of a namespace with a spec, it answers from the signature and stops (`packages/dashql-core/src/completion_clfn.rs`).

| Position | Candidates |
|---|---|
| `CALL \|` | The namespaces with a spec. If none matches, core SQL completes as usual |
| `CALL tickets.\|` | Every function of the namespace, those that only read first |
| `CALL tickets.ticket_list (\|` | That function's options, minus those already used, required ones first |
| `assignee => (\|` | The attributes of that schema, minus those already used |
| `labels => [(\|` | The attributes of the array's item schema |
| Inside `(SELECT \|` | Core SQL, as usual |
| A free-form value | None |

**Ranking** only looks at the spec and the typed text, and ties sort by name:

1. A prefix match ranks before any substring match. An empty prefix counts as a prefix.
2. Among options and attributes, a required one ranks first, then one of the spec, then a standard option.
3. Among functions, one that only reads ranks first.

The editor is the same as for SQL. Right after `.` or `(` it shows the first candidate as an inline hint, such as `access_policy_get` for `CALL cdp.|`. Typing a name opens the list, which holds the top 10 (`DASHQL_COMPLETION_LIMIT`), so a script finds a function by typing part of its name.

**The position comes from tokens, not the tree,** because the text being typed usually doesn't parse. From the start of the statement, the walk keeps a stack with the key that opened each `(` and `[`. A `(` followed by `select`, `with`, `table` or `values` (not followed by `=`, or with `values` followed by `(`) starts embedded SQL, which falls through to normal completion. A wrong decision here only affects suggestions, since it isn't part of parsing.

The same walk tells a key position from a value position. Completion inside a string could use a spec's enum lists later.

**The `CALL` keyword is only offered if the connection has a spec.** Otherwise it would sort ahead of `CREATE`, and ordinary SQL completion would change. A script can still write it, for a procedure of the backend.

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
| `AnalyzerErrorType` | `CLIENT_FUNCTION_UNKNOWN_FUNCTION`, `CLIENT_FUNCTION_UNKNOWN_OPTION`, `CLIENT_FUNCTION_MISSING_OPTION`, `CLIENT_FUNCTION_DUPLICATE_OPTION`, `CLIENT_FUNCTION_UNSUPPORTED_OPTION`, `CLIENT_FUNCTION_INVALID_VALUE` |

**Reused:** `OBJECT_SQL_FUNCTION_ARG` for options, an `ARRAY` of `OBJECT_EXT_VARARG_FIELD` for objects, `OBJECT_EXT_VARARG_ARRAY` for arrays, `OBJECT_SQL_SELECT_EXPRESSION` for embedded SQL, `OBJECT_SQL_PARAMETER_REF` for `:param`, and `LITERAL_STRING` for `$$` strings.

**Names are `NAME` nodes,** not enums, so APIs can grow without changing `parsed_script.fbs`.

**Expressiveness:** no existing rule, node or attribute changes meaning, so every construct still parses as before and stays distinguishable. On the checked grammar, the conflicts resolved by precedence stay at 1,814 with no new conflicts, and no keyword list changes.

**Consumers that must change:**
- `parser/context.rs`: panics on an unknown statement root.
- `dashql-core/src/formatter/`: an unknown node renders as `'<OBJECT_...>'`, which fails the round-trip test.
- `dashql-core-session/src/planner.rs`: see [Running calls](#running-calls).
- `dashql-core-session/src/compiler.rs` and `dashql-core/src/pack.rs`, plus the labels in `dashql_story_decorations.ts`.
- `snapshots/parser`, `formatter`, `analyzer`, `completion` and `planner`.

## Running calls

**Core describes, the runtime sends.** `AnalyzedScript::describe_client_function_call` turns a call into plain JSON, and the runtime applies the spec to it. So the rules for reading literals stay in Rust, and `EXPLAIN` shares the path.

```json
{
  "namespace": "tickets",
  "function": "webhook_create",
  "effect": "write",
  "explain": false,
  "options": { "url": null, "signing_key": null, "retries": 3 },
  "bindings": [
    { "pointer": "/url", "param": "hook_url" },
    { "pointer": "/signing_key", "param": "hook_key" }
  ]
}
```

- **A known name has the spelling of the spec,** any other the spelling of the script, so free-form keys and quoted names stay as written.
- **Strings are unescaped,** `$$` strings are verbatim, and a query is the text between its parentheses.
- **`bindings` holds what core can't resolve:** a parameter is a null in `options` and an entry with its JSON pointer. A marker inside `options` could collide with a real key, such as OData's `$filter`.

**The planner** treats a call in a namespace with a spec as a barrier that the executor hands to the runtime. It stays in session order, and its text never reaches the backend. Until the runtime exists, that makes it a planner error, so it can't reach a backend by accident. Any other `CALL` is an ordinary barrier that runs as written.

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
| `{ "body": "/next/url" }` | A JSON pointer into the response body | Data 360's `nextPageUrl` |
| `{ "link": "next" }` | The entry of a `Link` header with that `rel` | Snowflake, GitHub |
| `{ "header": "Location" }` | A response header | |
| `{ "last_row": "/id" }` | A JSON pointer into the page's last row | Stripe's `starting_after` |

**`end`** is `empty_page` (the default), `short_page`, `{ "total": "/totalSize" }` or `{ "has_more": "/has_more" }`. It's per function, because a short page doesn't always mean the end. Only a documented rule ends a list early, so `empty_page` can cost one last call, but it can't lose rows.

```json
"paging": { "kind": "url", "from": { "link": "next" } }
"paging": { "kind": "token", "from": { "last_row": "/id" }, "option": "starting_after", "end": { "has_more": "/has_more" } }
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
"pending": { "status": 202, "poll": { "header": "Location" } }
```

| `poll` | What the runtime does | Example |
|---|---|---|
| `{ "header": "Location" }` | Requests the URL in that header with `GET` and no body, after the origin check | Snowflake's `Location`, which points to `/api/v2/results/{handle}` |
| `{ "repeat": true }` | Repeats the request. Only allowed on `effect: read` | GitHub's statistics endpoints |

A status with no `pending` rule is an ordinary success. Data 360's `202`s on deletes are this case.

**The `_poll` column and option.** A function with `pending` has a `VARCHAR` column `_poll` and accepts `_poll => <value>`. It can't share `_next`, because a poll URL and a page token couldn't be told apart. A pending result is one row with only the standard columns, `_status = 202` and `_poll` set, which is the literal `same` for the poll rule `same`, and the UI shows it as not finished. Using `_poll` returns the function's normal result, or another pending one.

**The `_wait` option.** `_wait => 60` polls for up to that many seconds, honoring `Retry-After`. It defaults to 0.
- If the time runs out, the result is the pending row. That isn't an error, since the call is still running.
- It's safe for writes, because polling a URL from a header never re-sends the request.
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

## The core

| Part | Where | What it does |
|---|---|---|
| Statement | `grammar/rules/ext_call.y` | The generic `CALL` and its values. `StatementType::CALL` |
| `$$` strings | `packages/dashql-parser/src/scanner.rs` | The `Xdq` start condition and the `DCONST` token |
| Formatter | `formatter/explain.rs`, `formatter/mod.rs` | `call <name> (<options>)`, objects and arrays |
| Specs | `packages/dashql-core/src/catalog/clfn.rs` | `ClientFunctionSpec` reads the generic part of a document and ignores what only the runtime needs. `Catalog::register_client_functions` and `drop_client_functions` bump the catalog version |
| Checks | `packages/dashql-core/src/analyzer/clfn_calls.rs` | A pass after the others walks every call against its signature. `AnalyzedScript::client_function_calls` lists the calls in a namespace with a spec |
| Description | `AnalyzedScript::describe_client_function_call` | The JSON for the runtime, see [Running calls](#running-calls). `AnalyzedScript.client_function_calls` in the packed analysis carries it, so the app needs no second call |
| Bindings | `Catalog.registerClientFunctions`, `dropClientFunctions` | Wasm and `DashQLCatalog` in `packages/dashql-core-js/src/api.ts`. A binding registers the spec on the catalog of its connection |
| Completion | `packages/dashql-core/src/completion_clfn.rs` | The token walk, see [Completion](#completion) |
| Planner | `packages/dashql-core-session/src/planner.rs` | The barrier and the error, see [Running calls](#running-calls) |

**Tests:** `packages/dashql-snapshots/src/clfn_fixture.rs` holds a made-up ticket service, and a snapshot case selects it with `client_functions: tickets`. The `call` files in `snapshots/parser`, `formatter`, `analyzer`, `completion` and `planner` cover the statement, every check, and every position.

**Still missing in core:** result columns for script references, which the runtime phase needs, since a result only exists once a call can run.

## The runtime

`packages/dashql-app/src/connections/clfn/` holds the generic client. It knows no service.

| File | What it does |
|---|---|
| `clfn_spec.ts` | The types of the document and of the core's description |
| `clfn_specs.ts` | `loadClientFunctionSpec` loads a bundled spec as a chunk of its own, for `loadSpec` of a binding |
| `clfn_request.ts` | Builds a request from a description: API names, path encoding, query styles, body formats, followed URLs and the origin check |
| `clfn_runtime.ts` | `runClientFunctionCall` sends it through an `HttpClient`, with paging, polling and errors, and returns the result table. `explainClientFunctionCall` returns the request and sends nothing |
| `clfn_result_stream.ts` | The result as a `QueryExecutionResponseStream`, like every other query result |

**It only reads so far.** A call with `effect: write`, or a raw call with a method other than `GET`, fails before anything is sent. `EXPLAIN` works for every call, since it sends nothing.

**Nothing calls it yet.** Salesforce connections have their spec, for checks and completion, while the planner still rejects client function calls until a binding can resolve hosts. The tests use a mock `HttpClient`, so the browser behavior of real services, such as `Access-Control-Expose-Headers`, is still unchecked. `clfn_fixtures.test.ts` runs it on the real Data 360 spec.

## What was checked

- **Grammar:** no conflicts, and precedence resolutions stay at 1,814, the same as without `CALL`. It adds 50 states and one token.
- **Ordinary SQL:** every existing parser, formatter, analyzer, completion and planner snapshot is unchanged byte for byte.
- **Examples:** every `CALL` in [the Data 360 reference](../../extensions/d360/clfn/docs/functions.md) parses on the real parser and passes the real checks against the spec, and completion offers exactly what the reference lists, see [its tests](../../extensions/d360/clfn/docs/overview.md#the-spec-is-the-source).
- **The format:** [the survey](extensions/api_survey.md) measured the published specs of Snowflake, GitHub and Stripe against it. That was static analysis, and no spec was generated.

**What this doesn't show:**
- Most fixture responses are assumptions, built from the spec, so they check the runtime against the spec and not against Salesforce, see [the fixtures](../../extensions/d360/clfn/docs/overview.md#the-fixtures).
- The runtime only runs reads. Writes are only checked up to their requests.
- A spec's load time isn't measured.
- Nothing ran against a service.

## Roadmap

Each phase lands separately.

1. **Core:** generic `CALL`, `$$` strings, signature registration, checks and completion, formatter and snapshots, all tested with a made-up fixture spec. Done, apart from what [The core](#the-core) lists as missing.
2. **Runtime:** read-only calls, paging, polling and `EXPLAIN`, against a mock `HttpClient`. Done, see [The runtime](#the-runtime).
3. **Generators:** OpenAPI plus annotations to a spec in `extensions/`. Run it over Data 360, Snowflake, GitHub and Stripe, and report how many operations each can express. It needs no org and no account, so it's a repeatable measure of whether the format stays general.
4. **First spec:** the [Data 360 spec](../../extensions/d360/clfn/docs/overview.md) and the Salesforce binding, read-only, followed by the live checks on an org.
5. **Writes:** mutating calls, run gating and agent policy. To be designed; `effect` and `billed` are its input. A [secret store](../wip/secret_store.md) is deferred.
6. **Publish the format:** document it for other services, once phase 3's coverage is good and a second spec has run against a real service.

## Open questions

1. **Format stability.** `format` allows changes, but anything published has to keep working. This is why publishing comes last.
2. **Specs from elsewhere.** This document covers bundled specs. Loading others needs a trust decision, even with the security rules above.
3. **Tags beside an object.** A `tag` reads an attribute of the object itself. Some APIs select a variant with a sibling instead, such as `type` next to `config` in Data 360, so only the attributes of those objects decide. A `tag` that reads a sibling would close this, once a source says which value selects which variant.
4. **Spec size.** The Data 360 spec is 745 KB, or 62 KB gzipped, for 535 functions and it loads lazily. Stripe and GitHub would be larger, with 18,407 and 10,438 attributes against 4,018 here.
5. **`_next` on an empty page.** The one-row rule covers it, at the cost of `count(*)`. If that turns out to be wrong in practice, the alternative is carrying the value in result metadata, outside the table.
6. **Large uploads.** `$$...$$` works for small bodies. Larger ones probably need a reference to a session attachment.
7. **Non-JSON responses and streaming.** Out of scope for now. A binary or event-stream response has no table shape yet, and the generator leaves such functions out. They're rare: about 10 Snowflake operations, mostly Cortex and Spark Connect.
