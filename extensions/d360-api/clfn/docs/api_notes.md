# Data 360 API Notes

The research behind [CDP SQL](overview.md), as of 2026-11. It records API quirks, usage order, what Salesforce's skills teach, what Snowflake and competitors do, where sources disagree, and what to check once an org is available.

**Nothing here was tested against an org.** Everything is what the sources claim.

Field names here use the API's spelling. Scripts write them in snake_case, see [Naming](overview.md#naming).

| Tag | Meaning |
|---|---|
| **D** | Official documentation |
| **S** | Salesforce-authored code or skill text |
| **X** | Official documentation, seen only through a search excerpt |
| **C** | Community source: code, or notes from live testing |
| **U** | Unverified or inferred |

## The headless move

| Date | Event |
|---|---|
| 2026-04-15 | [Headless 360 announced at TDX](https://www.salesforce.com/news/stories/salesforce-headless-360-announcement/): the platform exposed as APIs, MCP tools and CLI commands |
| 2026-05-26 | [Data 360 MCP Server developer preview](https://www.salesforce.com/blog/introducing-the-data-360-mcp-server-your-unified-data-ready-for-any-agent/), self-hosted |
| 2026-08-19 | [Expansion](https://www.salesforce.com/news/stories/expanding-headless-360-enterprise-capabilities/): Data 360 MCP Server GA, Headless 360 MCP Server in open beta |
| 2026-08-25 | [The seven `data360-*` phase skills removed](https://github.com/forcedotcom/sf-skills/commit/0851d45f78fdfa511bda12446c8cbe7c83c0d352) from `forcedotcom/sf-skills`, with no reason given |
| 2026-09-17 | [Now also called AIforce](https://help.salesforce.com/s/articleView?id=005360285&language=en_US&type=1). Usage will be metered per call, with multipliers still to be announced |

**The hosted server has a small surface:** [`search`, `payload_examples` and `execute`](https://developer.salesforce.com/docs/platform/hosted-mcp-servers/references/reference/data360-mcp.md), the last taking `{toolName, paramsJson}`. It needs API v66.0 or later, and its calls count as calls to the underlying Connect endpoints for limits and Flex Credits (D).

**No official `sf data360` CLI exists.** npm returns 404 for `@salesforce/plugin-data360`. `sf-cli-plugin-data360` is community-made, despite the name. The official plugin is [`plugin-data-code-extension`](https://github.com/salesforcecli/plugin-data-code-extension).

## Sources for the API surface

| Source | What it gives | Limits |
|---|---|---|
| [`FamilyCatalog.java`](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/runtime/FamilyCatalog.java) | 241 tools with verb and path, 223 distinct operations | The hosted server has tools the repo lacks, such as `d360_segment_count` |
| [`tools/*.java`](https://github.com/forcedotcom/d360-mcp-server/tree/main/src/main/java/com/salesforce/data360/mcp/tools) | Parameters and rule text per tool | MCP convenience parameters aren't always API names |
| [`payload-examples.json`](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/resources/metadata/payload-examples.json) | Example bodies for 89 tools | Some contradict the tool rules, see [Source conflicts](#source-conflicts) |
| [Official doc index](https://developer.salesforce.com/docs/llms-data-cloud.txt) | Per-operation pages for Query, ingestion and agentic memory | No per-operation Connect pages |
| [`connect-openapi-contracts.json`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/registry/connect-openapi-contracts.json) | **The main source.** The official v68 contract normalized by Salesforce's `sf-pi` repository: 414 operations, 1,210 schemas | Normalized, so it has no descriptions or examples |
| [`openapi.yaml`](https://github.com/javrrr/data-360-sdk/blob/main/src/generated/openapi.yaml) | A community copy of the official v68 YAML, with descriptions and examples | Older (September 2026): 386 operations. No license stated, so it's read, not vendored |
| [Connect API spec page](https://developer.salesforce.com/docs/data/connectapi/references/spec) | The human reference, and deep links | Its YAML returned 404 to plain requests, and this research didn't try to get around that |
| [Postman collection](https://www.postman.com/salesforce-developers/workspace/salesforce-developers/collection/12721794-fa94cb66-3cb1-41e1-ad4b-7c0ec34bb430) | Requests and bodies | Couldn't be read as raw JSON |

## Hosts and tokens

```
Core OAuth token ──POST /services/a360/token──▶ Data 360 JWT + tenant host
```

`POST {instance}/services/a360/token` is form-encoded: `grant_type=urn:salesforce:grant-type:external:cdp`, `subject_token=<core token>`, `subject_token_type=urn:ietf:params:oauth:token-type:access_token` (D). The response has `access_token`, `instance_url` and `expires_in`, and one official example shows 7196 seconds. Use `expires_in` rather than assuming a lifetime.

| Call | Host and token | Evidence |
|---|---|---|
| `/api/v1`, `/api/v2`, `/api/v3`, ingestion, agentic memory | Tenant host, Data 360 JWT | D. A core token on ingestion returns 401 (C) |
| `/services/data/vXX/ssot/*` | **Sources conflict.** The spec's server is `https://{dne_cdpInstanceUrl}/services/data/v{version}`, and the Connect guide and Postman setup exchange first (D). DashQL's metadata call works on the core host with the core token, and live tests agree (C). The spec also says `segment_list` and `segment_create` need the core token (D) | Make this configurable |
| `/api/v1/agentic/*` | `agent_id` is a header on most calls, a query parameter on `memory_context_get` | D |

**DashQL today** (`salesforce_api_client.ts`): `/ssot/metadata` on the core host with the core token, on API v64.0, and Hyper over HTTP on the tenant host. Only `GET` on `/services/data` is exercised, so CORS for other verbs is unknown. It needs the org's CORS allowlist. Tokens aren't refreshed.

**Scopes:** `api` (needed for the exchange), `cdp_api`, `cdp_query_api`, `cdp_profile_api`, `cdp_ingest_api` (X, C).

## Usage order

The phases are `connect → prepare → harmonize → segment → act`, with retrieve alongside ([community skill](https://github.com/Jaganpro/sf-skills/blob/main/skills/sf-datacloud/SKILL.md)). The dependency graph is finer:

```
Data space → Connection → Stream → DLO → Mapping → DMO → Relationship
           → Identity resolution → Calculated insight → Segment → Activation target → Activation
```

This comes from community guides and skills (C). Notes from Salesforce's own material:

- **Refresh order:** ["Identity Resolution → Calculated Insights (one-by-one) → Segment (fire-and-forget)"](https://github.com/salesforce-misc/Data360AgentforceSolutionKitRetail/blob/main/.claude/skills/refresh-data-cloud-components/SKILL.md) (S).
- **Segments:** "All CIs referenced in segment filters must be in ACTIVE status before creation." (S)
- **Prediction jobs:** the definition must be `Active` before it runs, and the configured model `Enabled` (S).
- **Custom DMOs:** they need `dataSpaceName` set before a search index can use them, about 90 s after creation (C).

## Readiness

| Object | Ready signal | Observed wait | Evidence |
|---|---|---|---|
| Query | `completionStatus`: `Running`, `ResultsProduced` or `Finished` | Long-poll with `waitTimeMs`, up to 10 s | [D](https://developer.salesforce.com/docs/data/connectapi/guide/query-use-case.md) |
| Identity resolution | `lastJobStatus` = `SUCCESS` (not `rulesetStatus`) | 15–20 min | S, single-org kit |
| Calculated insight | `lastRunStatus` = `SUCCESS` | Up to 10 min, one at a time | S, kit |
| Segment publish | `publishStatus`, using the `1sg` id | Fire and forget, over 5 min seen | S, C |
| Data kit | `jobStatus` = `Complete` or `Completed`; failure may be `Error`, "not `Failed`" | 25–45 min | S, kit |
| Search index | `runtimeStatus` = `READY`. afd360 also accepts `SUBMITTED` and `IN_PROGRESS` | Several minutes | C. The field is in the spec's examples, not its schema |
| Mapping | Create returns `CREATING`, verify with GET | | X |
| Bulk job | `Open`, `UploadComplete`, `InProgress`, `JobComplete`, `Failed`, `Aborted` | | D |
| Setup version | `status`; send `Training` to start | | S |

**Traps:**
- `lastJobCompleted` shows the previous run, and Title Case comparisons "silently never match" (S, kit).
- Ingestion's 202 means accepted, not queryable. Streaming processes about every 3 minutes, and errors surface in Problem Records DLOs (X, C).
- I found no documented wait after creating metadata, so poll.

## Peculiarities

**Keying:** verbs on one object differ. Segment publish takes the id, delete and update the name, and deactivate either. Activations are id-only. Retriever GET needs the parent name, not the `activeConfiguration` name (S).

**Verbs:** transforms and activations update with `PUT`, most others with `PATCH`. `transform_validate` and `ci_run_status` are reads that use `POST`. `prediction_job_def_activate` is a `PATCH` with a status body.

**Pagination has no common shape (C):**

| Collection | Style |
|---|---|
| Data streams | `nextPageUrl`, offset counts from 1 |
| DLOs | `limit` capped at 20, and data space filtering runs **after** paging, so short pages don't mean the end |
| Segments, activations | `batchSize`, `offset` from 0. Only segments return `totalSize` |
| Calculated insights | `pageToken`, yet still requires `offset` |
| Query SQL | `offset`, `rowLimit` |
| Agentic memory | `page_token` |

Some collections ignore page size, which can make offset loops repeat forever.

**Data space:** supported as a query parameter on metadata, mappings, segments, insights and graph metadata. Not supported on DLOs, streams, activations, targets and identity resolution, which need client-side filtering (C). For segment creation it's a query parameter, "NOT a body field" (S).

**Empty results vary (C):** a DMO with no relationships returns 204 with no body, a DMO with no mappings returns 404, and `/calculated-insights` without `definitionType` returns 0 items.

**List and detail shapes differ (C):** stream lists omit mappings even with `includeMappings=true`, activation lists omit attributes, identity resolution responses have no developer name, and `includeCriteria` is a JSON string with HTML entities.

**Metadata views disagree (C):** `/metadata` returns only DMOs in use and lists each active relationship twice, while `/data-model-objects` returns everything.

**Errors:** Connect returns an array whose `message` may be a JSON string (C). Consent can return 200 with errors (X). A bulk abort race returns 409 (C).

**Retries:** retrying a retriever POST ["creates DUPLICATE"](https://github.com/salesforce-misc/Data360AgentforceSolutionKitRetail/blob/main/.claude/skills/create-individual-retrievers/SKILL.md) (S). Retry 429 and 503 honoring `Retry-After`, on idempotent methods only (C).

**Credits:** query charges are on rows processed, not returned, so `LIMIT` doesn't lower the cost (C). MCP and API calls count against Connect limits and Flex Credits (D).

**Blast radius (S):** `dmo_delete` cascades to dependent objects, `connection_delete` breaks dependent streams, `ci_delete` breaks dependent segments, and predictive artifact deletes leave configured models orphaned.

**UI-only gaps:** the official kit [refreshes CRM streams with Playwright](https://github.com/salesforce-misc/Data360AgentforceSolutionKitRetail/blob/main/.claude/skills/refresh-data-streams/SKILL.md), and not every connector has an API path for stream creation (S, C). A [community readiness classifier](https://github.com/Jaganpro/sf-skills/blob/main/skills/sf-datacloud/references/feature-readiness.md) separates `ready`, `ready_empty`, `partial`, `feature_gated` and `blocked`, because features vary per org (C).

**Not found:** public CRUD for federation or a credit consumption API (U). Data shares do have a public API, in the contract: see [Data Shares](data_shares.md).

**The spec is narrower than its examples.** This came up in most families. Examples send attributes the schema omits (`creationMode` on data graphs, `advancedAttributes` on stream updates), declare arrays but send one object (`dataMapping`, `frequency`), and spell enums differently (`Direct` and `DIRECT`). The function reference includes these with a label, and [the language doc](overview.md#where-attributes-come-from) explains why.

**Coverage beyond what earlier research found:** the contract has whole families that community clients barely touch: Data Governance (72 operations), Notebook AI (35), Communication Capping (17) and Data Shares (11).

## Naming

| Thing | Rule | Evidence |
|---|---|---|
| Suffixes | `__dlm` DMO, `__dll` DLO, `__c` field, `__cio` insight, `ssot__` standard namespace, `KQ_<field>__c` key qualifier | X, C |
| Generated names | `<x>_chunk__dlm`, `<x>_index__dlm`, `Unified*`, `*IdentityLink__dlm` | X, C |
| Characters | Start with a letter; alphanumerics and underscores; no trailing or consecutive underscores | X |
| Length | 40 characters or fewer for data kit deployment | X |
| Identity ruleset id | Up to 4 characters, immutable, embedded in generated DMO names | X |
| Custom CRM fields | `Foo__c` becomes DLO `Foo_c__c`; streams show `customField_c` | C, D |

`__dlm` handling is disputed: see [Source conflicts](#source-conflicts).

## SQL dialects

Data 360 has several, and DashQL's grammar can't enforce their differences.

| Dialect | Where | Notes |
|---|---|---|
| Query SQL | A script's `SELECT` over the connection | Shared with the Hyper API; treat as read-only. Parameters: `:name` (D) |
| Segment SQL | `includeDbt` | Below |
| Insight SQL | `ci_create` | `apiName` ends in `__cio`, columns as `table.column`, no `COUNT(DISTINCT)` (use `APPROX_COUNT_DISTINCT`), subqueries, `CAST AS FLOAT` or `CURRENT_DATE - INTERVAL` (S). No dimensions or measures arrays |
| Transforms | `transform_create` | Batch DCSQL. Streaming SQL allows row-level functions, no aggregates or window functions. On joins, the payload note rejects outer joins (S), while Help allows `LEFT JOIN` (X) |

### Segment SQL

From the [`d360_segment_create` description](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/SegmentTools.java) (S). It's the best single source for these rules, and it quotes the rejection messages.

**Shape:** `{displayName, segmentOnApiName, segmentType: 'Dbt', publishSchedule, includeDbt.models.models[].{name, sql}}`. Note the doubly nested `models`. `publishSchedule` is one of `NoRefresh`, `One`, `Two`, `Four`, `Six`, `Twelve`, `TwentyFour`. Other segment types (`Dynamic`, `Lookalike`, `Realtimez`, `Waterfall`, `EinsteinGptSegmentsUI`) use their own criteria fields. SQL can't change through `PATCH`.

**Rules:**
1. Tables and columns must exist in the data space's metadata.
2. Primary `SELECT` items are unaliased, fully qualified columns. No table aliases, `CASE`, functions or arithmetic there. `DISTINCT` and `ORDER BY` are allowed.
3. Project the primary key and, if configured, its key qualifier.
4. `ON` is a single bare equality between qualified identifiers on the primary key. Filters go in `WHERE`.
5. Join keys must be a declared DMO relationship. Tables can't repeat. No `CROSS`, comma, `NATURAL`, `LEFT_SEMI` or `LEFT_ANTI` joins, and no `USING`.
6. No `EXISTS`, `EXCEPT`, `MINUS`, `LATERAL` or correlated subqueries. `UNION` and `INTERSECT` are "subject to structural rules", which aren't published.
7. `FROM` holds DMO names only, no derived tables.
8. `CAST` only to varchar, int, decimal, date, timestamp or boolean, and varchar needs a precision.

**Guards for inner joins**, always in `WHERE`: NULL-safe key qualifier equality, an empty-string primary key check, and `IS NOT NULL` on filter fields. **Not for `LEFT JOIN`:** a predicate on the right side in `WHERE` collapses it to an inner join.

| Rejection message | Rule |
|---|---|
| `Invalid SQL. Please provide a valid SQL.` | Unrecognized syntax, such as `IS NOT DISTINCT FROM` |
| `Incorrect join condition structure: ...` | Extra predicate or compound equality in `ON` |
| `Sql kind: 'EXISTS' not supported` | Disallowed construct |
| `Need api name of DMO` | Table alias or derived table in `FROM` |
| `You must project a key qualifier along with the primary key` | Missing qualifier |
| `No relationship exists between the provided keys` | Keys aren't a declared relationship |
| `Primary select should only contain unaliased fully qualified identifiers` | `CASE`, function or alias in the primary `SELECT` |

**Canonical shapes**, from `payload-examples.json`. All pass `dashql lint`.

```sql
/* Attribute filter */
SELECT Individuals__dlm.IndividualId__c, Individuals__dlm.KQ_IndividualId__c
FROM Individuals__dlm
WHERE Individuals__dlm.FirstName__c = 'Robot'
  AND trim(cast(Individuals__dlm.IndividualId__c as varchar(255))) <> '';

/* At least one related row matches */
SELECT DISTINCT Individuals__dlm.IndividualId__c, Individuals__dlm.KQ_IndividualId__c
FROM Individuals__dlm
JOIN SalesOrders__dlm ON Individuals__dlm.IndividualId__c = SalesOrders__dlm.IndividualId__c
WHERE (Individuals__dlm.KQ_IndividualId__c = SalesOrders__dlm.KQ_IndividualId__c
       OR (Individuals__dlm.KQ_IndividualId__c IS NULL AND SalesOrders__dlm.KQ_IndividualId__c IS NULL))
  AND trim(cast(Individuals__dlm.IndividualId__c as varchar(255))) <> ''
  AND SalesOrders__dlm.TotalAmount__c IS NOT NULL
  AND SalesOrders__dlm.TotalAmount__c > 5000;

/* An aggregate over related rows passes a threshold */
SELECT Individuals__dlm.IndividualId__c, Individuals__dlm.KQ_IndividualId__c
FROM Individuals__dlm
JOIN SalesOrders__dlm ON Individuals__dlm.IndividualId__c = SalesOrders__dlm.IndividualId__c
WHERE (Individuals__dlm.KQ_IndividualId__c = SalesOrders__dlm.KQ_IndividualId__c
       OR (Individuals__dlm.KQ_IndividualId__c IS NULL AND SalesOrders__dlm.KQ_IndividualId__c IS NULL))
  AND trim(cast(Individuals__dlm.IndividualId__c as varchar(255))) <> ''
  AND SalesOrders__dlm.TotalAmount__c IS NOT NULL
GROUP BY Individuals__dlm.IndividualId__c, Individuals__dlm.KQ_IndividualId__c
HAVING SUM(SalesOrders__dlm.TotalAmount__c) > 1000;

/* No related row matches: no guards in WHERE */
SELECT Individuals__dlm.IndividualId__c, Individuals__dlm.KQ_IndividualId__c
FROM Individuals__dlm
LEFT JOIN SalesOrders__dlm ON Individuals__dlm.IndividualId__c = SalesOrders__dlm.IndividualId__c
GROUP BY Individuals__dlm.IndividualId__c, Individuals__dlm.KQ_IndividualId__c
HAVING SUM(CASE WHEN SalesOrders__dlm.TotalAmount__c IS NOT NULL AND SalesOrders__dlm.TotalAmount__c > 10000 THEN 1 ELSE 0 END) = 0;
```

These cover one criterion. Combining criteria would need `INTERSECT` or `UNION`, whose structural rules aren't published.

## Zero copy

The ways to read an outside warehouse without ingesting it, and what `snippets/zero-copy/` shows for each. The official guides answer automated requests with a 403, so what they say comes from search excerpts of them.

| Mode | Where it is set | Snowflake | BigQuery | Databricks | Redshift |
|---|---|---|---|---|---|
| Live query | The default of a stream | yes | yes | yes | yes |
| Acceleration | `refresh_config.is_acceleration_enabled` on the stream | yes | yes | yes | yes |
| Unloading | An attribute of the connection | yes | yes | not documented | not documented |
| File federation | A connector of its own | yes | no | yes | no |

**Live query and acceleration:** [Trailhead](https://trailhead.salesforce.com/content/learn/modules/data-cloud-with-zero-copy/explore-use-cases-for-zero-copy-data-federation) describes both and says a file federation connector is always live-queried. The [interoperability guide](https://architect.salesforce.com/docs/architect/decision-guides/guide/data-360-interoperability.html) gives the cache interval of 15 minutes to 7 days, and says an incremental refresh only upserts.

**Unloading:** it only affects accelerated streams. The same guide says Snowflake's is on by default. The [BigQuery connection guide](https://developer.salesforce.com/docs/data/data-cloud-int/guide/c360-a-set-up-bigquery-connection.html) calls it a connection-level property that exports to a temporary Cloud Storage bucket. `unloadData` comes from a [community recipe](https://github.com/javrrr/afd360/blob/main/skills/afd360/references/connector-snowflake.md) for Snowflake, and Salesforce's [MCP tool](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/SnowflakeConnectionTools.java) doesn't send it.

**File federation:** [Snowflake](https://developer.salesforce.com/docs/data/data-cloud-int/guide/c360-a-set-up-snowflake-file-federation-connection.html) goes through Open Catalog and [Databricks](https://developer.salesforce.com/docs/data/data-cloud-int/guide/c360-a-set-up-databricks-file-federation-connection.html) through Unity Catalog. [One post](https://www.salesforceblogger.com/2025/11/10/unlocking-peak-performance-in-zero-copy-federation-a-guide-to-data-locality/) lists neither BigQuery nor Redshift, [another](https://www.concret.io/blog/zero-copy-architecture-snowflake-databricks-bigquery) rules out BigQuery, and the [Redshift connector page](https://developer.salesforce.com/docs/data/data-cloud-int/guide/c360-a-redshift-connector.html) only covers data federation. No primary source excludes them outright.

**What the snippets guess.** No source gives these, so they are written from the labels of the setup pages:

| Snippets | Guessed |
|---|---|
| Databricks query federation | `clientId`, `clientSecret`, `url`, `httpPath`, and the stream's use of `database` for the catalog |
| Databricks file federation | `accessToken`, `catalogUrl`, and the connector's name, so it is a `:param` |
| Snowflake file federation | `clientId`, `clientSecret`, `catalogUrl`, and the connector's name, so it is a `:param` |
| BigQuery unloading | `unloadData`, `gcsBucket`, `temporaryDataset` |
| Every Redshift and Databricks stream | The shape of a Snowflake stream. [Community code](https://github.com/javrrr/data-360-sdk/blob/main/src/schemas.ts) says Databricks takes `Direct_Access`, and nothing shows a Redshift stream |

The Redshift connection comes from a [community example](https://github.com/Jaganpro/sf-skills/blob/main/skills/sf-datacloud-connect/examples/connections/redshift.json), the BigQuery one from [community code](https://github.com/javrrr/data-360-sdk/blob/main/src/schemas.ts).

## Source conflicts

| Topic | One source | Another |
|---|---|---|
| `IS NOT DISTINCT FROM` in `ON` | [DBT validation guide](https://developer.salesforce.com/docs/data/connectapi/guide/features_cdp_dbt_validations.md): allowed for key qualifiers (D) | Tool text: rejected, with the error message (S) |
| Subqueries | Guide: allowed in `WHERE` (D) | Tool text: not allowed (S) |
| Projecting several columns | Guide: "can't be selected", yet a passing example projects the key qualifier (D) | Tool text: project the primary key and qualifier (S) |
| Aliases in segments | Guide: unsupported, yet one passing example uses `t` (D) | Tool text: rejected. A [community template](https://github.com/Jaganpro/sf-skills/blob/main/skills/sf-datacloud/assets/definitions/segment.template.json) uses one (C) |
| Insight SQL | Tool text: bans `COUNT(DISTINCT)` and `CURRENT_DATE - INTERVAL` (S) | The same repo's payload example uses both (S) |
| DMO names | Catalog: "must end with `__dlm`" (S) | [afd360](https://github.com/javrrr/afd360/blob/main/skills/afd360/SKILL.md): "The platform appends these" (C) |
| Enum spelling | `Dbt`, `NoRefresh` (S) | `DBT`, `NO_REFRESH`, `P90D` (C) |
| Publish status | `PUBLISHED` in the kit (S) | `publishStatus: "SUCCESS"` in the [hosted docs](https://developer.salesforce.com/docs/platform/hosted-mcp-servers/references/reference/data360-mcp.md) (D) |
| Connect host | Core host and core token (C, DashQL) | Tenant host after exchange (D) |
| Agentic memory | [Create](https://developer.salesforce.com/docs/data/agentic-memory-context/references/agentic-memory-context-api-ref/agentic-memory-api-create-memories.md) and [Update](https://developer.salesforce.com/docs/data/agentic-memory-context/references/agentic-memory-context-api-ref/agentic-memory-api-update-memories.md) share `POST /api/v1/agentic/memory` (D) | The overview names only POST and DELETE as write methods, so possibly intended |
| Query v3 paths | Public docs: `/rows`, `/chunks/{id}` (D) | DashQL's `hyperdb_http_client.ts` and `docs/misc/salesforce_v3_http.md`: `/row`, `/chunk/{id}`. No CDP function uses these; this concerns only the existing client |
| `dataSpaceName` | Schemas on agents, data graphs and data shares (D) | Their examples and one lab: `dataspaceName` (D, C) |
| API version | v64 (schema skill) | v66+ (hosted server), v67, v68 (docs) |

Where the tool text and the guide disagree, the rule text is more specific about rejections, but neither has been tested here. CDP SQL doesn't depend on these, because the server decides.

## Skill files

| Source | Type | Data 360 content | Last activity |
|---|---|---|---|
| [forcedotcom/sf-skills](https://github.com/forcedotcom/sf-skills) | Official | `data360-schema-get`, `data360-code-extension-generate`, `platform-dataspace-access-configure`, `agentforce-d360-analyze` | 2026-11-06 |
| [Same repo before removal](https://github.com/forcedotcom/sf-skills/tree/2476476dda1b671762c6e963b9d10c4a7056f1c4/skills) | Official, removed | `data360-orchestrate`, `-connect`, `-prepare`, `-harmonize`, `-segment`, `-activate`, `-query` | 2026-08-25 |
| [Retail solution kit](https://github.com/salesforce-misc/Data360AgentforceSolutionKitRetail/tree/main/.claude/skills) | Salesforce org, sample | 21 skills and an installer agent | 2026-09-09 |
| [MedTech solution kit](https://github.com/salesforce-misc/Data360MedTechSolutionKit/tree/main/.claude/skills) | Salesforce org, sample | 21 skills, on the hosted server | 2026-10-07 |
| [partner-ecosystem-agentic-kit](https://github.com/forcedotcom/partner-ecosystem-agentic-kit) | Official | `data-360-implementation-advisor`, self-described as not production-ready | 2026-11-04 |
| [Jaganpro/sf-skills](https://github.com/Jaganpro/sf-skills) | Community, archived | `sf-datacloud` and six phase skills | 2026-04-27 |
| [javrrr/afd360](https://github.com/javrrr/afd360) | Community | Declarative SDK with synth, diff and deploy | 2026-10-06 |

**What they teach:**
- **Most of their length is workflow logic:** order, waits, naming and SQL shapes. Kit skills run up to 208 KB.
- **Tool descriptions now carry the rules.** With the phase skills removed, `d360_segment_create` is effectively a skill. That the removal happened because the rules moved into the server is my inference.
- **Format:** `SKILL.md` with `name` and a `description` holding explicit `TRIGGER when` and `DO NOT TRIGGER when` routing, plus `references/`, `scripts/`, `assets/` and `examples/` loaded on demand.
- **Lineage:** the removed official skills look like renames of the community family, and they told users to install the community plugin.

**Coverage of this reading:** the `sf-datacloud` skills and the `d360_segment_create` description were read in full. Kit skills were skimmed or searched. The hosted server's skills and full tool list weren't readable without an org.

## Snowflake

Snowflake is the main model for "everything in SQL".

**Worth copying:**
- `CALL name(arg => value)` and `$$` bodies, both used here.
- Write-only secrets: `DESC SECRET` never returns a password.
- A clean escape to embedded documents.
- The REST mapping idea: nouns become paths, modifiers become parameters, and non-CRUD verbs become actions.

**Worth avoiding**, each from Snowflake's documented grammar:

| Problem | Example |
|---|---|
| Seven encodings for an operation | `ALTER PIPE ... REFRESH`, `EXECUTE TASK`, `SELECT SYSTEM$...`, `CALL SYSTEM$...`, `CALL x!METHOD()`, `PUT`, DDL that runs a job |
| Object references as strings or names | `COMPUTE_POOL = '<name>'` vs `COMPUTE_POOL = <name>` |
| DSLs in strings | `SCHEDULE = 'USING CRON <expr> <tz>'` |
| Lifecycle state in properties | `SUSPEND`, `SET PIPE_EXECUTION_PAUSED = TRUE`, `ENABLED = FALSE`, `SCHEDULER = DISABLE` |
| `SHOW` output | Lowercase columns forcing `"name"` quoting, a 10K row limit, columns that drift |
| `GET_DDL` | Not always executable, and not available for every object type |
| No DDL transactions | Each DDL commits alone, and `CREATE OR ALTER` can apply partially |

CDP SQL has one encoding by construction, since every operation is a `CALL`. Most of the rest don't arise, because it passes the API's own values through and has no properties grammar of its own to be inconsistent. Results are the exception: the `_raw` and `_next` columns keep `SHOW`-style drift out of the known columns, but those columns still follow the API's names.

**Sources:** [SHOW TABLES](https://docs.snowflake.com/en/sql-reference/sql/show-tables), [CREATE TASK](https://docs.snowflake.com/en/sql-reference/sql/create-task), [CALL](https://docs.snowflake.com/en/sql-reference/sql/call), [CREATE SECRET](https://docs.snowflake.com/en/sql-reference/sql/create-secret), [CREATE SEMANTIC VIEW](https://docs.snowflake.com/en/sql-reference/sql/create-semantic-view), [Classes](https://docs.snowflake.com/en/sql-reference/snowflake-db-classes), [CREATE OR ALTER](https://docs.snowflake.com/en/sql-reference/sql/create-or-alter), [GET_DDL](https://docs.snowflake.com/en/sql-reference/functions/get_ddl), [DCM Projects](https://docs.snowflake.com/en/user-guide/dcm-projects/dcm-projects-overview), [Transactions](https://docs.snowflake.com/en/sql-reference/transactions), [REST APIs](https://docs.snowflake.com/en/developer-guide/snowflake-rest-api/snowflake-rest-api).

## Competitors

I found no CDP that exposes its whole control plane through SQL. This isn't an exhaustive survey: I found nothing usable on mParticle and didn't check Tealium.

| Vendor | Form |
|---|---|
| [Adobe Data Distiller](https://experienceleague.adobe.com/en/docs/experience-platform/query/data-distiller-audiences/overview) | SQL: `CREATE AUDIENCE ... WITH (...) AS (select_query)`, `DROP AUDIENCE [IF EXISTS]`, `INSERT OVERWRITE INTO`. Audiences and namespaces in what I read |
| [Adobe PQL](https://experienceleague.adobe.com/en/docs/experience-platform/segmentation/pql/overview) | Own language: `X.timestamp occurs <= 3 days before now` |
| [Twilio Segment](https://www.twilio.com/docs/segment/api/public-api/query-language) | Own language, private beta: `event('Shoes Bought').where(property('price') >= 100).within(7 days).count() >= 1` |
| [Treasure Data](https://docs.treasure.ai/ja/treasure-code/commands/cas) | YAML rules, with `validate` and `push --dry-run` |
| [Hightouch](https://hightouch.com/docs/audiences/visual-builder) | Visual builder and REST API; no formal language found |

## Other surfaces

| Surface | Notes | Evidence |
|---|---|---|
| Metadata API | `DataStreamDefinition`, `MktDataTranObject`, `MarketSegmentDefinition`, `DataPackageKitDefinition` and others. Most deploy only through a data kit | C, primary list not read |
| Python | `salesforce-cdp-connector` is deprecated. Use `salesforce-datacloud-connector` | S, X |
| JDBC | [`datacloud-jdbc`](https://github.com/forcedotcom/datacloud-jdbc): read-only, forward-only, gRPC | S |
| Code extension | [SDK](https://github.com/forcedotcom/datacloud-customcode-python-sdk) and `sf data-code-extension` | S |
| Pub/Sub, data-triggered flows | Data actions can invoke webhooks, Flow or Platform Events. No Data 360-specific channel name found | U |

## Live checks

Run these once an org is available, read-only first. Each settles something this research couldn't.

**Connection:**
1. Do `/ssot/*` calls work on the core host with the core token, on the tenant host with the JWT, or both?
2. From a browser with the org's CORS allowlist, do `POST`, `PATCH`, `PUT` and `DELETE` on `/services/data` work? Does `/api/v1/ingest`?
3. Do the agentic memory paths work on the tenant host? Are Create and Update Memories really the same call?

**The spec:**
4. Download the current Connect YAML in a browser and update `extensions/d360-api/clfn/spec/` from it. Check the deep links.
5. Run the hosted server's `search` to list its tools and fill the gap with the catalog. Read `payload_examples` for body schemas.
6. Verify the functions outside the contract: evidence `S`, `D` and `C`, and the attributes labeled as beyond the spec, especially schemas inferred from examples.

**Behavior:**
7. Do `vector_search` and `hybrid_search` work in a `SELECT` over the connection? The Query API is left out on the assumption that the connection subsumes it.
8. Check each pagination row, including the data space filtering after paging.
9. Check the 204 and 404 empty-result cases.
10. Find the full `completionStatus` enum on the Connect query, and the current query timeout.
11. Check `publishStatus` values, and `Dbt` vs `DBT` per API version.
12. Does a DMO name need the `__dlm` suffix on create?

**Segment SQL:**
13. Test `IS NOT DISTINCT FROM` in `ON`, subqueries in `WHERE`, and table aliases, to settle the source conflicts.
14. Test `INTERSECT` and `UNION` of canonical shapes. High-level segments depend on it.

**Response headers:**
15. Do `202` responses carry a `Location`, and do list responses carry a `Link`? The normalized contract drops response headers, so this decides whether Data 360 needs `pending` or header paging. From a browser, check that `Access-Control-Expose-Headers` lists them.

**Zero copy:**
16. Run `connector_list` and `connector_metadata` for Snowflake, BigQuery, Databricks, Redshift and both file federation connectors, and replace the [guessed attributes](#zero-copy) of the snippets. Do Databricks and Redshift have an unload attribute?
