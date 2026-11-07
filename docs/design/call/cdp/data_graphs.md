# Data Graphs

Part of the [CDP function reference](functions.md). Nothing here is implemented or tested against an org. Every result also has the [standard columns](functions.md#result-schema).

A data graph joins a primary DMO and its related objects into a [materialized JSON view](https://developer.salesforce.com/docs/data/data-cloud-query-guide/references/data-cloud-query-api-reference/c360a-api-data-graphs-overview.md), so an app can fetch a whole customer by key without writing joins.

The functions split in two. `data_graph_*` manage the definition: create, read, activate a draft, refresh, delete. `datagraph_*` read the graph's records and schema through `/ssot`. The same reads on the tenant host are in [profiles and metadata](profiles_and_metadata.md#direct_datagraph_lookup): `direct_datagraph_lookup`, `direct_datagraph_get` and `direct_datagraph_metadata`.

The order: the DMOs and relationships must exist, then create, wait for `status`, read, refresh, delete. The spec has no update call and no plain list, so `datagraph_metadata` is the list.

What matters most:

- Each record arrives as a JSON string in `data[].json_blob__c`, which needs a second parse.
- `lookup_keys` is one string that includes its square brackets.
- Creating a graph also creates system DMOs and points to a transform (community). See [`data_graph_create`](#data_graph_create).
- Refresh can report `success = false`, so check the column.
- The spec's create example uses attributes its schema doesn't have, including the one that makes a draft.

```sql
CALL cdp.data_graph_create (name => 'Customer_Graph', label => 'Customer Graph', type => 'NONE', primary_object_name => 'ssot__Individual__dlm', source_object => (name = 'ssot__Individual__dlm', type = 'standard', json_path = '$', fields = [(source_field_name = 'ssot__Id__c', is_key_column = true, is_projected = true, data_type = 'Text', usage_tag = 'NONE')], related_objects = []));
CALL cdp.data_graph_get (data_graph_name => 'Customer_Graph'); /* poll status */
CALL cdp.datagraph_lookup (data_graph_entity_name => 'Customer_Graph', lookup_keys => '[ssot__Individual__dlm.ssot__Id__c=10000001]');
CALL cdp.data_graph_refresh (data_graph_name => 'Customer_Graph');
```

**Functions:** [`data_graph_delete`](#data_graph_delete), [`data_graph_get`](#data_graph_get), [`datagraph_lookup`](#datagraph_lookup), [`datagraph_query`](#datagraph_query), [`datagraph_metadata`](#datagraph_metadata), [`data_graph_create`](#data_graph_create), [`data_graph_activate`](#data_graph_activate), [`data_graph_refresh`](#data_graph_refresh)

## data_graph_delete

`DELETE /ssot/data-graphs/{dataGraphName}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Graphs/paths/~1ssot~1data-graphs~1%7BdataGraphName%7D/delete) · evidence O · changes org state

Delete a data graph. Since v59.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `data_graph_name` | `dataGraphName` | path | string | yes | API name: `name` from the create response, or `developer_name` from `datagraph_metadata`. |

```sql
CALL cdp.data_graph_delete (data_graph_name => 'Customer_Graph');
```

**Result**

No response body (HTTP 200). One row with only the standard columns.

**Notes:** No source says what happens to the graph's system DMOs and transform, or to objects that reference the graph, such as personalization points. Compare [`metadata`](profiles_and_metadata.md#metadata) before and after.

The spec has no data space option here.

In a [community probe](https://github.com/dsouza-anush/sf-plugin-data360/blob/main/test/fixtures/live/p5-probe-data-graph-delete-error.json), deleting a missing graph returned the code `INTERNAL_ERROR`, not a separate not-found code (community, one org).

## data_graph_get

`GET /ssot/data-graphs/{dataGraphName}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Graphs/paths/~1ssot~1data-graphs~1%7BdataGraphName%7D/get) · evidence O · read-only

Read one graph's definition and status. Use it to poll a graph after create, activate or refresh. For the graph's records, use `datagraph_lookup` or `datagraph_query`. Since v59.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `data_graph_name` | `dataGraphName` | path | string | yes | API name: `name` from the create response, or `developer_name` from `datagraph_metadata`. |

```sql
CALL cdp.data_graph_get (data_graph_name => 'Customer_Graph');
```

**Result**

One row. Schema `CdpDataGraphOutputRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `created_by` | `createdBy` | VARCHAR | Who or what created the base object. Since v59.0. |
| `created_date` | `createdDate` | VARCHAR | Date when the base object was created. Since v59.0. |
| `dataspace_name` | `dataspaceName` | VARCHAR | Name of the data space of the base object. If unspecified, the `default` data space is used. Since v59.0. |
| `description` | `description` | VARCHAR | Description of the base object. Since v59.0. |
| `id` | `id` | VARCHAR | ID of the base object. Since v59.0. |
| `label` | `label` | VARCHAR | Label of the base object. Since v59.0. |
| `modified_by` | `modifiedBy` | VARCHAR | Who or what most recently modified the base object. Since v59.0. |
| `modified_date` | `modifiedDate` | VARCHAR | When the base object was most recently modified. Since v59.0. |
| `name` | `name` | VARCHAR | Name of the base object. Since v59.0. |
| `extended_properties` | `extendedProperties` | VARCHAR | Extended properties of the data graph. Since v59.0. |
| `id_dmo_label` | `idDmoLabel` | VARCHAR | Label of the data model object (DMO) that contains the ID table of the data graph. Since v59.0. |
| `id_dmo_name` | `idDmoName` | VARCHAR | API name of the data model object (DMO) that contains the ID table of the data graph. Since v59.0. |
| `kind` | `kind` | VARCHAR | Reserved for internal use. Since v59.0. |
| `last_run_status` | `lastRunStatus` | VARCHAR | Status for the most recent run of the data graph. Since v59.0. |
| `primary_object_label` | `primaryObjectLabel` | VARCHAR | Label of the primary data model object (DMO) of the data graph. Since v59.0. |
| `primary_object_name` | `primaryObjectName` | VARCHAR | Developer name of the primary object. Since v59.0. |
| `source_object` | `sourceObject` | JSON (CdpDataGraphSourceObjectOutputRepresentation) | Source object. Since v59.0. |
| `status` | `status` | VARCHAR | Status of the data graph. Since v59.0. |
| `type` | `type` | VARCHAR | Type of the data graph. Since v59.0. |
| `values_dmo_label` | `valuesDmoLabel` | VARCHAR | Label of the data model object (DMO) that contains the data graph JSON records. Since v59.0. |
| `values_dmo_name` | `valuesDmoName` | VARCHAR | API name of the DMO that contains the data graph JSON records. Since v59.0. |
| `version` | `version` | VARCHAR | Version of the data graph. Since v59.0. |

**Notes:** **Compared with `datagraph_metadata`:** this call adds labels, the refresh schedule, node `json_path` and `relatedSegments`. The tree is under `source_object`, and fields use `source_field_name` ([community, one org](https://github.com/szymonlewandowski/config-snapshot-data360/blob/main/docs/api-quirks.md)).

**Status can disagree.** The same source saw `Inprogress` from metadata while this call said `ready`, and a day later both said ready. Letter case differs too, so compare without case. That tool trusts this call's `status` (community, one org).

**Fields outside the spec** land in `_raw`. A [live fixture](https://github.com/dsouza-anush/sf-plugin-data360/blob/main/test/fixtures/live/data-graph-get.json) has `full_refresh_config`, `incremental_refresh_config`, `dayZeroTransformDevName`, `dayZeroMappingDevName`, and `source_object.fragmentDMOName` (community).

That fixture has no `last_run_status`, although the spec lists it, and its dates look like `Wed Jul 29 06:07:06 GMT 2026`, not ISO 8601 (community).

## datagraph_lookup

`GET /ssot/data-graphs/data/{dataGraphEntityName}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Graphs/paths/~1ssot~1data-graphs~1data~1%7BdataGraphEntityName%7D/get) · tool `d360_datagraph_lookup` · evidence O · read-only

Query a data graph by the primary key of either the primary data model object (DMO) or the Individual linked DMO. For real-time data graphs, the endpoint attempts to retrieve data from the real-time data graph but falls back to the standard data graph if the real-time data graph is unavailable. Since v59.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `data_graph_entity_name` | `dataGraphEntityName` | path | string | yes | API name of the data graph to query. Since v59.0. |
| `dataspace` | `dataspace` | query | string |  | Name of the data space in which to query the data graph. By default, the endpoint queries the `default` dataspace. Since v59.0. |
| `lookup_keys` | `lookupKeys` | query | string | yes | Lookup key and value to search on. Specify one of these key-value pairs: - The primary key of the primary DMO, for example, `lookup_keys=[id__c=def]` - The primary key of the Individual linked DMO, for example, `lookup_keys=[IndividualLink__dlm.SourceRecordId__c=1111111]` Since v59.0. |
| `no_cache` | `noCache` | query | boolean |  | Indicates whether to read data from the standard, non-real-time data graph (`true`) or the real-time data graph (`false`). The default is `false`. Since v59.0. |

```sql
CALL cdp.datagraph_lookup (data_graph_entity_name => 'UnifiedIndividual_DG', lookup_keys => '[UnifiedLinkssotIndividualIr1__dlm.SourceRecordId__c=10000001]');
```

**Result**

One row. Schema `CdpQueryOutputRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `data` | `data` | JSON | Result data set. Since v52.0. |
| `done` | `done` | BOOLEAN | Specifies whether the query is done (`true`) or not (`false`). Since v52.0. |
| `end_time` | `endTime` | VARCHAR | Query end time. Not returned for data graphs. Since v52.0. |
| `metadata` | `metadata` | JSON | Result metadata set. Not returned for data graphs. Since v52.0. |
| `query_id` | `queryId` | VARCHAR | Query ID. Not returned for data graphs. Since v52.0. |
| `row_count` | `rowCount` | BIGINT | Number of rows in the result data set. Not returned for data graphs. Since v52.0. |
| `start_time` | `startTime` | VARCHAR | Query start time. Not returned for data graphs. Since v52.0. |

**Notes:** **`data_graph_entity_name`** is the graph's name, not a DMO name. The docs' example is `UnifiedIndividual_DG`.

**`lookup_keys`** is one string, brackets included. The spec lists only two forms: the primary DMO's primary key and the Individual linked DMO's primary key. The [lookup reference](https://developer.salesforce.com/docs/data/data-cloud-query-guide/references/data-cloud-query-api-reference/c360a-api-v1-data-graphs-lookup.md) covers more, but it documents the [tenant host route](profiles_and_metadata.md#direct_datagraph_lookup), and no source says whether all of it applies to `/ssot`:

| Search on | Primary key | Primary key and key qualifier | Other fields |
|---|---|---|---|
| Primary DMO | `[primaryDMO__dlm.PrimaryKeyField=value]` | `[primaryDMO__dlm.PrimaryKeyField=value, primaryDMO__dlm.key_qualifier_field=value]` | `[primaryDMO__dlm.anyField=value, primaryDMO__dlm.anyField2=value]` |
| Value DMO | `[valueDMO__dlm.PrimaryKeyField=value]` | `[valueDMO__dlm.PrimaryKeyField=value, valueDMO__dlm.key_qualifier_field=value]` | Not supported |
| Link table DMO | `[DMO__dlm.primaryKeyField=value]` | `[DMO__dlm.primaryKeyField=value, DMO__dlm.key_qualifier_field=value]` | `[linkTableDMO__dlm.anyField=value, linkTableDMO__dlm.anyField2=value]` |
| Participating DMO | `[Participating__dlm.primaryKey=value]` | Not supported | Not supported |

Per that reference, several keys must all match, contact-based lookup takes one contact key per request, and real-time graphs only search by primary key and key qualifier. Use `datagraph_metadata` to find the DMO and field names.

**Result:** `data` is an array with one element per matching record, and a key can match more than one unified record. Each element's `json_blob__c` is a JSON string holding the nested record.

**`no_cache` sources conflict.** The spec says `true` reads the standard graph and `false` the real-time graph. Salesforce's MCP server describes it as ["Bypass cache"](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/QueryTools.java), which suggests fresher data, while the spec's `true` reads the non-real-time graph.

**Projection isn't in the spec for this route.** The tenant host route documents `fields` and `filters`. The MCP server sends `projectedFields` and `projectedFilters` here, so neither is confirmed.

## datagraph_query

`GET /ssot/data-graphs/data/{dataGraphEntityName}/{id}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Graphs/paths/~1ssot~1data-graphs~1data~1%7BdataGraphEntityName%7D~1%7Bid%7D/get) · tool `d360_datagraph_query` · evidence O · read-only

Query data graph data by ID. For real-time data graphs, the API retrieves data from the real-time data graph and only falls back to the standard data graph if the real-time data graph is unavailable. Since v59.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `data_graph_entity_name` | `dataGraphEntityName` | path | string | yes | API name of the data graph to query. Since v59.0. |
| `id` | `id` | path | string | yes | Record ID to query for, which is matched against the primary key field of the primary data model object (DMO) in the data graph. Since v59.0. |
| `dataspace` | `dataspace` | query | string |  | Name of the data space to query. If unspecified, the `default` data space is used. Since v59.0. |
| `live` | `live` | query | boolean |  | Indicates whether live lookup for the data graph is enabled (`true`) or not (`false`). Since v63.0. |

```sql
CALL cdp.datagraph_query (data_graph_entity_name => 'UnifiedIndividual_DG', id => '100005', live => true);
```

**Result**

One row. Schema `CdpQueryOutputRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `data` | `data` | JSON | Result data set. Since v52.0. |
| `done` | `done` | BOOLEAN | Specifies whether the query is done (`true`) or not (`false`). Since v52.0. |
| `end_time` | `endTime` | VARCHAR | Query end time. Not returned for data graphs. Since v52.0. |
| `metadata` | `metadata` | JSON | Result metadata set. Not returned for data graphs. Since v52.0. |
| `query_id` | `queryId` | VARCHAR | Query ID. Not returned for data graphs. Since v52.0. |
| `row_count` | `rowCount` | BIGINT | Number of rows in the result data set. Not returned for data graphs. Since v52.0. |
| `start_time` | `startTime` | VARCHAR | Query start time. Not returned for data graphs. Since v52.0. |
| `ssot__id__c` | `ssot__id__c` | VARCHAR | Not in the spec schema: from the spec's examples. |
| `ssot__name__c` | `ssot__name__c` | VARCHAR | Not in the spec schema: from the spec's examples. |
| `ssot__age__c` | `ssot__age__c` | BIGINT | Not in the spec schema: from the spec's examples. |
| `ssot__ContactPointEmail__dlm` | `ssot__ContactPointEmail__dlm` | JSON | Not in the spec schema: from the spec's examples. |
| `ssot__orders__dlm` | `ssot__orders__dlm` | JSON | Not in the spec schema: from the spec's examples. |

**Notes:** This is a get by key, and it takes no SQL. For any key other than the primary DMO's primary key, use `datagraph_lookup`.

**`live`:** the [reference](https://developer.salesforce.com/docs/data/data-cloud-query-guide/references/data-cloud-query-api-reference/c360a-api-v1-data-graphs-name-id.md) says `true` retrieves the latest data and the default is precalculated data. It also says `live` doesn't support real-time graphs. Live queries have [longer latency and higher credit use](https://developer.salesforce.com/docs/data/data-cloud-query-guide/references/data-cloud-query-api-reference/c360a-api-data-graphs-overview.md).

**The response shape conflicts.** The reference shows `data[].json_blob__c` holding a JSON string, as in `datagraph_lookup`. The spec's by-id example is a nested object with no `data` wrapper, although its schema has `data`. The table follows the schema.

Projection is the same open question as on [`datagraph_lookup`](#datagraph_lookup).

## datagraph_metadata

`GET /ssot/data-graphs/metadata` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Graphs/paths/~1ssot~1data-graphs~1metadata/get) · tool `d360_datagraph_metadata` · evidence O · read-only

Query data graph metadata. This API supports both standard and real-time data graphs that allow you to retrieve metadata from each respective graph type. Since v59.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `data_graph_entity_name` | `dataGraphEntityName` | query | string |  | API name of the data graph to query. If unspecified, metadata for all data graphs is returned. Since v59.0. |
| `dataspace` | `dataspace` | query | string |  | Name of the data space to query. If unspecified, the `default` data space is used. Since v59.0. |

```sql
CALL cdp.datagraph_metadata (data_graph_entity_name => 'UnifiedIndividual_DG');
```

**Result**

One row per item of `/dataGraphMetadata` in the response. Schema `CdpQueryDataGraphMetadataRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `dataspace_name` | `dataspaceName` | VARCHAR | Name of the data space in which the data graph metadata resides. Since v59.0. |
| `description` | `description` | VARCHAR | Description of the data graph metadata. Since v59.0. |
| `developer_name` | `developerName` | VARCHAR | Developer name of the data graph metadata. Since v59.0. |
| `dg_object` | `dgObject` | JSON (DataGraphObjectDataRepresentation) | Metadata for the data object of the data graph. Since v59.0. |
| `extended_properties` | `extendedProperties` | JSON | Extended properties of the data graph metadata. Since v59.0. |
| `id_dmo_name` | `idDmoName` | VARCHAR | API name of the data model object (DMO) that contains the ID table for the data graph. Since v59.0. |
| `ids_dmo` | `idsDmo` | JSON (DataGraphIdsDmoRepresentation) | Data about the DMO that contains the ID table for the data graph. Since v61.0. |
| `primary_object_name` | `primaryObjectName` | VARCHAR | Name of the primary object for the data graph. Since v59.0. |
| `primary_object_type` | `primaryObjectType` | VARCHAR | Data type of the primary object for the data graph. Since v59.0. |
| `status` | `status` | VARCHAR | Status of the data graph. Since v59.0. |
| `values_dmo` | `valuesDmo` | JSON (DataGraphValuesDmoRepresentation) | Data about the data model object (DMO) that contains the JSON records for the data graph. Since v61.0. |
| `values_dmo_name` | `valuesDmoName` | VARCHAR | API name of the DMO that contains the JSON records for the data graph. Since v59.0. |
| `version` | `version` | VARCHAR | Version of the data graph metadata. Since v59.0. |

**Notes:** This is the list of graphs: the spec has no `GET /ssot/data-graphs`, and a [community SDK](https://github.com/javrrr/data-360-sdk/blob/main/src/resources/data-graphs.ts) wraps this call as one. `developer_name` is the name the other calls take.

One call returns every graph's full tree: `dg_object` holds `related_objects`, recursively. Each node has `type`, `fields`, `paths`, `filterCriteria`, `recency_criteria` and `memberDmoName`, the node's fragment DMO ([community, one org](https://github.com/szymonlewandowski/config-snapshot-data360/blob/main/docs/api-quirks.md)).

`status` here can differ from [`data_graph_get`](#data_graph_get).

## data_graph_create

`POST /ssot/data-graphs` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Graphs/paths/~1ssot~1data-graphs/post) · evidence O · changes org state

Create a data graph. Since v59.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `dataspace_name` | `dataSpaceName` | body | string |  | Name of the data space. If unspecified, the `default` data space is used. This property is required for data graph resources. Since v59.0. Sources also spell it `dataspaceName`: quote that name to send that spelling. |
| `description` | `description` | body | string |  | Description of the object to create. Since v59.0. |
| `label` | `label` | body | string |  | Label of the object to create. This property is required for data graph resources. Since v59.0. |
| `name` | `name` | body | string |  | API name of the object to create. This property is required for data graph resources. Since v59.0. |
| `primary_object_name` | `primaryObjectName` | body | string |  | API name of the primary data model object (DMO) of the data graph. Since v59.0. |
| `source_object` | `sourceObject` | body | [CdpDataGraphSourceInput](#cdpdatagraphsourceinputrepresentation) |  | Primary root of the data graph. Since v59.0. |
| `type` | `type` | body | string |  | Data graph type. Valid value is `NONE`. Since v59.0. |
| `creation_mode` | `creationMode` | body | string |  | Not in the spec schema: from the spec's examples. |
| `full_refresh_config` | `fullRefreshConfig` | body | [data_graph_create_fullRefreshConfig](#data_graph_create_fullrefreshconfig) |  | Not in the spec schema: from the spec's examples. |
| `incremental_refresh_config` | `incrementalRefreshConfig` | body | [data_graph_create_incrementalRefreshConfig](#data_graph_create_incrementalrefreshconfig) |  | Not in the spec schema: from the spec's examples. |

```sql
CALL cdp.data_graph_create (name => 'Customer_Graph', label => 'Customer Graph', type => 'NONE', primary_object_name => 'ssot__Individual__dlm', source_object => (name = 'ssot__Individual__dlm', label = 'Individual', json_path = '$', type = 'standard', fields = [(source_field_name = 'ssot__Id__c', is_key_column = true, is_projected = true, data_type = 'Text', usage_tag = 'NONE'), (source_field_name = 'KQ_Id__c', is_key_column = false, is_projected = true, data_type = 'Text', usage_tag = 'KEY_QUALIFIER')], related_objects = []));
```

**Result**

One row. Schema `CdpDataGraphOutputRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `created_by` | `createdBy` | VARCHAR | Who or what created the base object. Since v59.0. |
| `created_date` | `createdDate` | VARCHAR | Date when the base object was created. Since v59.0. |
| `dataspace_name` | `dataspaceName` | VARCHAR | Name of the data space of the base object. If unspecified, the `default` data space is used. Since v59.0. |
| `description` | `description` | VARCHAR | Description of the base object. Since v59.0. |
| `id` | `id` | VARCHAR | ID of the base object. Since v59.0. |
| `label` | `label` | VARCHAR | Label of the base object. Since v59.0. |
| `modified_by` | `modifiedBy` | VARCHAR | Who or what most recently modified the base object. Since v59.0. |
| `modified_date` | `modifiedDate` | VARCHAR | When the base object was most recently modified. Since v59.0. |
| `name` | `name` | VARCHAR | Name of the base object. Since v59.0. |
| `extended_properties` | `extendedProperties` | VARCHAR | Extended properties of the data graph. Since v59.0. |
| `id_dmo_label` | `idDmoLabel` | VARCHAR | Label of the data model object (DMO) that contains the ID table of the data graph. Since v59.0. |
| `id_dmo_name` | `idDmoName` | VARCHAR | API name of the data model object (DMO) that contains the ID table of the data graph. Since v59.0. |
| `kind` | `kind` | VARCHAR | Reserved for internal use. Since v59.0. |
| `last_run_status` | `lastRunStatus` | VARCHAR | Status for the most recent run of the data graph. Since v59.0. |
| `primary_object_label` | `primaryObjectLabel` | VARCHAR | Label of the primary data model object (DMO) of the data graph. Since v59.0. |
| `primary_object_name` | `primaryObjectName` | VARCHAR | Developer name of the primary object. Since v59.0. |
| `source_object` | `sourceObject` | JSON (CdpDataGraphSourceObjectOutputRepresentation) | Source object. Since v59.0. |
| `status` | `status` | VARCHAR | Status of the data graph. Since v59.0. |
| `type` | `type` | VARCHAR | Type of the data graph. Since v59.0. |
| `values_dmo_label` | `valuesDmoLabel` | VARCHAR | Label of the data model object (DMO) that contains the data graph JSON records. Since v59.0. |
| `values_dmo_name` | `valuesDmoName` | VARCHAR | API name of the DMO that contains the data graph JSON records. Since v59.0. |
| `version` | `version` | VARCHAR | Version of the data graph. Since v59.0. |

**Done when:** `data_graph_get.status` = `ready`, compared without case. The create response said `creating` with an empty `values_dmo_name` in a [community fixture](https://github.com/dsouza-anush/sf-plugin-data360/blob/main/test/fixtures/live/data-graph-create.json). No source documents the full set of values or a typical wait.

**Notes:** **It creates more than the definition.** In [one org](https://github.com/szymonlewandowski/config-snapshot-data360/blob/main/docs/api-quirks.md), a graph with 12 nodes added 18 system DMOs (community). They appear in [`metadata`](profiles_and_metadata.md#metadata) under `Profile` or `Related`, so a category filter doesn't catch them:

| Kind | Name pattern | How many | Where the API names it |
|---|---|---|---|
| FRAGMENT | `Dg_xxxx_<15 chars>_FRAGMENT__dlm` | 1 per node | `memberDmoName` (metadata), `fragmentDMOName` (get) |
| STATE | `Dg_xxxx_<15 chars>_STATE__dlm` | Some nodes | Nowhere |
| ID | `<name>_<13 digits>_ID__dlm` | 1 | `id_dmo_name` |
| VALUE | `<name>_<13 digits>_VALUE__dlm` | 1 | `values_dmo_name` |
| State table | `DataGraphStateTable__dlm` | 1 per org | Nowhere |

These patterns come from one graph, and that source warns other graph kinds may differ.

**It also points to a transform.** A [community fixture](https://github.com/dsouza-anush/sf-plugin-data360/blob/main/test/fixtures/live/data-graph-get.json) of [`data_graph_get`](#data_graph_get) returns `dayZeroTransformDevName` and `dayZeroMappingDevName`, both `Dg_<graph>_<13 digits>`. The field names suggest a transform and a mapping made for the graph. They aren't in the spec, and no source says whether [`transform_list`](data_transforms.md#transform_list) shows that transform.

**The spec's example and schema disagree.** Its example sends `creation_mode`, `full_refresh_config`, `incremental_refresh_config`, `dataspace_name` and, on nodes and fields, `dev_name`. None of these are in the schema, so they aren't options here.

- `creation_mode => 'draft'` is what [`data_graph_activate`](#data_graph_activate) needs. A [community request](https://github.com/dsouza-anush/sf-plugin-data360/blob/main/scripts/live-scenarios/p5.mjs) without it reached `ready` with no activate call (one org).
- That request also had no refresh settings, and its response showed a daily full refresh with incremental off.
- The schema says `dataspace_name`. The spec's example, that request and the response all say `dataspace_name`.
- The schema requires `ci_field_type` and `key_qualifier_name` on every field. The spec's example omits both, and the request omits `ci_field_type`.
- The schema's `source_object.type` values are uppercase. The spec's example sends `standard`, and the request sends `custom`.

**Real-time graphs:** the spec's only `type` value is `NONE`. The [docs](https://developer.salesforce.com/docs/data/agentic-memory-context/guide/agentic-memory-create-rtdg-for-getcontext.md) describe creating real-time graphs in the UI, and no source shows it through this call.

## data_graph_activate

`POST /ssot/data-graphs/{dataGraphName}/actions/activate` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Graphs/paths/~1ssot~1data-graphs~1%7BdataGraphName%7D~1actions~1activate/post) · evidence O · changes org state

Activate a data graph draft. Activation saves the draft configuration and builds the data graph, which starts a materialization job to process the data according to the graph definition. In the Data 360 UI, this action corresponds to **Save and Build**. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `data_graph_name` | `dataGraphName` | path | string | yes | Name of the data graph. Since v67.0. |
| `full_refresh_config` | `fullRefreshConfig` | body | [DataGraphFullRefreshConfigInput](#datagraphfullrefreshconfiginputrepresentation) |  | Configuration of the full refresh schedule for standard data graphs. Since v67.0. |

```sql
CALL cdp.data_graph_activate (data_graph_name => 'Customer_Graph', full_refresh_config => (schedule = (frequency = 1, time_granularity = 'Day')));
```

**Result**

One row. Schema `CdpDataGraphActionResponseRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `errors` | `errors` | JSON (array of CdpErrorRepresentation) | List of errors that resulted from the action. Since v57.0. |
| `success` | `success` | BOOLEAN | Indicates whether the action was initiated successfully (`true`) or not (`false`). Since v57.0. |

**Done when:** `data_graph_get.status` = `ready`, compared without case. `success = true` means only that the action started. No source documents the intermediate values.

**Notes:** This is for drafts, which the schema of [`data_graph_create`](#data_graph_create) can't request. The community tool with live graph fixtures has no activate command, so this call has no live evidence here.

The spec's example also puts `data_graph_name` in the body. The schema doesn't have it there, and the path already carries it.

## data_graph_refresh

`POST /ssot/data-graphs/{dataGraphName}/actions/refresh` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Graphs/paths/~1ssot~1data-graphs~1%7BdataGraphName%7D~1actions~1refresh/post) · evidence O · changes org state

Start a rebuild of a data graph's materialized data, outside its schedule. Since v64.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `data_graph_name` | `dataGraphName` | path | string | yes | Name of the data graph. Since v64.0. |

```sql
CALL cdp.data_graph_refresh (data_graph_name => 'Customer_Graph');
```

**Result**

One row. Schema `CdpDataGraphActionResponseRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `errors` | `errors` | JSON (array of CdpErrorRepresentation) | List of errors that resulted from the action. Since v57.0. |
| `success` | `success` | BOOLEAN | Indicates whether the action was initiated successfully (`true`) or not (`false`). Since v57.0. |

**Done when:** No documented signal. Poll `data_graph_get.status`, where a community fixture shows `ready`, and `last_run_status`, which is in the spec with no documented values.

**Notes:** **Check `success`.** In a [community fixture](https://github.com/dsouza-anush/sf-plugin-data360/blob/main/test/fixtures/live/data-graph-refresh.json), the call returned `success: false` with the error code `DG_REFRESH_NOT_ALLOWED`, while the tool exited normally and [counted it as a success](https://github.com/dsouza-anush/sf-plugin-data360/blob/main/docs/API_COVERAGE.md). That tool's refresh test uses a [disposable graph over an empty DMO](https://github.com/dsouza-anush/sf-plugin-data360/blob/main/LIVE_TESTING.md). The message is redacted, so the reason is unknown.

**Retries:** that tool [marks the call billable](https://github.com/dsouza-anush/sf-plugin-data360/blob/main/src/resources/dataGraph.ts) under Data Services and treats a timeout as an unknown outcome, so it checks `data_graph_get` before retrying (community).

No source says whether this is a full or incremental refresh.

## Schemas

Attribute names are keywords inside the object they belong to, so completion offers exactly these.

### CdpDataGraphDataRecencyInputRepresentation

Data graph recency criteria input representation.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `field_name` | `fieldName` | string | yes | API name of the field to which recency criteria is applied. Since v59.0. |
| `value` | `value` | integer | yes | Value of the criteria. Since v59.0. |
| `value_type` | `valueType` | string | yes | Type of value. Valid values are `time` and `record`. Since v59.0. |
| `value_unit` | `valueUnit` | string | yes | For time, valid value is `DAY`. For record, valid value is `RECORD`. Since v59.0. |

### CdpDataGraphFieldInputRepresentation

Data graph field input representation.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `ci_field_type` | `ciFieldType` | string | yes | Calculated insight field type. Since v59.0. |
| `data_type` | `dataType` | string | yes | Data type of the field. Since v59.0. |
| `is_key_column` | `isKeyColumn` | boolean | yes | Indicates whether the field is a primary key (`true`) or not (`false`). Since v59.0. |
| `is_projected` | `isProjected` | boolean | yes | Indicates whether this field needs to be projected in output value JSON (`true`) or not (`false`). Since v59.0. |
| `key_qualifier_name` | `keyQualifierName` | string | yes | Key qualifier name. Since v59.0. |
| `source_field_name` | `sourceFieldName` | string | yes | API name of the field of the object. Since v59.0. |
| `usage_tag` | `usageTag` | string | yes | Tag that indicates whether the field represents a key qualifier field (`KEY_QUALIFIER`) or not (`NONE`). Since v59.0. |
| `dev_name` | `devName` | string |  | Not in the spec schema: from the spec's examples. |

### CdpDataGraphPathToParentInputRepresentation

Data graph source object path input representation.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `field_name` | `fieldName` | string | yes | Field name of this object that joins with parent_field_name. Since v59.0. |
| `parent_field_name` | `parentFieldName` | string | yes | Field name of the parent object that participated in the path. Since v59.0. |

### CdpDataGraphSourceInputRepresentation

Data graph source object input representation.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `dataspace_name` | `dataSpaceName` | string |  | Name of the data space. If unspecified, the `default` data space is used. This property is required for data graph resources. Since v59.0. |
| `description` | `description` | string |  | Description of the object to create. Since v59.0. |
| `label` | `label` | string |  | Label of the object to create. This property is required for data graph resources. Since v59.0. |
| `name` | `name` | string |  | API name of the object to create. This property is required for data graph resources. Since v59.0. |
| `fields` | `fields` | array of [CdpDataGraphFieldInput](#cdpdatagraphfieldinputrepresentation) |  | List of fields on the source object that need to be included in the data graph. Since v59.0. |
| `json_path` | `jsonPath` | string |  | Projected JSON path of this object in the output value JSON from root. Since v59.0. |
| `path` | `path` | array of [CdpDataGraphPathToParentInput](#cdpdatagraphpathtoparentinputrepresentation) |  | Path of the source object. Since v59.0. |
| `recency_criteria` | `recencyCriteria` | array of [CdpDataGraphDataRecencyInput](#cdpdatagraphdatarecencyinputrepresentation) |  | Recency criteria of the source object. Since v59.0. |
| `related_objects` | `relatedObjects` | array of [CdpDataGraphSourceInput](#cdpdatagraphsourceinputrepresentation) |  | List of related child objects that need to be included in the data graph. Since v59.0. |
| `type` | `type` | enum(CALCULATED, CALCULATED_STREAMING, CALCULATED_REAL_TIME, STANDARD, CUSTOM, SYSTEM, DERIVED, BRIDGE, SEGMENT_MEMBERSHIP, ML_PREDICTION, ACTIVATION_AUDIENCE, TRANSFORM) |  | Type of the source object. Since v59.0. |
| `dev_name` | `devName` | string |  | Not in the spec schema: from the spec's examples. |

### DataGraphFullRefreshConfigInputRepresentation

Represents the input for a full refresh data graph.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `schedule` | `schedule` | [DataGraphScheduleInput](#datagraphscheduleinputrepresentation) |  | Details about the full refresh schedule. Since v67.0. |

### DataGraphScheduleInputRepresentation

Represents the input for a data graph schedule.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `frequency` | `frequency` | integer |  | Frequency of the schedule refresh. Since v67.0. |
| `time_granularity` | `timeGranularity` | string |  | Type of time granularity. The spec's example sends `Day`, a [community fixture](https://github.com/dsouza-anush/sf-plugin-data360/blob/main/test/fixtures/live/data-graph-get.json) returned `day`, and other values aren't documented. Since v67.0. |

### data_graph_create_fullRefreshConfig

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `schedule` | `schedule` | [data_graph_create_fullRefreshConfig_schedule](#data_graph_create_fullrefreshconfig_schedule) |  | Seen in examples: the spec types the parent as a free-form object. |

### data_graph_create_fullRefreshConfig_schedule

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `frequency` | `frequency` | integer |  | Seen in examples: the spec types the parent as a free-form object. |
| `time_granularity` | `timeGranularity` | string |  | Seen in examples: the spec types the parent as a free-form object. |

### data_graph_create_incrementalRefreshConfig

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `enabled` | `enabled` | boolean |  | Seen in examples: the spec types the parent as a free-form object. |
