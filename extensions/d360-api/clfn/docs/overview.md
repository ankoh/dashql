# CDP SQL

Status: the spec is in `extensions/d360-api/clfn/spec/`, and the core and the runtime read it. Salesforce connections register it, for checks and completion, and calls that read run in the app. Calls that write fail before anything is sent, and nothing has been tested against an org.

CDP SQL lets a DashQL script reach the whole Salesforce Data 360 API, with one function per API call. It's the first [extension](../../../../docs/design/extensions.md), and everything Salesforce-specific lives here. The statement, spec format, checks, completion, paging and results are generic, and [extensions.md](../../../../docs/design/extensions.md) describes them.

- [functions.md](functions.md) is the function reference, with one document per family in this directory.
- [api_notes.md](api_notes.md) holds the research: API quirks, usage order, sources and a list of checks to run on an org.

## Goals

1. **Reach everything.** Every API operation can be called, apart from [the Query API](#functions-and-options), and a call the spec doesn't know yet still works.
2. **Know the API.** Completion and checks cover every function, option and nested attribute.
3. **Prove the extension point.** Anything Data 360 needs goes into the generic format or the binding. Core and the runtime stay free of Salesforce.

**Why functions and not `CREATE SEGMENT`:** a verb-and-kind language needs a design for each kind of object, and it falls behind the API whenever an operation doesn't fit. High-level forms can come later and compile to `CALL cdp.*`, and `EXPLAIN` would show the calls they produce.

## The statement

```sql
CALL cdp.segment_create (
  dataspace => 'default',
  display_name => 'Any high-value order',
  description => 'Individuals with an order over 5000',
  segment_on_api_name => 'Individuals__dlm',
  segment_type => 'Dbt',
  publish_schedule => 'NoRefresh',
  include_dbt => (models = (models = [(
    name = 'any_high_value_order',
    sql = (
      SELECT DISTINCT Individuals__dlm.IndividualId__c, Individuals__dlm.KQ_IndividualId__c
      FROM Individuals__dlm
      JOIN SalesOrders__dlm ON Individuals__dlm.IndividualId__c = SalesOrders__dlm.IndividualId__c
      WHERE SalesOrders__dlm.TotalAmount__c > 5000
    )
  )]))
);

CALL cdp.segment_list (batch_size => 200, offset => 0);
CALL cdp.segment_list (batch_size => 200, _pages => 5);
CALL cdp.segment_publish (segment_id => '1sgRM0000000001');
CALL cdp.segment_get (segment_api_name => :segment);

/* Any endpoint the spec doesn't know yet */
CALL cdp.request (method => 'POST', path => '/ssot/new-thing', body => (a = 1));

/* Prints the resolved HTTP request, sends nothing */
EXPLAIN CALL cdp.segment_delete (segment_api_name => 'vip');
```

## The Salesforce binding

The Salesforce connector's descriptor (`packages/dashql-app/src/connections/salesforce/salesforce_connector_descriptor.ts`) enables the spec, so the spec shadows `cdp.` on Salesforce connections: nothing under it reaches the backend, and a function the spec doesn't know is an error. On any other connection, `CALL cdp.*` goes to the backend as written.

| Spec host | Base path | Token | Used by |
|---|---|---|---|
| `core` | `/services/data/v{api_version}` | Core OAuth token | Calls the spec says need the core token, such as `segment_list` and `segment_create` |
| `tenant` | none | Data 360 JWT | `/api/v1`, ingestion, agentic memory |
| `connect` | `/services/data/v{api_version}` | Core OAuth token, for now | The other `/ssot/*`, `/connect`, `/personalization` and `/semantic-engine` calls |

**`connect` takes the core host and token for now,** as DashQL's metadata call does, because the sources conflict: the spec places these calls on the tenant host after a token exchange, while that metadata call works on the core host with the core token (see [the notes](api_notes.md#hosts-and-tokens)). The spec only names `connect`, so settling this on an org changes `salesforce_client_functions.ts` and not 400 functions.

**The token exchange** stays in `SalesforceApiClient`, as `POST /services/oauth2/token` and `POST /services/a360/token` aren't functions. `resolveHost` reads the tokens of the connection's channel, and a call without a login fails. Tokens aren't refreshed today, so a call with an expired token fails with the service's error, and `resolveHost` has to handle that before long-running sessions can rely on it.

**`api_version`** comes from the binding, which sends 68.0, the version of the spec. DashQL's own calls use v64.0, and the hosted server needs v66 or later. The binding could load a spec per API version later, which needs no rebuild.

**SIDB** spreads the Salesforce descriptor and turns the binding off, since it isn't known whether it has this API, see the [open questions](#open-questions).

**Connector flags:** `readOnly` and `queryResultCaching` are both on for Salesforce connections. See [the rules for writes](../../../../docs/design/extensions.md#running-calls).

## How Data 360 fits the format

| Quirk | Where it goes |
|---|---|
| Token exchange, core or tenant host | The binding. A function only names its host |
| `next_page_url`, a result field | `paging` with kind `url` and `from: "/nextPageUrl"`, followed through `_next` |
| `offset` with `limit` or `batch_size` | Kind `offset` |
| `page_token`, from `nextPageToken` | Kind `token` |
| `continuationToken` in the response | Kind `token`, with a pointer to it |
| `nextBatchId`, which the spec gives no way to send | No `paging`. The function reads the first batch, and the rest goes through `cdp.request` |
| A short page that isn't the end (DLOs) | No `short_page` on that function. It follows its next URL until that's absent |
| `calculated_insights` requires `offset` alongside `page_token` | An ordinary option the script sets |
| Options in the path, query, header or body | `in`: 411, 542, 18 and 1,279 rows in the reference |
| `202` on some governance deletes | No `pending` for now, so it's an ordinary success, and job status stays explicit through status functions. The contract drops response headers, so whether these carry a `Location` [needs checking on an org](api_notes.md#live-checks) |
| 404 for an empty result (DMO mappings) | `empty_on` on that function |
| 200 with errors (consent) | The `result` column on every row, which a script reads. No `error_if`, since no source gives a pointer that means failure |
| Connect errors: an array whose `message` may be a JSON string | `errors` at the top level, with `message_is_json` |
| CSV upload (`ingest_job_upload`) | `body: "text/csv"`. The 150 MB case is an [open question](../../../../docs/design/extensions.md#open-questions) |
| `agent_id`: a header on most agentic memory calls, a query parameter on one | `in` per function |
| Data space filtering that the API doesn't support | Not handled. Values are API values, and the client adds no filtering |
| Segment SQL rules, call order, readiness | Stay out of the spec. The server decides, and [the notes](api_notes.md) explain |

Data 360's contract doesn't exercise the format much: it has no top-level array responses or form encoding, and it doesn't record response headers. [The survey](../../../../docs/design/extensions/api_survey.md) measures the format against APIs that do.

## The spec is the source

The extension lives in `extensions/d360-api/`, while its namespace is `cdp`. `clfn/spec/*.yaml` is edited by hand and holds everything, prose included: `clfn.yaml` the spec itself, and every other file one family with its functions and schemas. `clfn/spec/generate_spec.rs` generates two things from it and reads nothing back:

- `spec.json`, the facts that the core and the runtime read. It's a build output, `//extensions/d360-api:spec`, and isn't checked in.
- The family documents of [the reference](functions.md), which are checked in so that they can be read anywhere.

This writes the documents and [the fixtures](#the-fixtures):

```
bazel run //extensions/d360-api:update
```

| Spec | Number |
|---|---:|
| Functions, with `request` | 535 |
| Options | 2,254 |
| Schemas | 466 |
| Schema attributes | 1,889 |
| Result columns | 4,700 |
| Size of `spec.json` | 745 KB, 62 KB gzipped |

**Changing the API means editing the YAML.** Facts are plain fields, so a reworded sentence can't change what a call does. The prose sits next to them as block text: `description`, `example`, `result_description` and `notes` on a function, `description` on a schema, an attribute and a family. `spec_url`, `reference_url`, `tools` and `evidence` are for the documents too. None of this reaches `spec.json`. `overview.md`, `functions.md` and `api_notes.md` are written by hand, and the other documents here say at the top that they're generated.

**YAML can't change a type silently.** It reads `1.0` or `true` as something other than a string, so the generator fails on a value that isn't a string where one belongs, such as `enum: [1.0]`, and on a key that isn't a string. Quote those. It also fails on a schema that two families define, and on one that nothing defines.

**A family document lists** the schemas of its family and all that its functions and schemas reach, sorted. A schema is defined in one family, and other documents that reach it repeat its section.

**The app bundles `spec.json`.** `//packages/dashql-app:extensions` stages it for the `@dashql/extensions` alias, and `loadClientFunctionSpec('d360-api')` in `clfn_specs.ts` loads it as a chunk of its own. The binding calls it when a Salesforce connection exists, so a session without one doesn't load it.

**Corrections go into the YAML.** The contract marks some fields required that its own examples leave out, such as every body field of the `PATCH` of `ml_configured_model_update`. Those attributes aren't required there, with a note.

**The tests** in `//extensions/d360-api`:
- `generate_spec_test` tests the generator.
- `docs_up_to_date_test` fails if a family document isn't what the YAML generates.
- `spec_test` loads the spec into the core. Every `CALL` example in the reference and every snippet has to parse and pass the checks, and completion has to offer exactly the functions, the options of every function and the attributes of every object option.

Passing means an example has the shape the spec describes, not that the server accepts it.

## The fixtures

`extensions/d360-api/clfn/tests/` has a JSON file per family, generated from the spec and the examples of the reference:

```json
{
  "function": "segment_get",
  "call": "CALL cdp.segment_get (segment_api_name => 'Vip')",
  "description": { "...": "what the core describes" },
  "request": { "method": "GET", "host": "connect", "path": "/services/data/v68.0/ssot/segments/Vip", "query": [], "headers": {}, "body": null },
  "response": { "source": "assumed", "status": 200, "headers": {}, "body": { "...": "..." } },
  "result": { "rows": [{ "api_name": "api_name_value", "_status": 200 }] }
}
```

**There are 622 cases.** All 534 documented functions have a request, and 254 of the 256 reads have a response. Writes have no response yet, since the runtime only runs reads.

**Two implementations check each other.** `tests/generate_tests.rs` computes the expected request from the spec, separately from the runtime, and `clfn_fixtures.test.ts` compares the two in the browser, on `EXPLAIN` and on a mock `HttpClient`.

**Responses start as assumptions and get replaced by real ones.** An `assumed` response is built from the columns of the spec, so it shows that the runtime follows the spec, not that the spec is right. Replace `response` and `result` of a case with a real exchange, with `source: recorded` or `documented`, and regenerating keeps it. A real exchange must not contain tokens or the data of an org.

**Snippets** are workflows in `extensions/d360-api/snippets/<workflow>/<NN>-<step>.sql`, built from the examples of the reference. A single call of this API rarely does anything on its own, so the steps build on each other: `order-pipeline` goes from a Snowflake connection through a data stream, the data model, identity resolution, an insight and a segment to an activation, in the [documented order](api_notes.md#usage-order). The others are shorter, with most families having one, and `explore-the-org` only reads.

Names stay the same from step to step, and a value that only a result can give is a `:param`, which the description of the step explains. The tests hold every step to the checks and the rules of the snippet browser, but passing doesn't mean a workflow runs on an org, and the object names are made up. Most steps write, so they don't run yet.

## Where attributes come from

The checks are only as good as the attributes. The official contract gives most of them, but it's often narrower than what its own examples send. For example, `dataspace_create` has `label` and `prefix` in its examples but not its schema, and `search_index_get` omits `runtime_status`, the field that says an index is ready. A spec built from the contract alone would reject real payloads.

So the spec is the contract plus annotations, built mechanically and labeled per row:

| Source | What it adds |
|---|---|
| Official contract | Functions, options, schemas, result columns, including `oneOf` variants |
| Spec examples | Request attributes and result columns that examples use but schemas omit |
| MCP payload examples and request classes | Attributes Salesforce's own server sends |
| Examples, for untyped objects | Schemas for what the spec types only as `object`, such as `match_rules` in `ir_create` |
| Path templates | Placeholders the spec's parameters omit |
| Review | A few corrections from reading the sources, such as `models = (models = [...])` in DBT segments |

That merged knowledge is in the YAML.

**`unknown` follows the evidence:**

| Schema | `unknown` |
|---|---|
| Complete in the official contract | `error` |
| Inferred from examples, or otherwise possibly incomplete | `warning` |
| A declared map, or an object with no known attributes | `allow` |

A schema inferred from examples can miss attributes. The prototype hit this with `case_sensitive_match` and `source_object_name`. With `warning`, these still get sent, and quoting the name always works.

### Variants

The contract has 10 request attributes that are one of several schemas, and these become [unions](../../../../docs/design/extensions.md#the-spec). Each is named after its first use, such as `transform_create.definition`.

The contract declares no discriminators: variants inherit the attribute from a shared base, with the same enum. So nothing official says which value selects which variant. The `tag` of a union connects them where the value and the variant have the same name:

| Union | Tag | Values that select a variant | Values that select nothing |
|---|---|---|---|
| `transform_create.definition` | `type` | `DcSql`, `Sql`, `Stl` | `DbtHidden`, `SqlHidden`, `StlHidden` |
| `private_network_route_create.route` | `type` | `AmazonMsk`, `Databricks`, `Redshift`, `Snowflake` | `DatabricksInternalStage`, `SnowflakeInternalStage` |
| `segment_update.publish_schedule_info` | `frequency` | `Daily`, `Hourly`, `Minutely`, `Monthly`, `MonthlyRelative`, `None`, `Weekly` | `Transform` |
| `DataCleanRoomOutputConfigurationRepresentation.connection_attributes` | `connector_type` | `CleanroomAwsS3`, `CleanroomSnowflake` | |
| `MlRetrieverQueryTemplateDefinitionInputRepresentation.query_citation_definition` | `citation_type` | `Custom`, `Default` | |

The other 5 have no such attribute inside the object, so only their attributes decide: `CdpDataKitDeployComponentRepresentation.config`, `CdpDataKitDeployComponentConfigForBundle.bundle_config`, `ConnectorInputRepresentation.connector_details`, `DataKitComponentInputRepresentation.info` and `dataaction_target_create.config`. Variants that overlap stay possible together: `config = (template_dev_name = 'x')` fits several of the 27 variants of `config`.

The mapping is unverified until it runs against an org. A wrong entry rejects a valid call. Quoting the attribute that doesn't fit gets past that, and `cdp.request` takes anything.

**The spec also disagrees with itself on values.** Enums often differ in case between schema and examples (`Direct` and `DIRECT`), and the field names `dataSpaceName` and `dataspaceName` both appear. Values aren't checked, so those reach the server, and the family documents call out the known conflicts.

## Functions and options

- **The Query API is left out on purpose.** The Salesforce connection subsumes it: a script's `SELECT` already runs over that connection, so `/api/v1/query`, `/api/v2/query`, `/api/v3/query`, `/ssot/query`, `/ssot/queryv2` and `/ssot/query-sql` get no functions. `cdp.request` can still reach them.
- **One function per HTTP operation.** Variants collapse: `datastream_create_snowflake` is an ordinary `datastream_create` with particular attributes.
- **Function names** follow Salesforce's MCP tool names without `d360_` where a tool exists, so its skills and examples transfer. Others follow the same `<noun>_<verb>` pattern, derived from the spec's summary.
- **Option names** are the API's names in snake_case. The rare clash between a body field and a path or query parameter gets a prefix on the body field: `segment_create` has both `dataspace` (query) and `body_dataspace` (body). A handful of functions need this.
- **Values are API values.** Enums are the API's strings (`'Dbt'`), and ids and names are what each endpoint expects. Scripts see the API's quirks, on purpose. The function reference documents them.

## Naming

Options, nested attributes and result columns are snake_case. Unquoted names are lower-cased when scanned, so camelCase in a script carries no meaning, and the API isn't consistent about it anyway. The spec holds the exact spelling to send, per function and per schema, and the reference shows it in an **API name** column.

| API name | Script name | Rule |
|---|---|---|
| `segmentApiName` | `segment_api_name` | Split at each case change |
| `primaryDMO`, `supportedDMOTypes` | `primary_dmo`, `supported_dmo_types` | A run of capitals is one word |
| `orderBy`, `orderby` | `order_by` | Spellings that differ only in case or underscores are one name, and the most split form wins |
| `dataSpace`, `dataspace`, `dataSpaceName` | `dataspace`, `dataspace_name` | "Data space" is one word, matching the `dataspace` parameter and the `dataspace_*` functions |
| `DataSourceId__c` | `DataSourceId__c` | Salesforce object and field names stay as they are, as they do in SQL |
| `X-Chatter-Entity-Encoding` | `"X-Chatter-Entity-Encoding"` | Not an identifier, so it's quoted |

**These keep the API's spelling:**
- **Values,** including field names inside them: `segment_type => 'Dbt'`, `order_by => 'createdDate DESC'`.
- **Keys of free-form objects:** `additional_metadata => (someKey = 1)` sends `someKey`.
- **Unknown and quoted names,** which are sent as written.
- **JSON in results:** a column holding `status` reads as `status.queryId`, and so do the fields inside `_meta` and `_raw`.
- **Schema names,** such as `CdpSegmentDbtInputRepresentation`. A script never writes them.

**A path option's API name is its placeholder.** `dataaction_get` takes `action_developer_name`, which fills `{id}` in `/ssot/data-actions/{id}`.

**One name can hide two API spellings.** Five functions list both `dataSpaceName` and `dataspaceName`, because the spec's schema and its examples disagree. The spec sends the schema's spelling, and quoting the other one sends that instead. This needs checking on an org.

**Case in keys:** an unquoted API spelling such as `batchSize` scans as `batchsize`, which isn't a name in the spec, so the check suggests `batch_size`.

## Embedded SQL

- `sql = (SELECT ...)` gets parsing and completion, and the text is sent as written.
- `sql = $$ ... $$` is for SQL the core grammar can't parse, or shouldn't reformat, and for non-SQL such as Tableau formulas.

Data 360 has several SQL dialects (see [the notes](api_notes.md#sql-dialects)), so `$$` also keeps DashQL from blocking something the server would accept. CSV bodies need their first line right after the opening `$$`, because the first line is the header: write `$$id,name`, not `$$` on a line of its own.

## Credentials

```sql
CALL cdp.connection_create (
  label => 'prod',
  connector_type => 'SNOWFLAKE',
  credentials => [
    (param_name = 'user', value = :snowflake_user),
    (param_name = 'privateKey', value = :snowflake_private_key)
  ]
);
```

Connection credentials are a list of `(param_name, value)` pairs, as the API has them. A `value` can be a literal or a parameter.

## The escape hatch

`cdp.request` is the spec's [raw function](../../../../docs/design/extensions.md#the-escape-hatch):

```sql
CALL cdp.request (method => 'POST', path => '/ssot/new-thing', host => 'tenant', body => (a = 1), someParam => 1);
```

It's the only function with a `body` option.

## Spec excerpt

```json
{
  "name": "segment_create",
  "family": "Segments",
  "method": "POST",
  "path": "/ssot/segments",
  "host": "core",
  "options": [
    { "name": "dataspace", "api_name": "dataspace", "in": "query", "type": "string" },
    { "name": "display_name", "api_name": "displayName", "in": "body", "type": "string", "required": true },
    { "name": "include_dbt", "api_name": "includeDbt", "in": "body", "schema": "CdpSegmentDbtInputRepresentation" },
    { "name": "body_dataspace", "api_name": "dataSpace", "in": "body", "type": "string" }
  ],
  "columns": [{ "name": "api_name", "api_name": "apiName", "type": "VARCHAR" }],
  "effect": "write",
  "billed": false,
  "evidence": "O"
}
```

`evidence` is `O`, `S`, `D` or `C` per function (see [the reference](functions.md#evidence)), plus a source per annotated attribute.

`effect` follows the method, except for reads that use `POST`, such as `transform_validate` and `ci_run_status`. `billed` gets set from the [cost checks](api_notes.md#live-checks).

## Roadmap

The [extension roadmap](../../../../docs/design/extensions.md#roadmap) comes first. The spec exists. For Data 360:

1. **Read-only binding:** host and token resolution, with `effect: read` functions only. Built. It still needs a browser CORS check on the tenant host, since only `GET` on `/services/data` is exercised today.
2. **Live checks:** [the list in the notes](api_notes.md#live-checks), which settles the host question.
3. **Writes:** all other calls, on the generic write rules. Ingestion needs its own CORS check, since no code calls `/api/v1/ingest` yet.
4. **High-level forms**, if wanted, compiling to `CALL cdp.*`. The canonical segment shapes in [the notes](api_notes.md#segment-sql) are the starting point, but multi-criterion segments need an org to test against.

## Open questions

1. **SIDB.** Its binding is off. Does SIDB have this API?
2. **CORS for writes.** If `POST`, `PATCH`, `PUT` and `DELETE` fail on `/services/data` from a browser, even with the org's allowlist, writes are Electron-only.
3. **Which spec version.** The API has versions, and a spec describes one. An older org could reject what completion offers. The binding could pick a spec per API version, but it's only worth generating more than one if this shows up in practice.
4. **Functions outside the spec.** The families marked `S`, `D` and `C` in the reference are written from tool sources and docs, not the contract, so their attributes are less certain. They default to `unknown: warning`.
5. **Unpublished endpoints.** Sources mention calls no function covers: `POST /personalization/decisions`, `/ssot/intelligent-context/{lens}/chunks`, `/ssot/metadata-entities/{nextBatchId}`, some semantic model endpoints, and community-reported agent calls. They work through `cdp.request` for now.
