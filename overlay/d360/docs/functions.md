# CDP Functions

Status: work in progress, part of the [CDP SQL](overview.md) spec. Nothing here is implemented, and nothing has been tested against an org.

This is the reference for `CALL cdp.<function>(...)`: 534 functions, one per Data 360 API call, in one document per family. For each function, it gives the API call and its reference, every option with its type, an example, and the result schema. Nested objects are documented under each family's **Schemas** heading.

The overlay holds all of it, so completion offers exactly what a position takes and a misplaced attribute gets a diagnostic. See [the Data 360 doc](overview.md) and [overlays](../../../docs/design/overlay.md).

## Families

| Family | Functions | Evidence | What it's for |
|---|---:|---|---|
| [Activation Platforms](activation_platforms.md) | 15 | O 15 | An activation platform defines a destination: its output format, attributes, identifiers and connector. |
| [Activation Targets](activation_targets.md) | 16 | O 16 | An activation target is a destination for segment data: a file drop such as Amazon S3 or SFTP, Marketing Cloud, Data 360 itself, or an ad platform. |
| [Activations](activations.md) | 21 | O 21 | An activation delivers an audience to an activation target. |
| [Agent Configuration](agent_configuration.md) | 4 | O 4 | An agent in this family is a registration for [Agentic Memory and Context](https://developer.salesforce.com/docs/data/agentic-memory-context/guide/agentic-memory-agent-registration.md). |
| [Agentic Memory & Context](agentic_memory.md) | 14 | D 14 | Agentic Memory stores what agents and users say, then extracts session summaries, profile facts and preferences from it. |
| [Calculated Insights](calculated_insights.md) | 10 | O 6, S 4 | A calculated insight is a SQL aggregate over data model objects. |
| [Clean Rooms](clean_rooms.md) | 19 | O 19 | A clean room lets two companies compare customer data without handing it over. |
| [Communication Capping](communication_capping.md) | 17 | O 17 | Communication capping limits how many messages a customer, lead or prospect receives, for regulation, message fatigue or budget ([Trailhead](https://trailhead.salesforce.com/content/learn/modules/communication-capping-in-data-cloud-quick-look/get-to-know-communication-capping)). |
| [Connections](connections.md) | 23 | O 23 | A connection is the stored link between Data 360 and one outside system, such as Snowflake, S3, a CRM org or a website. |
| [Consent](consent.md) | 2 | D 2 | The Consent API records and reads a person's privacy requests against their Data 360 profile: stop processing their data, export it, or delete it. |
| [Data Actions](data_actions.md) | 11 | C 2, O 7, S 2 | A data action watches a source object, usually a data model object (`__dlm`), for created, updated or deleted rows. |
| [Data Custom Code](data_custom_code.md) | 7 | O 7 | Code extension runs your own Python in Data 360. |
| [Data Governance](data_governance.md) | 72 | O 72 | This family labels data and controls who can read it. |
| [Data Graphs](data_graphs.md) | 8 | O 8 | A data graph joins a primary DMO and its related objects into a [materialized JSON view](https://developer.salesforce.com/docs/data/data-cloud-query-guide/references/data-cloud-query-api-reference/c360a-api-data-graphs-overview.md), so an app can fetch a whole customer by key without writing joins. |
| [Data Kits](data_kits.md) | 12 | O 10, S 2 | A data kit packages Data 360 definitions, such as streams, DLOs and insights, so that they can move to another org. |
| [Data Lake Objects](data_lake_objects.md) | 5 | O 5 | A data lake object (DLO) is a table of raw ingested data, named `<Name>__dll`. |
| [Data Model Objects](data_model_objects.md) | 16 | O 14, S 2 | A data lake object (DLO, `__dll`) holds ingested rows as they arrived. |
| [Data Shares](data_shares.md) | 11 | O 11 | Data shares publish Data 360 objects to another platform without copying them there. |
| [Data Spaces](data_spaces.md) | 11 | O 11 | A data space is an [isolated workspace](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/runtime/FamilyCatalog.java) inside one org. |
| [Data Streams](data_streams.md) | 6 | O 6 | A data stream is the ingestion pipeline of Data 360. |
| [Data Transforms](data_transforms.md) | 14 | O 14 | A data transform reads data lake objects (DLOs) or data model objects (DMOs) and writes the result to another object. |
| [Document AI](document_ai.md) | 10 | O 10 | Document AI uses an LLM to read documents such as PDFs and images, and returns structured data that follows a JSON schema you define. |
| [Identity Resolutions](identity_resolutions.md) | 7 | O 6, S 1 | Identity resolution merges records of the same person or account from different sources into one unified profile. |
| [Ingestion](ingestion.md) | 9 | D 9 | Ingestion pushes records from an outside system into a Data 360 data lake object. |
| [Machine Learning](machine_learning.md) | 51 | O 37, S 14 | This family trains predictive models, serves them, and manages retrievers for AI search. |
| [Notebook AI](notebook_ai.md) | 35 | O 35 | Notebook AI keeps documents in searchable notebooks. |
| [Personalization](personalization.md) | 21 | S 21 | This family configures Salesforce Personalization: which content a website or mobile app shows, to whom, and how it renders. |
| [Private Network Routes](private_network_routes.md) | 4 | O 4 | A private network route (PNR) connects a Data 360 tenant to a data source without sending traffic over the public internet. |
| [Profiles, Insights and Metadata](profiles_and_metadata.md) | 27 | D 14, O 12, S 1 | These calls read what exists in an org and fetch single records, without SQL. |
| [Search Index](search_index.md) | 7 | O 6, S 1 | A search index makes the text in a data model object (DMO) searchable by meaning. |
| [Segments](segments.md) | 11 | O 11 | A segment is a named audience built on a data model object (DMO), such as every individual with an order over 5000. |
| [Semantic Models](semantic_models.md) | 38 | S 38 | A semantic model (SDM) is a named layer over existing DMOs, DLOs and calculated insights. |

## Reading a function

Each function has the same parts:

- **Header:** the HTTP verb and path, a link to its reference, the Salesforce MCP tools it covers, its evidence, and whether it changes org state.
- **Options:** path parameters, query parameters and request body fields are all options. Only the **In** column tells them apart, and the overlay uses it to build the request. A body field that clashes with a parameter of the same name gets a `body_` prefix.
- **API name:** every option, attribute and column is snake_case in a script, and this column has the API's exact spelling, which the client sends and reads. For a path option, it's the placeholder. See [Naming](overview.md#naming). Values, free-form keys and JSON in results keep the API's spelling.
- **Example:** a `CALL` statement. Every example in these documents parses on the proposed `CALL` grammar, see [What was checked](../../../docs/design/overlay.md#what-was-checked).
- **Result:** the rows and columns, described below.
- **Paging, Done when, Token, Notes:** present when they apply. Paging names the options that move through results. Every paged function also takes `_next` and `_pages`, see [Paging](../../../docs/design/overlay.md#paging). Done when says what to read to see that an asynchronous call finished.

**Paths** under `/ssot`, `/connect`, `/personalization` and `/semantic-engine` are relative to `/services/data/vXX.X`. Paths under `/api/...` are on the tenant host. See [Hosts and tokens](api_notes.md#hosts-and-tokens).

**Option types** link to a schema where the value is an object. `one of` lists variants, and a value has to fit one of them, see [Variants](overview.md#variants). Every object attribute accepts both a single object and an array, because the spec and its own examples often disagree on which is right.

## Evidence

| Tag | Functions | Meaning |
|---|---:|---|
| O | 407 | In the official Connect API contract, v68, as normalized in Salesforce's [`sf-pi`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/registry/connect-openapi-contracts.json) repository |
| S | 86 | Only in Salesforce's [MCP server](https://github.com/forcedotcom/d360-mcp-server) source, not in the contract. Includes Semantic Models and Personalization, which have their own APIs |
| D | 39 | Official documentation pages for APIs outside the contract: ingestion, agentic memory, direct reads, consent |
| C | 2 | Community sources only |

**Attributes beyond the spec.** The contract is often narrower than what its own examples send. Those attributes are included, because the checks would otherwise reject real payloads. Their rows say where they come from:

| Row text | Source |
|---|---|
| `Not in the spec schema: from the spec's examples.` | An example in the older spec copy shows it |
| `Not in the spec schema: from the MCP server's payload example.` | Salesforce's payload example shows it |
| `Not in the spec schema: from the MCP server's request class.` | Salesforce's typed request class declares it |
| `In the path, but missing from the spec's parameters.` | The path has a placeholder with no parameter |
| `Seen in examples: the spec types the parent as a free-form object.` | The spec says only `object`, so the schema is built from examples, and it may be incomplete |

An attribute missing from a schema can still be sent by quoting its name, as in `"newAttribute" = 1`.

## Result schema

**Every call returns one table.** Its columns come from the response schema, in three shapes:

| Response | Rows | Columns |
|---|---|---|
| An object holding one array of items and paging fields | One row per item | The item's fields. The paging fields go to `_meta` |
| Any other object | One row | The object's fields |
| No body, such as HTTP 204 | One row | Only the standard columns |

If no source documents a response, the function says so, and it returns one row with the response in `_raw`.

**Standard columns**, added after a function's own columns on every result:

| Column | Type | Contents |
|---|---|---|
| `_status` | `INTEGER` | The HTTP status |
| `_next` | `VARCHAR` | The value for the next page, in that function's paging style, or `NULL` on the last page |
| `_meta` | `JSON` | Response fields outside the rows, in the API's spelling, such as `totalSize` and `batchSize`, or `NULL` |
| `_raw` | `JSON` | Row fields the spec doesn't list, or `NULL`. A new API field lands here, so no data is lost |

**Column types:**

| Schema type | Column type |
|---|---|
| `string`, enum | `VARCHAR` |
| `string`, format `date-time` | `TIMESTAMPTZ` |
| `string`, format `date` | `DATE` |
| `integer`, format `int32` | `INTEGER` |
| `integer`, otherwise | `BIGINT` |
| `number` | `DOUBLE` |
| `boolean` | `BOOLEAN` |
| object, array | `JSON`, holding JSON text. The column names the schema, as in `JSON (CdpSegmentDbtPipelineOutputRepresentation)` |

Many date fields are plain `string` in the spec, so they stay `VARCHAR`. A value that can't be converted to its column type goes to `_raw`, and the column is `NULL`, so a schema that disagrees with a response doesn't fail the statement.

For example, `CALL cdp.segment_list (batch_size => 2);` returns:

| `api_name` | `display_name` | ... | `_status` | `_next` | `_meta` | `_raw` |
|---|---|---|---|---|---|---|
| `Vip` | `VIP customers` | ... | 200 | `2` | `{"batchSize":2,"offset":0}` | `NULL` |
| `Churn` | `Churn risk` | ... | 200 | `2` | `{"batchSize":2,"offset":0}` | `NULL` |

This shows the shape only. These values are made up, since nothing has run against an org.

## Not functions

| Item | Why |
|---|---|
| `POST /services/oauth2/token`, `POST /services/a360/token` | The connection handles authentication, in `SalesforceApiClient` |
| `d360_smart_mapping_suggest`, `d360_preview_field_matches`, `d360_smart_datastream_create`, `d360_event_date_recommend` | MCP helpers that compute suggestions or wrap other calls |
| `d360_standard_mapping_preview`, `d360_standard_mapping_create` | MCP tools for predefined mappings, which may be one or more `dmo_mapping_create` calls |
| `search`, `execute`, `payload_examples` | The MCP server's own discovery tools |
| The Query API: `/api/v1/query`, `/api/v2/query`, `/api/v3/query`, `/ssot/query`, `/ssot/queryv2`, `/ssot/query-sql` | Left out on purpose: the Salesforce connection subsumes it, since a script's `SELECT` already runs over that connection. This leaves out 7 of the contract's 414 operations |

Anything else goes through `cdp.request`, see [the escape hatch](overview.md#the-escape-hatch).
