<!-- Generated from extensions/d360-api/clfn/spec/profiles_and_metadata.yaml, edit that and run: bazel run //extensions/d360-api:update -->

# Profiles, Insights and Metadata

Part of the [CDP function reference](functions.md). Nothing here is implemented or tested against an org. Every result also has the [standard columns](functions.md#result-schema).

These calls read what exists in an org and fetch single records, without SQL. There are four groups: metadata (which objects and fields exist), profile reads, calculated insight reads and ID lookups. The docs [recommend these over custom SQL](https://developer.salesforce.com/docs/data/data-cloud-query-guide/guide/obj-specific-apis.md) where one fits. For joins, aggregates or engagement data, use a `SELECT` over the connection.

**Order:** find a name with `metadata_search` or `metadata_entities`, describe it with `metadata`, then read records. Every read takes an API name such as `ssot__Individual__dlm`.

**Connect or `direct_*`:** the `/ssot` calls are the Connect API, which Salesforce calls its [preferred platform](https://developer.salesforce.com/docs/data/connectapi/guide/get-started.md). The `direct_*` calls are the `/api/v1` routes on the tenant host, and always need the token exchange. Start with Connect. It also has `dataspace` on metadata. Use `direct_*` for what only its reference documents, such as `fields` and `filters` on `direct_datagraph_lookup`. The twins aren't drop-in: `batch_size` becomes `limit`, `searchKey` becomes `searchkey`, and `order_by` on profile reads changes syntax.

The gotchas that matter most:

- `metadata` returns only the DMOs in use, while [`dmo_list`](data_model_objects.md#dmo_list) returns the whole catalog (community, one org).
- Pass `entity_name` to `metadata`, because unfiltered responses are large.
- Profile reads take Profile category DMOs only, and filters are equality joined by AND.
- Most record reads return one row, with the records in a `data` JSON column.

```sql
/* Inventory, without fields */
CALL cdp.metadata_entities (entity_type => 'DataModelObject', entity_category => 'Profile');
/* Fields, keys and relationships of one object */
CALL cdp.metadata (entity_name => 'ssot__Individual__dlm');
/* Records */
CALL cdp.profile_query (data_model_name => 'ssot__Individual__dlm', filters => '[ssot__FirstName__c=Jean]', fields => 'ssot__Id__c,ssot__LastName__c');
```

**Functions:** [`insights_query`](#insights_query), [`insights_metadata`](#insights_metadata), [`insights_metadata_get`](#insights_metadata_get), [`metadata`](#metadata), [`metadata_entities`](#metadata_entities), [`profile_query`](#profile_query), [`profile_get`](#profile_get), [`profile_child`](#profile_child), [`profile_insight`](#profile_insight), [`profile_metadata`](#profile_metadata), [`profile_metadata_get`](#profile_metadata_get), [`universal_id_lookup`](#universal_id_lookup), [`metadata_search`](#metadata_search), [`direct_metadata`](#direct_metadata), [`direct_profile_metadata`](#direct_profile_metadata), [`direct_profile_metadata_get`](#direct_profile_metadata_get), [`direct_profile_list`](#direct_profile_list), [`direct_profile_get`](#direct_profile_get), [`direct_profile_child`](#direct_profile_child), [`direct_profile_insight`](#direct_profile_insight), [`direct_insight_metadata`](#direct_insight_metadata), [`direct_insight_metadata_get`](#direct_insight_metadata_get), [`direct_insight_query`](#direct_insight_query), [`direct_datagraph_metadata`](#direct_datagraph_metadata), [`direct_datagraph_get`](#direct_datagraph_get), [`direct_datagraph_lookup`](#direct_datagraph_lookup), [`direct_universal_id_lookup`](#direct_universal_id_lookup)

## insights_query

`GET /ssot/insight/calculated-insights/{ciName}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Insights/paths/~1ssot~1insight~1calculated-insights~1%7BciName%7D/get) · tool `d360_insights_query` · evidence O · read-only

Query a Calculated Insight object in Data 360. Since v52.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `ci_name` | `ciName` | path | string | yes | API name of the insight, such as `Avg_Spends__cio`. |
| `batch_size` | `batchSize` | query | integer |  | Number of items to return. Values are from `1` through `4999`. If unspecified, the default value is `4999`. Since v52.0. |
| `dimensions` | `dimensions` | query | string |  | Comma-separated list of up to 10 dimensions, such as `GenderId__c`, to project. If unspecified, this parameter includes all of the available dimensions. Since v52.0. |
| `filters` | `filters` | query | string |  | Filter the result set to a more narrow scope or specific type, such as `[GenderId__c=Male,FirstName__c=Angel]`. Since v52.0. |
| `measures` | `measures` | query | string |  | Comma-separated list of up to five measures, such as `TotalSales__c,` to project. If unspecified, this parameter includes all of the available measures. Since v52.0. |
| `offset` | `offset` | query | integer |  | Number of rows to skip before returning results. If unspecified, no rows are skipped. Since v52.0. |
| `order_by` | `orderby` | query | string |  | Sort order for the result set, such as `GenderId__c ASC,Occupation__c DESC`. If unspecified, items are returned in the order they are retrieved. Since v52.0. |
| `time_granularity` | `timeGranularity` | query | string |  | Time range for the measures. Values are `HOUR`, `DAY`, `MONTH`, `QUARTER`, or `YEAR`. If unspecified, no time range is applied. Since v54.0. |

```sql
CALL cdp.insights_query (ci_name => 'Avg_Spends__cio', dimensions => 'Id__c,FirstName__c', measures => 'Avg_Spend__c', batch_size => 100);
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

**Paging:** `batch_size`, `offset`.

**Notes:** Get the dimension and measure names from [`insights_metadata`](#insights_metadata). A query returns at most [4,999 rows](https://developer.salesforce.com/docs/data/data-cloud-query-guide/references/data-cloud-query-api-reference/c360a-api-ci-call-overview.md), so page with `offset` for more. The [tenant host page](https://developer.salesforce.com/docs/data/data-cloud-query-guide/references/data-cloud-query-api-reference/c360a-api-insights-ci-ci-name.md) says filter values are case-sensitive. The spec has no `dataspace` here, while [Salesforce's tool](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/CalculatedInsightTools.java) accepts one. One community run saw an [eventual-consistency race](https://github.com/dsouza-anush/sf-plugin-data360/blob/main/docs/API_COVERAGE.md) on an insight read (community).

## insights_metadata

`GET /ssot/insight/metadata` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Insights/paths/~1ssot~1insight~1metadata/get) · tool `d360_insights_metadata` · evidence O · read-only

Get Insight metadata, including Calculated Insight objects, their dimensions, and their measures in Data 360. Since v52.0.

**Options**

None.

```sql
CALL cdp.insights_metadata ();
```

**Result**

One row. Schema `CdpQueryMetadataOutputRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `metadata` | `metadata` | JSON | Result metadata set. Since v52.0. |

**Notes:** This is how you discover insight names. The result is one row, with every insight in the `metadata` array. Each has `name`, `display_name`, `dimensions`, `measures`, `relationships` and `partition_by`, as shown on the [tenant host page](https://developer.salesforce.com/docs/data/data-cloud-query-guide/references/data-cloud-query-api-reference/c360a-api-v1-insight-metadata.md). The spec has no `dataspace` here.

## insights_metadata_get

`GET /ssot/insight/metadata/{ciName}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Insights/paths/~1ssot~1insight~1metadata~1%7BciName%7D/get) · evidence O · read-only

Get metadata for a Calculated Insight object in Data 360. Metadata includes dimensions and measures. Since v52.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `ci_name` | `ciName` | path | string | yes | API name of the insight, such as `Avg_Spends__cio`. |

```sql
CALL cdp.insights_metadata_get (ci_name => 'Avg_Spends__cio');
```

**Result**

One row. Schema `CdpQueryMetadataOutputRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `metadata` | `metadata` | JSON | Result metadata set. Since v52.0. |

## metadata

`GET /ssot/metadata` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Metadata/paths/~1ssot~1metadata/get) · tool `d360_metadata` · evidence O · read-only

Get all metadata, including Calculated Insights, Engagement, Profile, and other objects, as well as their relationships to other objects in Data 360. Since v52.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `dataspace` | `dataspace` | query | string |  | Name of the data space. If unspecified, the `default` data space is used. Since v55.0. |
| `entity_category` | `entityCategory` | query | string |  | Category of the metadata entity. Valid values are `Profile`, `Engagement`, and `Related`. If unspecified, all category entities are returned. Since v54.0. |
| `entity_name` | `entityName` | query | string |  | Metadata name of the entity, for example `UnifiedIndividual__dlm`. If unspecified, a complete list of entities is returned. Since v54.0. |
| `entity_type` | `entityType` | query | string |  | Type of metadata entity requested. Valid values are `DataLakeObject`, `DataModelObject`, and `CalculatedInsight`. If unspecified, all types are returned. Since v54.0. |

```sql
CALL cdp.metadata (entity_name => 'ssot__Individual__dlm');
```

**Result**

One row. Schema `CdpQueryMetadataOutputRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `metadata` | `metadata` | JSON | Result metadata set. Since v52.0. |

**Notes:** **`metadata` or [`dmo_list`](data_model_objects.md#dmo_list)?** Use this one for the model the org actually uses.

| | `metadata` | `dmo_list` |
|---|---|---|
| DMOs | Only those in use | The whole catalog, over 1,000 |
| Cost | One fast call | 20 to 40 s per page of 200 |
| Relationships | Active only, each listed twice, once at each end | Separate call, [`dmo_relationship_list`](data_model_objects.md#dmo_relationship_list), which also returns inactive ones |

These rows come from [one test on a Developer Edition org](https://github.com/szymonlewandowski/config-snapshot-data360/blob/main/docs/api-quirks.md) (community, one org). A DMO missing here can still exist in the catalog. This call also covers DLOs and insights.

**Always filter.** [Salesforce's tool](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/MetadataTools.java) treats `entity_name` as required "to avoid massive responses", although the spec makes it optional.

**The result is one row**, with every entity in the `metadata` array. DMOs and DLOs have `fields`, `indexes`, `category`, `relationships` and `primary_keys`. Insights have `dimensions`, `measures` and `partition_by`. A field's `keyQualifier` names its key qualifier field.

**`entity_category` values disagree.** The spec says `Profile`, `Engagement` and `Related`. [Salesforce's tool](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/MetadataTools.java) says `Profile`, `Engagement`, `Other` and `DirectoryTable`. The [tenant host page](https://developer.salesforce.com/docs/data/data-cloud-query-guide/references/data-cloud-query-api-reference/c360a-api-metadata-api.md) says the filter doesn't apply to insights.

**Data graphs add system DMOs** here under `Profile` or `Related`, so a category filter doesn't remove them. One graph with 12 nodes [added 18 DMOs](https://github.com/szymonlewandowski/config-snapshot-data360/blob/main/docs/api-quirks.md) (community, one org).

## metadata_entities

`GET /ssot/metadata-entities` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Metadata/paths/~1ssot~1metadata-entities/get) · tool `d360_metadata_entities` · evidence O · read-only

Get a list of metadata entities. This endpoint provides a high-performance way to retrieve metadata for Data 360 entities. By returning only essential fields like name, type, and category, it allows you to efficiently view entities at scale. Request detailed field and relationship data only for the specific objects you need. Since v66.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `dataspace` | `dataspace` | query | string |  | Name of the data space in which the metadata is requested. Since v66.0. |
| `entity_category` | `entityCategory` | query | string |  | Category of the metadata entity. If unspecified, all categories are returned. Supported values are: - `Activation_Audience` - `CG_Audience` - `Content` - `Directory_Table` - `Engagement` - `Profile` - `Related` - `Segment_Membership` - `Vector_Embedding` Since v66.0. |
| `entity_type` | `entityType` | query | string |  | Type of metadata entity. If unspecified, all types are returned. Supported values are: - `CalculatedInsight` - `DataLakeObject` - `DataModelObject` Since v66.0. |

```sql
CALL cdp.metadata_entities (entity_type => 'DataModelObject', entity_category => 'Profile');
```

**Result**

One row per item of `/metadata` in the response. Other response fields go to `_meta`: `done`, `nextBatchId`. Schema `CdpQueryMetadataEntityOutputRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `category` | `category` | VARCHAR | Category of the metadata entity. Supported values are: - `Activation_Audience` - `CG_Audience` - `Content` - `Directory_Table` - `Engagement` - `Profile` - `Related` - `Segment_Membership` - `Vector_Embedding` Since v66.0. |
| `display_name` | `displayName` | VARCHAR | Display name of the entity. Since v66.0. |
| `name` | `name` | VARCHAR | Name of the entity. Since v66.0. |
| `type` | `type` | VARCHAR | Type of metadata entity. Supported values are: - `CalculatedInsight` - `DataLakeObject` - `DataModelObject` Since v66.0. |

**Paging:** `nextBatchId`, but the spec has no way to send it, so this function can only read the first batch. [Salesforce's tool](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/MetadataTools.java) fetches the next one from `GET /ssot/metadata-entities/{nextBatchId}`, a path the spec doesn't list.

**Notes:** Use this for an inventory: it returns names, types and categories, without fields. Then call [`metadata`](#metadata) with `entity_name` for details.

The spec makes `entity_type` optional, while the [catalog](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/runtime/FamilyCatalog.java) says "entity_type required". [Salesforce's tool](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/MetadataTools.java) sends the call without it.

Category names vary. The spec has `Directory_Table`, and [the tool](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/MetadataTools.java) says `DirectoryTable` and `Other`. In [one test](https://github.com/szymonlewandowski/config-snapshot-data360/blob/main/docs/api-quirks.md) this call used `Segment_Membership_Category` and `Activation_Audience_Category` (community, one org).

## profile_query

`GET /ssot/profile/{dataModelName}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Profile/paths/~1ssot~1profile~1%7BdataModelName%7D/get) · tool `d360_profile_query` · evidence O · read-only

Query a profile data model object using filters in Data 360. Since v52.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `data_model_name` | `dataModelName` | path | string | yes | Name of the data model object. Since v52.0. |
| `batch_size` | `batchSize` | query | integer |  | Number of items to return. Values are from `1` through `4999`. If unspecified, the default value is `100`. Since v52.0. |
| `fields` | `fields` | query | string |  | Comma-separated list of up to 50 field names that you want to include in the result, for example, `Id__c,FirstName__c`, `GenderId__c,Occupation__c`. If unspecified, `Id__c` is returned. Since v52.0. |
| `filters` | `filters` | query | string | yes | Comma-separated list of equality expressions within square brackets, for example, `[FirstName__c=DON]`. Since v52.0. |
| `offset` | `offset` | query | integer |  | Number of rows to skip before returning results. If unspecified, no rows are skipped. Since v52.0. |
| `order_by` | `orderby` | query | string |  | Sort order for the result set, such as `GenderId__c ASC,Occupation__c DESC`. If unspecified, items are returned in the order they are retrieved. Since v52.0. |

```sql
CALL cdp.profile_query (data_model_name => 'ssot__Individual__dlm', filters => '[ssot__FirstName__c=Jean]', fields => 'ssot__Id__c,ssot__LastName__c', batch_size => 100);
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

**Paging:** `batch_size`, `offset`.

**Notes:** From the [Profile API overview](https://developer.salesforce.com/docs/data/data-cloud-query-guide/references/data-cloud-query-api-reference/c360a-api-profile-call-overview.md): this reads Profile category DMOs only, and Engagement DMOs aren't supported. Filters are equality only, joined by AND, with no limit on their number. Date and time values use `YYYY-MM-DD HH:MM:SS`. Unified objects filtered on an index column respond faster, and [`profile_metadata_get`](#profile_metadata_get) lists the indexes.

`data_model_name` is the [full API name with `__dlm`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/references/endpoint-families.md), although [Salesforce's tool](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/QueryTools.java) gives `Individual` and `Account` as examples. The spec has no `dataspace` here, while the tool accepts one.

Records are in the `data` column as JSON.

## profile_get

`GET /ssot/profile/{dataModelName}/{id}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Profile/paths/~1ssot~1profile~1%7BdataModelName%7D~1%7Bid%7D/get) · evidence O · read-only

Get profile records by the value of a key. Without `search_key`, `id` matches the primary key. With it, `id` matches that field.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `data_model_name` | `dataModelName` | path | string | yes | API name of the DMO, with the `__dlm` suffix, such as `ssot__Individual__dlm`. |
| `id` | `id` | path | string | yes | Value to match: the primary key, or the field named in `search_key` if set. |
| `batch_size` | `batchSize` | query | integer |  | Number of items to return. Values are from `1` through `4999`. If unspecified, the default value is `100`. Since v52.. |
| `fields` | `fields` | query | string |  | Comma-separated list of up to 50 field names that you want to include in the result, for example, `Id__c,FirstName__c`, `GenderId__c,Occupation__c`. If unspecified, `Id__c` is returned. Since v52.0. |
| `filters` | `filters` | query | string |  | Comma-separated list of equality expressions within square brackets, for example, `[FirstName__c=DON]`. Since v52.0. |
| `offset` | `offset` | query | integer |  | Number of rows to skip before returning results. If unspecified, no rows are skipped. Since v52.0. |
| `order_by` | `orderby` | query | string |  | Sort order for the result set, such as `GenderId__c ASC,Occupation__c DESC`. If unspecified, items are returned in the order they are retrieved. Since v52.0. |
| `search_key` | `searchKey` | query | string |  | If a field other than the primary key is used, name of the key field, for example, `FirstName__c`. Parameter is required for secondary key. Since v52.0. |

```sql
CALL cdp.profile_get (data_model_name => 'ssot__Individual__dlm', id => 'Jean', search_key => 'ssot__FirstName__c', fields => 'ssot__Id__c,ssot__LastName__c');
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

**Paging:** `batch_size`, `offset`.

**Notes:** `offset` [needs `order_by`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/references/endpoint-families.md) on this route.

## profile_child

`GET /ssot/profile/{dataModelName}/{id}/{childDataModelName}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Profile/paths/~1ssot~1profile~1%7BdataModelName%7D~1%7Bid%7D~1%7BchildDataModelName%7D/get) · evidence O · read-only

Get the child records of a profile record, such as an Individual's email addresses. `filters` applies to the parent only, and `fields` to the child only.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `child_data_model_name` | `childDataModelName` | path | string | yes | API name of the child DMO, such as `ContactPointEmail__dlm`. |
| `data_model_name` | `dataModelName` | path | string | yes | API name of the parent DMO, with the `__dlm` suffix, such as `ssot__Individual__dlm`. |
| `id` | `id` | path | string | yes | Value to match on the parent: the primary key, or the field named in `search_key` if set. |
| `batch_size` | `batchSize` | query | integer |  | Number of items to return. Values are from `1` through `4999`. If unspecified, the default value is `100`. Since v52.0. |
| `fields` | `fields` | query | string |  | Comma-separated list of child object field names that you want to include in the result, for example, `Id__c,EmailAddress__c`. If unspecified, the first 10 alphabetically sorted fields are returned. Since v52.0. |
| `filters` | `filters` | query | string |  | Comma-separated list of equality expressions within square brackets, for example, `[FirstName__c=DON]`. Filters are applied to the parent object only. Since v52.0. |
| `offset` | `offset` | query | integer |  | Number of rows to skip before returning results. If unspecified, no rows are skipped. Since v52.0. |
| `order_by` | `orderby` | query | string |  | Sort order for the result set, such as `GenderId__c ASC,Occupation__c DESC`. If unspecified, items are returned in the order they are retrieved. Since v52.0. |
| `search_key` | `searchKey` | query | string |  | If a field other than the primary key is used, name of the key field, for example, `FirstName__c`. Parameter is required for secondary key. Since v52.0. |

```sql
CALL cdp.profile_child (data_model_name => 'ssot__Individual__dlm', id => '100005', child_data_model_name => 'ContactPointEmail__dlm');
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

**Paging:** `batch_size`, `offset`.

**Notes:** The child [must have a relationship with the parent](https://developer.salesforce.com/docs/data/data-cloud-query-guide/references/data-cloud-query-api-reference/c360a-api-profile-dmname-id-child-dmname.md). Find it in `relationships` from [`profile_metadata_get`](#profile_metadata_get). `offset` [needs `order_by`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/references/endpoint-families.md) on this route.

## profile_insight

`GET /ssot/profile/{dataModelName}/{id}/calculated-insights/{ciName}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Profile/paths/~1ssot~1profile~1%7BdataModelName%7D~1%7Bid%7D~1calculated-insights~1%7BciName%7D/get) · evidence O · read-only

Get a calculated insight's values for one profile record.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `ci_name` | `ciName` | path | string | yes | API name of the insight, such as `Avg_Spends__cio`. |
| `data_model_name` | `dataModelName` | path | string | yes | API name of the DMO, with the `__dlm` suffix, such as `ssot__Individual__dlm`. |
| `id` | `id` | path | string | yes | Value to match: the primary key, or the field named in `search_key` if set. |
| `batch_size` | `batchSize` | query | integer |  | Number of items to return. Values are from `1` through `4999`. If unspecified, the default value is `100`. Since v52.0. |
| `dimensions` | `dimensions` | query | string |  | Comma-separated list of up to 10 dimensions, such as `GenderId__c`, to project. If unspecified, this parameter returns all of the available dimensions. Since v52.0. |
| `fields` | `fields` | query | string |  | Comma-separated list of up to 50 field names that you want to include in the result, for example, `Id__c,FirstName__c`, `GenderId__c,Occupation__c`. If unspecified, `Id__c` is returned. Since v52.0. |
| `filters` | `filters` | query | string |  | Comma-separated list of equality expressions within square brackets, for example, `[FirstName__c=DON]`. Since v52.0. |
| `measures` | `measures` | query | string |  | Comma-separated list of up to five measures, such as `TotalSales__c,` to project. If unspecified, this parameter returns all of the available measures. Since v52.0. |
| `offset` | `offset` | query | integer |  | Number of rows to skip before returning results. If unspecified, no rows are skipped. Since v52.0. |
| `order_by` | `orderby` | query | string |  | Sort order for the result set, such as `GenderId__c ASC,Occupation__c DESC`. If unspecified, items are returned in the order they are retrieved. Since v52.0. |
| `search_key` | `searchKey` | query | string |  | If a field other than the primary key is used, name of the key field, for example, `FirstName__c`. Parameter is required for secondary key. Since v52.0. |
| `time_granularity` | `timeGranularity` | query | string |  | Time range for the measures. Values are: `HOUR`, `DAY`, `MONTH`, `QUARTER`, or `YEAR`. If unspecified, no time range is applied. Since v54.0. |

```sql
CALL cdp.profile_insight (data_model_name => 'ssot__Individual__dlm', id => '100005', ci_name => 'Avg_Spends__cio', measures => 'Avg_Spend__c');
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

**Paging:** `batch_size`, `offset`.

**Notes:** The insight [must be associated with the DMO](https://developer.salesforce.com/docs/data/data-cloud-query-guide/references/data-cloud-query-api-reference/c360a-api-profile-dmname-id-ci-ci-name.md). `offset` [needs `order_by`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/references/endpoint-families.md) on this route.

## profile_metadata

`GET /ssot/profile/metadata` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Profile/paths/~1ssot~1profile~1metadata/get) · tool `d360_profile_metadata` · evidence O · read-only

Get metadata for data model objects in the profile category, including Individual, Contact Point Email, Unified Individual, and Contact Point Address objects in Data 360. Metadata includes the objects, their fields, and their categories. Since v52.0.

**Options**

None.

```sql
CALL cdp.profile_metadata ();
```

**Result**

One row. Schema `CdpQueryMetadataOutputRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `metadata` | `metadata` | JSON | Result metadata set. Since v52.0. |

**Notes:** Compared with [`metadata`](#metadata), this covers only the Profile category. The result is one row, with every DMO in the `metadata` array. The `indexes` show which fields [can be used for efficient lookups](https://developer.salesforce.com/docs/data/data-cloud-query-guide/references/data-cloud-query-api-reference/c360a-api-profile-meta.md). The spec has no `dataspace` here, while [Salesforce's tool](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/QueryTools.java) accepts one.

## profile_metadata_get

`GET /ssot/profile/metadata/{dataModelName}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Profile/paths/~1ssot~1profile~1metadata~1%7BdataModelName%7D/get) · evidence O · read-only

Get metadata for a data model object (DMO) in the profile category, such as Individual, Contact Point Email, Unified Individual, and Contact Point Address in Data 360. Metadata includes the list of fields, data types, and indexes available for lookup. Since v52.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `data_model_name` | `dataModelName` | path | string | yes | API name of the DMO, with the `__dlm` suffix, such as `ssot__Individual__dlm`. |

```sql
CALL cdp.profile_metadata_get (data_model_name => 'ssot__Individual__dlm');
```

**Result**

One row. Schema `CdpQueryMetadataOutputRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `metadata` | `metadata` | JSON | Result metadata set. Since v52.0. |

## universal_id_lookup

`GET /ssot/universalIdLookup/{entityName}/{dataSourceId}/{dataSourceObjectId}/{sourceRecordId}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Universal-ID-Lookup/paths/~1ssot~1universalIdLookup~1%7BentityName%7D~1%7BdataSourceId%7D~1%7BdataSourceObjectId%7D~1%7BsourceRecordId%7D/get) · evidence O · read-only

Starting from one source record, return the records from every source that are linked to the same unified record. Use it to find a person's IDs across systems.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `data_source_id` | `dataSourceId` | path | string | yes | Data source ID, such as `SFMC1487860`. |
| `data_source_object_id` | `dataSourceObjectId` | path | string | yes | Data source object ID, such as `SFMC1487860_EmailProfile`. |
| `entity_name` | `entityName` | path | string | yes | Name of the bridge table, such as `IndividualIdentityLink__dlm`. |
| `source_record_id` | `sourceRecordId` | path | string | yes | Primary key of the source record, such as `100060522`. It maps to the Individual ID of the Individual DMO. |

```sql
CALL cdp.universal_id_lookup (entity_name => 'IndividualIdentityLink__dlm', data_source_id => 'SFMC1487860', data_source_object_id => 'SFMC1487860_EmailProfile', source_record_id => '100060522');
```

**Result**

One row. Schema `CdpQueryDataOutputRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `data` | `data` | JSON | Result data set. Since v54.0. |

**Notes:** Each item of `data` has `SourceRecordId__c`, `UnifiedRecordId__c`, `ssot__DataSourceObjectId__c` and `ssot__DataSourceId__c`, per the [tenant host page](https://developer.salesforce.com/docs/data/data-cloud-query-guide/references/data-cloud-query-api-reference/c360a-api-universalidlookup-entity-name-datasourceid.md). `*IdentityLink__dlm` objects are [identity resolution DMOs](https://github.com/szymonlewandowski/config-snapshot-data360/blob/main/docs/api-quirks.md) (community, one org).

## metadata_search

`POST /connect/search/metadata/results` · tool `d360_metadata_search` · evidence S · read-only

Search metadata in natural language, without listing every entity. Each result's `api_name` is what `metadata` takes as `entity_name`.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `query` | `query` | body | string | yes | Search text, such as `AI Agent Interaction`. |
| `pagination` | `pagination` | body | [MetadataSearchPagination](#metadatasearchpagination) |  | Page settings. |
| `filters` | `filters` | body | array of [MetadataSearchFilter](#metadatasearchfilter) |  | Filters on result attributes. |

```sql
CALL cdp.metadata_search (query => 'AI Agent Interaction', pagination => (limit = 5), filters => [(field = 'metadataType', values = ['DataModelObject'])]);
```

**Result**

One row per item of `/data` in the response. Other response fields go to `_meta`: `totalRecords`.

| Column | API name | Type | Description |
|---|---|---|---|
| `api_name` | `apiName` | VARCHAR | API name of the entity. Pass it to `metadata` as `entity_name`. |
| `label` | `label` | VARCHAR | Label of the entity. |
| `metadata_type` | `metadataType` | VARCHAR | Type of the entity, such as `DataModelObject`. |

**Notes:** It's a POST, but it only reads: [sf-pi](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/registry/operations.json) marks it `safe_post`.

**The call may not work in every org.** A `PRISM_RUNTIME_ERROR` mentioning `msr_metadata_index__dlm` [means the org's search plane is unindexed](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/references/endpoint-families.md). Fall back to [`metadata_entities`](#metadata_entities) or [`metadata`](#metadata).

**Which call to start with is disputed.** [Salesforce's tool](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/MetadataTools.java) calls this the preferred way to discover metadata. [sf-pi](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/registry/overrides.json) says to use it "when compact catalogs are not enough", and to add a `metadata_type` filter when possible.

**The sources are thin.** The spec has no entry for this call. The options come from the [tool's request classes](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/MetadataTools.java). The result columns come from a [mock in Salesforce's unit test](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/test/java/com/salesforce/data360/mcp/tools/MetadataToolsTest.java), not a documented response, so other fields would land in `_raw`. The filter fields seen are `metadata_type` and, in that test only, `tags`.

## direct_metadata

`GET /api/v1/metadata` · [reference](https://developer.salesforce.com/docs/data/data-cloud-query-guide/references/data-cloud-query-api-reference/c360a-api-metadata-api.md) · evidence D · host tenant · read-only

Get metadata about all entities on the tenant host: DMOs, DLOs and calculated insights, with their fields, keys and relationships. It's the tenant host form of `metadata`.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `entity_name` | `entityName` | query | string |  | Name of the entity, such as `UnifiedIndividual__dlm`. If unset, all entities are returned. |
| `entity_type` | `entityType` | query | string |  | `DataLakeObject`, `DataModelObject` or `CalculatedInsight`. If unset, all types are returned. |
| `entity_category` | `entityCategory` | query | string |  | `Profile`, `Engagement` or `Related`. If unset, all categories are returned. It doesn't apply to calculated insights. |

```sql
CALL cdp.direct_metadata (entity_name => 'ssot__Individual__dlm');
```

**Result**

One row per item of `/metadata` in the response.

| Column | API name | Type | Description |
|---|---|---|---|
| `name` | `name` | VARCHAR | API name of the entity. |
| `display_name` | `displayName` | VARCHAR | Display name of the entity. |
| `category` | `category` | VARCHAR | `Profile`, `Engagement` or `Related`. Not returned for calculated insights. |
| `fields` | `fields` | JSON | Array of objects with `name`, `display_name`, `type` and, if the field has one, `keyQualifier`. Not returned for calculated insights. |
| `indexes` | `indexes` | JSON | Array of objects whose `fields` can be used for lookups. Not returned for calculated insights. |
| `relationships` | `relationships` | JSON | Array of objects with `fromEntity`, `toEntity`, `fromEntityAttribute`, `toEntityAttribute` and `cardinality`. |
| `primary_keys` | `primaryKeys` | JSON | Array of objects with `name`, `display_name` and `indexOrder`. Not returned for calculated insights. |
| `dimensions` | `dimensions` | JSON | Array of objects with `name`, `display_name` and `type`. |
| `measures` | `measures` | JSON | Array of objects with `name`, `display_name`, `type` and `rollupable`. |
| `partition_by` | `partitionBy` | VARCHAR | Field the data is partitioned by. |

**Token:** Data 360 JWT on the tenant host (`dne_cdpInstanceUrl`), from the [token exchange](api_notes.md#hosts-and-tokens).

**Notes:** Prefer [`metadata`](#metadata) unless you need the tenant host. The [reference](https://developer.salesforce.com/docs/data/data-cloud-query-guide/references/data-cloud-query-api-reference/c360a-api-metadata-api.md) documents no `dataspace` here, and [`metadata`](#metadata) has one. The community findings listed under `metadata` were measured on `/ssot/metadata`, and no source checks them on this route.

## direct_profile_metadata

`GET /api/v1/profile/metadata` · [reference](https://developer.salesforce.com/docs/data/data-cloud-query-guide/references/data-cloud-query-api-reference/c360a-api-profile-meta.md) · evidence D · host tenant · read-only

List the Profile category DMOs with their fields, indexes and relationships. It's the tenant host form of `profile_metadata`.

**Options**

None.

```sql
CALL cdp.direct_profile_metadata ();
```

**Result**

One row per item of `/metadata` in the response.

| Column | API name | Type | Description |
|---|---|---|---|
| `name` | `name` | VARCHAR | API name of the DMO. |
| `display_name` | `displayName` | VARCHAR | Display name of the DMO. |
| `category` | `category` | VARCHAR | Category of the DMO, such as `Profile`. |
| `fields` | `fields` | JSON | Array of objects with `name`, `display_name` and `type`. |
| `indexes` | `indexes` | JSON | Array of objects whose `fields` can be used for lookups. |
| `relationships` | `relationships` | JSON | Array of objects with `fromEntity`, `toEntity`, `fromEntityAttribute`, `toEntityAttribute` and `cardinality`. |
| `primary_keys` | `primaryKeys` | JSON | Array of objects with `name`, `display_name` and `indexOrder`. |

**Token:** Data 360 JWT on the tenant host (`dne_cdpInstanceUrl`), from the [token exchange](api_notes.md#hosts-and-tokens).

## direct_profile_metadata_get

`GET /api/v1/profile/metadata/{dataModelName}` · [reference](https://developer.salesforce.com/docs/data/data-cloud-query-guide/references/data-cloud-query-api-reference/c360a-api-profile-meta-dmname.md) · evidence D · host tenant · read-only

Get the fields, indexes and relationships of one Profile category DMO. It's the tenant host form of `profile_metadata_get`.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `data_model_name` | `dataModelName` | path | string | yes | API name of the DMO, such as `Individual__dlm`. |

```sql
CALL cdp.direct_profile_metadata_get (data_model_name => 'Individual__dlm');
```

**Result**

One row per item of `/metadata` in the response.

| Column | API name | Type | Description |
|---|---|---|---|
| `name` | `name` | VARCHAR | API name of the DMO. |
| `display_name` | `displayName` | VARCHAR | Display name of the DMO. |
| `category` | `category` | VARCHAR | Category of the DMO, such as `Profile`. |
| `fields` | `fields` | JSON | Array of objects with `name`, `display_name` and `type`. |
| `indexes` | `indexes` | JSON | Array of objects whose `fields` can be used for lookups. |
| `relationships` | `relationships` | JSON | Array of objects with `fromEntity`, `toEntity`, `fromEntityAttribute`, `toEntityAttribute` and `cardinality`. |
| `primary_keys` | `primaryKeys` | JSON | Array of objects with `name`, `display_name` and `indexOrder`. |

**Token:** Data 360 JWT on the tenant host (`dne_cdpInstanceUrl`), from the [token exchange](api_notes.md#hosts-and-tokens).

**Notes:** The [reference](https://developer.salesforce.com/docs/data/data-cloud-query-guide/references/data-cloud-query-api-reference/c360a-api-profile-meta-dmname.md) describes one object, but its example wraps it in a `metadata` array. The result follows the example.

## direct_profile_list

`GET /api/v1/profile/{dataModelName}` · [reference](https://developer.salesforce.com/docs/data/data-cloud-query-guide/references/data-cloud-query-api-reference/c360a-api-profile-dmname.md) · evidence D · host tenant · read-only

Query the records of a Profile category DMO using equality filters. It's the tenant host form of `profile_query`.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `data_model_name` | `dataModelName` | path | string | yes | API name of the DMO, such as `Individual__dlm`. |
| `fields` | `fields` | query | string |  | Comma-separated fields, such as `FirstName__c,LastName__c`. If unset, up to 10 arbitrary fields are returned. |
| `filters` | `filters` | query | string |  | Filter in the form `[field=value]`, such as `[FirstName__c=John]`. |
| `limit` | `limit` | query | integer |  | Maximum number of records. The reference gives a default of 49,999. |
| `offset` | `offset` | query | integer |  | Number of records to skip. |
| `order_by` | `orderby` | query | string |  | Sort fields, with a `-` prefix for descending, such as `LastName__c,-FirstName__c`. |

```sql
CALL cdp.direct_profile_list (data_model_name => 'Individual__dlm', fields => 'FirstName__c,LastName__c', filters => '[FirstName__c=John]', limit => 10);
```

**Result**

One row.

| Column | API name | Type | Description |
|---|---|---|---|
| `data` | `data` | JSON | Array of records, as objects keyed by field name. |
| `done` | `done` | BOOLEAN | Whether all results have been returned. |

**Paging:** `limit`, `offset`.

**Token:** Data 360 JWT on the tenant host (`dne_cdpInstanceUrl`), from the [token exchange](api_notes.md#hosts-and-tokens).

**Notes:** The rules of [`profile_query`](#profile_query) apply: Profile category only, equality joined by AND, and [at most 50 fields](https://developer.salesforce.com/docs/data/data-cloud-query-guide/references/data-cloud-query-api-reference/c360a-api-profile-call-overview.md).

**Differences from `profile_query`:** the page size is `limit`, not `batch_size`. `order_by` uses a `-` prefix, not `ASC` and `DESC`. Without `fields` you get up to 10 arbitrary fields, not `Id__c`. The reference doesn't mark `filters` required, and the spec does on Connect.

**The row limit conflicts.** The [reference](https://developer.salesforce.com/docs/data/data-cloud-query-guide/references/data-cloud-query-api-reference/c360a-api-profile-dmname.md) gives a default `limit` of 49,999 and also says a response has at most 4,999 records. The [overview](https://developer.salesforce.com/docs/data/data-cloud-query-guide/references/data-cloud-query-api-reference/c360a-api-profile-call-overview.md) gives a default of 4,999. Page rather than rely on either.

## direct_profile_get

`GET /api/v1/profile/{dataModelName}/{Id}` · [reference](https://developer.salesforce.com/docs/data/data-cloud-query-guide/references/data-cloud-query-api-reference/c360a-api-profile-dmname-id.md) · evidence D · host tenant · read-only

Get profile records by a key: the primary key, or with `search_key`, another field. It's the tenant host form of `profile_get`.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `data_model_name` | `dataModelName` | path | string | yes | API name of the DMO, such as `Individual__dlm`. |
| `id` | `Id` | path | string | yes | Value to match: the record's primary key, or the field named in `search_key` if set. |
| `fields` | `fields` | query | string |  | Comma-separated fields. If unset, up to 10 fields are returned. |
| `search_key` | `searchkey` | query | string |  | Field to search by, such as `Email__c`. |

```sql
CALL cdp.direct_profile_get (data_model_name => 'Individual__dlm', id => '123', fields => 'FirstName__c,LastName__c');
```

**Result**

One row.

| Column | API name | Type | Description |
|---|---|---|---|
| `data` | `data` | JSON | Array of records, as objects keyed by field name. |
| `done` | `done` | BOOLEAN | Whether all results have been returned. |

**Token:** Data 360 JWT on the tenant host (`dne_cdpInstanceUrl`), from the [token exchange](api_notes.md#hosts-and-tokens).

**Notes:** The [reference](https://developer.salesforce.com/docs/data/data-cloud-query-guide/references/data-cloud-query-api-reference/c360a-api-profile-dmname-id.md) spells it `searchkey`, all lowercase, while Connect has `searchKey`. It documents no `limit` or `offset` here.

## direct_profile_child

`GET /api/v1/profile/{dataModelName}/{Id}/{childDataModelName}` · [reference](https://developer.salesforce.com/docs/data/data-cloud-query-guide/references/data-cloud-query-api-reference/c360a-api-profile-dmname-id-child-dmname.md) · evidence D · host tenant · read-only

Get the child records of a profile record through a parent-child relationship. It's the tenant host form of `profile_child`.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `data_model_name` | `dataModelName` | path | string | yes | API name of the parent DMO, such as `Individual__dlm`. |
| `id` | `Id` | path | string | yes | Key of the parent record. |
| `child_data_model_name` | `childDataModelName` | path | string | yes | API name of the child DMO, such as `ContactPointEmail__dlm`. |
| `fields` | `fields` | query | string |  | Comma-separated child fields, such as `Email__c,IsPrimary__c`. |
| `limit` | `limit` | query | integer |  | Maximum number of records. The reference gives a default of 49,999. |
| `offset` | `offset` | query | integer |  | Number of records to skip. |
| `order_by` | `orderby` | query | string |  | Sort fields, with a `-` prefix for descending, such as `Email__c,-IsPrimary__c`. |
| `search_key` | `searchkey` | query | string |  | Field to search by, such as `Email__c`. |

```sql
CALL cdp.direct_profile_child (data_model_name => 'Individual__dlm', id => '123', child_data_model_name => 'ContactPointEmail__dlm', fields => 'Email__c,IsPrimary__c');
```

**Result**

One row.

| Column | API name | Type | Description |
|---|---|---|---|
| `data` | `data` | JSON | Array of records, as objects keyed by field name. |
| `done` | `done` | BOOLEAN | Whether all results have been returned. |

**Paging:** `limit`, `offset`.

**Token:** Data 360 JWT on the tenant host (`dne_cdpInstanceUrl`), from the [token exchange](api_notes.md#hosts-and-tokens).

**Notes:** The child [must have a relationship with the parent](https://developer.salesforce.com/docs/data/data-cloud-query-guide/references/data-cloud-query-api-reference/c360a-api-profile-dmname-id-child-dmname.md). This page has the same row limit conflict as [`direct_profile_list`](#direct_profile_list). It documents no `filters`, while Connect has them.

## direct_profile_insight

`GET /api/v1/profile/{dataModelName}/{Id}/calculated-insights/{ci-name}` · [reference](https://developer.salesforce.com/docs/data/data-cloud-query-guide/references/data-cloud-query-api-reference/c360a-api-profile-dmname-id-ci-ci-name.md) · evidence D · host tenant · read-only

Get a calculated insight's values for one profile record. It's the tenant host form of `profile_insight`, with far fewer options.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `data_model_name` | `dataModelName` | path | string | yes | API name of the DMO, such as `Individual__dlm`. |
| `id` | `Id` | path | string | yes | Key of the record. |
| `ci_name` | `ci-name` | path | string | yes | API name of the insight, such as `TotalSales__cio`. It fills the `{ci-name}` path segment. |
| `fields` | `fields` | query | string |  | Comma-separated fields, such as `TotalAmount__c,LastPurchaseDate__c`. If unset, up to 10 fields are returned. |

```sql
CALL cdp.direct_profile_insight (data_model_name => 'Individual__dlm', id => '123', ci_name => 'TotalSales__cio', fields => 'TotalAmount__c,LastPurchaseDate__c');
```

**Result**

One row.

| Column | API name | Type | Description |
|---|---|---|---|
| `data` | `data` | JSON | Array of records, as objects keyed by field name. |
| `done` | `done` | BOOLEAN | Whether all results have been returned. |

**Token:** Data 360 JWT on the tenant host (`dne_cdpInstanceUrl`), from the [token exchange](api_notes.md#hosts-and-tokens).

**Notes:** The insight [must be associated with the DMO](https://developer.salesforce.com/docs/data/data-cloud-query-guide/references/data-cloud-query-api-reference/c360a-api-profile-dmname-id-ci-ci-name.md). The reference documents only `fields`. For `dimensions`, `measures` or `time_granularity`, use the Connect form.

## direct_insight_metadata

`GET /api/v1/insight/metadata` · [reference](https://developer.salesforce.com/docs/data/data-cloud-query-guide/references/data-cloud-query-api-reference/c360a-api-v1-insight-metadata.md) · evidence D · host tenant · read-only

List the calculated insights with their dimensions, measures and relationships. It's the tenant host form of `insights_metadata`.

**Options**

None.

```sql
CALL cdp.direct_insight_metadata ();
```

**Result**

One row per item of `/metadata` in the response.

| Column | API name | Type | Description |
|---|---|---|---|
| `name` | `name` | VARCHAR | API name of the insight. |
| `display_name` | `displayName` | VARCHAR | Display name of the insight. |
| `relationships` | `relationships` | JSON | Array of objects with `fromEntity` and `toEntity`. |
| `dimensions` | `dimensions` | JSON | Array of objects with `name`, `display_name` and `type`. |
| `measures` | `measures` | JSON | Array of objects with `name`, `display_name`, `type` and `rollupable`. |
| `partition_by` | `partitionBy` | VARCHAR | Field the data is partitioned by. |

**Token:** Data 360 JWT on the tenant host (`dne_cdpInstanceUrl`), from the [token exchange](api_notes.md#hosts-and-tokens).

## direct_insight_metadata_get

`GET /api/v1/insight/metadata/{ci-name}` · [reference](https://developer.salesforce.com/docs/data/data-cloud-query-guide/references/data-cloud-query-api-reference/c360a-api-insights-meta-ci-name.md) · evidence D · host tenant · read-only

Get the dimensions, measures and relationships of one calculated insight. It's the tenant host form of `insights_metadata_get`.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `ci_name` | `ci-name` | path | string | yes | API name of the insight, such as `Avg_Spends__cio`. It fills the `{ci-name}` path segment. |

```sql
CALL cdp.direct_insight_metadata_get (ci_name => 'Avg_Spends__cio');
```

**Result**

One row per item of `/metadata` in the response.

| Column | API name | Type | Description |
|---|---|---|---|
| `name` | `name` | VARCHAR | API name of the insight. |
| `display_name` | `displayName` | VARCHAR | Display name of the insight. |
| `relationships` | `relationships` | JSON | Array of objects with `fromEntity` and `toEntity`. |
| `dimensions` | `dimensions` | JSON | Array of objects with `name`, `display_name` and `type`. |
| `measures` | `measures` | JSON | Array of objects with `name`, `display_name`, `type` and `rollupable`. |
| `partition_by` | `partitionBy` | VARCHAR | Field the data is partitioned by. |

**Token:** Data 360 JWT on the tenant host (`dne_cdpInstanceUrl`), from the [token exchange](api_notes.md#hosts-and-tokens).

**Notes:** The [reference](https://developer.salesforce.com/docs/data/data-cloud-query-guide/references/data-cloud-query-api-reference/c360a-api-insights-meta-ci-name.md) describes one object, but its example wraps it in a `metadata` array. The result follows the example.

## direct_insight_query

`GET /api/v1/insight/calculated-insights/{ci-name}` · [reference](https://developer.salesforce.com/docs/data/data-cloud-query-guide/references/data-cloud-query-api-reference/c360a-api-insights-ci-ci-name.md) · evidence D · host tenant · read-only

Query a calculated insight with chosen dimensions, measures and filters. It's the tenant host form of `insights_query`.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `ci_name` | `ci-name` | path | string | yes | API name of the insight, such as `Avg_Spends__cio`. It fills the `{ci-name}` path segment. |
| `dimensions` | `dimensions` | query | string |  | Comma-separated dimensions. If unset, all are returned. |
| `measures` | `measures` | query | string |  | Comma-separated measures. If unset, all are returned. |
| `limit` | `limit` | query | integer |  | Maximum number of rows. The default is 4,999. |
| `offset` | `offset` | query | integer |  | Number of rows to skip. |
| `filters` | `filters` | query | string |  | Filter in the form `[field=value]`, such as `[GenderId__c=Male,FirstName__c=John]`. Values are case-sensitive. |
| `order_by` | `orderby` | query | string |  | Comma-separated sort fields with an optional direction, such as `GenderId__c ASC,Occupation__c DESC`. |
| `time_granularity` | `timeGranularity` | query | string |  | `HOUR`, `DAY`, `MONTH`, `QUARTER` or `YEAR`. |

```sql
CALL cdp.direct_insight_query (ci_name => 'Avg_Spends__cio', dimensions => 'Id__c,FirstName__c', measures => 'Avg_Spend__c', limit => 3);
```

**Result**

One row.

| Column | API name | Type | Description |
|---|---|---|---|
| `data` | `data` | JSON | Array of records, as objects keyed by field name. |
| `done` | `done` | BOOLEAN | Whether all results have been returned. |

**Paging:** `limit`, `offset`.

**Token:** Data 360 JWT on the tenant host (`dne_cdpInstanceUrl`), from the [token exchange](api_notes.md#hosts-and-tokens).

**Notes:** The [reference](https://developer.salesforce.com/docs/data/data-cloud-query-guide/references/data-cloud-query-api-reference/c360a-api-insights-ci-ci-name.md) contradicts itself on the path: its syntax has `/api/v1/insight/...`, and its example `/api/v1/insights/...`. The [overview](https://developer.salesforce.com/docs/data/data-cloud-query-guide/references/data-cloud-query-api-reference/c360a-api-ci-call-overview.md) agrees with the syntax. The reference also says `time_granularity` needs API v53.0, where the spec says v54.0 on Connect.

## direct_datagraph_metadata

`GET /api/v1/dataGraph/metadata` · [reference](https://developer.salesforce.com/docs/data/data-cloud-query-guide/references/data-cloud-query-api-reference/c360a-api-v1-data-graphs-metadata.md) · evidence D · host tenant · read-only

List the data graphs with their primary objects, related objects and fields. Use it to find the names `lookup_keys` needs. It's the tenant host form of `datagraph_metadata`.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `entity_name` | `entityName` | query | string |  | Name of one data graph, such as `UnifiedIndividual_DG`. The reference's example and the lookup page use this name. |
| `data_graph_name` | `dataGraphName` | query | string |  | Name of one data graph. The reference's parameter table uses this name. |

```sql
CALL cdp.direct_datagraph_metadata (entity_name => 'UnifiedIndividual_DG');
```

**Result**

One row per item of `/metadata` in the response.

| Column | API name | Type | Description |
|---|---|---|---|
| `developer_name` | `developerName` | VARCHAR | Name of the data graph. |
| `description` | `description` | VARCHAR | Description of the data graph. |
| `dataspace_name` | `dataspaceName` | VARCHAR | Data space of the data graph. |
| `primary_object_name` | `primaryObjectName` | VARCHAR | Name of the primary DMO. |
| `primary_object_type` | `primaryObjectType` | VARCHAR | Type of the primary object, such as `DMO`. |
| `values_dmo_name` | `valuesDmoName` | VARCHAR | Name of the values DMO. |
| `id_dmo_name` | `idDmoName` | VARCHAR | Name of the ID DMO. |
| `version` | `version` | VARCHAR | Version of the data graph. |
| `status` | `status` | VARCHAR | Status of the data graph, such as `READY`. |
| `object` | `object` | JSON | Tree of the primary object, with `fields` and `related_objects`. |

**Token:** Data 360 JWT on the tenant host (`dne_cdpInstanceUrl`), from the [token exchange](api_notes.md#hosts-and-tokens).

**Notes:** **The filter's name conflicts.** The [reference](https://developer.salesforce.com/docs/data/data-cloud-query-guide/references/data-cloud-query-api-reference/c360a-api-v1-data-graphs-metadata.md) lists `data_graph_name` in its table, but its own example and the [lookup page](https://developer.salesforce.com/docs/data/data-cloud-query-guide/references/data-cloud-query-api-reference/c360a-api-v1-data-graphs-lookup.md) use `entity_name`. Both are listed until one is checked.

**The shape differs from [`datagraph_metadata`](data_graphs.md#datagraph_metadata):** the array is `metadata` here and `dataGraphMetadata` on Connect, the tree is `object` here and `dg_object` there, and the filter is `data_graph_entity_name` there. This route documents no `dataspace` option.

## direct_datagraph_get

`GET /api/v1/dataGraph/{dataGraphEntityName}/{id}` · [reference](https://developer.salesforce.com/docs/data/data-cloud-query-guide/references/data-cloud-query-api-reference/c360a-api-v1-data-graphs-name-id.md) · evidence D · host tenant · read-only

Get one data graph record by the primary key of the graph's primary DMO. It's the tenant host form of `datagraph_query`.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `data_graph_entity_name` | `dataGraphEntityName` | path | string | yes | Name of the data graph, such as `UnifiedIndividual_DG`. |
| `id` | `id` | path | string | yes | Primary key of the primary DMO, such as `100005`. |
| `live` | `live` | query | boolean |  | `true` retrieves the latest data. By default you get the precalculated data. It doesn't support real-time data graphs. |
| `dataspace` | `dataspace` | header | string |  | Data space the query runs in. |

```sql
CALL cdp.direct_datagraph_get (data_graph_entity_name => 'individual_eng_dg', id => '100005');
```

**Result**

One row.

| Column | API name | Type | Description |
|---|---|---|---|
| `data` | `data` | JSON | Array of records, as objects keyed by field name. |
| `done` | `done` | BOOLEAN | Whether all results have been returned. |

**Token:** Data 360 JWT on the tenant host (`dne_cdpInstanceUrl`), from the [token exchange](api_notes.md#hosts-and-tokens).

**Notes:** Each item of `data` holds `json_blob__c`, a JSON string with the nested record, so it needs parsing twice ([reference](https://developer.salesforce.com/docs/data/data-cloud-query-guide/references/data-cloud-query-api-reference/c360a-api-v1-data-graphs-name-id.md)). Live queries have [longer latency and higher credit use](https://developer.salesforce.com/docs/data/data-cloud-query-guide/references/data-cloud-query-api-reference/c360a-api-data-graphs-overview.md). For any other key, use [`direct_datagraph_lookup`](#direct_datagraph_lookup).

## direct_datagraph_lookup

`GET /api/v1/dataGraph/{dataGraphEntityName}` · [reference](https://developer.salesforce.com/docs/data/data-cloud-query-guide/references/data-cloud-query-api-reference/c360a-api-v1-data-graphs-lookup.md) · evidence D · host tenant · read-only

Get data graph records by lookup keys on any participating DMO, optionally with only some fields. It's the tenant host form of `datagraph_lookup`, and the best documented.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `data_graph_entity_name` | `dataGraphEntityName` | path | string | yes | Name of the data graph, such as `UnifiedIndividual_DG`. |
| `lookup_keys` | `lookupKeys` | query | string | yes | Keys in the form `[DMO__dlm.field__c=value]`, brackets included. Several keys must all match. |
| `live` | `live` | query | boolean |  | `true` retrieves the latest data. By default you get the precalculated data. |
| `fields` | `fields` | query | string |  | Fully qualified field paths from the root DMO, such as `[UnifiedIndividual.ID,UnifiedIndividual.Case.CaseNumber]`. Rename with `path=alias`. By default you get the whole graph. |
| `filters` | `filters` | query | string |  | Filters using `=`, `>=`, `<=`, `>` or `<`, such as `[Case.CreatedDate>='2024-01-01']`. |
| `dataspace` | `dataspace` | header | string |  | Data space the query runs in. |

```sql
CALL cdp.direct_datagraph_lookup (data_graph_entity_name => 'UnifiedIndividual_DG', lookup_keys => '[UnifiedLinkssotIndividualIr1__dlm.SourceRecordId__c=10000001]');
```

**Result**

One row.

| Column | API name | Type | Description |
|---|---|---|---|
| `data` | `data` | JSON | Array of records, as objects keyed by field name. |
| `done` | `done` | BOOLEAN | Whether all results have been returned. |

**Token:** Data 360 JWT on the tenant host (`dne_cdpInstanceUrl`), from the [token exchange](api_notes.md#hosts-and-tokens).

**Notes:** Everything here is from the [reference](https://developer.salesforce.com/docs/data/data-cloud-query-guide/references/data-cloud-query-api-reference/c360a-api-v1-data-graphs-lookup.md). Get DMO and field names from [`direct_datagraph_metadata`](#direct_datagraph_metadata) first.

**`lookup_keys`** is one string, and what you can search depends on the DMO:

| Search on | Primary key | Primary key and key qualifier | Other fields |
|---|---|---|---|
| Primary DMO | `[primaryDMO__dlm.PrimaryKeyField=value]` | `[primaryDMO__dlm.PrimaryKeyField=value, primaryDMO__dlm.key_qualifier_field=value]` | `[primaryDMO__dlm.anyField=value, primaryDMO__dlm.anyField2=value]` |
| Value DMO | `[valueDMO__dlm.PrimaryKeyField=value]` | `[valueDMO__dlm.PrimaryKeyField=value, valueDMO__dlm.key_qualifier_field=value]` | Not supported |
| Link table DMO | `[DMO__dlm.primaryKeyField=value]` | `[DMO__dlm.primaryKeyField=value, DMO__dlm.key_qualifier_field=value]` | `[linkTableDMO__dlm.anyField=value, linkTableDMO__dlm.anyField2=value]` |
| Participating DMO | `[Participating__dlm.primaryKey=value]` | Not supported | Not supported |

- A key can match several unified records, and then `data` holds several graphs.
- Contact-based lookup takes one contact key per request, an email address or a phone number.
- Real-time graphs search only by primary key and key qualifier.
- A cross table search combines the value DMO's primary key and key qualifier with fields of the primary DMO.

**`fields` and `filters` limits:** fields must exist in the graph, and you can't skip intermediate DMOs in a path. Filters apply per DMO, so you can't filter a parent on a grandchild. There are no aggregates, no custom ordering and no nested projections.

**The page's examples are loose.** Its projection examples drop the `__dlm` and `__c` suffixes. Its syntax section shows a filter inside `fields`, while its full requests use `filters`. Its "key qualifier" example request doesn't include the qualifier.

Each item of `data` holds `json_blob__c`, a JSON string with the nested record. With `fields`, the page doesn't show the response.

## direct_universal_id_lookup

`GET /api/v1/universalIdLookup/{entityName}/{DataSourceId__c}/{DataSourceObjectId__c}/{SourceRecordId__c}` · [reference](https://developer.salesforce.com/docs/data/data-cloud-query-guide/references/data-cloud-query-api-reference/c360a-api-universalidlookup-entity-name-datasourceid.md) · evidence D · host tenant · read-only

Starting from one source record, return the records from every source that are linked to the same unified record. It's the tenant host form of `universal_id_lookup`.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `entity_name` | `entityName` | path | string | yes | Name of the bridge table, such as `IndividualIdentityLink__dlm`. |
| `DataSourceId__c` | `DataSourceId__c` | path | string | yes | Data source ID, such as `SFMC1487860`. |
| `DataSourceObjectId__c` | `DataSourceObjectId__c` | path | string | yes | Data source object ID, such as `SFMC1487860_EmailProfile`. |
| `SourceRecordId__c` | `SourceRecordId__c` | path | string | yes | Primary key of the source record, such as `100060522`. It maps to the Individual ID of the Individual DMO. |

```sql
CALL cdp.direct_universal_id_lookup (entity_name => 'IndividualIdentityLink__dlm', DataSourceId__c => 'SFMC1487860', DataSourceObjectId__c => 'SFMC1487860_EmailProfile', SourceRecordId__c => '100060522');
```

**Result**

One row per item of `/data` in the response.

| Column | API name | Type | Description |
|---|---|---|---|
| `SourceRecordId__c` | `SourceRecordId__c` | VARCHAR | ID of the record in its source. |
| `UnifiedRecordId__c` | `UnifiedRecordId__c` | VARCHAR | Unified record ID, shared by all rows of one lookup in the reference's example. |
| `ssot__DataSourceObjectId__c` | `ssot__DataSourceObjectId__c` | VARCHAR | Data source object ID. |
| `ssot__DataSourceId__c` | `ssot__DataSourceId__c` | VARCHAR | Data source ID. |

**Token:** Data 360 JWT on the tenant host (`dne_cdpInstanceUrl`), from the [token exchange](api_notes.md#hosts-and-tokens).

**Notes:** The [overview](https://developer.salesforce.com/docs/data/data-cloud-query-guide/references/data-cloud-query-api-reference/c360a-api-universal-id-lookup.md) gives a default limit of 49,999 rows. It and the reference also say you must "explicitly specify fields" to get more than 10, yet neither documents a `fields` option here, so none is listed.

## Schemas

Attribute names are keywords inside the object they belong to, so completion offers exactly these.

### MetadataSearchFilter

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `field` | `field` | string | yes | Field to filter on, such as `metadata_type`. |
| `values` | `values` | array of string | yes | Values to match, such as `['DataModelObject']`. |

### MetadataSearchPagination

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `limit` | `limit` | integer |  | Items per page, from 1 to 5000. The default is 300. |
