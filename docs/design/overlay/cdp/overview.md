# CDP SQL

Status: proposed. Nothing here is implemented, and nothing has been tested against an org.

CDP SQL lets a DashQL script reach the whole Salesforce Data 360 API, with one function per API call. It's the first [overlay](../../overlay.md), and everything Salesforce-specific lives here. The statement, spec format, checks, completion, paging and results are generic, and [overlay.md](../../overlay.md) describes them.

- [functions.md](functions.md) is the function reference, with one document per family in this directory.
- [api_notes.md](api_notes.md) holds the research: API quirks, usage order, sources and a list of checks to run on an org.

## Goals

1. **Reach everything.** Every API operation can be called, and a call the spec doesn't know yet still works.
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
CALL cdp.query_sql_status (query_id => :query_id);

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
| `connect` | `/services/data/v{api_version}` | Configurable | The other `/ssot/*`, `/connect`, `/personalization` and `/semantic-engine` calls |

**`connect` stays configurable** because the sources conflict: the spec places these calls on the tenant host after a token exchange, while DashQL's metadata call works on the core host with the core token (see [the notes](api_notes.md#hosts-and-tokens)). The spec only names `connect`, so settling this on an org changes the binding and not 400 functions.

**The token exchange** stays in `SalesforceApiClient`, as `POST /services/oauth2/token` and `POST /services/a360/token` aren't functions. Tokens aren't refreshed today, so `resolveHost` has to handle that before long-running sessions can rely on it.

**`api_version`** comes from the binding. DashQL's own calls use v64.0, while the spec is v68, and the hosted server needs v66 or later. The binding could load a spec per API version later, which needs no rebuild.

**SIDB** spreads the Salesforce descriptor, so it would inherit the binding. Whether it should is an [open question](#open-questions).

**Connector flags:** `readOnly` and `queryResultCaching` are both on for Salesforce connections. See [the rules for writes](../../overlay.md#running-calls).

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
| 200 with errors (consent), 404 for an empty result (DMO mappings) | `errors` on those functions |
| Connect errors: an array whose `message` may be a JSON string | `errors` at the top level, with `message_is_json` |
| CSV upload (`ingest_job_upload`) | `body: "text/csv"`. The 150 MB case is an [open question](../../overlay.md#open-questions) |
| Credentials, where `value` is secret depending on `param_name` | `sensitive` with `public_when` |
| `agent_id`: a header on most agentic memory calls, a query parameter on one | `in` per function |
| Data space filtering that the API doesn't support | Not handled. Values are wire values, and the client adds no filtering |
| Segment SQL rules, call order, readiness | Stay out of the spec. The server decides, and [the notes](api_notes.md) explain |

Data 360's contract doesn't exercise the format much: it has no top-level array responses or form encoding, and it doesn't record response headers. [The survey](../api_survey.md) measures the format against APIs that do.

## Where attributes come from

The checks are only as good as the attributes. The official contract gives most of them, but it's often narrower than what its own examples send. For example, `dataspace_create` has `label` and `prefix` in its examples but not its schema, and `search_index_get` omits `runtime_status`, the field that says an index is ready. A spec built from the contract alone would reject real payloads.

So the spec is the contract plus annotations, built mechanically and labeled per row:

| Source | What it adds |
|---|---|
| Official contract | Functions, options, schemas, result columns, including `oneOf` and `anyOf` variants as a union of attributes |
| Spec examples | Request attributes and result columns that examples use but schemas omit |
| MCP payload examples and request classes | Attributes Salesforce's own server sends |
| Examples, for untyped objects | Schemas for what the spec types only as `object`, such as `match_rules` in `ir_create` |
| Path templates | Placeholders the spec's parameters omit |
| Review | A few corrections from reading the sources, such as `models = (models = [...])` in DBT segments |

The result: 4,035 attribute rows, 616 of them typed objects, and only 24 left free-form. The prototype generated these from the reference documents, so the documents are enough to build the spec.

**`unknown` follows the evidence:**

| Schema | `unknown` |
|---|---|
| Complete in the official contract | `error` |
| Inferred from examples, or otherwise possibly incomplete | `warning` |
| A declared map, or an object with no known attributes | `allow` |

A schema inferred from examples can miss attributes. The prototype hit this with `case_sensitive_match` and `source_object_name`. With `warning`, these still get sent, and quoting the name always works.

**The spec also disagrees with itself on values.** Enums often differ in case between schema and examples (`Direct` and `DIRECT`), and the field names `dataSpaceName` and `dataspaceName` both appear. Values aren't checked, so those reach the server, and the family documents call out the known conflicts.

## Functions and options

- **One function per HTTP operation.** Variants collapse: `datastream_create_snowflake` is an ordinary `datastream_create` with particular attributes.
- **Function names** follow Salesforce's MCP tool names without `d360_` where a tool exists, so its skills and examples transfer. Others follow the same `<noun>_<verb>` pattern, derived from the spec's summary.
- **Option names** are the API's names in snake_case. The rare clash between a body field and a path or query parameter gets a prefix on the body field: `segment_create` has both `dataspace` (query) and `body_dataspace` (body). A handful of functions need this.
- **Values are wire values.** Enums are the API's strings (`'Dbt'`), and ids and names are what each endpoint expects. Scripts see the API's quirks, on purpose. The function reference documents them.

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
    (param_name = 'user', value = secret(snowflake_user)),
    (param_name = 'privateKey', value = secret(snowflake_private_key))
  ]
);
```

Connection credentials are a list of `(param_name, value)` pairs, so whether `value` is secret depends on the `param_name` beside it. Every `value` must be `secret()` unless `public_when` lists that `param_name` as public (see [Secrets](../../overlay.md#secrets)). The spec's connector metadata may say which are public; that needs checking.

## The escape hatch

`cdp.request` is the spec's [raw function](../../overlay.md#the-escape-hatch):

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
    { "name": "dataspace", "wire": "dataspace", "in": "query", "type": "string" },
    { "name": "display_name", "wire": "displayName", "in": "body", "type": "string", "required": true },
    { "name": "include_dbt", "wire": "includeDbt", "in": "body", "schema": "CdpSegmentDbtInputRepresentation" },
    { "name": "body_dataspace", "wire": "dataSpace", "in": "body", "type": "string" }
  ],
  "columns": [{ "name": "api_name", "wire": "apiName", "type": "VARCHAR" }],
  "effect": "write",
  "billed": false,
  "evidence": "O"
}
```

`evidence` is `O`, `S`, `D` or `C` per function (see [the reference](functions.md#evidence)), plus a source per annotated attribute.

`effect` follows the method, except for reads that use `POST`, such as `transform_validate` and `ci_run_status`. `billed` gets set from the [cost checks](api_notes.md#live-checks).

## Roadmap

The [overlay roadmap](../../overlay.md#roadmap) comes first, up to its generator phase. For Data 360:

1. **Generator input:** the OpenAPI contract plus the annotations, producing the spec in `overlay/apis/cdp/`.
2. **Read-only binding:** host and token resolution, with `effect: read` functions only. Needs a browser CORS check, since only `GET` on `/services/data` is exercised today.
3. **Live checks:** [the list in the notes](api_notes.md#live-checks), which settles the host question.
4. **Writes:** all other calls, on the generic write rules. Ingestion needs its own CORS check, since no code calls `/api/v1/ingest` yet.
5. **High-level forms**, if wanted, compiling to `CALL cdp.*`. The canonical segment shapes in [the notes](api_notes.md#segment-sql) are the starting point, but multi-criterion segments need an org to test against.

## Open questions

1. **SIDB.** Its descriptor spreads Salesforce's, so it would get the binding too. Does SIDB have this API?
2. **CORS for writes.** If `POST`, `PATCH`, `PUT` and `DELETE` fail on `/services/data` from a browser, even with the org's allowlist, writes are Electron-only.
3. **Which spec version.** The API has versions, and a spec is generated from one. An older org could reject what completion offers. The binding could pick a spec per API version, but it's only worth generating more than one if this shows up in practice.
4. **Functions outside the spec.** The families marked `S`, `D` and `C` in the reference are written from tool sources and docs, not the contract, so their attributes are less certain. They default to `unknown: warning`.
5. **Unpublished endpoints.** Sources mention calls no function covers: `POST /personalization/decisions`, `/ssot/intelligent-context/{lens}/chunks`, `/ssot/metadata-entities/{nextBatchId}`, some semantic model endpoints, and community-reported agent calls. They work through `cdp.request` for now.
6. **The `query` family.** [functions.md](functions.md) lists a [Query](query.md) family with 4 functions, including `query_sql`, but its document is missing from the repository. It needs restoring or regenerating.
