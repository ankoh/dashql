# Data Streams

Part of the [CDP function reference](functions.md). Nothing here is implemented or tested against an org. Every result also has the [standard columns](functions.md#result-schema).

A data stream is the ingestion pipeline of Data 360. It reads from a connection on a schedule and writes into a data lake object (DLO), the raw table you later map to the data model. Streams come after connections, and before DMO mappings, segments and insights.

The order is: find or create the connection, call `datastream_create`, wait for `status` to become `ACTIVE`, optionally call `datastream_run`, then map the DLO with `dmo_mapping_create`.

What matters most:

- There is one create function, but the body differs per connector. [`datastream_create`](#datastream_create) shows each shape. The spec's required flags don't fit all of them.
- Each stream picks a category. `Profile` and `Other` need a primary key. `Engagement` also needs an event time field that never changes.
- `datastream_run` doesn't work on Salesforce CRM streams.
- Results use uppercase enum values and different field names than the input, so a `datastream_get` result can't be sent back as a create.
- List paging follows `next_page_url`, and `offset` counts from 1.
- `should_delete_data_lake_object => true` can return success and leave the DLO in place.

```sql
CALL cdp.connection_list (connector_type => 'AwsS3');
CALL cdp.datastream_create (
  name => 'Bookings', label => 'Bookings',
  data_source => 'AwsS3_S3Connection', data_stream_type => 'CONNECTORSFRAMEWORK',
  connector_info => (connector_type = 'DataConnector', connector_details = (name = 'S3Connection')),
  advanced_attributes => (fileName = 'bookings.csv', fileType = 'CSV', importDirectory = 'exports'),
  data_lake_object_info => (name = 'Bookings__dll', label = 'Bookings', category = 'Other',
    dataspace_info = [(name = 'default')],
    data_lake_field_input_representations = [(name = 'booking_id', label = 'Booking Id', data_type = 'Text', is_primary_key = true)]),
  source_fields => [(name = 'booking_id', data_type = 'Text')],
  mappings => [(source_field_label = 'booking_id', target_field_name = 'booking_id', target_field_returntype = 'Text')],
  refresh_config => (refresh_mode = 'UPSERT', frequency = (frequency_type = 'DAILY', hours = [12])));
CALL cdp.datastream_get (record_id_or_developer_name => 'Bookings'); /* until status is ACTIVE */
CALL cdp.datastream_run (record_id_or_developer_name => 'Bookings');
```

**Functions:** [`datastream_delete`](#datastream_delete), [`datastream_list`](#datastream_list), [`datastream_get`](#datastream_get), [`datastream_update`](#datastream_update), [`datastream_create`](#datastream_create), [`datastream_run`](#datastream_run)

## datastream_delete

`DELETE /ssot/data-streams/{recordIdOrDeveloperName}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Streams/paths/~1ssot~1data-streams~1%7BrecordIdOrDeveloperName%7D/delete) · tool `d360_datastream_delete` · evidence O · changes org state

Delete a data stream. Since v60.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `record_id_or_developer_name` | `recordIdOrDeveloperName` | path | string | yes | `record_id` from the result, or the developer name. |
| `should_delete_data_lake_object` | `shouldDeleteDataLakeObject` | query | boolean |  | Indicates whether to delete the data lake objects (DLOs) associated with the data stream (`true`) or not (`false`). The default value is `false`. Since v60.0. |

```sql
CALL cdp.datastream_delete (record_id_or_developer_name => 'S3Stream', should_delete_data_lake_object => true);
```

**Result**

No response body (HTTP 204). One row with only the standard columns.

**Notes:** `should_delete_data_lake_object` defaults to `false`, so the DLO and its data stay unless you ask otherwise.

With `true`, one community project reports that the call returns 204 and [silently leaves the DLO in place](https://github.com/javrrr/afd360/blob/main/src/resources/data-stream.ts) while something still references it, such as a DMO mapping. It also handles a rejected `true` (412 or similar) by retrying with `false` (community, one org). The same report says the earlier 204 never completes later. Only a new delete sent after the dependents were gone removed the DLO.

So don't trust the 204. A safe order, following that report:

```sql
CALL cdp.datastream_get (record_id_or_developer_name => 'Orders_stream'); /* note data_lake_object_info.name, it can't be looked up afterwards */
CALL cdp.datastream_delete (record_id_or_developer_name => 'Orders_stream', should_delete_data_lake_object => true);
CALL cdp.dlo_get (record_id_or_developer_name => 'Orders__dll'); /* 404 means the DLO is gone */
/* If it still exists: remove its mappings with dmo_mapping_delete, then */
CALL cdp.dlo_delete (record_id_or_developer_name => 'Orders__dll');
```

Removing the DLO breaks every DMO mapping that reads it, so don't pass `true` on platform-provisioned CRM streams such as `Account_Home` that other assets depend on (community).

## datastream_list

`GET /ssot/data-streams` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Streams/paths/~1ssot~1data-streams/get) · tool `d360_datastream_list` · evidence O · read-only

Get a list of data streams. Since v60.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `connection_name` | `connectionName` | query | string |  | Name of the data stream connection. Since v60.0. |
| `filter` | `filter` | query | string |  | Filter the result set to a more narrow scope or specific type, such as `filter=MC` or `filter=SFDC` for connector types. Since v60.0. |
| `include_mappings` | `includeMappings` | query | string |  | Whether to include mappings, as `'true'` or `'false'`. Reported to have no effect on the list (community). |
| `limit` | `limit` | query | integer |  | Maximum number of rows to return from `1` through `200`. If unspecified, the default number of rows is `10`. Since v60.0. |
| `offset` | `offset` | query | integer |  | Number of rows to skip before returning results. If unspecified, no rows are skipped. Since v60.0. |
| `order_by` | `orderBy` | query | string |  | Sort order for the result set: `ASC` for ascending or `DESC` for descending. If unspecified, results are returned in ascending order. Possible values are: - `Id` - `DataConnectorId` - `DataConnectorType` - `DataSourceId` - `DeveloperName` Since v60.0. |

```sql
CALL cdp.datastream_list (filter => 'SFDC', limit => 50);
```

**Result**

One row per item of `/dataStreams` in the response. Other response fields go to `_meta`: `currentPageUrl`, `nextPageUrl`, `totalSize`. Schema `DataStreamDetailedRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `created_by` | `createdBy` | JSON (CdpUserRepresentation) | Who or what created the model configuration, artifact, or other asset. Since v60.0. |
| `created_date` | `createdDate` | VARCHAR | Date that the artifact was created. Since v60.0. |
| `id` | `id` | VARCHAR | 18-character ID of the asset. Since v60.0. |
| `label` | `label` | VARCHAR | Label of the asset. Not applicable to the [get activation](https://developer.salesforce.com/docs/data/connectapi/references/spec?meta=getActivation) endpoint. Since v60.0. |
| `last_modified_by` | `lastModifiedBy` | JSON (CdpUserRepresentation) | Who or what last modified the asset. Since v60.0. |
| `last_modified_date` | `lastModifiedDate` | VARCHAR | When the asset was last modified. Since v60.0. |
| `name` | `name` | VARCHAR | Name of the asset. Since v60.0. |
| `namespace` | `namespace` | VARCHAR | Namespace of the asset. Not applicable to the [get activation](https://developer.salesforce.com/docs/data/connectapi/references/spec?meta=getActivation) endpoint. Since v60.0. |
| `url` | `url` | VARCHAR | The artifact's, configured model's, or other asset's URL. Not applicable to the [get activation](https://developer.salesforce.com/docs/data/connectapi/references/spec?meta=getActivation) endpoint. Since v60.0. |
| `advanced_attributes` | `advancedAttributes` | JSON | Additional attributes for a data stream, such as a directory, file name, or file parser options. The `are_headers_included_in_file` and `isMissingFileFailutre` flags are populated for file-based connectors. Since v62.0. |
| `connector_info` | `connectorInfo` | JSON (ConnectorRepresentation) | Data stream connector information. Since v60.0. |
| `data_access_mode` | `dataAccessMode` | VARCHAR | Data access mode used to create the data stream. Since v62.0. |
| `data_lake_object_info` | `dataLakeObjectInfo` | JSON (DataLakeObjectRepresentation) | Information about the data stream's data lake. Since v60.0. |
| `data_source` | `dataSource` | VARCHAR | Information about the data source to categorize the data being ingested. Since v63.0. |
| `data_stream_type` | `dataStreamType` | VARCHAR | Type of data stream. Since v61.0. |
| `last_added_records` | `lastAddedRecords` | BIGINT | Number of rows added in the most recent ingestion run. Since v62.0. |
| `last_processed_records` | `lastProcessedRecords` | BIGINT | Number of last processed data stream records. Since v60.0. |
| `last_refresh_date` | `lastRefreshDate` | VARCHAR | Data and time of the most recent refresh for the data stream. Since v62.0. |
| `last_run_status` | `lastRunStatus` | VARCHAR | Status of the most recent run. Since v60.0. |
| `mappings` | `mappings` | JSON (array of DataStreamFieldMappingRepresentation) | Data stream mappings. Since v60.0. |
| `record_id` | `recordId` | VARCHAR | Record ID of the data stream. Since v60.0. |
| `refresh_config` | `refreshConfig` | JSON (RefreshConfigRepresentation) | Data stream refresh configuration. Since v60.0. |
| `source_fields` | `sourceFields` | JSON (array of DataStreamSourceFieldRepresentation) | List of data stream source field information. Since v60.0. |
| `status` | `status` | VARCHAR | Status of the data stream. Since v60.0. |
| `total_records` | `totalRecords` | BIGINT | Total records in the data stream. Since v60.0. |
| `is_enabled` | `isEnabled` | BOOLEAN | Not in the spec schema: from the spec's examples. |
| `capabilities` | `capabilities` | JSON | Not in the spec schema: from the spec's examples. |

**Paging:** `next_page_url`. Follow it, and don't compute offsets. `offset` counts from 1, though the spec calls it rows to skip: its examples show `offset=1` on the first page, and [one project found](https://github.com/szymonlewandowski/config-snapshot-data360/blob/main/docs/api-quirks.md) that `offset=0` acts like 1 and `limit=3&offset=1` links to `offset=4` (community, one org). Page size is also unclear: the spec says 1 to 200, and [another project](https://github.com/javrrr/afd360/blob/main/src/resources/data-stream.ts) reports a cap near 10 whatever `limit` says (community, one org).

**Notes:** The list omits field mappings [even with `include_mappings => 'true'`](https://github.com/szymonlewandowski/config-snapshot-data360/blob/main/docs/api-quirks.md) (community), so call `datastream_get` per stream when you need them.

There is no data space option. Filter on `data_lake_object_info.dataSpaceInfo` on the client (community). The same project measured about 4 seconds for a list of 10 streams (community, one org).

The `order_by` description in the spec mixes `ASC`/`DESC` with field names and doesn't say how to combine them. The [MCP tool](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/datastream/DataStreamTools.java) also sends a `source_object_name` filter that the spec doesn't have, so it isn't an option here.

## datastream_get

`GET /ssot/data-streams/{recordIdOrDeveloperName}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Streams/paths/~1ssot~1data-streams~1%7BrecordIdOrDeveloperName%7D/get) · tool `d360_datastream_get` · evidence O · read-only

Get a data stream. Since v60.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `record_id_or_developer_name` | `recordIdOrDeveloperName` | path | string | yes | `record_id` from the result, or the developer name. S3 and Ingestion API streams can get a different developer name than you asked for (community), so prefer `record_id`. |
| `include_mappings` | `includeMappings` | query | string |  | Whether to include mappings, as `'true'` or `'false'`. |

```sql
CALL cdp.datastream_get (record_id_or_developer_name => 'Account_Home', include_mappings => 'true');
```

**Result**

One row. Schema `DataStreamDetailedRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `created_by` | `createdBy` | JSON (CdpUserRepresentation) | Who or what created the model configuration, artifact, or other asset. Since v60.0. |
| `created_date` | `createdDate` | VARCHAR | Date that the artifact was created. Since v60.0. |
| `id` | `id` | VARCHAR | 18-character ID of the asset. Since v60.0. |
| `label` | `label` | VARCHAR | Label of the asset. Not applicable to the [get activation](https://developer.salesforce.com/docs/data/connectapi/references/spec?meta=getActivation) endpoint. Since v60.0. |
| `last_modified_by` | `lastModifiedBy` | JSON (CdpUserRepresentation) | Who or what last modified the asset. Since v60.0. |
| `last_modified_date` | `lastModifiedDate` | VARCHAR | When the asset was last modified. Since v60.0. |
| `name` | `name` | VARCHAR | Name of the asset. Since v60.0. |
| `namespace` | `namespace` | VARCHAR | Namespace of the asset. Not applicable to the [get activation](https://developer.salesforce.com/docs/data/connectapi/references/spec?meta=getActivation) endpoint. Since v60.0. |
| `url` | `url` | VARCHAR | The artifact's, configured model's, or other asset's URL. Not applicable to the [get activation](https://developer.salesforce.com/docs/data/connectapi/references/spec?meta=getActivation) endpoint. Since v60.0. |
| `advanced_attributes` | `advancedAttributes` | JSON | Additional attributes for a data stream, such as a directory, file name, or file parser options. The `are_headers_included_in_file` and `isMissingFileFailutre` flags are populated for file-based connectors. Since v62.0. |
| `connector_info` | `connectorInfo` | JSON (ConnectorRepresentation) | Data stream connector information. Since v60.0. |
| `data_access_mode` | `dataAccessMode` | VARCHAR | Data access mode used to create the data stream. Since v62.0. |
| `data_lake_object_info` | `dataLakeObjectInfo` | JSON (DataLakeObjectRepresentation) | Information about the data stream's data lake. Since v60.0. |
| `data_source` | `dataSource` | VARCHAR | Information about the data source to categorize the data being ingested. Since v63.0. |
| `data_stream_type` | `dataStreamType` | VARCHAR | Type of data stream. Since v61.0. |
| `last_added_records` | `lastAddedRecords` | BIGINT | Number of rows added in the most recent ingestion run. Since v62.0. |
| `last_processed_records` | `lastProcessedRecords` | BIGINT | Number of last processed data stream records. Since v60.0. |
| `last_refresh_date` | `lastRefreshDate` | VARCHAR | Data and time of the most recent refresh for the data stream. Since v62.0. |
| `last_run_status` | `lastRunStatus` | VARCHAR | Status of the most recent run. Since v60.0. |
| `mappings` | `mappings` | JSON (array of DataStreamFieldMappingRepresentation) | Data stream mappings. Since v60.0. |
| `record_id` | `recordId` | VARCHAR | Record ID of the data stream. Since v60.0. |
| `refresh_config` | `refreshConfig` | JSON (RefreshConfigRepresentation) | Data stream refresh configuration. Since v60.0. |
| `source_fields` | `sourceFields` | JSON (array of DataStreamSourceFieldRepresentation) | List of data stream source field information. Since v60.0. |
| `status` | `status` | VARCHAR | Status of the data stream. Since v60.0. |
| `total_records` | `totalRecords` | BIGINT | Total records in the data stream. Since v60.0. |
| `is_enabled` | `isEnabled` | BOOLEAN | Not in the spec schema: from the spec's examples. |

**Notes:** **Status values.** `status` and `last_run_status` aren't in the published schema's spelling. Salesforce's sf-pi repo [accepts other values from live responses](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/registry/connect-openapi-overrides.json) for these fields, and the spec's own examples show uppercase. A [community SDK](https://github.com/javrrr/data-360-sdk/blob/main/src/schemas.ts) lists `status` as `PROCESSING`, `ACTIVE`, `ERROR`, `DELETING`, `NEEDS_ACTIVATION`, `INACTIVE`, and `last_run_status` as `NONE`, `PENDING`, `IN_PROGRESS`, `EXTRACTING`, `SUCCESS`, `FAILURE`, `CANCELLED`.

**Field names.** The [official guide](https://developer.salesforce.com/docs/data/connectapi/guide/data-stream-use-case.md) reads DLO field names from `data_lake_object_info.fields`. The spec's examples only show `data_lake_field_info_representation`. Check both. Custom CRM fields end in `_c` here, not `__c`.

**Output isn't valid input.** The community SDK and afd360 report (community):

| Result | Create input |
|---|---|
| `source_fields.datatype` | `source_fields.dataType` |
| `mappings.sourceFieldName` | `mappings.sourceFieldLabel` |
| `connector_info.connectorDetails.type` | not accepted, 400 `JSON_PARSER_ERROR` |
| `connector_type = 'AwsS3'` | `connector_type = 'DataConnector'` |
| `data_access_mode = 'INGEST'` | `data_access_mode = 'Ingest'` in the spec |

## datastream_update

`PATCH /ssot/data-streams/{recordIdOrDeveloperName}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Streams/paths/~1ssot~1data-streams~1%7BrecordIdOrDeveloperName%7D/patch) · tool `d360_datastream_update` · evidence O · changes org state

Change a stream's label, refresh settings, source fields or mappings, or disable CRM fields in bulk. Only the attributes you pass change.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `record_id_or_developer_name` | `recordIdOrDeveloperName` | path | string | yes | `record_id` from the result, or the developer name. |
| `connector_patch_info` | `connectorPatchInfo` | body | [ConnectorPatchInput](#connectorpatchinputrepresentation) |  | Information about the connector for the data stream. Since v60.0. |
| `data_lake_object_info` | `dataLakeObjectInfo` | body | array of [DataStreamPatchInput_dataLakeObjectInfo](#datastreampatchinput_datalakeobjectinfo) |  | DLO fields to add or change. The spec types this as an array, and its BYOL example sends one object with `data_lake_field_input_representations`. |
| `data_stream_type` | `datastreamType` | body | string |  | Type of data stream. Possible values include: - `AZURE` - `COMMERCE_CLOUD-S3` - `CONNECTORSFRAMEWORK` - `CRM-S3` - `DATA_CONNECTORS` - `DATA_CONNECTORS_STREAMING` - `DFU-BUNDLE` - `DFU-DE` - `EVENTS` - `GCS` - `INGEST_API` - `MCIS` - `S3` - `SFDC` - `SFDC_BUNDLE` - `SFDC_PACKAGE_KIT` - `SFTP` - `SLACK` Since v60.0. |
| `label` | `label` | body | string |  | Label of the data stream. Since v60.0. |
| `mappings` | `mappings` | body | array of [DataStreamFieldMappingInput](#datastreamfieldmappinginputrepresentation) |  | Mappings between source fields or formulas and DLO fields. A mapping with `transformation_formula = NULL` disables that field on a CRM stream. |
| `refresh_config` | `refreshConfig` | body | [RefreshConfigInput](#refreshconfiginputrepresentation) |  | New refresh settings. |
| `source_fields` | `sourceFields` | body | array of [DataStreamSourceFieldInput](#datastreamsourcefieldinputrepresentation) |  | Source fields to add. Not used for streams of type `EVENTS`. To re-enable disabled fields of a CRM stream, add them here. |
| `advanced_attributes` | `advancedAttributes` | body | [datastream_update_advancedAttributes](#datastream_update_advancedattributes) |  | Not in the spec schema: from the spec's examples. |

```sql
CALL cdp.datastream_update (record_id_or_developer_name => '0dkRM000000001XYAQ', data_stream_type => 'SFDC', mappings => [(target_field_name = 'IsEnrollmentRequired', transformation_formula = NULL), (target_field_name = 'customField_c', transformation_formula = NULL)]);
```

**Result**

One row. Schema `DataStreamRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `created_by` | `createdBy` | JSON (CdpUserRepresentation) | Who or what created the model configuration, artifact, or other asset. Since v60.0. |
| `created_date` | `createdDate` | VARCHAR | Date that the artifact was created. Since v60.0. |
| `id` | `id` | VARCHAR | 18-character ID of the asset. Since v60.0. |
| `label` | `label` | VARCHAR | Label of the asset. Not applicable to the [get activation](https://developer.salesforce.com/docs/data/connectapi/references/spec?meta=getActivation) endpoint. Since v60.0. |
| `last_modified_by` | `lastModifiedBy` | JSON (CdpUserRepresentation) | Who or what last modified the asset. Since v60.0. |
| `last_modified_date` | `lastModifiedDate` | VARCHAR | When the asset was last modified. Since v60.0. |
| `name` | `name` | VARCHAR | Name of the asset. Since v60.0. |
| `namespace` | `namespace` | VARCHAR | Namespace of the asset. Not applicable to the [get activation](https://developer.salesforce.com/docs/data/connectapi/references/spec?meta=getActivation) endpoint. Since v60.0. |
| `url` | `url` | VARCHAR | The artifact's, configured model's, or other asset's URL. Not applicable to the [get activation](https://developer.salesforce.com/docs/data/connectapi/references/spec?meta=getActivation) endpoint. Since v60.0. |
| `data_lake_object_info` | `dataLakeObjectInfo` | JSON (DataLakeObjectRepresentation) | Information about the data lake object (DLO) related to the data stream. Since v60.0. |
| `record_id` | `recordId` | VARCHAR | Record ID of the data stream. Since v60.0. |
| `status` | `status` | VARCHAR | Status of the data stream. Since v60.0. |

**Done when:** `datastream_get.status` returns to `ACTIVE`. The update returns `PROCESSING` ([official guide](https://developer.salesforce.com/docs/data/connectapi/guide/data-stream-use-case.md)).

**Notes:** **Bulk disable CRM fields.** This is the [official use case](https://developer.salesforce.com/docs/data/connectapi/guide/data-stream-use-case.md), and the example above is its request. When a CRM field is deleted or the integration user loses access, the stream keeps trying to extract it and fails. Disabling fields one by one starts a deploy cycle per field, and no other field operation can run during a cycle. A single call handles all fields in one cycle.

1. Call `datastream_get` and find each field's `name` under `data_lake_object_info.fields`. Custom fields end in `_c`.
2. Call `datastream_update` with `data_stream_type => 'SFDC'` and one mapping per field. Each has `target_field_name` and `transformation_formula = NULL`.

`NULL` must be sent as a JSON `null`. The call returns `status = 'PROCESSING'`. The DLO keeps its fields, and only the source link and formula are removed.

- Never disable `Id`, `SystemModstamp`, `SfdcOrganizationId`, `DataSource`, `DataSourceObject` or `cdp_sys_PartitionDate`.
- Check first if you can restore access instead. Mappings, transforms, segments and activations get null or stale values for a disabled field.
- To re-enable a field, add it to `source_fields` with this function.

**What can change.** The [MCP tool](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/datastream/DataStreamTools.java) lists `refresh_config` (`refresh_mode`, `frequency`, `is_acceleration_enabled`), `label`, `mappings` and `source_fields` as updatable, and `shouldFetchImmediately`, `last_run_status` and `total_records` as read-only. For Ingestion API streams, the [official page](https://developer.salesforce.com/docs/data/data-cloud-int/guide/c360-a-create-ingestion-data-stream.md) says refresh mode "cannot be changed" after creation. One community project [deletes and recreates on any drift](https://github.com/javrrr/afd360/blob/main/src/resources/data-stream.ts) instead of patching.

```sql
CALL cdp.datastream_update (record_id_or_developer_name => 'S3Stream',
  refresh_config => (refresh_mode = 'UPSERT', frequency = (frequency_type = 'WEEKLY', refresh_day_of_week = 'Monday', hours = [8])));

/* Add a source column and map it */
CALL cdp.datastream_update (record_id_or_developer_name => 'S3Stream',
  source_fields => [(name = 'NewField', data_type = 'Text')],
  mappings => [(source_field_label = 'NewField', target_field_name = 'NewField', target_field_returntype = 'Text')]);
```

**Spec gaps.** The spec's schema has no `advanced_attributes` here, but its S3 and BYOL update examples send it (`file_name`, `import_directory`, `incrementalColumn`), and a [community SDK](https://github.com/javrrr/data-360-sdk/blob/main/src/schemas.ts) says it's accepted. It's therefore missing from the options above. The spec types `data_lake_object_info` as an array, and its example sends one object. Two spec formula examples are cut off (`CONCAT(source_field['first name']`), so don't copy them.

## datastream_create

`POST /ssot/data-streams` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Streams/paths/~1ssot~1data-streams/post) · tool `d360_datastream_create`, `d360_datastream_create_sfdc`, `d360_datastream_create_aws_s3`, `d360_datastream_create_snowflake`, `d360_datastream_create_third_party_connectors` · evidence O · changes org state

Create a data stream. Since v60.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `advanced_attributes` | `advancedAttributes` | body | map to string |  | Additional attributes for a data stream, such as a directory, file name, or file parser options. BYOL data stream creations use this property for inputs, usch as `database`, `schema`, and `object`. Since v60.0. |
| `connector_info` | `connectorInfo` | body | [ConnectorInput](#connectorinputrepresentation) | yes | Details about the connector used for the data stream. Since v60.0. |
| `currency_iso_code_info` | `currencyIsoCodeInfo` | body | [DataStreamInput_currencyIsoCodeInfo](#datastreaminput_currencyisocodeinfo) |  | Currency for the stream, as `(currency_iso_code = 'USD')`. If unspecified, the org default is used. Since v63.0. |
| `data_access_mode` | `dataAccessMode` | body | enum(Direct_Access, Ingest) |  | `Ingest` copies data into the lake, and `Direct_Access` queries the source and is needed for Snowflake and BigQuery (community). MCP examples send `INGEST`. Since v62.0. |
| `data_lake_object_info` | `dataLakeObjectInfo` | body | array of [DataLakeObjectInput](#datalakeobjectinputrepresentation) |  | The DLO to create. Either this or `existing_data_lake_object_info`. The spec types it as an array, and every example sends one object. For Ingestion API streams, `data_lake_field_input_representations` must contain only the primary key. Since v60.0. |
| `data_source` | `datasource` | body | string |  | Data source of the stream. The pattern depends on the connector, see the notes. Rejected for `Direct_Access` streams (community). Since v60.0. |
| `data_stream_type` | `datastreamType` | body | string |  | Type of data stream. The spec lists `AZURE`, `COMMERCE_CLOUD-S3`, `CONNECTORSFRAMEWORK`, `CRM-S3`, `DATA_CONNECTORS`, `DATA_CONNECTORS_STREAMING`, `DFU-BUNDLE`, `DFU-DE`, `EVENTS`, `GCS`, `INGEST_API`, `MCIS`, `S3`, `SFDC`, `SFDC_BUNDLE`, `SFDC_PACKAGE_KIT`, `SFTP`, `SLACK`. Its Snowflake example also uses `EXTERNAL`. Since v60.0. |
| `existing_data_lake_object_info` | `existingDataLakeObjectInfo` | body | [ExistingDataLakeObjectInput](#existingdatalakeobjectinputrepresentation) |  | Information about a DLO that you want to reuse for the deployment. Either `data_lake_object_info` or `existing_data_lake_object_info` can be present. Since v60.0. |
| `label` | `label` | body | string | yes | Label of the data stream. Since v60.0. |
| `mappings` | `mappings` | body | array of [DataStreamFieldMappingInput](#datastreamfieldmappinginputrepresentation) |  | The spec marks this required, but the example here leaves it out. Formula fields or mappings. Since v60.0. |
| `name` | `name` | body | string | yes | Unique identifier of the data stream. Since v60.0. |
| `refresh_config` | `refreshConfig` | body | [RefreshConfigInput](#refreshconfiginputrepresentation) | yes | Refresh information for the data stream. Since v60.0. |
| `source_fields` | `sourceFields` | body | array of [DataStreamSourceFieldInput](#datastreamsourcefieldinputrepresentation) |  | The spec marks this required, but the example here leaves it out. Source fields for the data stream. Since v60.0. |

```sql
CALL cdp.datastream_create (name => 'S3Stream', label => 'S3Stream', data_source => 'AwsS3_S3Connection', data_stream_type => 'CONNECTORSFRAMEWORK', connector_info => (connector_type = 'DataConnector', connector_details = (name = 'S3Connection')), data_lake_object_info => (label = 'S3Stream', name = 'S3Stream__dll', category = 'Profile', dataspace_info = [(name = 'Default')], data_lake_field_input_representations = [(name = 'bikeid', label = 'bikeid', data_type = 'Number', is_primary_key = true), (name = 'trip_id', label = 'trip_id', data_type = 'Number', is_primary_key = false), (name = 'formulaDate', label = 'formulaDate', data_type = 'DateTime', is_primary_key = false), (name = 'DateDifference', label = 'DateDifference', data_type = 'DateTime', is_primary_key = false), (name = 'usertype', label = 'usertype', data_type = 'Text', is_primary_key = false)]), source_fields => [(name = 'bikeid', data_type = 'Number'), (name = 'trip_id', data_type = 'Number'), (name = 'starttime', data_type = 'DateTime'), (name = 'usertype', data_type = 'Text')], mappings => [(source_field_label = 'bikeid', target_field_name = 'bikeid'), (source_field_label = 'trip_id', target_field_name = 'trip_id'), (transformation_formula = 'DAYPRECISION(sourceField[''starttime''])', target_field_name = 'formulaDate', target_field_returntype = 'DateTime'), (transformation_formula = 'DAYSBETWEEN(NOW(),sourceField[''starttime''])', target_field_name = 'DateDifference', target_field_returntype = 'DateTime'), (source_field_label = 'usertype', target_field_name = 'usertype', target_field_returntype = 'Text')], refresh_config => (is_acceleration_enabled = true, refresh_mode = 'UPSERT', frequency = (frequency_type = 'WEEKLY', refresh_day_of_week = 'Sunday', hours = [7])), advanced_attributes => (fileName = '*', fileType = 'CSV', importDirectory = 'divvy', isMissingFileFailure = true, areHeadersIncludedInFile = false));
```

**Result**

One row. Schema `DataStreamRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `created_by` | `createdBy` | JSON (CdpUserRepresentation) | Who or what created the model configuration, artifact, or other asset. Since v60.0. |
| `created_date` | `createdDate` | VARCHAR | Date that the artifact was created. Since v60.0. |
| `id` | `id` | VARCHAR | 18-character ID of the asset. Since v60.0. |
| `label` | `label` | VARCHAR | Label of the asset. Not applicable to the [get activation](https://developer.salesforce.com/docs/data/connectapi/references/spec?meta=getActivation) endpoint. Since v60.0. |
| `last_modified_by` | `lastModifiedBy` | JSON (CdpUserRepresentation) | Who or what last modified the asset. Since v60.0. |
| `last_modified_date` | `lastModifiedDate` | VARCHAR | When the asset was last modified. Since v60.0. |
| `name` | `name` | VARCHAR | Name of the asset. Since v60.0. |
| `namespace` | `namespace` | VARCHAR | Namespace of the asset. Not applicable to the [get activation](https://developer.salesforce.com/docs/data/connectapi/references/spec?meta=getActivation) endpoint. Since v60.0. |
| `url` | `url` | VARCHAR | The artifact's, configured model's, or other asset's URL. Not applicable to the [get activation](https://developer.salesforce.com/docs/data/connectapi/references/spec?meta=getActivation) endpoint. Since v60.0. |
| `data_lake_object_info` | `dataLakeObjectInfo` | JSON (DataLakeObjectRepresentation) | Information about the data lake object (DLO) related to the data stream. Since v60.0. |
| `record_id` | `recordId` | VARCHAR | Record ID of the data stream. Since v60.0. |
| `status` | `status` | VARCHAR | Status of the data stream. Since v60.0. |

**Done when:** `datastream_get.status = 'ACTIVE'`. The create returns `PROCESSING`. `ERROR` is final: community code found no API retry, and it deletes and recreates. Ingestion API streams can take minutes (community).

**Notes:** There is one API call. The MCP server's `datastream_create_*` tools are presets that fill this same body. Shapes come from the spec's examples and the MCP server, and community details are marked.

**The spec's required flags are too strict.** It requires `source_fields`, `mappings` and `refresh_config` always. The [MCP CRM tool](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/datastream/SalesforceCrmDataStreamTools.java) sends none of them, and [community code](https://github.com/javrrr/afd360/blob/main/src/resources/data-stream.ts) omits `source_fields` and `mappings` for CRM and Ingestion API streams. A [community SDK](https://github.com/javrrr/data-360-sdk/blob/main/src/schemas.ts) marks `source_fields` and `mappings` optional. Every example also sends `data_lake_object_info` as one object, while the spec types it as an array.

**Shapes by connector**

| Source | `connector_type` | `data_stream_type` | `data_source` | `source_fields`, `mappings` |
|---|---|---|---|---|
| Salesforce CRM | `SalesforceDotCom` | `SFDC` | omit, or see below | not sent |
| Amazon S3 | `DataConnector` | `CONNECTORSFRAMEWORK` | `AwsS3_<connection>` | every column |
| Snowflake, BigQuery | `DataConnector` | `EXTERNAL` | omit | every column |
| Other connectors (Airtable, HubSpot, ...) | `DataConnector` | `CONNECTORSFRAMEWORK` | `<ConnectorType>_<connection>` | every column |
| Ingestion API | `IngestApi` | `INGESTAPI` (community) | `<connection>` (community) | not sent (community) |
| CSV upload | `UploadedFiles` | not shown | not shown | not shown |
| Marketing Cloud | `SalesforceMarketingCloud` | not sent | not sent | see below |

**Salesforce CRM.** Only `name` and `source_object` go in `connector_details`. The platform reads the object's columns itself, so send only the primary key ([community, one org](https://github.com/javrrr/afd360/blob/main/src/resources/data-stream.ts)). Call `connection_list (connector_type => 'SalesforceDotCom')` first. The connection name is `SalesforceDotCom_<alias>`, usually `SalesforceDotCom_Home`.

```sql
CALL cdp.datastream_create (
  name => 'Task_Home', label => 'Task_Home', data_stream_type => 'SFDC',
  connector_info => (connector_type = 'SalesforceDotCom',
    connector_details = (name = 'SalesforceDotCom_Home', source_object = 'Task')),
  data_lake_object_info => (name = 'Task_Home__dll', label = 'Task_Home',
    category = 'Engagement', event_date_time_field_name = 'CreatedDate',
    record_modified_field_name = 'SystemModstamp', dataspace_info = [(name = 'default')],
    data_lake_field_input_representations = [(name = 'Id', label = 'Id', data_type = 'Text', is_primary_key = true)]),
  refresh_config => (refresh_mode = 'UPSERT', frequency = (frequency_type = 'BATCH')));
```

Sources disagree on the details. The MCP tool names the DLO `<object>_<alias>` without a suffix and sends no fields, while the spec's list example shows `Account_Home__dll`. Community code strips `__c` from custom objects (`P_Region_Home__dll`) and sends `data_source => 'Salesforce_Home'`. A [community template](https://github.com/Jaganpro/sf-skills/blob/main/skills/sf-datacloud/assets/definitions/data-stream.template.json) uses `CONNECTORSFRAMEWORK` and `data_source => 'SalesforceDotCom_Home'`. The [payload examples](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/resources/metadata/payload-examples.json) use `eventDateColumn` and `data_lake_field_info_representation`, which aren't input attributes in the spec, so prefer `event_date_time_field_name` and `data_lake_field_input_representations`.

**Amazon S3.** The example above is the spec's. Attributes in `advanced_attributes`: `file_name`, `file_type` (`CSV` or `Parquet`), `import_directory`, `delimiter`, `are_headers_included_in_file`, `is_missing_file_failure`. The MCP example also has `headerlessRetrievalEnabled`. The [official page](https://developer.salesforce.com/docs/data/data-cloud-int/guide/c360-a-create-awss3-data-stream.md) adds that `file_name` takes wildcards, files in subdirectories are ignored, and after a directory change only files newer than the last ingested one are read. Community findings ([one org](https://github.com/javrrr/afd360/blob/main/src/resources/data-stream.ts)): `source_fields.name` is the literal CSV header, every mapping target must also be in `data_lake_field_input_representations`, and the stream's real developer name comes from the DLO name, not `name`. Use `record_id` afterwards.

**Snowflake and BigQuery (`Direct_Access`).** No data is copied. `advanced_attributes` always uses `database`, `schema` and `object`. For BigQuery these hold project, dataset and table ([community](https://github.com/javrrr/data-360-sdk/blob/main/src/schemas.ts); the spec's Snowflake example is named `GBQ_Retail` and uses these keys). Add `incrementalColumn` for incremental refresh. In the [MCP tool](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/datastream/SnowflakeDataStreamTools.java), a field's `label` is the source column and its `name` is the DLO field.

```sql
CALL cdp.datastream_create (
  name => 'Orders_snow', label => 'Orders', data_stream_type => 'EXTERNAL', data_access_mode => 'Direct_Access',
  connector_info => (connector_type = 'DataConnector', connector_details = (name = 'SnowflakeConn')),
  advanced_attributes => (database = 'ANALYTICS', schema = 'PUBLIC', object = 'CUSTOMER_ORDERS'),
  data_lake_object_info => (name = 'Orders_snow__dll', label = 'Orders', category = 'Engagement',
    event_date_time_field_name = 'purchased_at', dataspace_info = [(name = 'default')],
    data_lake_field_input_representations = [
      (name = 'order_id', label = 'ORDER_ID', data_type = 'Text', is_primary_key = true),
      (name = 'purchased_at', label = 'PURCHASED_AT', data_type = 'DateTime', is_primary_key = false)]),
  source_fields => [(name = 'ORDER_ID', data_type = 'Text'), (name = 'PURCHASED_AT', data_type = 'DateTime')],
  mappings => [(source_field_label = 'ORDER_ID', target_field_name = 'order_id', target_field_returntype = 'Text'),
    (source_field_label = 'PURCHASED_AT', target_field_name = 'purchased_at', target_field_returntype = 'DateTime')],
  refresh_config => (refresh_mode = 'TOTAL_REPLACE'));
```

Community findings: without `Direct_Access` the server answers `DATA_CONNECTORS is not supported`, a `data_source` is rejected, and `INCREMENTAL` on BigQuery needs acceleration. Community code sends `DATA_CONNECTORS` as the type, while the spec's example and the MCP tool send `EXTERNAL`, a value the spec's own list omits. The MCP tool allows `UPSERT` here, and community code says it isn't supported.

**Other connectors.** Discover objects and fields with `connection_objects_list` and `connection_object_fields_describe`. Describe types differ, so send `VARCHAR` as `Text`, `FLOAT` as `Number` and `TIMESTAMP` as `DateTime` ([MCP tool](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/datastream/ThirdPartyConnectorsDataStreamTools.java)). The DLO name must end in `__dll`. Copy `format` from the describe result onto date fields, and set `advanced_attributes.incrementalColumn` for `INCREMENTAL`.

```sql
CALL cdp.datastream_create (
  name => 'Tasks_airtable_conn', label => 'Tasks airtable conn',
  data_source => 'Airtable_airtable_conn', data_stream_type => 'CONNECTORSFRAMEWORK', data_access_mode => 'Ingest',
  connector_info => (connector_type = 'DataConnector', connector_details = (name = 'airtable_conn')),
  advanced_attributes => (objectName = 'Tasks'),
  data_lake_object_info => (name = 'Tasks_airtable_conn__dll', label = 'Tasks', category = 'Profile',
    dataspace_info = [(name = 'default')],
    data_lake_field_input_representations = [
      (name = 'Internal_Id', label = 'Internal_Id', data_type = 'Text', is_primary_key = true),
      (name = 'CreatedTime', label = 'CreatedTime', data_type = 'DateTime', is_primary_key = false)]),
  source_fields => [(name = 'Internal_Id', data_type = 'Text'),
    (name = 'CreatedTime', data_type = 'DateTime', format = 'MM/dd/yyyy HH:mm:ss.SSS')],
  mappings => [(source_field_label = 'Internal_Id', target_field_name = 'Internal_Id', target_field_returntype = 'Text'),
    (source_field_label = 'CreatedTime', target_field_name = 'CreatedTime', target_field_returntype = 'DateTime')],
  refresh_config => (refresh_mode = 'TOTAL_REPLACE', fetch_immediately = true, frequency = (frequency_type = 'NONE')));
```

**Ingestion API.** Upload the schema first with `connection_schema_upsert`. The spec says `data_lake_field_input_representations` must contain only the primary key. The rest of this shape is [community](https://github.com/javrrr/afd360/blob/main/src/resources/data-stream.ts): `events` holds the schema object name, a mismatch fails with an opaque 400, and the platform rewrites `name` and `label` on create. The spec lists the type as `INGEST_API`, while community code sends `INGESTAPI`. The [official page](https://developer.salesforce.com/docs/data/data-cloud-int/guide/c360-a-create-ingestion-data-stream.md) says data can take up to 1 hour to appear.

```sql
CALL cdp.datastream_create (
  name => 'Orders_stream', label => 'Orders', data_source => 'my_ingest_conn', data_stream_type => 'INGESTAPI',
  connector_info => (connector_type = 'IngestApi', connector_details = (name = 'my_ingest_conn', events = ['Orders'])),
  data_lake_object_info => (name = 'Orders__dll', label = 'Orders', category = 'Other', dataspace_info = [(name = 'default')],
    data_lake_field_input_representations = [(name = 'order_id', label = 'order_id', data_type = 'Text', is_primary_key = true)]),
  refresh_config => (refresh_mode = 'UPSERT'));
```

**CSV upload.** The only source is an [MCP payload example](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/resources/metadata/payload-examples.json): `connector_type = 'UploadedFiles'`, `connector_details = (name = 'UploadedFiles')`, `advanced_attributes => (file_type = 'CSV', delimiter = ',', file_name = 'customers.csv')`, and `refresh_mode = 'TOTAL_REPLACE'`. It has no `name`, `data_stream_type`, `source_fields` or `mappings`.

**Marketing Cloud.** From the spec's examples. `connector_details` holds `sub_type`, `eid`, `mid`, and for a data extension `custom_object_id` and `custom_object_name`. `advanced_attributes.mcDataExtractMode` is `FullRefresh`, `DeltaExtractByDate` or `DeltaExtractByNumber`, with `mcDeltaExtractField` naming the delta column. A data extension sends every column in `source_fields` and `mappings`. A bundle uses `sub_type = 'SalesforceMarketingCloudStandard'` and `source_object_name`, and sends empty `refresh_config`, `source_fields`, `data_lake_object_info` and `mappings`.

```sql
CALL cdp.datastream_create (
  name => 'Scoring', label => 'Scoring', refresh_config => (),
  connector_info => (connector_type = 'SalesforceMarketingCloud', connector_details = (
    sub_type = 'SalesforceMarketingCloudStandard', eid = '524000862', mid = '524000862',
    source_object_name = 'EinsteinEmailEngagementScoring')),
  advanced_attributes => (), source_fields => [], data_lake_object_info => (), mappings => []);
```

**Existing DLO.** Replace `data_lake_object_info` with `existing_data_lake_object_info => (name = 'S3Stream__dll')`, and keep `source_fields` and `mappings`. Another stream can't already be using that DLO.

**Org currency.** Pass `currency_iso_code_info => (currency_iso_code = 'USD')` and add a field with `data_type = 'currency'`, filled by a formula mapping. This is from the spec's example.

**Categories**

| `category` | Use for | Needs |
|---|---|---|
| `Profile` | People and entities: Contact, Account, Lead | Primary key |
| `Engagement` | Events: Case, Task, Event, purchases | Primary key and `event_date_time_field_name` |
| `Other` | Reference data: Product2 | Primary key |
| `Directory_Table` | Unstructured files ([community](https://github.com/Jaganpro/sf-skills/blob/main/skills/sf-datacloud-prepare/SKILL.md)) | `data_source` |
| `Insights` | Listed by the spec, not explained | - |

- Set `is_primary_key = true` on a field. The MCP tools require at least one, and community code requires exactly one.
- The event time field must be ["unchanging over time"](https://developer.salesforce.com/docs/data/data-cloud-int/guide/c360-a-create-ingestion-data-stream.md). The [MCP examples](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/resources/metadata/payload-examples.json) say to use `CreatedDate` and not `LastModifiedDate`, because a changing value breaks time-series partitioning.
- `record_modified_field_name` applies only to `Profile` and `Other`, and helps process records in the right order (official page). CRM streams use `SystemModstamp`.
- The DLO name usually ends in `__dll`. Custom CRM fields end in `_c`.

**`refresh_config`**

- `refresh_mode`: `UPSERT` inserts new records and updates existing ones by primary key. `TOTAL_REPLACE` replaces all data on each refresh ([MCP examples](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/resources/metadata/payload-examples.json)). `INCREMENTAL` needs `advanced_attributes.incrementalColumn` ([MCP tool](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/datastream/ThirdPartyConnectorsDataStreamTools.java)). The spec doesn't explain `PARTIAL_UPDATE`. The official page has a "Partial" mode limited to `Profile` and `Other`, which is likely the same.
- `frequency` is one object in every example, though the spec types it as an array.
- `frequency_type` casing is inconsistent. The spec's enum is title case (`Weekly`), and its examples send `WEEKLY`, `HOURLY` and `Hourly`. Prefer uppercase: the [community SDK](https://github.com/javrrr/data-360-sdk/blob/main/src/schemas.ts) says the wire uses it. It also lists `NOT_APPLICABLE`, `MINUTES_5`, `MINUTES_15`, `MINUTES_30`, `EVERY_4_HOURS`, `EVERY_12_HOURS`, `BATCH` and `STREAMING`. The spec's own CRM results show `BATCH`.
- The [MCP tool](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/datastream/ThirdPartyConnectorsDataStreamTools.java) requires `hours` (0 to 23) for `DAILY`, `WEEKLY` and `MONTHLY`, `refresh_day_of_week` for `WEEKLY`, and `refresh_day_of_month` for `MONTHLY`. Use `NONE` for a stream that only runs on demand.
- Fetching right after creation has three spellings: `fetch_immediately` (MCP tool, contract), `additional_attributes.shouldFetchImmediately` (spec text) and `shouldFetchImmediately` (MCP examples).

**Errors and access.** A second create with the same name fails, reported as `EDTO '<name>' already in use`. `Illegal argument` right after creating a connection or schema is transient, and community code retries it 6 times, 15 seconds apart ([community, one org](https://github.com/javrrr/afd360/blob/main/src/resources/data-stream.ts)). Not every connector has an API path for streams, so the UI may be needed ([community](https://github.com/Jaganpro/sf-skills/blob/main/skills/sf-datacloud-prepare/SKILL.md)). The [official S3 page](https://developer.salesforce.com/docs/data/data-cloud-int/guide/c360-a-create-awss3-data-stream.md) lists Data Cloud Architect as the permission needed to create a stream.

## datastream_run

`POST /ssot/data-streams/{recordIdOrDeveloperName}/actions/run` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Streams/paths/~1ssot~1data-streams~1%7BrecordIdOrDeveloperName%7D~1actions~1run/post) · tool `d360_datastream_run` · evidence O · changes org state

Start a data stream run to ingest data from the source and refresh the data lake object (DLO). Since v62.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `record_id_or_developer_name` | `recordIdOrDeveloperName` | path | string | yes | Record ID or developer name of the data stream. Since v60.0. |
| `interactive` | `interactive` | query | boolean |  | Indicates whether to execute fast forward conversion for the data stream (`true`) or not (`false`). The default value is `false`. `true` is supported only for file upload connector types. Since v62.0. |

```sql
CALL cdp.datastream_run (record_id_or_developer_name => 'S3Stream');
```

**Result**

One row. Schema `DataStreamActionResponseRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `errors` | `errors` | JSON (array of CdpErrorRepresentation) | List of errors that resulted from the action. Since v57.0. |
| `success` | `success` | BOOLEAN | Indicates whether the action was initiated successfully (`true`) or not (`false`). Since v57.0. |
| `job_id` | `jobId` | VARCHAR | Job ID of the data stream run. Since v62.0. |

**Done when:** `datastream_get.last_run_status` is `SUCCESS`, `FAILURE` or `CANCELLED`, and not `PENDING`, `IN_PROGRESS` or `EXTRACTING`. The spec's examples show `NONE`, `SUCCESS` and `FAILURE`. The in-between values come from a community SDK.

**Notes:** Not for Salesforce CRM streams. The [MCP tool](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/datastream/DataStreamTools.java) says they "cannot be manually triggered" and run on the connector's own schedule, though the spec doesn't mention this. [Community guidance](https://github.com/Jaganpro/sf-skills/blob/main/skills/sf-datacloud-prepare/SKILL.md) agrees, and Salesforce's own kit [clicks "Refresh Now" with Playwright](https://github.com/salesforce-misc/Data360AgentforceSolutionKitRetail/blob/main/.claude/skills/refresh-data-streams/SKILL.md) to refresh them. The tool says the call works for S3, Snowflake, file upload and other non-CRM streams.

`success = true` only means the run was started. The sources read for this section show no call that reads a run by `job_id`, so poll the stream.

## Schemas

Attribute names are keywords inside the object they belong to, so completion offers exactly these.

### ConnectorInputRepresentation

Represents the input details for a connector.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `connector_details` | `connectorDetails` | one of [DataConnectorDetailsConfig](#dataconnectordetailsconfig), [IngestApiConnectorDetailsConfig](#ingestapiconnectordetailsconfig), [CrmConnectorDetailsConfig](#crmconnectordetailsconfig), [SalesforceMarketingCloudConnectorDetailsConfig](#salesforcemarketingcloudconnectordetailsconfig), [StreamingConnectorDetailsConfig](#streamingconnectordetailsconfig) |  | Attributes depend on `connector_type`. See [`datastream_create`](#datastream_create). For example `(name = 'S3Connection')` or `(name = 'SalesforceDotCom_Home', source_object = 'Account')`. Since v60.0. |
| `connector_type` | `connectorType` | string |  | Type of the connector: `DataConnector`, `IngestApi`, `SalesforceDotCom`, `SalesforceMarketingCloud`, `StreamingApp`, or `UploadedFiles` (MCP example). Since v60.0. |

### ConnectorPatchInputRepresentation

Represents patch input for a connector.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `connector_patch_details_config` | `connectorPatchDetailsConfig` | object |  | Details about the connector's configuration. Since v60.0. |
| `connector_type` | `connectorType` | string |  | Type of connector used for deploying the data stream. For example, `StreamingApp`, `SalesforceDotCom`, `IngestApi`, or `DataConnector`. Since v60.0. |

### CrmConnectorDetailsConfig

Represents the configuration details for a CRM connector.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `name` | `name` | string |  | Name of the CRM connector. Since v63.0. |
| `source_object` | `sourceObject` | string |  | Developer name of the source object. Since v63.0. |

### DataConnectorDetailsConfig

Represents the configuration details for a data connector.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `name` | `name` | string |  | Name of the data connector. Since v62.0. |

### DataLakeFieldInputRepresentation

Represents the input for a data lake object (DLO) field.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `data_type` | `dataType` | enum(Boolean, Currency, Date, DateTime, Email, Number, Percent, Phone, Text, Unsupported, Url) | yes | Data type of the field. Since v62.0. |
| `is_primary_key` | `isPrimaryKey` | boolean | yes | Indicates whether the field is a primary key field (`true`) or not (`false`). Since v62.0. |
| `label` | `label` | string | yes | Label of the field. Since v60.0. |
| `name` | `name` | string | yes | API name of the field. Since v60.0. |

### DataLakeObjectInputRepresentation

Represents the input for a data lake object (DLO).

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `dataspace_name` | `dataSpaceName` | string |  | Name of the data space. If unspecified, the `default` data space is used. This property is required for data graph resources. Since v59.0. |
| `description` | `description` | string |  | Description of the object to create. Since v59.0. |
| `label` | `label` | string |  | The spec marks this required, but the example here leaves it out. Label of the object to create. This property is required for data graph resources. Since v59.0. |
| `name` | `name` | string |  | The spec marks this required, but the example here leaves it out. API name of the DLO, usually ending in `__dll`. The MCP third-party tool requires that suffix. Since v59.0. |
| `category` | `category` | enum(Directory_Table, Engagement, Insights, Other, Profile) |  | The spec marks this required, but the example here leaves it out. Category of the DLO. `Profile` and `Other` need a primary key. `Engagement` also needs `event_date_time_field_name`. Since v60.0. |
| `event_date_time_field_name` | `eventDateTimeFieldName` | string |  | Field that says when the event happened. Required when `category` is `Engagement`. It must not change over time, so use `CreatedDate` and not `LastModifiedDate`. Since v60.0. |
| `fields` | `fields` | array of [DataObjectFieldInput](#dataobjectfieldinputrepresentation) |  | Fields in the data object. Since v60.0. |
| `record_modified_field_name` | `recordModifiedFieldName` | string |  | Field that says when the record last changed, which helps process records in order. Only for `Profile` and `Other`. CRM streams use `SystemModstamp`. Since v60.0. |
| `type` | `type` | enum(DataLakeObject, DataModelObject) |  | Type of data object. Since v60.0. |
| `data_lake_field_input_representations` | `dataLakeFieldInputRepresentations` | array of [DataLakeFieldInput](#datalakefieldinputrepresentation) |  | Information about DLO fields. For Ingestion API data streams, include only the primary key field. Since v60.0. |
| `data_model_object_config` | `dataModelObjectConfig` | [DataModelObjectConfigInput](#datamodelobjectconfiginputrepresentation) |  | - |
| `data_source` | `dataSource` | [DataLakeSourceInput](#datalakesourceinputrepresentation) |  | Where the files of an unstructured DLO (`Directory_Table`) live (community). |
| `dataspace_info` | `dataspaceInfo` | array of [DataSpaceInput](#dataspaceinputrepresentation) |  | The spec marks this required, but the example here leaves it out. Information about the data space. Since v60.0. |
| `org_unit_identifier_field_name` | `orgUnitIdentifierFieldName` | string |  | Name of the org unit identifier field. Since v60.0. |

### DataLakeSourceInputRepresentation

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `directory_and_files_details` | `directoryAndFilesDetails` | array of [DirectoryAndFilesDetailsInput](#directoryandfilesdetailsinputrepresentation) |  | Directories and file patterns to read (community). |
| `source_config` | `sourceConfig` | map to string |  | Extra settings, for example `reservedPrefix = '$dcf_content$'` (community). |
| `source_id` | `sourceId` | string |  | - |
| `source_type` | `sourceType` | enum(SfDrive) |  | Spec value `SfDrive`. A community sample sends `SF_DRIVE`. |

### DataModelObjectConfigInputRepresentation

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `label` | `label` | string |  | - |
| `name` | `name` | string |  | - |

### DataObjectFieldInputRepresentation

Represents the input fields in the data object.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `is_primary_key` | `isPrimaryKey` | boolean | yes | Indicates whether this field is a primary key (`true`) or not (`false`). Since v60.0. |
| `key_qualifier_field_name` | `keyQualifierFieldName` | string |  | Key qualifier field name. Since v60.0. |
| `label` | `label` | string | yes | Label of the field. Since v60.0. |
| `name` | `name` | string | yes | Name of the field. Since v60.0. |
| `type` | `type` | enum(Boolean, Date, DateOnly, DateTime, Email, Number, Percent, Phone, Text, Url) |  | Data type of the field. Since v60.0. |
| `description` | `description` | string |  | Not in the spec schema: from the spec's examples. |
| `is_dynamic_lookup` | `isDynamicLookup` | boolean |  | Not in the spec schema: from the spec's examples. |
| `data_type` | `dataType` | string |  | Not in the spec schema: from the spec's examples. |
| `key_qualifier_field` | `keyQualifierField` | string |  | Not in the spec schema: from the spec's examples. |

### DataSpaceFilterConditionCollectionRepresentation

Represents a data space input filter on a data lake object (DLO).

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `conditions` | `conditions` | array of [DataSpaceFilterConditionInput](#dataspacefilterconditioninputrepresentation) | yes | Conditions for the filter. Since v62.0. |

### DataSpaceFilterConditionInputRepresentation

Represents the input for a data space filter condition.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `field_name` | `fieldName` | string | yes | Name of the field. Since v62.0. |
| `filter_value` | `filterValue` | string | yes | Value of the filter. Since v62.0. |
| `operator` | `operator` | enum(ContainsAny, Equals, GreaterThan, In, LastNumberOfDays, LessThan, NotEquals, NotIn) | yes | Operator of the filter condition. These are compatible with the following data types: - `ContainsAny`: text - `Equals`: text, number, date, dateTime, boolean - `GreaterThan`: number, date, dateTime - `In`: text, number - `LastNumberOfDays`: date, dateTime - `LessThan`: number, date, dateTime - `NotEquals`: text, number, date, dateTime, boolean - `NotIn`: text, number Since v62.0. |
| `table_name` | `tableName` | string | yes | Name of the table to apply the filter. Since v62.0. |

### DataSpaceFilterInputRepresentation

Represents the input filter for a data space on a data lake object (DLO).

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `condition_groups` | `conditionGroups` | array of [DataSpaceFilterInput](#dataspacefilterinputrepresentation) |  | List of filter groups. Since v67.0. |
| `conditions` | `conditions` | array of [DataSpaceFilterConditionCollection](#dataspacefilterconditioncollectionrepresentation) | yes | Conditions for the filter. Since v62.0. |
| `conjunctive_operator` | `conjunctiveOperator` | enum(AndOperator, NoneOperator, OrOperator) | yes | Operator of the filter. Since v62.0. |
| `filter_creation_type` | `filterCreationType` | string |  | Type of filter creation type, such as `CUSTOM` or `SYSTEM`. Since v66.0. |

### DataSpaceInputRepresentation

Represents the input for a data space.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `id` | `id` | string |  | ID of the asset. Since v58.0. |
| `name` | `name` | string |  | Name of the asset. Since v58.0. |
| `namespace` | `namespace` | string |  | Namespace of the asset. Since v58.0. |
| `filter` | `filter` | [DataSpaceFilterInput](#dataspacefilterinputrepresentation) |  | Filter for the data space. Since v60.0. |

### DataStreamFieldMappingInputRepresentation

Represents the input for data stream field mapping.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `source_field_label` | `sourceFieldLabel` | string |  | Source field to read, matching a `source_fields` name. Omit it when using `transformation_formula`. Since v60.0. |
| `target_field_name` | `targetFieldName` | string |  | DLO field to write. It must also be declared on the DLO (community). Since v60.0. |
| `target_field_returntype` | `targetFieldReturntype` | enum(Boolean, Currency, Date, DateTime, Email, Number, Percent, Phone, Text, Url) |  | Type of the target field. Spec examples omit it on plain mappings, but a community SDK reports that a mapping without it is silently dropped, so always send it. Since v60.0. |
| `transformation_formula` | `transformationFormula` | string |  | Formula that fills the field, referring to source fields as `source_field['name']`. Use `$$ ... $$` to avoid doubling quotes. `NULL` disables the field on a CRM stream. Since v60.0. |

### DataStreamFrequencyInputRepresentation

Represents the input for a data stream refresh frequency.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `frequency_type` | `frequencyType` | enum(Daily, Hourly, Minutely, Monthly, MonthlyRelative, Weekly, None, Transform) |  | How often the stream refreshes. The spec's enum is title case, and its examples send uppercase (`WEEKLY`, `HOURLY`). CRM streams show `BATCH`, which the enum omits. Since v60.0. |
| `hours` | `hours` | array of integer |  | Hours of the day, 0 to 23. Required for `DAILY`, `WEEKLY` and `MONTHLY` (MCP tool). Since v60.0. |
| `refresh_day_of_month` | `refreshDayOfMonth` | array of integer |  | Days of the month, 1 to 31. Required for `MONTHLY` (MCP tool). Since v60.0. |
| `refresh_day_of_week` | `refreshDayOfWeek` | enum(Friday, Monday, Saturday, Sunday, Thursday, Tuesday, Wednesday) |  | Day of the week. Required for `WEEKLY` (MCP tool). Since v60.0. |

### DataStreamInput_currencyIsoCodeInfo

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `currency_iso_code` | `currencyIsoCode` | string |  | Seen in examples: the spec types the parent as a free-form object. |

### DataStreamPatchInput_dataLakeObjectInfo

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `data_lake_field_input_representations` | `dataLakeFieldInputRepresentations` | array of [DataStreamPatchInput_dataLakeObjectInfo_dataLakeFieldInputRepresentations](#datastreampatchinput_datalakeobjectinfo_datalakefieldinputrepresentations) |  | Seen in examples: the spec types the parent as a free-form object. |

### DataStreamPatchInput_dataLakeObjectInfo_dataLakeFieldInputRepresentations

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `data_type` | `dataType` | string |  | Seen in examples: the spec types the parent as a free-form object. |
| `label` | `label` | string |  | Seen in examples: the spec types the parent as a free-form object. |
| `name` | `name` | string |  | Seen in examples: the spec types the parent as a free-form object. |

### DataStreamSourceFieldInputRepresentation

Represents the input for a data stream source field.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `data_type` | `dataType` | string |  | Data type of the data source field. Since v60.0. |
| `format` | `format` | string |  | Date format of the source field, for example `yyyy-MM-dd` or `MM/dd/yyyy HH:mm:ss.SSS`. Since v60.0. |
| `name` | `name` | string |  | Name of the field in the data source. - For CRM objects, use the API name of the field. - For CSV files, use the name of the column in the header row. - For apps, use the name of the JSON (or other format) object field exposed by the app. Since v60.0. |

### DirectoryAndFilesDetailsInputRepresentation

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `dir_name` | `dirName` | string |  | For SharePoint, `SPUnstructuredDocument/<CONNECTION_ID>/<SITE_ID>` (community). |
| `file_name` | `fileName` | string |  | File name or pattern, for example `*` (community). |

### ExistingDataLakeObjectInputRepresentation

Represents the input for a data stream's existing target data lake object (DLO).

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `name` | `name` | string |  | Developer name of the existing target DLO. The DLO cannot be used by another data stream. Since v62.0. |

### IngestApiConnectorDetailsConfig

Represents the configuration details for an Ingestion API connector.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `events` | `events` | array of string |  | List of developer names of events from the schema selected from the connected app. Since v63.0. |
| `name` | `name` | string |  | Name of the Ingestion API connector. Since v63.0. |

### RefreshConfigInputRepresentation

Represents the input for a data stream refresh configuration.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `additional_attributes` | `additionalAttributes` | map to string |  | Additional attributes for the data stream refresh configuration. For example, `shouldFetchImmediately`, `shouldTreatMissingFilesAsFailures`, and `doesPeriodicFullRefresh`. Since v60.0. |
| `fetch_immediately` | `fetchImmediately` | boolean |  | Whether to fetch data right after creation. The MCP third-party tool sends it and defaults to `true`. |
| `frequency` | `frequency` | array of [DataStreamFrequencyInput](#datastreamfrequencyinputrepresentation) |  | Frequency of the refresh. The spec types this as an array, and every example sends one object. Since v60.0. |
| `is_acceleration_enabled` | `isAccelerationEnabled` | boolean |  | Indicates whether acceleration is enabled for the data stream refresh (`true`) or not (`false`). Since v62.0. |
| `refresh_mode` | `refreshMode` | enum(TOTAL_REPLACE, UPSERT, INCREMENTAL, REPLACE, NEAR_REAL_TIME_INCREMENTAL, PARTIAL_UPDATE) |  | Refresh mode for the data stream. Since v60.0. |

### SalesforceMarketingCloudConnectorDetailsConfig

Represents the configuration details for a Salesforce Marketing Cloud connector.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `eid` | `eid` | string |  | Enterprise ID of the Marketing Cloud account. Since v63.0. |
| `mid` | `mid` | string |  | Member ID (business unit) of the Marketing Cloud account. Since v63.0. |
| `sub_type` | `subType` | string |  | The subtype of the connector details, either `SalesforceMarketingCloudStandard` or `SalesforceMarketingCloudDataExtension`. Since v63.0. |
| `source_object_name` | `sourceObjectName` | string |  | Not in the spec schema: from the spec's examples. |
| `custom_object_id` | `customObjectId` | string |  | Not in the spec schema: from the spec's examples. |
| `custom_object_name` | `customObjectName` | string |  | Not in the spec schema: from the spec's examples. |

### StreamingConnectorDetailsConfig

Represents the configuration details for a streaming connector.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `category` | `category` | enum(Directory_Table, Engagement, Insights, Other, Profile) |  | Category of the connector events. Since v63.0. |
| `events` | `events` | array of string |  | List of developer names of events from the schema selected from the connected app. Since v63.0. |
| `name` | `name` | string |  | Name of the streaming connector. Since v63.0. |
| `streaming_app_type` | `streamingAppType` | enum(MobileApp, ServerApp, WebApp) |  | Type of streaming app. Since v63.0. |

### datastream_update_advancedAttributes

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `file_name` | `fileName` | string |  | Seen in examples: the spec types the parent as a free-form object. |
| `import_directory` | `importDirectory` | string |  | Seen in examples: the spec types the parent as a free-form object. |
| `is_missing_file_failure` | `isMissingFileFailure` | boolean |  | Seen in examples: the spec types the parent as a free-form object. |
| `are_headers_included_in_file` | `areHeadersIncludedInFile` | boolean |  | Seen in examples: the spec types the parent as a free-form object. |
