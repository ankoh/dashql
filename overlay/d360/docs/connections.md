<!-- Generated from overlay/d360/api/connections.yaml, edit that and run: bazel run //overlay/d360:update -->

# Connections

Part of the [CDP function reference](functions.md). Nothing here is implemented or tested against an org. Every result also has the [standard columns](functions.md#result-schema).

A connection is the stored link between Data 360 and one outside system, such as Snowflake, S3, a CRM org or a website. A connector is the type, and a connection is one configured instance of it. Data streams read through a connection, so it comes first in any pipeline.

The usual order is `connector_list` for the type token, `connector_metadata` for the attributes that type takes, `connection_test` to try them without saving, then `connection_create`. After that, the discovery calls show what a data stream could read: databases, schemas, objects, fields and a data preview.

What matters most:

- `connection_list` requires `connector_type`. There is no list-all call, and the token's casing varies by connector (`IngestApi`, `SNOWFLAKE`).
- The option tables for `connection_create`, `connection_replace` and `connection_update` show only the fields common to all types. Their notes list the rest.
- `credentials` is a list of `(param_name = ..., value = ...)` pairs.
- `advanced_attributes` keys vary by connector, and sources disagree on names and form.
- `connection_databases_list`, `connection_db_schemas_list`, `connection_preview_get` and the test calls work only for JDBC-shaped connectors, according to Salesforce's own [troubleshooting notes](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/references/troubleshooting.md).

```sql
CALL cdp.connector_list (filters => 'name=SNOWFLAKE');

CALL cdp.connector_metadata (connector_type => 'SNOWFLAKE');

CALL cdp.connection_list (connector_type => 'SNOWFLAKE');

CALL cdp.connection_objects_list (
  connection_id => '9cgaj0000012O5hAAE',
  advanced_attributes => (database = 'SNOWFLAKE_SAMPLE_DATA', schema = 'TPCH_SF1')
);
```

**Functions:** [`connection_delete`](#connection_delete), [`connection_list`](#connection_list), [`connection_get`](#connection_get), [`connection_endpoint_list`](#connection_endpoint_list), [`connection_schema_list`](#connection_schema_list), [`connection_sitemap_get`](#connection_sitemap_get), [`connector_list`](#connector_list), [`connector_metadata`](#connector_metadata), [`connection_update`](#connection_update), [`connection_create`](#connection_create), [`existing_connection_action_run`](#existing_connection_action_run), [`existing_connection_action_test`](#existing_connection_action_test), [`connection_db_schemas_list`](#connection_db_schemas_list), [`connection_databases_list`](#connection_databases_list), [`connection_objects_list`](#connection_objects_list), [`connection_object_fields_describe`](#connection_object_fields_describe), [`connection_preview_get`](#connection_preview_get), [`existing_connection_schema_action_test`](#existing_connection_schema_action_test), [`connection_action_run`](#connection_action_run), [`connection_test`](#connection_test), [`connection_replace`](#connection_replace), [`connection_schema_upsert`](#connection_schema_upsert), [`connection_sitemap_upsert`](#connection_sitemap_upsert)

## connection_delete

`DELETE /ssot/connections/{connectionId}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Connections/paths/~1ssot~1connections~1%7BconnectionId%7D/delete) · tool `d360_connection_delete` · evidence O · changes org state

Delete a Data 360 connector. Since v60.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `connection_id` | `connectionId` | path | string | yes | Record id of the connection, from `connection_list`. |

```sql
CALL cdp.connection_delete (connection_id => '9cgaj0000012O5hAAE');
```

**Result**

No response body (HTTP 204). One row with only the standard columns.

**Notes:** Dependent data streams break, per the [catalog](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/runtime/FamilyCatalog.java). The official [web and mobile guide](https://developer.salesforce.com/docs/data/data-cloud-int/guide/c360-a-mobile-web-app-connector-delete.md) says streams must be deleted first for those connectors, and a live test saw `DEPENDENCY_EXISTS` from others ([afd360](https://github.com/javrrr/afd360/blob/main/src/resources/connection.ts), community, one org).

The same test saw a first attempt fail with `500 UNKNOWN_EXCEPTION` and a retry about 10 s later succeed. `DEPENDENCY_EXISTS` can also linger for seconds after the streams are gone (community, one org). Data connections have a `deletable` field in `connection_get`. The built-in `Salesforce_Home` connection is shared and shouldn't be deleted ([afd360](https://github.com/javrrr/afd360/blob/main/src/resources/connection.ts), community).

## connection_list

`GET /ssot/connections` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Connections/paths/~1ssot~1connections/get) · tool `d360_connection_list`, `d360_snowflake_connection_list` · evidence O · read-only

Get a paginated list of Data 360 connections that exist in an org by connector type. Since v60.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `connector_type` | `connectorType` | query | string | yes | Type of the connector. For example, `AwsRdsPostgres`, `AzureBlob`, `Databricks`, `Gcs`, `IngestApi`, `SalesforceDotCom`, `SalesforceMarketingCloud`, `Sftp`, `StreamingApp`, and so forth. Since v62.0. |
| `dev_name` | `devName` | query | string |  | Developer name of the connector. Since v62.0. |
| `label` | `label` | query | string |  | Label or public-facing name to filter on. Since v62.0. |
| `limit` | `limit` | query | integer |  | Maximum number of connections to return. Since v62.0. |
| `offset` | `offset` | query | integer |  | Number of rows to skip before returning results. Must be greater than or equal to `0`. If unspecified, no rows are skipped. Since v62.0. |
| `order_by` | `orderBy` | query | string |  | Sort connectors by field names. Supported field names are `label`, `created_date`, and `last_modified_date`. Since v62.0. |
| `organization_id` | `organizationId` | query | string |  | Organization ID to filter on. Since v62.0. |

```sql
CALL cdp.connection_list (connector_type => 'SNOWFLAKE', order_by => 'label', limit => 50);
```

**Result**

One row per item of `/connections` in the response. Other response fields go to `_meta`: `currentPageUrl`, `nextPageUrl`, `totalSize`. Schema `ConnectionRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `status` | `status` | VARCHAR | - |
| `tenant_specific_endpoint` | `tenantSpecificEndpoint` | VARCHAR | - |
| `alias` | `alias` | VARCHAR | - |
| `connection_status` | `connectionStatus` | VARCHAR | - |
| `data_source` | `dataSource` | VARCHAR | - |
| `organization_id` | `organizationId` | VARCHAR | - |
| `activation_business_units` | `activationBusinessUnits` | JSON (array of MarketingCloudConnectionBusinessUnitRepresentation) | - |
| `business_units_to_dataspaces` | `businessUnitsToDataSpaces` | JSON (array of McBuToDataSpaceRepresentation) | - |
| `create_profile_bu_mappings` | `createProfileBuMappings` | BOOLEAN | - |
| `eid` | `eid` | VARCHAR | - |
| `ingestion_business_units` | `ingestionBusinessUnits` | JSON (array of MarketingCloudConnectionBusinessUnitRepresentation) | - |
| `modules` | `modules` | JSON (array of ConnectionModuleConfigRepresentation) | - |
| `source_id` | `sourceId` | VARCHAR | - |
| `streaming_app_sub_type` | `streamingAppSubType` | VARCHAR | - |
| `streaming_app_type` | `streamingAppType` | VARCHAR | - |
| `connector_label` | `connectorLabel` | VARCHAR | - |
| `credentials` | `credentials` | JSON (array of DataConnectionParameterRepresentation) | - |
| `deletable` | `deletable` | BOOLEAN | - |
| `editable` | `editable` | BOOLEAN | - |
| `icon_url` | `iconUrl` | VARCHAR | - |
| `last_data_change_error_code` | `lastDataChangeErrorCode` | VARCHAR | - |
| `last_sync_date` | `lastSyncDate` | VARCHAR | - |
| `method` | `method` | VARCHAR | - |
| `params` | `params` | JSON (array of DataConnectionParameterRepresentation) | - |
| `sync_status` | `syncStatus` | VARCHAR | - |
| `connector_type` | `connectorType` | VARCHAR | The type of the Data Connector Framework (DCF) connector. The endpoint returns the connection output object that corresponds to the connector type: - `AccountEngagement`: Account Engagement Connection Output - `IngestApi`: Ingest API Connection Output - `SalesforceDotCom`: CRM Connection Output - `SalesforceMarketingCloud`: Marketing Cloud Connection Output - `StreamingApp`: Streaming App Connection Output - All others: Data Connection Output Since v60.0. |
| `id` | `id` | VARCHAR | Not in the spec schema: from the spec's examples. |
| `label` | `label` | VARCHAR | Not in the spec schema: from the spec's examples. |
| `name` | `name` | VARCHAR | Not in the spec schema: from the spec's examples. |
| `created_date` | `createdDate` | VARCHAR | Not in the spec schema: from the spec's examples. |

**Paging:** `next_page_url`.

**Notes:** There's no list-all mode. The spec marks `connector_type` required, as do Salesforce's [catalog](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/runtime/FamilyCatalog.java) and a [one-org test](https://github.com/szymonlewandowski/config-snapshot-data360/blob/main/docs/api-quirks.md), although the [tool](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/MetadataTools.java) code treats it as optional. To see everything, run this once per `name` from `connector_list`.

**Casing** is set per connector, with no rule. `IngestApi`, `SalesforceDotCom`, `AwsS3`, `AzureBlob` and `Databricks` are mixed case, and `SNOWFLAKE`, `BIGQUERY`, `GCS` and `SFTP` are upper case. A wrong token returns `400 ILLEGAL_QUERY_PARAMETER_VALUE`, such as `ConnectorType [Snowflake] is not supported` ([SDK](https://github.com/javrrr/data-360-sdk/blob/main/src/resources/connections.ts), community). The spec's description shows `Gcs` and `Sftp`, and its catalog example has lower case `hubspot`.

The columns stop at `connectorType`, so `id`, `name` and `label` land in `_raw`. See [`connection_get`](#connection_get). An empty result usually means the feature is on and nothing is configured ([skill](https://github.com/Jaganpro/sf-skills/blob/main/skills/sf-datacloud-connect/SKILL.md), community). The [tool](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/MetadataTools.java) also passes `filter_group`, which the spec doesn't list here.

## connection_get

`GET /ssot/connections/{connectionId}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Connections/paths/~1ssot~1connections~1%7BconnectionId%7D/get) · tool `d360_connection_get` · evidence O · read-only

Get information about a Data 360 connection. Different connector types return different response payloads. For example, the response for a `StreamingApp` connector is different from the response for a `SalesforceMarketingCloud` connector. Since v60.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `connection_id` | `connectionId` | path | string | yes | Record id of the connection, from `connection_list`. |

```sql
CALL cdp.connection_get (connection_id => '9cgaj0000012O5hAAE');
```

**Result**

One row. Schema `ConnectionRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `status` | `status` | VARCHAR | - |
| `tenant_specific_endpoint` | `tenantSpecificEndpoint` | VARCHAR | - |
| `alias` | `alias` | VARCHAR | - |
| `connection_status` | `connectionStatus` | VARCHAR | - |
| `data_source` | `dataSource` | VARCHAR | - |
| `organization_id` | `organizationId` | VARCHAR | - |
| `activation_business_units` | `activationBusinessUnits` | JSON (array of MarketingCloudConnectionBusinessUnitRepresentation) | - |
| `business_units_to_dataspaces` | `businessUnitsToDataSpaces` | JSON (array of McBuToDataSpaceRepresentation) | - |
| `create_profile_bu_mappings` | `createProfileBuMappings` | BOOLEAN | - |
| `eid` | `eid` | VARCHAR | - |
| `ingestion_business_units` | `ingestionBusinessUnits` | JSON (array of MarketingCloudConnectionBusinessUnitRepresentation) | - |
| `modules` | `modules` | JSON (array of ConnectionModuleConfigRepresentation) | - |
| `source_id` | `sourceId` | VARCHAR | - |
| `streaming_app_sub_type` | `streamingAppSubType` | VARCHAR | - |
| `streaming_app_type` | `streamingAppType` | VARCHAR | - |
| `connector_label` | `connectorLabel` | VARCHAR | - |
| `credentials` | `credentials` | JSON (array of DataConnectionParameterRepresentation) | - |
| `deletable` | `deletable` | BOOLEAN | - |
| `editable` | `editable` | BOOLEAN | - |
| `icon_url` | `iconUrl` | VARCHAR | - |
| `last_data_change_error_code` | `lastDataChangeErrorCode` | VARCHAR | - |
| `last_sync_date` | `lastSyncDate` | VARCHAR | - |
| `method` | `method` | VARCHAR | - |
| `params` | `params` | JSON (array of DataConnectionParameterRepresentation) | - |
| `sync_status` | `syncStatus` | VARCHAR | - |
| `connector_type` | `connectorType` | VARCHAR | The type of the Data Connector Framework (DCF) connector. The endpoint returns the connection output object that corresponds to the connector type: - `AccountEngagement`: Account Engagement Connection Output - `IngestApi`: Ingest API Connection Output - `SalesforceDotCom`: CRM Connection Output - `SalesforceMarketingCloud`: Marketing Cloud Connection Output - `StreamingApp`: Streaming App Connection Output - All others: Data Connection Output Since v60.0. |
| `id` | `id` | VARCHAR | Not in the spec schema: from the spec's examples. |
| `label` | `label` | VARCHAR | Not in the spec schema: from the spec's examples. |
| `name` | `name` | VARCHAR | Not in the spec schema: from the spec's examples. |

**Notes:** The spec's `ConnectionRepresentation` declares only `connector_type`. `id`, `name` and `label` are in no schema, although the spec's examples return them. All of these, and everything below, land in `_raw`:

| `connector_type` | Spec schema | Fields |
|---|---|---|
| `AccountEngagement` | `AccountEngagementConnectionRepresentation` | `modules`, `source_id`, `tenant_specific_endpoint` |
| `IngestApi` | `IngestApiConnectionRepresentation` | `status`, `tenant_specific_endpoint` |
| `SalesforceDotCom` | `CrmConnectionRepresentation` | `alias`, `connection_status`, `data_source`, `organization_id` |
| `SalesforceMarketingCloud` | `MarketingCloudConnectionRepresentation` | `activation_business_units`, `business_units_to_dataspaces`, `create_profile_bu_mappings`, `eid`, `ingestion_business_units` |
| `StreamingApp` | `StreamingAppConnectionRepresentation` | `modules`, `source_id`, `status`, `streaming_app_sub_type`, `streaming_app_type`, `tenant_specific_endpoint` |
| All others | `DataConnectionRepresentation` | `connector_label`, `credentials`, `deletable`, `editable`, `icon_url`, `last_data_change_error_code`, `last_sync_date`, `method`, `params`, `status`, `sync_status` |

Data connections return settings as `params`, while create takes `parameters`. Credential values are masked, according to the spec and [afd360](https://github.com/javrrr/afd360/blob/main/src/resources/connection.ts) (community), so a read can't be used to copy a connection.

`status` is `Connected`, `Disconnected`, `Failed` or `NeedsReAuth`. CRM `connection_status` is `Active`, `Deleting`, `Error`, `InActive`, `Processing` or `SchemaRequired`, yet a spec example shows `Connected`. A community tool saw `Processing`, `Active` and `Error` on data connections ([afd360](https://github.com/javrrr/afd360/blob/main/src/resources/connection.ts)).

The [catalog](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/runtime/FamilyCatalog.java) text says "connector_type REQUIRED" here, but neither the spec nor the [tool](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/MetadataTools.java) has that option. The tool also passes `filter_group`, which the spec doesn't list on this call.

## connection_endpoint_list

`GET /ssot/connections/{connectionId}/endpoints` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Connections/paths/~1ssot~1connections~1%7BconnectionId%7D~1endpoints/get) · evidence O · read-only

Get the endpoints of an Ingestion API connector as a binary stream. The stream contains a YAML file that includes the OpenAPI definitions of the endpoints for the connector. You can push the returned data to a data lake object (DLO). Since v61.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `connection_id` | `connectionId` | path | string | yes | Record id of an `IngestApi` connection. |

```sql
CALL cdp.connection_endpoint_list (connection_id => '9cgaj0000012O5hAAE');
```

**Result**

No response body (HTTP 200). One row with only the standard columns.

**Notes:** The response is a binary YAML file, not an empty body as the result section implies, because the spec declares no response schema. The file has to reach `_raw` or it's lost. Other connectors return `INTERNAL_SERVER_ERROR` when they have no OpenAPI definition ([sf-pi](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/references/troubleshooting.md)).

## connection_schema_list

`GET /ssot/connections/{connectionId}/schema` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Connections/paths/~1ssot~1connections~1%7BconnectionId%7D~1schema/get) · evidence O · read-only

Get the schema model for a connection. Since v60.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `connection_id` | `connectionId` | path | string | yes | Record id of the connection. |

```sql
CALL cdp.connection_schema_list (connection_id => '9cgaj0000012O5hAAE');
```

**Result**

One row per item of `/schemas` in the response. Schema `ConnectionSchemaRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `availability_status` | `availabilityStatus` | VARCHAR | - |
| `fields` | `fields` | JSON (array of ConnectorsFrameworkConnectionSchemaFieldRepresentation) | - |
| `category` | `category` | VARCHAR | - |
| `label` | `label` | VARCHAR | Label of the connector. Since v60.0. |
| `name` | `name` | VARCHAR | Developer name of the connector. Since v60.0. |
| `schema_type` | `schemaType` | VARCHAR | Schema of the connector. Since v60.0. |

**Notes:** Only some connector types work. The spec's `schema_type` allows `DataConnectionEvent`, `IngestApi` and `StreamingApp`. A community test found `AwsS3`, `Databricks` and `SalesforceDotCom` rejected with `400 ILLEGAL_QUERY_PARAMETER_VALUE`, `No enum constant ConnectionSchemaTypeEnum.<type>` ([SDK](https://github.com/javrrr/data-360-sdk/blob/main/src/resources/connections.ts)). [sf-pi](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/references/troubleshooting.md) calls this call web-connector specific, which doesn't match `IngestApi` being accepted. Each schema also has `fields`, in `_raw`.

## connection_sitemap_get

`GET /ssot/connections/{connectionId}/sitemap` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Connections/paths/~1ssot~1connections~1%7BconnectionId%7D~1sitemap/get) · evidence O · read-only

Get the sitemap for a Streaming App connection. Since v60.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `connection_id` | `connectionId` | path | string | yes | Record id of a `StreamingApp` connection. |

```sql
CALL cdp.connection_sitemap_get (connection_id => '9cgaj0000012O5hAAE');
```

**Result**

One row. Schema `ConnectionSitemapRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `sitemap` | `sitemap` | VARCHAR | Sitemap of the Streaming App connector. Since v60.0. |
| `sitemap_path` | `sitemapPath` | VARCHAR | Path to the sitemap of the Streaming App connector. Since v60.0. |

**Notes:** This is the [Web SDK sitemap](https://developer.salesforce.com/docs/data/salesforce-interactions-sdk/guide/c360a-api-sitemap.md), which holds a website's data capture rules. It isn't the sitemap of the [Web Content connector](https://developer.salesforce.com/docs/data/data-cloud-int/guide/c360-a-web-content-sitemap-connector.md). Other connector kinds return enum or parameter errors ([sf-pi](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/references/troubleshooting.md)).

## connector_list

`GET /ssot/connectors` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Connections/paths/~1ssot~1connectors/get) · tool `d360_connector_list` · evidence O · read-only

Get a paginated list of Data 360 connectors, including high-level information and attributes for each connector. Since v62.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `field_group` | `fieldGroup` | query | string |  | Number of fields to include in the results. Specify one of these values: - `SMALL` returns the fewest number of fields, including `name`, `label`, and a few others. - `MEDIUM` returns a greater number of fields. - `BIG` returns all fields. The default is `SMALL`. Since v62.0. |
| `filters` | `filters` | query | string |  | Field names by which to filter results. Specify a comma-separated list of values of the form `field=value`. For example, `name=AwsRdsPostgres` returns connectors whose name matches `AwsRdsPostgres`. By default, no filter is applied. Since v62.0. |
| `order_by` | `orderBy` | query | string |  | Sort order for the results. You can order results by the field name `label` or `name`; by default, results are ordered by name. You can also list results in ascending (`ASC`) or descending (`DESC`) order; by default, results are listed in ascending order. For example, specify `label` or `label ASC` to list results by the `label` field and in ascending order. Omit both a field name and sort order to list results by connector name and in ascending order by default. Since v62.0. |

```sql
CALL cdp.connector_list (field_group => 'BIG', order_by => 'label ASC');
```

**Result**

One row per item of `/connectorInfoList` in the response. Other response fields go to `_meta`: `currentPageUrl`, `nextPageUrl`, `totalSize`. Schema `ConnectorInfoRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `description` | `description` | VARCHAR | Description of the connector. Since v62.0. |
| `features` | `features` | JSON (array of ConnectorFeatureRepresentation) | List of features of the connector. Since v62.0. |
| `icon_url` | `iconUrl` | VARCHAR | URL for the icon of the connector. Since v62.0. |
| `label` | `label` | VARCHAR | Label of the connector. Since v62.0. |
| `name` | `name` | VARCHAR | Name of the connector. Since v62.0. |
| `release_level` | `releaseLevel` | VARCHAR | Release level of the connector. Since v63.0. |

**Paging:** `next_page_url`.

**Notes:** `name` is the token to pass to `connector_metadata`. For `connection_list`, a [community SDK](https://github.com/javrrr/data-360-sdk/blob/main/src/resources/connectors.ts) says it's also the exact `connector_type`, but [sf-pi](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/references/troubleshooting.md) gives a counterexample: CRM connections have `connector_type` `SalesforceDotCom`, while the catalog name is `SalesforceCRM`.

`features` entries look like `{"featureType": "IncrementalUpdate", "config": {"deleteSupport": "true"}}`, with `Ingress`, `ObjectBased` and `Batch` also in the spec's example.

## connector_metadata

`GET /ssot/connectors/{connectorType}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Connections/paths/~1ssot~1connectors~1%7BconnectorType%7D/get) · tool `d360_connector_metadata` · evidence O · read-only

Get metadata about a Data 360 connector. Since v59.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `connector_type` | `connectorType` | path | string | yes | Type of the connector for which to return metadata. For example, possible connector types are `AccountEngagement`, `AwsRdsPostgres`, `Databricks`, `IngestApi`, `SalesforceDotCom`, `SalesforceMarketingCloud`, `StreamingApp`, and so forth. Since v62.0. |

```sql
CALL cdp.connector_metadata (connector_type => 'AwsRdsSqlServer');
```

**Result**

One row. Schema `ConnectorMetadataRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `advanced_attributes` | `advancedAttributes` | JSON | List of advanced attributes supported by the connector, which can include extract attributes and parser settings where applicable. The list of attributes is returned in the form `List<Map<String, Object>>`. Since v62.0. |
| `connection_attributes` | `connectionAttributes` | JSON | List of connection attributes supported by the connector. The list of attributes is returned in the form `List<Map<String, Object>>`. Since v62.0. |
| `description` | `description` | VARCHAR | Description of the connector. Since v62.0. |
| `features` | `features` | JSON (array of ConnectorFeatureRepresentation) | List of features of the connector. Since v62.0. |
| `icon_url` | `iconUrl` | VARCHAR | URL for the icon of the connector. Since v62.0. |
| `label` | `label` | VARCHAR | Label of the connector. Since v62.0. |
| `name` | `name` | VARCHAR | Name of the connector. Since v62.0. |
| `ingress_description` | `ingressDescription` | VARCHAR | Not in the spec schema: from the spec's examples. |
| `release_level` | `releaseLevel` | VARCHAR | Not in the spec schema: from the spec's examples. |
| `custom_error_labels` | `customErrorLabels` | JSON | Not in the spec schema: from the spec's examples. |

**Notes:** Pass the catalog `name` from `connector_list`, not a connection's `connector_type`, or expect `NOT_FOUND`. For CRM it's `SalesforceCRM`, not `SalesforceDotCom` ([sf-pi](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/references/troubleshooting.md)).

This is the only API source for a connector's attribute names. Entries of `connection_attributes` in the spec's example have `name`, `label`, `type`, `data_type`, `required`, `editable`, `ingress`, `placeholder`, `pattern`, `minLength`, `maxLength` and **`secure`**. There, `username` and `password` have `secure: true`: write those with `:name`. A live response used scalar and nullable attribute fields where the spec declares nested objects ([sf-pi](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/registry/connect-openapi-overrides.json)).

`required` isn't the whole story: Snowflake's `region` and `unloadData` are marked optional but streams need them ([recipe](https://github.com/javrrr/afd360/blob/main/skills/afd360/references/connector-snowflake.md), community). The spec's example also returns `ingressDescription` and `releaseLevel`, which land in `_raw`.

## connection_update

`PATCH /ssot/connections/{connectionId}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Connections/paths/~1ssot~1connections~1%7BconnectionId%7D/patch) · tool `d360_connection_update` · evidence O · changes org state

Update a Data 360 connector, replacing only the data passed in the request. Since v63.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `connection_id` | `connectionId` | path | string | yes | Record id of the connection, from `connection_list`. |
| `organization_id` | `organizationId` | body | string |  | - |
| `streaming_app_sub_type` | `streamingAppSubType` | body | enum(WebApp_GA4) |  | - |
| `streaming_app_type` | `streamingAppType` | body | enum(MobileApp, ServerApp, WebApp) |  | - |
| `credentials` | `credentials` | body | array of [DataConnectionParameterInput](#dataconnectionparameterinputrepresentation) |  | - |
| `method` | `method` | body | enum(Egress, Ingress) |  | - |
| `parameters` | `parameters` | body | array of [DataConnectionParameterInput](#dataconnectionparameterinputrepresentation) |  | - |
| `add_activation_business_units` | `addActivationBusinessUnits` | body | array of string |  | - |
| `add_business_units_to_dataspaces` | `addBusinessUnitsToDataSpaces` | body | array of [McBuToDataSpaceInput](#mcbutodataspaceinputrepresentation) |  | - |
| `add_ingestion_business_units` | `addIngestionBusinessUnits` | body | array of string |  | - |
| `create_profile_mappings` | `createProfileMappings` | body | boolean |  | - |
| `remove_activation_business_units` | `removeActivationBusinessUnits` | body | array of string |  | - |
| `remove_business_units_to_dataspaces` | `removeBusinessUnitsToDataSpaces` | body | array of [McBuToDataSpaceInput](#mcbutodataspaceinputrepresentation) |  | - |
| `remove_ingestion_business_units` | `removeIngestionBusinessUnits` | body | array of string |  | - |
| `modules` | `modules` | body | array of [ConnectionModuleConfigInput](#connectionmoduleconfiginputrepresentation) |  | - |
| `connector_type` | `connectorType` | body | string | yes | The type of the Data Connector Framework (DCF) connector. For **create connection** and **replace connection**, allowable connector types are `IngestApi`, `SalesforceDotCom`, `SalesforceMarketingCloud`, `StreamingApp`, `AwsRdsPostgres`, `AzureBlob`, `Databricks`, `Gcs`, `Sftp`, and so forth. Use the connection input object that corresponds to the schema type: - `IngestApi`: Ingest API Connection Input - `SalesforceDotCom`: CRM Connection Input - `SalesforceMarketingCloud`: Marketing Cloud Connection Input - `StreamingApp`: Streaming App Connection Input - All others: Data Connection Input For **update connection**, allowable connector types are `SalesforceMarketingCloud` or `StreamingApp`. Use the connection patch input object that corresponds to the schema type: - `SalesforceMarketingCloud`: Marketing Cloud Connection Patch Input - `StreamingApp`: Streaming App Connection Patch Input Since v60.0. |
| `label` | `label` | body | string |  | Label of the connector. Since v60.0. |
| `name` | `name` | body | string |  | Developer name of the connector. Since v60.0. |
| `create_profile_bu_mappings` | `createProfileBuMappings` | body | string |  | Not in the spec schema: from the spec's examples. |

```sql
CALL cdp.connection_update (connection_id => '1WMX40000000IZdOAM', connector_type => 'SalesforceMarketingCloud', add_ingestion_business_units => ['524002279'], remove_ingestion_business_units => ['524002280'], add_business_units_to_dataspaces => [(dataspace_name = 'default', mid = '524002279')]);
```

**Result**

One row. Schema `ConnectionRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `status` | `status` | VARCHAR | - |
| `tenant_specific_endpoint` | `tenantSpecificEndpoint` | VARCHAR | - |
| `alias` | `alias` | VARCHAR | - |
| `connection_status` | `connectionStatus` | VARCHAR | - |
| `data_source` | `dataSource` | VARCHAR | - |
| `organization_id` | `organizationId` | VARCHAR | - |
| `activation_business_units` | `activationBusinessUnits` | JSON (array of MarketingCloudConnectionBusinessUnitRepresentation) | - |
| `business_units_to_dataspaces` | `businessUnitsToDataSpaces` | JSON (array of McBuToDataSpaceRepresentation) | - |
| `create_profile_bu_mappings` | `createProfileBuMappings` | BOOLEAN | - |
| `eid` | `eid` | VARCHAR | - |
| `ingestion_business_units` | `ingestionBusinessUnits` | JSON (array of MarketingCloudConnectionBusinessUnitRepresentation) | - |
| `modules` | `modules` | JSON (array of ConnectionModuleConfigRepresentation) | - |
| `source_id` | `sourceId` | VARCHAR | - |
| `streaming_app_sub_type` | `streamingAppSubType` | VARCHAR | - |
| `streaming_app_type` | `streamingAppType` | VARCHAR | - |
| `connector_label` | `connectorLabel` | VARCHAR | - |
| `credentials` | `credentials` | JSON (array of DataConnectionParameterRepresentation) | - |
| `deletable` | `deletable` | BOOLEAN | - |
| `editable` | `editable` | BOOLEAN | - |
| `icon_url` | `iconUrl` | VARCHAR | - |
| `last_data_change_error_code` | `lastDataChangeErrorCode` | VARCHAR | - |
| `last_sync_date` | `lastSyncDate` | VARCHAR | - |
| `method` | `method` | VARCHAR | - |
| `params` | `params` | JSON (array of DataConnectionParameterRepresentation) | - |
| `sync_status` | `syncStatus` | VARCHAR | - |
| `connector_type` | `connectorType` | VARCHAR | The type of the Data Connector Framework (DCF) connector. The endpoint returns the connection output object that corresponds to the connector type: - `AccountEngagement`: Account Engagement Connection Output - `IngestApi`: Ingest API Connection Output - `SalesforceDotCom`: CRM Connection Output - `SalesforceMarketingCloud`: Marketing Cloud Connection Output - `StreamingApp`: Streaming App Connection Output - All others: Data Connection Output Since v60.0. |
| `id` | `id` | VARCHAR | Not in the spec schema: from the spec's examples. |
| `label` | `label` | VARCHAR | Not in the spec schema: from the spec's examples. |
| `name` | `name` | VARCHAR | Not in the spec schema: from the spec's examples. |

**Notes:** **Which connectors.** The spec allows `SalesforceMarketingCloud` and `StreamingApp`. The [tool text](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/MetadataTools.java) says only Marketing Cloud works, and that others fail with `Could not resolve type id ... as a subtype of ConnectionPatchInputRepresentation`, so "delete and recreate" them. `connection_replace` is the spec's route for the rest. The [catalog](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/runtime/FamilyCatalog.java) warns an update can break dependent streams.

The table shows only the common fields. The rest are top-level options on one subtype:

| `connector_type` | Options |
|---|---|
| `SalesforceMarketingCloud` | `add_ingestion_business_units`, `remove_ingestion_business_units`, `add_activation_business_units`, `remove_activation_business_units` (lists of MIDs); `add_business_units_to_dataspaces`, `remove_business_units_to_dataspaces` (lists of `(dataspace_name = ..., mid = ...)`, both required); the profile mapping flag below |
| `StreamingApp` | `modules` (required), a list of `(name = ..., is_enabled = ..., configuration = ..., path = ...)`. `name` is required, and `configuration` is stringified JSON |

**Profile mapping flag.** The spec's schema has `create_profile_mappings` (boolean). Its example sends `createProfileBuMappings: "true"`, and the response and Salesforce's [request class](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/model/request/metadata/ConnectionPatchRequest.java) use `create_profile_bu_mappings`. In `mid` mappings, the MID must already be configured for ingestion or be added in the same request.

The spec marks `connector_type` required, and the request class marks it optional. The [tool](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/MetadataTools.java) also passes `filter_group`, which the spec doesn't list here.

## connection_create

`POST /ssot/connections` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Connections/paths/~1ssot~1connections/post) · tool `d360_connection_create`, `d360_connection_create_snowflake` · evidence O · changes org state

Create a Data 360 connector. Since v64.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `organization_id` | `organizationId` | body | string |  | - |
| `streaming_app_sub_type` | `streamingAppSubType` | body | enum(WebApp_GA4) |  | - |
| `streaming_app_type` | `streamingAppType` | body | enum(MobileApp, ServerApp, WebApp) |  | - |
| `credentials` | `credentials` | body | array of [DataConnectionParameterInput](#dataconnectionparameterinputrepresentation) |  | - |
| `method` | `method` | body | enum(Egress, Ingress) |  | - |
| `parameters` | `parameters` | body | array of [DataConnectionParameterInput](#dataconnectionparameterinputrepresentation) |  | - |
| `add_activation_business_units` | `addActivationBusinessUnits` | body | array of string |  | - |
| `add_business_units_to_dataspaces` | `addBusinessUnitsToDataSpaces` | body | array of [McBuToDataSpaceInput](#mcbutodataspaceinputrepresentation) |  | - |
| `add_ingestion_business_units` | `addIngestionBusinessUnits` | body | array of string |  | - |
| `create_profile_mappings` | `createProfileMappings` | body | boolean |  | - |
| `remove_activation_business_units` | `removeActivationBusinessUnits` | body | array of string |  | - |
| `remove_business_units_to_dataspaces` | `removeBusinessUnitsToDataSpaces` | body | array of [McBuToDataSpaceInput](#mcbutodataspaceinputrepresentation) |  | - |
| `remove_ingestion_business_units` | `removeIngestionBusinessUnits` | body | array of string |  | - |
| `modules` | `modules` | body | array of [ConnectionModuleConfigInput](#connectionmoduleconfiginputrepresentation) |  | - |
| `connector_type` | `connectorType` | body | string | yes | The type of the Data Connector Framework (DCF) connector. For **create connection** and **replace connection**, allowable connector types are `IngestApi`, `SalesforceDotCom`, `SalesforceMarketingCloud`, `StreamingApp`, `AwsRdsPostgres`, `AzureBlob`, `Databricks`, `Gcs`, `Sftp`, and so forth. Use the connection input object that corresponds to the schema type: - `IngestApi`: Ingest API Connection Input - `SalesforceDotCom`: CRM Connection Input - `SalesforceMarketingCloud`: Marketing Cloud Connection Input - `StreamingApp`: Streaming App Connection Input - All others: Data Connection Input For **update connection**, allowable connector types are `SalesforceMarketingCloud` or `StreamingApp`. Use the connection patch input object that corresponds to the schema type: - `SalesforceMarketingCloud`: Marketing Cloud Connection Patch Input - `StreamingApp`: Streaming App Connection Patch Input Since v60.0. |
| `label` | `label` | body | string |  | Label of the connector. Since v60.0. |
| `name` | `name` | body | string |  | Developer name of the connector. Since v60.0. |
| `config` | `config` | body | [connection_create_config](#connection_create_config) |  | Not in the spec schema: from the MCP server's payload example. |
| `capabilities` | `capabilities` | body | object |  | Not in the spec schema: from the MCP server's request class. |
| `data_stream_type` | `dataStreamType` | body | string |  | Not in the spec schema: from the MCP server's request class. |
| `pardot_tenant_id` | `pardotTenantId` | body | string |  | Not in the spec schema: from the MCP server's request class. |
| `additional_attributes` | `additionalAttributes` | body | object |  | Not in the spec schema: from the MCP server's request class. |
| `container_id` | `containerId` | body | string |  | Not in the spec schema: from the MCP server's request class. |
| `file_paths` | `filePaths` | body | array |  | Not in the spec schema: from the MCP server's request class. |
| `search_index_api_name` | `searchIndexApiName` | body | string |  | Not in the spec schema: from the MCP server's request class. |
| `advanced_attributes` | `advancedAttributes` | body | object |  | Not in the spec schema: from the MCP server's request class. |
| `filters_by_property` | `filtersByProperty` | body | array |  | Not in the spec schema: from the MCP server's request class. |
| `filter_operator` | `filterOperator` | body | string |  | Not in the spec schema: from the MCP server's request class. |
| `values` | `values` | body | array |  | Not in the spec schema: from the MCP server's request class. |

```sql
CALL cdp.connection_create (
  connector_type => 'SNOWFLAKE',
  label => 'Snowflake prod',
  name => 'snowflake_prod',
  method => 'Ingress',
  credentials => [
    (param_name = 'authenticationOption', value = 'KeyPair'),
    (param_name = 'user', value = :snowflake_user),
    (param_name = 'privateKey', value = :snowflake_private_key)
  ],
  parameters => [
    (param_name = 'accountUrl', value = 'https://my-account.snowflakecomputing.com'),
    (param_name = 'region', value = 'us-west-2'),
    (param_name = 'warehouse', value = 'LOAD_WH'),
    (param_name = 'hasPrivateNetworkRoute', value = 'false')
  ]
);
```

**Result**

One row. Schema `ConnectionRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `status` | `status` | VARCHAR | - |
| `tenant_specific_endpoint` | `tenantSpecificEndpoint` | VARCHAR | - |
| `alias` | `alias` | VARCHAR | - |
| `connection_status` | `connectionStatus` | VARCHAR | - |
| `data_source` | `dataSource` | VARCHAR | - |
| `organization_id` | `organizationId` | VARCHAR | - |
| `activation_business_units` | `activationBusinessUnits` | JSON (array of MarketingCloudConnectionBusinessUnitRepresentation) | - |
| `business_units_to_dataspaces` | `businessUnitsToDataSpaces` | JSON (array of McBuToDataSpaceRepresentation) | - |
| `create_profile_bu_mappings` | `createProfileBuMappings` | BOOLEAN | - |
| `eid` | `eid` | VARCHAR | - |
| `ingestion_business_units` | `ingestionBusinessUnits` | JSON (array of MarketingCloudConnectionBusinessUnitRepresentation) | - |
| `modules` | `modules` | JSON (array of ConnectionModuleConfigRepresentation) | - |
| `source_id` | `sourceId` | VARCHAR | - |
| `streaming_app_sub_type` | `streamingAppSubType` | VARCHAR | - |
| `streaming_app_type` | `streamingAppType` | VARCHAR | - |
| `connector_label` | `connectorLabel` | VARCHAR | - |
| `credentials` | `credentials` | JSON (array of DataConnectionParameterRepresentation) | - |
| `deletable` | `deletable` | BOOLEAN | - |
| `editable` | `editable` | BOOLEAN | - |
| `icon_url` | `iconUrl` | VARCHAR | - |
| `last_data_change_error_code` | `lastDataChangeErrorCode` | VARCHAR | - |
| `last_sync_date` | `lastSyncDate` | VARCHAR | - |
| `method` | `method` | VARCHAR | - |
| `params` | `params` | JSON (array of DataConnectionParameterRepresentation) | - |
| `sync_status` | `syncStatus` | VARCHAR | - |
| `connector_type` | `connectorType` | VARCHAR | The type of the Data Connector Framework (DCF) connector. The endpoint returns the connection output object that corresponds to the connector type: - `AccountEngagement`: Account Engagement Connection Output - `IngestApi`: Ingest API Connection Output - `SalesforceDotCom`: CRM Connection Output - `SalesforceMarketingCloud`: Marketing Cloud Connection Output - `StreamingApp`: Streaming App Connection Output - All others: Data Connection Output Since v60.0. |

**Done when:** No source says this call is asynchronous. Read `status` from `connection_get`, or `connection_status` for CRM. A community tool saw `Processing` while the authentication handshake ran, then `Active` or `Error`.

**Notes:** The table shows only what the spec's abstract `ConnectionInputRepresentation` declares. The attributes that do the work sit on one subtype per `connector_type`, and they are sent as top-level options:

| `connector_type` | Spec schema | Further options |
|---|---|---|
| `IngestApi` | `IngestApiConnectionInputRepresentation` | None |
| `SalesforceMarketingCloud` | `MarketingCloudConnectionInputRepresentation` | None |
| `SalesforceDotCom` | `CrmConnectionInputRepresentation` | `organization_id` (required) |
| `StreamingApp` | `StreamingAppConnectionInputRepresentation` | `streaming_app_type` (required: `MobileApp`, `ServerApp`, `WebApp`), `streaming_app_sub_type` (`WebApp_GA4`) |
| All others | `DataConnectionInputRepresentation` | `method` (required: `Egress`, `Ingress`), `credentials` (required), `parameters` (required), the last two as lists of [DataConnectionParameterInput](#dataconnectionparameterinputrepresentation) |

Salesforce's [request class](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/model/request/metadata/ConnectionCreateRequest.java) also has `capabilities`, `data_stream_type`, `pardot_tenant_id`, `additional_attributes`, `container_id`, `file_paths` and `search_index_api_name`. The spec doesn't list them.

**Names seen in `credentials`.** The spec says credential values are masked, and these names come up:

| `param_name` in `credentials` | Source |
|---|---|
| `username`, `password` | Spec example of `connector_metadata`, with `secure: true` |
| `user`, `privateKey`, `passphrase` | [Snowflake tool](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/SnowflakeConnectionTools.java) |
| `access_key`, `accessSecret` | [S3 recipe](https://github.com/javrrr/afd360/blob/main/skills/afd360/references/connector-s3.md) (community) |
| `client_id`, `client_secret` | [SharePoint example](https://github.com/Jaganpro/sf-skills/tree/main/skills/sf-datacloud-connect/examples/connections) (community) |

`connector_metadata` marks an attribute `secure: true` in the spec's example. No source states that `secure` decides between `credentials` and `parameters`.

**Traps:**

- Attribute names differ per connector, and no public list exists beyond `connector_metadata`. Snowflake's selector is `authenticationOption = 'KeyPair'` in [Salesforce's tool](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/SnowflakeConnectionTools.java), and `credentialType = 'KeyPairAuthentication'` in a [community example](https://github.com/Jaganpro/sf-skills/tree/main/skills/sf-datacloud-connect/examples/connections).
- Salesforce's [payload example](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/resources/metadata/payload-examples.json) for this call uses `connector_type: 'SALESFORCE'`, a `credentials` object and a `config` object. That contradicts the spec, the tool text ("'parameters' (not 'params')") and the [Snowflake tool](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/SnowflakeConnectionTools.java). Follow the spec.
- Snowflake's `privateKey` is passed as content, not a path ([tool](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/SnowflakeConnectionTools.java)). Community examples use the body without PEM headers ([recipe](https://github.com/javrrr/afd360/blob/main/skills/afd360/references/connector-snowflake.md)). The same recipe says `region` and `unloadData = 'true'` are needed for streams, although metadata marks them optional (community).
- `IngestApi`: the server replaces `name` with `<label>_<uuid>`, so look it up by `label` later ([SDK](https://github.com/javrrr/data-360-sdk/blob/main/src/resources/connections.ts), community). The connection isn't usable until `connection_schema_upsert` has run ([skill](https://github.com/Jaganpro/sf-skills/blob/main/skills/sf-datacloud-connect/SKILL.md), community).
- Recreating a name right after `connection_delete` can return `400 DUPLICATES_DETECTED` for several seconds ([SDK](https://github.com/javrrr/data-360-sdk/blob/main/src/resources/connections.ts), community).
- Creating a connection doesn't mean a stream can be created through the API for that connector ([skill](https://github.com/Jaganpro/sf-skills/blob/main/skills/sf-datacloud-connect/SKILL.md), community).

`SPUnstructuredDocument` is reported to take no `parameters` ([skill](https://github.com/Jaganpro/sf-skills/blob/main/skills/sf-datacloud-connect/SKILL.md), community), which the spec's required flag contradicts.

## existing_connection_action_run

`POST /ssot/connections/{connectionId}/actions/{command}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Connections/paths/~1ssot~1connections~1%7BconnectionId%7D~1actions~1%7Bcommand%7D/post) · evidence O · changes org state

Run a command on an existing connection. Since v64.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `command` | `command` | path | string | yes | Name of the command to run, for example, `GET_SCHEMAS`. Since v64.0. |
| `connection_id` | `connectionId` | path | string | yes | ID of the connection. Since v64.0. |
| `command_attributes` | `commandAttributes` | body | map to object |  | Map of key-value pairs for command attributes in the form `Map<String, String>`. Since v64.0. |

```sql
CALL cdp.existing_connection_action_run (command => 'GET_SCHEMAS', connection_id => '9cgaj0000012O5hAAE');
```

**Result**

One row. Schema `ConnectionCommandActionRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `errors` | `errors` | JSON (array of CdpErrorRepresentation) | List of errors that resulted from the action. Since v57.0. |
| `success` | `success` | BOOLEAN | Indicates whether the action was initiated successfully (`true`) or not (`false`). Since v57.0. |

**Notes:** The spec names only `GET_SCHEMAS`, and no source lists the commands or what each one's `command_attributes` holds. A [community tool](https://github.com/Magna-Marketing/portal-mcp/blob/main/sf-data-360/write/connections/run_connection_action.txt) lists `discover-schema`, `discover-databases`, `discover-schemas`, `refresh-credentials` and `validate-credentials`, a different spelling. The spec's description gives `command_attributes` as `Map<String, String>`, and its schema as a map to object.

The schema returns only `success` and `errors`. Any command output would land in `_raw`. For schemas, `connection_db_schemas_list` is the documented route.

## existing_connection_action_test

`POST /ssot/connections/{connectionId}/actions/test` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Connections/paths/~1ssot~1connections~1%7BconnectionId%7D~1actions~1test/post) · evidence O · changes org state

Test an existing connection and update its status based on the test result. Since v62.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `connection_id` | `connectionId` | path | string | yes | ID of the connection. Since v62.0. |

```sql
CALL cdp.existing_connection_action_test (connection_id => '9cgaj0000012O5hAAE');
```

**Result**

One row. Schema `ConnectionTestActionRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `errors` | `errors` | JSON (array of CdpErrorRepresentation) | List of errors that resulted from the action. Since v57.0. |
| `success` | `success` | BOOLEAN | Indicates whether the action was initiated successfully (`true`) or not (`false`). Since v57.0. |

**Notes:** This writes: it updates the connection's status. A live test returned HTTP 201, while the spec declares 200 ([sf-pi](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/registry/connect-openapi-overrides.json)). Check `success` and `errors`. The spec defines `success` as whether the action was initiated. CRM and similar connections can fail with `INTERNAL_ERROR: Unable to query...` ([sf-pi](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/references/troubleshooting.md)).

## connection_db_schemas_list

`POST /ssot/connections/{connectionId}/database-schemas` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Connections/paths/~1ssot~1connections~1%7BconnectionId%7D~1database-schemas/post) · tool `d360_connection_db_schemas_list` · evidence O · read-only

Get a list of database schema names for a connection. Since v63.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `connection_id` | `connectionId` | path | string | yes | ID of the connection. Since v62.0. |
| `advanced_attributes` | `advancedAttributes` | body | map to string |  | Map of strings, written `(database = 'X')`. Keys vary by connector, see the notes. Use `()` when no keys are needed. Since v63.0. |

```sql
CALL cdp.connection_db_schemas_list (connection_id => '9cgaj0000012O5hAAE', advanced_attributes => (database = 'SNOWFLAKE_SAMPLE_DATA'));
```

**Result**

One row. Schema `ConnectionDbSchemaCollectionRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `database_schemas` | `databaseSchemas` | JSON | List of database schemas for the connection. Since v63.0. |
| `schemas` | `schemas` | JSON | Not in the spec schema: from the spec's examples. |

**Notes:** **`advanced_attributes`, shared by the discovery calls.** Sources disagree on both form and keys:

- **Form.** The spec and Salesforce's [request classes](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/model/request/metadata/ConnectionDbSchemaCollectionRequest.java) define an object of strings. Salesforce's [payload example](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/resources/metadata/payload-examples.json) shows a string holding JSON, `"{\"database\":\"SNOWFLAKE_SAMPLE_DATA\"}"`, and notes "advanced_attributes is a JSON string". That may describe the MCP tool's argument and not the wire. Written as `(database = 'X')`, this function sends an object. `$$...$$` would send the string, if a connector turns out to need it.
- **Keys.** The spec's description and example here use `database_name`, and its `connection_objects_list` description adds `schema_name`. Its examples on fields and preview use `database` and `schema`, as do the [tool text](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/MetadataTools.java) and payload examples for Snowflake.
- **Discovery.** The spec points to `connector_metadata` for the keys, but its example there shows stream settings (`object_name`, `incrementalColumn`, `deleteColumn`). Check what your connector lists.

**Result.** The schema names the column `database_schemas`, but the spec's example response has `schemas`. If the example is right, the column is `NULL` and the list is in `_raw`.

JDBC-shaped connectors only: CRM and similar connections fail with `INTERNAL_ERROR: Unable to query...` ([sf-pi](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/references/troubleshooting.md)).

## connection_databases_list

`POST /ssot/connections/{connectionId}/databases` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Connections/paths/~1ssot~1connections~1%7BconnectionId%7D~1databases/post) · evidence O · read-only

Get a list of databases for a connection. This `POST` endpoint doesn't accept a request body. Since v63.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `connection_id` | `connectionId` | path | string | yes | ID of the connection. Since v62.0. |

```sql
CALL cdp.connection_databases_list (connection_id => '9cgaj0000012O5hAAE');
```

**Result**

One row. Schema `ConnectionDatabaseCollectionRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `databases` | `databases` | JSON | List of database names for the connection. Since v63.0. |

**Notes:** This is a read that uses `POST`. Its `databases` column holds a list, such as `["main", "samples", "hive_metadata"]`. JDBC-shaped connectors only ([sf-pi](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/references/troubleshooting.md)).

## connection_objects_list

`POST /ssot/connections/{connectionId}/objects` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Connections/paths/~1ssot~1connections~1%7BconnectionId%7D~1objects/post) · tool `d360_connection_objects_list` · evidence O · read-only

Get a list of source objects for a connection. Since v62.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `connection_id` | `connectionId` | path | string | yes | ID of the connection. Since v62.0. |
| `advanced_attributes` | `advancedAttributes` | body | map to string |  | Map of strings, written `(database = 'X')`. Keys vary by connector: see [`connection_db_schemas_list`](#connection_db_schemas_list). Use `()` when no keys are needed. Example keys: `database`, `schema`, `includeDataExtensionSize` (for the `SalesforceMarketingCloudDataExtension` subtype). Since v62.0. |
| `filters` | `filters` | body | [ResourceFiltersInput](#resourcefiltersinputrepresentation) |  | Criteria that filter and retrieve objects based on a subset of fields and values. Since v62.0. |

```sql
CALL cdp.connection_objects_list (connection_id => '9cgaj0000012O5hAAE', advanced_attributes => (database = 'SNOWFLAKE_SAMPLE_DATA', schema = 'TPCH_SF1'));
```

**Result**

One row. Schema `ConnectionObjectCollectionRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `objects` | `objects` | JSON | List of source objects for the connection. The endpoint returns the connection output object that corresponds to the connector type: - `SalesforceDotCom`: CRM Connection Object Output - `SalesforceMarketingCloud`: Salesforce Marketing Cloud Standard or Data Extension Connection Object Output - All others: Connection Object Output. Since v62.0. |

**Notes:** For database connectors, set `database` and `schema`, because leaving them out "can return very large result sets". Omit `advanced_attributes` for non-database connectors such as Salesforce ([payload example](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/resources/metadata/payload-examples.json)).

Each entry of `objects` has `name` and `attributes`, as in `{"type": "TABLE", "schema": "HubSpotV3", "catalog": "CData"}`. For Marketing Cloud, filter with `filters` on the properties `sub_type` (`SalesforceMarketingCloudDataExtension`, `SalesforceMarketingCloudStandard`), `mid` and `name`. One spec example spells `operator`, where the schema has `filter_operator`.

## connection_object_fields_describe

`POST /ssot/connections/{connectionId}/objects/{resourceName}/fields` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Connections/paths/~1ssot~1connections~1%7BconnectionId%7D~1objects~1%7BresourceName%7D~1fields/post) · tool `d360_connection_object_fields_describe` · evidence O · read-only

Get a list of fields for a connection object. Since v62.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `connection_id` | `connectionId` | path | string | yes | ID of the connection. Since v62.0. |
| `resource_name` | `resourceName` | path | string | yes | - Use `files` for file-based connectors. The actual file name or wildcard expression of the folder is part of the request body. - Use the object name for object, blob, or app-based connectors. - Use the table name or view name for database connectors. - Use the custom object ID for data extension source objects. - Use the data stream name for Standard Marketing Cloud bundle streams. Since v62.0. |
| `advanced_attributes` | `advancedAttributes` | body | map to string | yes | Map of strings, written `(database = 'X')`. Keys vary by connector: see [`connection_db_schemas_list`](#connection_db_schemas_list). Use `()` when no keys are needed. For files, keys include the file path and parser settings. Since v62.0. |
| `filters` | `filters` | body | [ResourceFiltersInput](#resourcefiltersinputrepresentation) |  | Criteria that filter and retrieve fields based on a subset of fields and values. Since v63.0. |

```sql
CALL cdp.connection_object_fields_describe (connection_id => '9cgaj0000012O5hAAE', resource_name => 'CUSTOMER', advanced_attributes => (database = 'SNOWFLAKE_SAMPLE_DATA', schema = 'TPCH_SF1'));
```

**Result**

One row. Schema `ConnectionFieldCollectionRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `advanced_attributes` | `advancedAttributes` | JSON | Advanced attributes of the connection, which can include extract attributes and parser settings where applicable. Since v61.0. |
| `fields` | `fields` | JSON (array of BaseConnectionFieldRepresentation) | List of fields for the connection. All connections return the properties of `Connection Field Output`. CRM connections also return the properties of `CRM Connection Field Output`. Since v61.0. |
| `incremental_extract_attributes` | `incrementalExtractAttributes` | JSON | List of incremental fields and delete fields for the connection. Since v61.0. |
| `primary_keys` | `primaryKeys` | JSON | List of primary keys for the connection. Since v61.0. |

**Notes:** Find `resource_name` with `connection_objects_list`. The spec marks `advanced_attributes` required, and the [tool](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/MetadataTools.java)'s request class optional, so pass `()` to be safe.

Each entry of `fields` has `name`, `type` (`Text`, `Number`, `DateTime`, `Boolean`), `originalType` and sometimes `format`. CRM adds `is_required`, `label`, `creation_type` and `isCalculatedField`. These feed data stream creation. `primary_keys` can be empty, and a spec example for CSV files returns empty `fields`.

## connection_preview_get

`POST /ssot/connections/{connectionId}/objects/{resourceName}/preview` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Connections/paths/~1ssot~1connections~1%7BconnectionId%7D~1objects~1%7BresourceName%7D~1preview/post) · evidence O · read-only

Get a preview of the data in an object and pass it through parser settings. Since v62.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `connection_id` | `connectionId` | path | string | yes | ID of the connection. Since v62.0. |
| `resource_name` | `resourceName` | path | string | yes | Resource name for the connection: - Use `files` for file-based connectors. The actual file name or wildcard expression of the folder is part of the request body. - Use the object name for object, blob, or app-based connectors. - Use the table name or view name for database connectors. Since v62.0. |
| `advanced_attributes` | `advancedAttributes` | body | map to string | yes | Map of strings, written `(database = 'X')`. Keys vary by connector: see [`connection_db_schemas_list`](#connection_db_schemas_list). Use `()` when no keys are needed. Can include extract attributes and parser settings. Since v62.0. |
| `fields` | `fields` | body | array of string | yes | List of fields to return in the preview. Since v62.0. |
| `limit` | `limit` | body | integer |  | Maximum number of records to return in the preview. The default is `100`. Since v62.0. |

```sql
CALL cdp.connection_preview_get (connection_id => '9cgaj0000012O5hAAE', resource_name => 'CUSTOMER', advanced_attributes => (database = 'SNOWFLAKE_SAMPLE_DATA', schema = 'TPCH_SF1'), fields => ['C_CUSTKEY', 'C_NAME'], limit => 10);
```

**Result**

One row. Schema `ConnectionPreviewRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `advanced_attributes` | `advancedAttributes` | JSON | Advanced attributes of the connection, which can include extract attributes and parser settings where applicable. Since v62.0. |
| `records` | `records` | JSON (array of ConnectionPreviewRecordRepresentation) | List of connection preview records. Since v62.0. |

**Notes:** This returns rows from the source, so treat the result as source data. Each entry of `records` is `{"record": {"Id": 1, ...}}`. The schema's `fields` is a list of strings, while one spec example sends an object, `{"string_col": "", "date_col": ""}`. JDBC-shaped connectors only ([sf-pi](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/references/troubleshooting.md)).

## existing_connection_schema_action_test

`POST /ssot/connections/{connectionId}/schema/actions/test` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Connections/paths/~1ssot~1connections~1%7BconnectionId%7D~1schema~1actions~1test/post) · evidence O · read-only

Test a schema for an existing connection. Since v62.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `connection_id` | `connectionId` | path | string | yes | ID of the connection. Since v62.0. |

```sql
CALL cdp.existing_connection_schema_action_test (connection_id => '9cgaj0000012O5hAAE');
```

**Result**

One row. Schema `ConnectionSchemaActionResponseRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `errors` | `errors` | JSON (array of CdpErrorRepresentation) | List of errors that resulted from the action. Since v57.0. |
| `success` | `success` | BOOLEAN | Indicates whether the action was initiated successfully (`true`) or not (`false`). Since v57.0. |

## connection_action_run

`POST /ssot/connections/actions/{command}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Connections/paths/~1ssot~1connections~1actions~1%7Bcommand%7D/post) · evidence O · changes org state

Run a command on a connection without creating the connection. Since v64.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `command` | `command` | path | string | yes | Name of the command to run, for example, `GET_SCHEMAS`. Since v64.0. |
| `command_attributes` | `commandAttributes` | body | map to object |  | Map of key-value pairs for command attributes in the form `Map<String, String>`. Since v64.0. |
| `connector_type` | `connectorType` | body | string | yes | Type of the connector. For example, `AwsRdsPostgres`, `AzureBlob`, `Databricks`, `Gcs`, `IngestApi`, `SalesforceDotCom`, `SalesforceMarketingCloud`, `Sftp`, `StreamingApp`, and so forth. Since v64.0. |
| `method` | `method` | body | enum(Egress, Ingress) | yes | Type of the data connection. Since v64.0. |

```sql
CALL cdp.connection_action_run (command => 'GET_SCHEMAS', connector_type => 'SNOWFLAKE', method => 'Ingress');
```

**Result**

One row. Schema `ConnectionCommandActionRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `errors` | `errors` | JSON (array of CdpErrorRepresentation) | List of errors that resulted from the action. Since v57.0. |
| `success` | `success` | BOOLEAN | Indicates whether the action was initiated successfully (`true`) or not (`false`). Since v57.0. |

**Notes:** This has no `credentials` or `parameters`, unlike `connection_test`. No source says how a command reaches the system without them, or which keys `command_attributes` takes. See [`existing_connection_action_run`](#existing_connection_action_run) for the command names.

## connection_test

`POST /ssot/connections/actions/test` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Connections/paths/~1ssot~1connections~1actions~1test/post) · tool `d360_connection_test` · evidence O · read-only

Test a connection without creating it. Since v62.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `connector_type` | `connectorType` | body | string | yes | Type of the connector. For example, `AwsRdsPostgres`, `AzureBlob`, `Databricks`, `Gcs`, `IngestApi`, `SalesforceDotCom`, `SalesforceMarketingCloud`, `Sftp`, `StreamingApp`, and so forth. Since v62.0. |
| `credentials` | `credentials` | body | array of [DataConnectionParameterInput](#dataconnectionparameterinputrepresentation) |  | List of `(param_name = ..., value = ...)` pairs, see [`connection_create`](#connection_create). Since v62.0. |
| `method` | `method` | body | enum(Egress, Ingress) |  | Type of the data connection. The spec marks this optional, but [sf-pi](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/references/troubleshooting.md) says the test requires it. Since v62.0. |
| `parameters` | `parameters` | body | array of [DataConnectionParameterInput](#dataconnectionparameterinputrepresentation) |  | List of key-value pairs that provide parameters for the data connection. Since v62.0. |

```sql
CALL cdp.connection_test (
  connector_type => 'AwsRdsSqlServer',
  method => 'Ingress',
  credentials => [
    (param_name = 'username', value = :sales_db_user),
    (param_name = 'password', value = :sales_db_password)
  ],
  parameters => [
    (param_name = 'jdbc_connection_url', value = 'sales-db.abc123.us-east-1.rds.amazonaws.com:1433'),
    (param_name = 'DATABASE', value = 'sales'),
    (param_name = 'SCHEMA', value = 'dbo')
  ]
);
```

**Result**

One row. Schema `ConnectionTestActionRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `errors` | `errors` | JSON (array of CdpErrorRepresentation) | List of errors that resulted from the action. Since v57.0. |
| `success` | `success` | BOOLEAN | Indicates whether the action was initiated successfully (`true`) or not (`false`). Since v57.0. |

**Notes:** Run this before `connection_create`, as the [catalog](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/runtime/FamilyCatalog.java) advises. It doesn't create anything.

The spec's own example is wrong for this call: it nests `credentials` as an object of `attributes` with `name` keys. The schema, [Snowflake tool](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/SnowflakeConnectionTools.java) and [sf-pi](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/references/troubleshooting.md) all use a list of `param_name` and `value`. The attribute names in the example above come from the spec's `connector_metadata` example.

Check `success` and `errors`. The spec defines `success` as whether the action was initiated. `connector_type` must be in the body, and non-JDBC connectors can fail with `INTERNAL_ERROR: Unable to query...` ([sf-pi](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/references/troubleshooting.md)).

## connection_replace

`PUT /ssot/connections/{connectionId}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Connections/paths/~1ssot~1connections~1%7BconnectionId%7D/put) · evidence O · changes org state

Update a Data 360 connector, completely replacing all existing data for the connector with the data passed in the request. Since v61.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `connection_id` | `connectionId` | path | string | yes | Record id of the connection, from `connection_list`. |
| `organization_id` | `organizationId` | body | string |  | - |
| `streaming_app_sub_type` | `streamingAppSubType` | body | enum(WebApp_GA4) |  | - |
| `streaming_app_type` | `streamingAppType` | body | enum(MobileApp, ServerApp, WebApp) |  | - |
| `credentials` | `credentials` | body | array of [DataConnectionParameterInput](#dataconnectionparameterinputrepresentation) |  | - |
| `method` | `method` | body | enum(Egress, Ingress) |  | - |
| `parameters` | `parameters` | body | array of [DataConnectionParameterInput](#dataconnectionparameterinputrepresentation) |  | - |
| `add_activation_business_units` | `addActivationBusinessUnits` | body | array of string |  | - |
| `add_business_units_to_dataspaces` | `addBusinessUnitsToDataSpaces` | body | array of [McBuToDataSpaceInput](#mcbutodataspaceinputrepresentation) |  | - |
| `add_ingestion_business_units` | `addIngestionBusinessUnits` | body | array of string |  | - |
| `create_profile_mappings` | `createProfileMappings` | body | boolean |  | - |
| `remove_activation_business_units` | `removeActivationBusinessUnits` | body | array of string |  | - |
| `remove_business_units_to_dataspaces` | `removeBusinessUnitsToDataSpaces` | body | array of [McBuToDataSpaceInput](#mcbutodataspaceinputrepresentation) |  | - |
| `remove_ingestion_business_units` | `removeIngestionBusinessUnits` | body | array of string |  | - |
| `modules` | `modules` | body | array of [ConnectionModuleConfigInput](#connectionmoduleconfiginputrepresentation) |  | - |
| `connector_type` | `connectorType` | body | string | yes | The type of the Data Connector Framework (DCF) connector. For **create connection** and **replace connection**, allowable connector types are `IngestApi`, `SalesforceDotCom`, `SalesforceMarketingCloud`, `StreamingApp`, `AwsRdsPostgres`, `AzureBlob`, `Databricks`, `Gcs`, `Sftp`, and so forth. Use the connection input object that corresponds to the schema type: - `IngestApi`: Ingest API Connection Input - `SalesforceDotCom`: CRM Connection Input - `SalesforceMarketingCloud`: Marketing Cloud Connection Input - `StreamingApp`: Streaming App Connection Input - All others: Data Connection Input For **update connection**, allowable connector types are `SalesforceMarketingCloud` or `StreamingApp`. Use the connection patch input object that corresponds to the schema type: - `SalesforceMarketingCloud`: Marketing Cloud Connection Patch Input - `StreamingApp`: Streaming App Connection Patch Input Since v60.0. |
| `label` | `label` | body | string |  | Label of the connector. Since v60.0. |
| `name` | `name` | body | string |  | Developer name of the connector. Since v60.0. |

```sql
CALL cdp.connection_replace (
  connection_id => '9cgaj0000012O5hAAE',
  connector_type => 'SNOWFLAKE',
  label => 'Snowflake prod',
  name => 'snowflake_prod',
  method => 'Ingress',
  credentials => [
    (param_name = 'authenticationOption', value = 'KeyPair'),
    (param_name = 'user', value = :snowflake_user),
    (param_name = 'privateKey', value = :snowflake_new_private_key)
  ],
  parameters => [
    (param_name = 'accountUrl', value = 'https://my-account.snowflakecomputing.com'),
    (param_name = 'region', value = 'us-west-2'),
    (param_name = 'warehouse', value = 'LOAD_WH'),
    (param_name = 'hasPrivateNetworkRoute', value = 'false')
  ]
);
```

**Result**

One row. Schema `ConnectionRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `status` | `status` | VARCHAR | - |
| `tenant_specific_endpoint` | `tenantSpecificEndpoint` | VARCHAR | - |
| `alias` | `alias` | VARCHAR | - |
| `connection_status` | `connectionStatus` | VARCHAR | - |
| `data_source` | `dataSource` | VARCHAR | - |
| `organization_id` | `organizationId` | VARCHAR | - |
| `activation_business_units` | `activationBusinessUnits` | JSON (array of MarketingCloudConnectionBusinessUnitRepresentation) | - |
| `business_units_to_dataspaces` | `businessUnitsToDataSpaces` | JSON (array of McBuToDataSpaceRepresentation) | - |
| `create_profile_bu_mappings` | `createProfileBuMappings` | BOOLEAN | - |
| `eid` | `eid` | VARCHAR | - |
| `ingestion_business_units` | `ingestionBusinessUnits` | JSON (array of MarketingCloudConnectionBusinessUnitRepresentation) | - |
| `modules` | `modules` | JSON (array of ConnectionModuleConfigRepresentation) | - |
| `source_id` | `sourceId` | VARCHAR | - |
| `streaming_app_sub_type` | `streamingAppSubType` | VARCHAR | - |
| `streaming_app_type` | `streamingAppType` | VARCHAR | - |
| `connector_label` | `connectorLabel` | VARCHAR | - |
| `credentials` | `credentials` | JSON (array of DataConnectionParameterRepresentation) | - |
| `deletable` | `deletable` | BOOLEAN | - |
| `editable` | `editable` | BOOLEAN | - |
| `icon_url` | `iconUrl` | VARCHAR | - |
| `last_data_change_error_code` | `lastDataChangeErrorCode` | VARCHAR | - |
| `last_sync_date` | `lastSyncDate` | VARCHAR | - |
| `method` | `method` | VARCHAR | - |
| `params` | `params` | JSON (array of DataConnectionParameterRepresentation) | - |
| `sync_status` | `syncStatus` | VARCHAR | - |
| `connector_type` | `connectorType` | VARCHAR | The type of the Data Connector Framework (DCF) connector. The endpoint returns the connection output object that corresponds to the connector type: - `AccountEngagement`: Account Engagement Connection Output - `IngestApi`: Ingest API Connection Output - `SalesforceDotCom`: CRM Connection Output - `SalesforceMarketingCloud`: Marketing Cloud Connection Output - `StreamingApp`: Streaming App Connection Output - All others: Data Connection Output Since v60.0. |

**Notes:** This takes the same per-type options as [`connection_create`](#connection_create), which the table omits. Data connections must resend `credentials`, because the input requires them and reads return them masked.

Everything not in the request is replaced, so read the connection first and copy its settings. Salesforce's MCP server has no tool for this call. Its [tool text](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/MetadataTools.java) says to delete and recreate non-Marketing Cloud connections, which breaks dependent streams, and a [community tool](https://github.com/javrrr/afd360/blob/main/src/resources/connection.ts) does the same. No source I read reports using `PUT` on a live data connection.

## connection_schema_upsert

`PUT /ssot/connections/{connectionId}/schema` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Connections/paths/~1ssot~1connections~1%7BconnectionId%7D~1schema/put) · evidence O · changes org state

Create or update a schema model for a connection. Since v60.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `connection_id` | `connectionId` | path | string | yes | Record id of the connection, from `connection_list`. |
| `schemas` | `schemas` | body | array of [ConnectionSchemaInput](#connectionschemainputrepresentation) | yes | List of connection schemas. Use the connection schema input object that corresponds to the schema type. For example, use the Connectors Framework Connection Schema Input for the `DataConnectionEvent` schema type. Since v60.0. |

```sql
CALL cdp.connection_schema_upsert (
  connection_id => '9cgaj0000012O5hAAE',
  schemas => [(
    name = 'Orders',
    label = 'Orders',
    schema_type = 'IngestApi',
    fields = [
      (name = 'Id', label = 'Id', data_type = 'Text'),
      (name = 'Amount', label = 'Amount', data_type = 'Number'),
      (name = 'OrderedAt', label = 'OrderedAt', data_type = 'DateTime')
    ]
  )]
);
```

**Result**

One row per item of `/schemas` in the response. Schema `ConnectionSchemaRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `availability_status` | `availabilityStatus` | VARCHAR | - |
| `fields` | `fields` | JSON (array of ConnectorsFrameworkConnectionSchemaFieldRepresentation) | - |
| `category` | `category` | VARCHAR | - |
| `label` | `label` | VARCHAR | Label of the connector. Since v60.0. |
| `name` | `name` | VARCHAR | Developer name of the connector. Since v60.0. |
| `schema_type` | `schemaType` | VARCHAR | Schema of the connector. Since v60.0. |

**Notes:** `ConnectionSchemaInput` omits what its subtypes add. All have `fields`, a list of `(name = ..., label = ..., data_type = ...)`, where `data_type` is `Boolean`, `Currency`, `Date`, `DateOnly`, `DateTime`, `Email`, `Number`, `Percent`, `Phone`, `Text` or `Url`. By `schema_type`:

| `schema_type` | Schema attributes | Field attributes |
|---|---|---|
| `IngestApi`, `DataConnectionEvent` | None | `currency_iso_code` |
| `StreamingApp` | `availability_status` (`Available`, `InUse`), `category` (`Engagement`, `Other`, `Profile`) | `isDataRequired`, `primaryIndexOrder` |

An Ingestion API connection is incomplete until this has run ([skill](https://github.com/Jaganpro/sf-skills/blob/main/skills/sf-datacloud-connect/SKILL.md), community). The [official guide](https://developer.salesforce.com/docs/data/data-cloud-int/guide/c360-a-connect-an-ingestion-source.md) does the same step by uploading an OpenAPI YAML file.

From a [community recipe](https://github.com/javrrr/afd360/blob/main/skills/afd360/references/connector-ingestapi.md): always send field `label`, because the server fails without it. The schema is effectively immutable, so adding a field means a new schema, stream and mapping. A stream's source object must match the schema `name`. [Web and mobile setup](https://developer.salesforce.com/docs/data/data-cloud-int/guide/c360-a-mobile-web-app-connector.md) calls this event definitions.

## connection_sitemap_upsert

`PUT /ssot/connections/{connectionId}/sitemap` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Connections/paths/~1ssot~1connections~1%7BconnectionId%7D~1sitemap/put) · evidence O · changes org state

Create or update the sitemap for a Streaming App connection. Since v60.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `connection_id` | `connectionId` | path | string | yes | Record id of a `StreamingApp` connection. |
| `sitemap` | `sitemap` | body | string | yes | JavaScript text of the [Web SDK sitemap](https://developer.salesforce.com/docs/data/salesforce-interactions-sdk/guide/c360a-api-sitemap.md), best written as `$$...$$`. Since v60.0. |

```sql
CALL cdp.connection_sitemap_upsert (
  connection_id => '9cgaj0000012O5hAAE',
  sitemap => $$
    SalesforceInteractions.init().then(() => {
      SalesforceInteractions.initSitemap({ global: {}, pageTypeDefault: {}, pageTypes: [] });
    });
  $$
);
```

**Result**

One row. Schema `ConnectionSitemapRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `sitemap` | `sitemap` | VARCHAR | Sitemap of the Streaming App connector. Since v60.0. |
| `sitemap_path` | `sitemapPath` | VARCHAR | Path to the sitemap of the Streaming App connector. Since v60.0. |

**Notes:** The [SDK docs](https://developer.salesforce.com/docs/data/salesforce-interactions-sdk/guide/c360a-api-sitemap.md) show the sitemap as JavaScript, while the [upload guide](https://developer.salesforce.com/docs/data/data-cloud-int/guide/c360-a-upload-a-sitemap-file.md) calls it a "custom sitemap JSON file". The spec only says "Contents of the sitemap file". The example has the SDK's general pattern with empty sections.

## Schemas

Attribute names are keywords inside the object they belong to, so completion offers exactly these.

### ConnectionModuleConfigInputRepresentation

Input representation for Streaming App module configuration for a patch request.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `configuration` | `configuration` | string |  | Stringified JSON object for the custom configuration of the Streaming App module. The default is `null`. Since v63.0. |
| `is_enabled` | `isEnabled` | boolean |  | Indicates whether the Streaming App module is enabled (`true`) or not (`false`). The default value is `false`. Since v63.0. |
| `name` | `name` | string | yes | Name of the Streaming App module. Since v63.0. |
| `path` | `path` | string |  | URL for the Amazon S3 location where the Streaming App module's minified JavaScript file is hosted. The default is `null`. Since v63.0. |

### ConnectionSchemaInputRepresentation

Input representation for a connection schema.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `fields` | `fields` | array of [ConnectorsFrameworkConnectionSchemaFieldInput](#connectorsframeworkconnectionschemafieldinputrepresentation) |  | - |
| `availability_status` | `availabilityStatus` | enum(Available, InUse) |  | - |
| `category` | `category` | enum(Engagement, Other, Profile) |  | - |
| `label` | `label` | string | yes | Label of the connector. Since v60.0. |
| `name` | `name` | string | yes | Developer name of the connector. Since v60.0. |
| `schema_type` | `schemaType` | enum(DataConnectionEvent, IngestApi, StreamingApp) | yes | Schema of the connector. Since v60.0. |

### ConnectorsFrameworkConnectionSchemaFieldInputRepresentation

Represents the input for connectors framework field types.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `label` | `label` | string |  | Label of the schema field. Since v60.0. |
| `name` | `name` | string |  | Developer name of the schema field. Since v60.0. |
| `currency_iso_code` | `currencyIsoCode` | boolean |  | Indicates whether the field is a currency ISO code (`true`) or not (`false`). Since v64.0. |
| `data_type` | `dataType` | enum(Boolean, Currency, Date, DateOnly, DateTime, Email, Number, Percent, Phone, Text, Url) |  | Data type of the field. Since v64.0. |

### DataConnectionParameterInputRepresentation

Key-value pair for credentials and parameters of a data connection.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `param_name` | `paramName` | string | yes | Name of the parameter, from the `connection_attributes` of `connector_metadata`. Names vary by connector and aren't checked here. Since v61.0. |
| `value` | `value` | string | yes | Value of the parameter, always a string. Since v61.0. |
| `client_secret` | `clientSecret` | string |  | Not in the spec schema: from the MCP server's payload example. |
| `environment` | `environment` | string |  | Not in the spec schema: from the MCP server's payload example. |
| `client_id` | `clientId` | string |  | Not in the spec schema: from the MCP server's payload example. |
| `username` | `username` | string |  | Not in the spec schema: from the MCP server's payload example. |
| `attributes` | `attributes` | array of [DataConnectionParameterInput_attributes](#dataconnectionparameterinput_attributes) |  | Not in the spec schema: from the spec's examples. |
| `parameters` | `parameters` | [DataConnectionParameterInput_parameters](#dataconnectionparameterinput_parameters) |  | Not in the spec schema: from the spec's examples. |

### DataConnectionParameterInput_attributes

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `name` | `name` | string |  | Seen in examples: the spec types the parent as a free-form object. |
| `value` | `value` | string |  | Seen in examples: the spec types the parent as a free-form object. |

### DataConnectionParameterInput_parameters

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `attributes` | `attributes` | array of [DataConnectionParameterInput_parameters_attributes](#dataconnectionparameterinput_parameters_attributes) |  | Seen in examples: the spec types the parent as a free-form object. |

### DataConnectionParameterInput_parameters_attributes

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `name` | `name` | string |  | Seen in examples: the spec types the parent as a free-form object. |
| `value` | `value` | string |  | Seen in examples: the spec types the parent as a free-form object. |

### McBuToDataSpaceInputRepresentation

Input representation for Marketing Cloud business-unit-to-data-space mappings for a patch request.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `id` | `id` | string |  | ID of the asset. Since v58.0. |
| `name` | `name` | string |  | Name of the asset. Since v58.0. |
| `namespace` | `namespace` | string |  | Namespace of the asset. Since v58.0. |
| `dataspace_name` | `dataspaceName` | string | yes | Name of the data space. Since v63.0. |
| `mid` | `mid` | string | yes | Member ID (MID) of the Marketing Cloud business unit. Specify a business unit already configured for ingestion or one passed for addition in the payload of the request. Since v63.0. |

### ResourceFilterByPropertyInputRepresentation

Input representation to filter fields and objects for a connection by property.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `filter_operator` | `filterOperator` | enum(EqualsOp, LikeOp, SubstrOp) | yes | Filter operation to perform on the `name` and `values`. Since v62.0. |
| `name` | `name` | string |  | Name of the property to filter against the `values` based on the `filter_group`. Since v60.0. |
| `values` | `values` | array of string | yes | List of values on which to filter the `name` based on the `filter_operator`. Since v62.0. |
| `operator` | `operator` | string |  | Not in the spec schema: from the spec's examples. |

### ResourceFiltersInputRepresentation

Input representation for resource filters for a connection.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `filters_by_property` | `filtersByProperty` | array of [ResourceFilterByPropertyInput](#resourcefilterbypropertyinputrepresentation) | yes | List of filters that return only a specific subset of fields and objects for a connection. Since v63.0. |

### connection_create_config

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `batch_size` | `batchSize` | integer |  | Seen in examples: the spec types the parent as a free-form object. |
| `api_version` | `apiVersion` | string |  | Seen in examples: the spec types the parent as a free-form object. |
| `poll_interval` | `pollInterval` | integer |  | Seen in examples: the spec types the parent as a free-form object. |
