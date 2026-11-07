<!-- Generated from extensions/d360-api/clfn/spec/private_network_routes.yaml, edit that and run: bazel run //extensions/d360-api:update -->

# Private Network Routes

Part of the [CDP function reference](functions.md). Nothing here is implemented or tested against an org. Every result also has the [standard columns](functions.md#result-schema).

A private network route (PNR) connects a Data 360 tenant to a data source without sending traffic over the public internet. The feature is [Private Connect for Data 360](https://developer.salesforce.com/docs/data/data-cloud-int/guide/c360-a-private-connect-considerations.md), a different product from Salesforce Private Connect. A route is network plumbing only: connections and data streams use it, and it carries no data itself.

The order is: prepare the endpoint on the cloud side, create the route, finish the cloud-side approval, wait for `Ready`, then create the connection that uses the route.

The gotchas that matter most:

- MSK, Redshift and self-managed Azure routes need Salesforce's Principal ID allowed on your endpoint service. The guides read it from the Setup page, and the spec's output schemas have no attribute for it.
- The [guides](https://developer.salesforce.com/docs/data/data-cloud-int/guide/c360-a-private-connect-integrations.md) cover BigQuery and Salesforce-managed Azure routes, but the spec's enums and inputs don't show how to create them.
- A URL can have only one route per functional domain, so a repeated create can return 409.
- The API has no update call.
- Salesforce's `sf-pi` calls this family [feature gated](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/references/endpoint-families.md), and says it can return internal errors when the org has no routes.

```sql
CALL cdp.private_network_route_create (
  name => 'Snowflake_Prod',
  label => 'Snowflake Prod',
  description => 'PrivateLink route to the prod Snowflake account',
  route => (type = 'Snowflake', service_name = 'com.amazonaws.vpce.us-west-2.vpce-svc-0123456789abcdef0', account_url = 'https://my-account.snowflakecomputing.com')
);
CALL cdp.private_network_route_get (route_id_or_name => 'Snowflake_Prod'); /* repeat until cloud_provider.status is Ready, then update the Snowflake network policy */
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
    (param_name = 'region', value = 'us-west-2'),
    (param_name = 'warehouse', value = 'LOAD_WH'),
    (param_name = 'hasPrivateNetworkRoute', value = 'true'),
    (param_name = 'outboundnetworkconnection', value = '...') /* id from the route */
  ]
);
```

**Functions:** [`private_network_route_delete`](#private_network_route_delete), [`private_network_route_list`](#private_network_route_list), [`private_network_route_get`](#private_network_route_get), [`private_network_route_create`](#private_network_route_create)

## private_network_route_delete

`DELETE /ssot/private-network-routes/{routeIdOrName}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Private-Network-Routes/paths/~1ssot~1private-network-routes~1%7BrouteIdOrName%7D/delete) · evidence O · changes org state

Delete a Private Network Route. Since v65.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `route_id_or_name` | `routeIdOrName` | path | string | yes | ID or name of the Private Network Route. Since v65.0. |

```sql
CALL cdp.private_network_route_delete (route_id_or_name => 'Redshift_Prod');
```

**Result**

No response body (HTTP 200). One row with only the standard columns.

**Notes:** - The [guide](https://developer.salesforce.com/docs/data/data-cloud-int/guide/c360-a-delete-private-connect-network-route.md) says to delete only a route no data stream uses, and to move any such stream to a different route first. No source says what the API returns for a route in use.
- The spec's 409 text for this call is the duplicate-URL message from create, which looks copied.
- The guide says deleting the route also deletes the endpoint connections entry from your VPC endpoint service.
- The status enum includes `TeardownInProgress`, but no source says whether teardown ends before this call returns.

## private_network_route_list

`GET /ssot/private-network-routes` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Private-Network-Routes/paths/~1ssot~1private-network-routes/get) · evidence O · read-only

Get a paginated list of Private Network Routes. Since v65.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `limit` | `limit` | query | integer |  | Maximum number of rows to return from `1` through `1000`. By default, the endpoint returns `100` rows. Since v65.0. |
| `offset` | `offset` | query | integer |  | Number of rows to skip before returning results. By default, the endpoint skips `0` rows. Since v65.0. |

```sql
CALL cdp.private_network_route_list ();
```

**Result**

One row per item of `/routes` in the response. Other response fields go to `_meta`: `currentPageUrl`, `nextPageUrl`, `totalSize`. Schema `PrivateNetworkRouteRepresentation`.

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
| `cloud_provider` | `cloudProvider` | JSON (CloudProviderDetailsRepresentation) | Details about the cloud provider for the Private Network Route. Since v65.0. |
| `route` | `route` | JSON | Provider details for the Private Network Route. The endpoint returns the details output object that corresponds to the type of Private Network Route. For example, the Amazon MSK Route Details Output is returned for the `AmazonMsk` type. Since v65.0. |
| `storage_route` | `storageRoute` | JSON (RouteDetailsRepresentation) | Storage details for a route, for example, the URL and service name, for a storage/internal stage in the case of customer-managed and Salesforce-managed solutions. Since v66.0. |

**Paging:** `next_page_url`.

**Notes:** [`sf-pi`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/references/endpoint-families.md) says the list and detail calls are feature gated and can return internal errors when the org has no routes, so an error here doesn't prove a problem with the request.

## private_network_route_get

`GET /ssot/private-network-routes/{routeIdOrName}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Private-Network-Routes/paths/~1ssot~1private-network-routes~1%7BrouteIdOrName%7D/get) · evidence O · read-only

Get detailed information about a Private Network Route. Since v65.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `route_id_or_name` | `routeIdOrName` | path | string | yes | ID or name of the Private Network Route. Since v65.0. |

```sql
CALL cdp.private_network_route_get (route_id_or_name => 'Redshift_Prod');
```

**Result**

One row. Schema `PrivateNetworkRouteRepresentation`.

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
| `cloud_provider` | `cloudProvider` | JSON (CloudProviderDetailsRepresentation) | Details about the cloud provider for the Private Network Route. Since v65.0. |
| `route` | `route` | JSON | Provider details for the Private Network Route. The endpoint returns the details output object that corresponds to the type of Private Network Route. For example, the Amazon MSK Route Details Output is returned for the `AmazonMsk` type. Since v65.0. |
| `storage_route` | `storageRoute` | JSON (RouteDetailsRepresentation) | Storage details for a route, for example, the URL and service name, for a storage/internal stage in the case of customer-managed and Salesforce-managed solutions. Since v66.0. |

**Notes:** - `cloud_provider.status` is the readiness signal. `cloud_provider.dataCloudVpceId` is the [value to allow](https://developer.salesforce.com/docs/data/data-cloud-int/guide/c360-a-private-connect-update-your-snowflake-network-policy.md) in a Snowflake network policy. The [considerations page](https://developer.salesforce.com/docs/data/data-cloud-int/guide/c360-a-private-connect-considerations.md) suggests `dig` or `nslookup` on the DNS name, `dataCloudDnsName`, for troubleshooting.
- `cloud_provider.azureResourceId` has no type in the spec. The [Salesforce-managed Snowflake guide](https://developer.salesforce.com/docs/data/data-cloud-int/guide/c360-a-add-a-private-network-route-for-snowflake-on-azure-sf-managed.md) shows two Azure Resource IDs on the details page when the internal stage is enabled, and no source says where the second appears in this response.
- In the spec, `SnowflakeRouteDetailsRepresentation` requires `accountURL` but defines `account_url`. Expect `account_url`, and treat the difference as a likely typo.
- The spec lists a 308 `Record Not Found Here` response without saying where it redirects.

## private_network_route_create

`POST /ssot/private-network-routes` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Private-Network-Routes/paths/~1ssot~1private-network-routes/post) · evidence O · changes org state

Create a private network route from the Data 360 tenant to a data source's private endpoint, for Amazon MSK, Redshift, Snowflake or Databricks. Create it before the connection that uses it. Since v65.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `cloud_provider` | `cloudProvider` | body | [CloudProviderDetailsInput](#cloudproviderdetailsinputrepresentation) |  | Details about the cloud provider for the Private Network Route. Since v65.0. |
| `description` | `description` | body | string | yes | Description of the Private Network Route. Since v65.0. |
| `label` | `label` | body | string | yes | Label of the Private Network Route. Since v65.0. |
| `name` | `name` | body | string | yes | Developer name of the Private Network Route. Since v65.0. |
| `route` | `route` | body | one of [DatabricksRouteDetailsInput](#databricksroutedetailsinputrepresentation), [AmazonMSKRouteDetailsInput](#amazonmskroutedetailsinputrepresentation), [RedshiftRouteDetailsInput](#redshiftroutedetailsinputrepresentation), [SnowflakeRouteDetailsInput](#snowflakeroutedetailsinputrepresentation) | yes | Provider details for the Private Network Route. Use the details input object that corresponds to the type of Private Network Route. For example, use the Amazon MSK Route Details Input for the `AmazonMsk` type. Since v65.0. |
| `storage_route` | `storageRoute` | body | [RouteDetailsInput](#routedetailsinputrepresentation) |  | Storage details for a route, for example, the URL and service name, for a storage/internal stage in the case of customer-managed and Salesforce-managed solutions. Since v66.0. |

```sql
CALL cdp.private_network_route_create (
  name => 'Redshift_Prod',
  label => 'Redshift Prod',
  description => 'PrivateLink route to the prod Redshift cluster',
  route => (type = 'Redshift', service_name = 'com.amazonaws.vpce.us-east-1.vpce-svc-0123456789abcdef0')
);
```

**Result**

One row per item of `/routes` in the response. Other response fields go to `_meta`: `currentPageUrl`, `nextPageUrl`, `totalSize`. Schema `PrivateNetworkRouteRepresentation`.

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
| `cloud_provider` | `cloudProvider` | JSON (CloudProviderDetailsRepresentation) | Details about the cloud provider for the Private Network Route. Since v65.0. |
| `route` | `route` | JSON | Provider details for the Private Network Route. The endpoint returns the details output object that corresponds to the type of Private Network Route. For example, the Amazon MSK Route Details Output is returned for the `AmazonMsk` type. Since v65.0. |
| `storage_route` | `storageRoute` | JSON (RouteDetailsRepresentation) | Storage details for a route, for example, the URL and service name, for a storage/internal stage in the case of customer-managed and Salesforce-managed solutions. Since v66.0. |

**Paging:** Not applicable, since this call creates one route. The spec reuses the collection schema for its response, which is why `next_page_url` appears.

**Done when:** `private_network_route_get.cloud_provider.status` is `Ready`. The spec's other values are `Allocating`, `PendingAcceptance`, `PendingActivation`, `RejectedRemotely`, `DeletedRemotely`, `TeardownInProgress` and `Unprovisioned`, and it doesn't define them. The guides give waits of several minutes to about 10, and warn that DNS can add a brief delay before a connection can be created. In Setup, status changes only after the Private Connect refresh button. No source says whether the GET has the same lag.

**Notes:** - **`route` by `type`:** the spec defines one input per value: [`AmazonMsk`](#amazonmskroutedetailsinputrepresentation), [`Databricks`](#databricksroutedetailsinputrepresentation), [`Redshift`](#redshiftroutedetailsinputrepresentation) and [`Snowflake`](#snowflakeroutedetailsinputrepresentation). The `*InternalStage` values have no such mapping, so they appear to belong to `storage_route`. A [Postman-derived sample](https://github.com/supanmaniar/salesforce-mcn-d360-agent/blob/main/catalog/endpoints.json) sends `broker_endpoints` with `Redshift` (community), but the spec has that attribute on MSK only.
- **Field mapping:** the guides describe Setup fields, and no source maps them all to API attributes. The [Redshift guide](https://developer.salesforce.com/docs/data/data-cloud-int/guide/c360-a-create-a-pnr-redshift.md) gives the service name as `com.amazonaws.vpce.<region>.<account_ID>`. The [Snowflake on AWS guide](https://developer.salesforce.com/docs/data/data-cloud-int/guide/c360-a-add-network-route-snowflake.md) instead asks for a "Virtual Private Cloud endpoint ID" from `SYSTEM$GET_PRIVATELINK_CONFIG`.
- **Not creatable from the spec alone:** [BigQuery](https://developer.salesforce.com/docs/data/data-cloud-int/guide/c360-a-add-a-private-network-route-for-bigquery-google-cloud.md) has no `type` value. `cloud_provider.type` only allows `AmazonWebServices`, and the input has no fields for [Salesforce-managed Azure routes](https://developer.salesforce.com/docs/data/data-cloud-int/guide/c360-a-add-a-private-network-route-for-databricks-on-azure-sf-managed.md).
- **`storage_route`:** its description mentions a URL, but its schema has only `service_name` and `type`. The [self-managed Databricks guide](https://developer.salesforce.com/docs/data/data-cloud-int/guide/c360-a-add-a-private-network-route-for-databricks-on-azure.md) asks for an Azure Blob URL for the internal stage and shows two routes afterwards, one for Databricks and one for its internal stage.
- **`description`:** the spec requires it, while the Redshift and Snowflake guides call it optional in Setup.
- **Cloud-side steps:** MSK, Redshift and self-managed Azure routes need the Principal ID added to the endpoint service's allowed principals. Redshift and self-managed Azure routes also need the connection request accepted. Snowflake needs its [network policy updated](https://developer.salesforce.com/docs/data/data-cloud-int/guide/c360-a-private-connect-update-your-snowflake-network-policy.md).
- **Limits:** the guides allow one route per Snowflake URL, MSK connection or Databricks URL per functional domain, not per org, and [one route per Redshift instance](https://developer.salesforce.com/docs/data/data-cloud-int/guide/c360-a-private-connect-considerations.md). The number of routes is also licensed: Setup hides **New** at the maximum, and no source says what the API returns then. Don't retry this POST blindly, since the spec returns 409 when a route with this connection URL exists.
- **Renaming:** the MSK, Redshift and Snowflake guides say the route name can't change after saving, while the self-managed Databricks guide says the name and description can be edited. The spec has no update call in either case.
- **Using the route:** Salesforce's MCP server sets [`hasPrivateNetworkRoute` and `outboundnetworkconnection`](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/SnowflakeConnectionTools.java) in the connection's parameters, and omits `account_url` when a route is used. BigQuery can't add a route to an existing connection, so create the route first. Snowflake data share targets use the route when [its URL matches the target's](https://developer.salesforce.com/docs/data/data-cloud-int/guide/c360-a-private-connect-considerations.md).
- **Credits:** the [considerations page](https://developer.salesforce.com/docs/data/data-cloud-int/guide/c360-a-private-connect-considerations.md) gives an example of 70 credits per million rows accessed for federation plus 500 credits per GB transferred over the private connection. It sends you to the rate cards for current numbers.

## Schemas

Attribute names are keywords inside the object they belong to, so completion offers exactly these.

### AmazonMSKRouteDetailsInputRepresentation

Input representation of route details for the cloud service used by the Private Network Route: Amazon Managed Streaming for Apache Kafka (MSK).

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `service_name` | `serviceName` | string | yes | Service name of the endpoint for the Private Network Route. Since v65.0. |
| `type` | `type` | enum(Databricks, DatabricksInternalStage, AmazonMsk, Redshift, Snowflake, SnowflakeInternalStage) | yes | Type of the Private Network Route. Since v65.0. |
| `broker_endpoints` | `brokerEndpoints` | array of string | yes | Endpoint of the Amazon MSK broker. Since v65.0. |

### CloudProviderDetailsInputRepresentation

Input representation for the cloud provider of a Private Network Route.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `type` | `type` | enum(AmazonWebServices) |  | Cloud provider that hosts the connector type for the Private Network Route. Since v65.0. |

### DatabricksRouteDetailsInputRepresentation

Input representation of route details for the cloud service used by the Private Network Route: Databricks.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `service_name` | `serviceName` | string | yes | Service name of the endpoint for the Private Network Route. Since v65.0. |
| `type` | `type` | enum(Databricks, DatabricksInternalStage, AmazonMsk, Redshift, Snowflake, SnowflakeInternalStage) | yes | Type of the Private Network Route. Since v65.0. |
| `account_url` | `accountUrl` | string | yes | URL of the Databricks workspace. Since v66.0. |

### RedshiftRouteDetailsInputRepresentation

Input representation of route details for the cloud service used by the Private Network Route: Amazon Redshift.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `service_name` | `serviceName` | string | yes | Service name of the endpoint for the Private Network Route. Since v65.0. |
| `type` | `type` | enum(Databricks, DatabricksInternalStage, AmazonMsk, Redshift, Snowflake, SnowflakeInternalStage) | yes | Type of the Private Network Route. Since v65.0. |

### RouteDetailsInputRepresentation

Abstract superclass for all route details input types for a Private Network Route.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `service_name` | `serviceName` | string | yes | Service name of the endpoint for the Private Network Route. Since v65.0. |
| `type` | `type` | enum(Databricks, DatabricksInternalStage, AmazonMsk, Redshift, Snowflake, SnowflakeInternalStage) | yes | Type of the Private Network Route. Since v65.0. |

### SnowflakeRouteDetailsInputRepresentation

Input representation of route details for the cloud service used by the Private Network Route: Amazon Snowflake.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `service_name` | `serviceName` | string | yes | Service name of the endpoint for the Private Network Route. Since v65.0. |
| `type` | `type` | enum(Databricks, DatabricksInternalStage, AmazonMsk, Redshift, Snowflake, SnowflakeInternalStage) | yes | Type of the Private Network Route. Since v65.0. |
| `account_url` | `accountUrl` | string | yes | URL of the Snowflake account. Since v65.0. |
