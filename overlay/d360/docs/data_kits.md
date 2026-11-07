# Data Kits

Part of the [CDP function reference](functions.md). Nothing here is implemented or tested against an org. Every result also has the [standard columns](functions.md#result-schema).

A data kit packages Data 360 definitions, such as streams, DLOs and insights, so that they can move to another org. It carries [metadata, not data](https://developer.salesforce.com/docs/data/data-cloud-dev/guide/packages-data-kits.md).

The order is: build the kit in the source org with `datakit_create`, add it to a package outside this API, and install the package in the target org. Then `datakit_deploy` in the target org creates the components there, and `datakit_deploy_status` tracks the job.

The gotchas that matter most:

- `async_mode` must be `true` on deploy and undeploy.
- A deploy took 25 to 45 minutes in Salesforce's sample kits. Poll about every 5 minutes.
- A failed job can report `Error`, not `Failed`. A poller that only checks `Failed` keeps waiting for a dead job.
- `datakit_deploy_status` isn't in the spec, and sources disagree on its path.
- The shape of `config` depends on the component `type`. See [`datakit_deploy`](#datakit_deploy).
- `datakit_components_update` replaces the whole component list.

```sql
/* In the source org */
CALL cdp.datakit_create (data_kit_dev_name => 'Customer_Kit', label => 'Customer Kit', data_kit_type => 'None', components => [(type = 'DataLakeObject', info = (name = 'Customer__dll', label = 'Customer'))]);

/* In the target org, after installing the package */
CALL cdp.datakit_deploy (data_kit_dev_name => 'Customer_Kit', async_mode => true, components => []);
CALL cdp.datakit_deploy_status (job_id => '08Paj00000tPyr4');
```

**Functions:** [`datakit_delete`](#datakit_delete), [`datakit_list`](#datakit_list), [`datakit_component_deps`](#datakit_component_deps), [`datakit_component_status`](#datakit_component_status), [`datakit_components`](#datakit_components), [`datakit_manifest`](#datakit_manifest), [`datakit_components_update`](#datakit_components_update), [`datakit_create`](#datakit_create), [`datakit_deploy`](#datakit_deploy), [`datakit_undeploy`](#datakit_undeploy), [`datakit_get`](#datakit_get), [`datakit_deploy_status`](#datakit_deploy_status)

## datakit_delete

`DELETE /ssot/data-kits/{dataKitDevName}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Kits/paths/~1ssot~1data-kits~1%7BdataKitDevName%7D/delete) · evidence O · changes org state

Delete a data kit. Since v64.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `data_kit_dev_name` | `dataKitDevName` | path | string | yes | Developer name of the data kit. Since v63.0. |

```sql
CALL cdp.datakit_delete (data_kit_dev_name => 'Customer_Kit');
```

**Result**

No response body (HTTP 200). One row with only the standard columns.

**Notes:** The spec documents a 200 with no body, while [sf-pi](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/references/data-shapes.md) says 204. A second delete returns [`INTERNAL_SERVER_ERROR: PackageKitDefinition does not exist`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/references/troubleshooting.md), which means the kit is already gone. No source says whether deleting a kit affects components already deployed from it.

## datakit_list

`GET /ssot/data-kits` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Kits/paths/~1ssot~1data-kits/get) · tool `d360_datakit_list` · evidence O · read-only

Get a list of data kits by namespace. Since v63.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `namespace` | `namespace` | query | string |  | Namespace prefix of the data kit package. Since v63.0. |

```sql
CALL cdp.datakit_list (namespace => 'acme');
```

**Result**

One row per item of `/dataKitDetails` in the response. Schema `DataKitDetails`.

| Column | API name | Type | Description |
|---|---|---|---|
| `components` | `components` | JSON (array of DataKitComponentInfo) | List of data kit components. Since v63.0. |
| `developer_name` | `developerName` | VARCHAR | Developer name of the data kit. Since v63.0. |
| `label` | `label` | VARCHAR | Label of the data kit. Since v63.0. |
| `publishing_sequence` | `publishingSequence` | JSON (array of DataKitDefaultComponentInfo) | Publishing sequence for the data kit components. Since v63.0. |

**Notes:** This call can be slow or fail:

- It can take over 60 s or time out on orgs with many kits, and `DataPackageKitDefinition` metadata is a suggested alternative ([community](https://github.com/javrrr/data-360-sdk/blob/main/src/resources/data-kits.ts)).
- It returned a 500 in [one org](https://github.com/szymonlewandowski/config-snapshot-data360/blob/main/docs/api-quirks.md) (community).
- A new kit [may not appear right away](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/references/troubleshooting.md). Confirm it from the create response.

A recorded response also has `data_kit_type` with the value `FILEBASED`, and `connector_type` on bundle components, neither of which is in the spec ([community, one org](https://github.com/dsouza-anush/sf-plugin-data360/blob/main/test/fixtures/live/data-kit-list.json)).

## datakit_component_deps

`GET /ssot/data-kits/{dataKitName}/components/{componentName}/dependencies` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Kits/paths/~1ssot~1data-kits~1%7BdataKitName%7D~1components~1%7BcomponentName%7D~1dependencies/get) · tool `d360_datakit_component_deps` · evidence O · read-only

Get the dependencies for components deployed from a data kit. Since v63.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `component_name` | `componentName` | path | string | yes | Name of the component, for example `Customer__dll` for a DLO. |
| `data_kit_name` | `dataKitName` | path | string | yes | Developer name of the data kit. |
| `component_type` | `componentType` | query | string | yes | Type of component. Valid values are: - `ActivationTarget` - `CalculatedInsight` - `DataAction` - `DataActionTarget` - `DataConnection` - `DataGraph` - `DataLakeObject` - `DataSemanticSearch` - `DataShare` - `DataStreamBundle` - `DataTransform` - `IdentityResolution` - `MarketSegment` - `MarketSegmentActivation` - `MlConfiguredModel` - `MlPredictionJob` - `MlRetriever` - `SemanticModel` Since v63.0. |
| `dataspace` | `dataspace` | query | string |  | Name of the data space. If unspecified, the `default` data space is used. Since v63.0. |

```sql
CALL cdp.datakit_component_deps (data_kit_name => 'Customer_Kit', component_name => 'Customer__dll', component_type => 'DataLakeObject');
```

**Result**

One row per item of `/componentDependencies` in the response. Schema `DataKitComponentDependencyRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `id` | `id` | VARCHAR | ID of the dependent object. Since v62.0. |
| `name` | `name` | VARCHAR | API name of the dependent object. Since v62.0. |
| `type` | `type` | VARCHAR | Type of the dependent object. Since v62.0. |

**Notes:** The spec requires `component_type`, though the [MCP server](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/DataKitTools.java) treats it as optional. The MCP server also sends `dataspace`. A live call reached a platform error, so this call has no recorded success ([community, one org](https://github.com/dsouza-anush/sf-plugin-data360/blob/main/docs/API_COVERAGE.md)).

## datakit_component_status

`GET /ssot/data-kits/{dataKitName}/components/{componentName}/deployment-status` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Kits/paths/~1ssot~1data-kits~1%7BdataKitName%7D~1components~1%7BcomponentName%7D~1deployment-status/get) · tool `d360_datakit_component_status` · evidence O · read-only

Get the status of a component deployed from a data kit. Since v62.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `component_name` | `componentName` | path | string | yes | Name of the component, for example `Customer__dll` for a DLO. |
| `data_kit_name` | `dataKitName` | path | string | yes | Developer name of the data kit. |

```sql
CALL cdp.datakit_component_status (data_kit_name => 'Customer_Kit', component_name => 'Customer__dll');
```

**Result**

One row. Schema `DataKitComponentDeploymentStatusRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `component_details` | `componentDetails` | JSON (array of DatakitComponentDetails) | List of components and their status. Since v62.0. |
| `status` | `status` | JSON (DataKitComponentDeploymentStatus) | Current status of the component. Since v62.0. |

**Notes:** The spec's example has `status.code` = `ACTIVE`, and `component_details[].status` is one of `Active`, `Deleting`, `Error`, `Processing`. A recorded response had an empty `component_details` and no `status` ([community, one org](https://github.com/dsouza-anush/sf-plugin-data360/blob/main/test/fixtures/live/data-kit-component-status.json)), so handle an empty list and a missing `status`. The [MCP server](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/DataKitTools.java) also sends `dataspace`, which the spec doesn't list. This reports one component. For a whole deploy, use `datakit_deploy_status`.

## datakit_components

`GET /ssot/data-kits/available-components` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Kits/paths/~1ssot~1data-kits~1available-components/get) · tool `d360_datakit_components` · evidence O · read-only

List components in the org that can be added to a data kit, optionally by component type. Use it to find names for `datakit_create`. Since v63.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `component_type` | `componentType` | query | string |  | Type of components to return. These values are supported: - `DataStreamBundle` - `CalculatedInsight` - `DataLakeObject` - `DataTransform` - `EngagementSignal` - `PersonalizationObjective` - `PersonalizationRecommender` - `PersonalizationPoint` - `PersonalizationSchema` Since v63.0. |
| `data_kit_dev_name` | `dataKitDevName` | query | string |  | Developer name of the data kit. Since v63.0. |
| `limit` | `limit` | query | integer |  | Maximum number of available components to return from `1` through `200`. By default, `200` components are returned. Since v63.0. |
| `offset` | `offset` | query | integer |  | Number of records to skip before returning results. If unspecified, no rows are skipped. Since v63.0. |

```sql
CALL cdp.datakit_components (component_type => 'DataLakeObject', limit => 50);
```

**Result**

One row. Schema `DataKitComponentCollectionRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `components` | `components` | JSON (array of DataKitComponentRepresentation) | List of data kit components. Since v63.0. |
| `external_record_identifier` | `externalRecordIdentifier` | VARCHAR | External record ID for `DataStreamBundle` component types. Since v62.0. |

**Paging:** `limit`, `offset`.

**Notes:** It has returned a 500 on orgs with large kit inventories, with `DataKitObjectTemplate` metadata as a suggested alternative ([community](https://github.com/javrrr/data-360-sdk/blob/main/src/resources/data-kits.ts)). The spec's `component_type` list is shorter than the `type` values that `datakit_create` accepts. The [MCP server](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/DataKitTools.java) describes this call as org-wide, while the spec says "within data kits".

## datakit_manifest

`GET /ssot/datakit/{dataKitDevName}/manifest` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Kits/paths/~1ssot~1datakit~1%7BdataKitDevName%7D~1manifest/get) · tool `d360_datakit_manifest` · evidence O · read-only

Get a list of all member components and dependencies for a data kit. Since v63.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `data_kit_dev_name` | `dataKitDevName` | path | string | yes | Developer name of the data kit or name of the `DataPackageKitDefinition`. Since v63.0. |

```sql
CALL cdp.datakit_manifest (data_kit_dev_name => 'Customer_Kit');
```

**Result**

One row per item of `/dataKitMembers` in the response. Schema `CdpDataKitMembers`.

| Column | API name | Type | Description |
|---|---|---|---|
| `developer_name` | `developerName` | JSON | List of component developer names. Since v63.0. |
| `entity_name` | `entityName` | VARCHAR | List of component entity names. Since v63.0. |
| `id` | `id` | JSON | List of component entity IDs. Since v63.0. |

**Notes:** The path uses singular `/ssot/datakit/`, unlike the rest of this family. The spec's own endpoint table and [sf-pi](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/references/endpoint-families.md) write `/ssot/data-kits/.../manifest`.

[sf-pi](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/references/endpoint-families.md) also says a `developer_name` from `datakit_list` isn't always accepted, and that this path [can return `NOT_FOUND`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/references/troubleshooting.md) in healthy orgs.

`entity_name` names a metadata type such as `DataPackageKitDefinition`, `DataPackageKitObject` or `DataSource`. The [CLI guide](https://developer.salesforce.com/docs/data/data-cloud-dev/guide/dc-deploy_data_kit_using_cli.md) describes the manifest as a `package.xml` for retrieving a DevOps kit and points here for a programmatic version, but the spec returns JSON.

## datakit_components_update

`PATCH /ssot/data-kits/{dataKitDevName}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Kits/paths/~1ssot~1data-kits~1%7BdataKitDevName%7D/patch) · evidence O · changes org state

Update the components of an existing data kit. Updating components is a destructive sync: newly provided components replace the existing set, and any omitted components are removed. Since v64.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `data_kit_dev_name` | `dataKitDevName` | path | string | yes | Developer name of the data kit. Since v63.0. |
| `components` | `components` | body | array of [DataKitComponentInput](#datakitcomponentinputrepresentation) | yes | List of data kit components. Since v63.0. |

```sql
CALL cdp.datakit_components_update (data_kit_dev_name => 'Customer_Kit', components => [(type = 'DataLakeObject', info = (name = 'Customer__dll', label = 'Customer')), (type = 'DataLakeObject', info = (name = 'Order__dll', label = 'Order'))]);
```

**Result**

One row. Schema `DataKitRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `components` | `components` | JSON (array of DataKitComponentRepresentation) | List of components in the data kit. Since v63.0. |
| `dev_name` | `devName` | VARCHAR | Developer name of the data kit. Since v63.0. |
| `label` | `label` | VARCHAR | Label of the data kit. Since v63.0. |

**Notes:** Always send the complete list, since anything left out is removed. The call [rejects `data_kit_dev_name` and `label` in the body](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/references/troubleshooting.md), so recreate the kit to change its label or type. [sf-pi's patch example](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/references/data-shapes.md) uses `name`, `type = 'CI'` and `action`, which doesn't match the spec's `type` and `info`.

## datakit_create

`POST /ssot/data-kits` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Kits/paths/~1ssot~1data-kits/post) · evidence O · changes org state

Create a standard data kit. Since v63.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `components` | `components` | body | array of [DataKitComponentInput](#datakitcomponentinputrepresentation) | yes | List of components to be included in the data kit. Since v63.0. |
| `data_kit_dev_name` | `dataKitDevName` | body | string | yes | Developer name of the data kit. Since v63.0. |
| `data_kit_type` | `dataKitType` | body | enum(None, Sandbox) |  | Type of data kit. Since v63.0. |
| `dataspace_name` | `dataSpaceName` | body | string |  | Name of the data space for the data kit creation. Since v63.0. |
| `label` | `label` | body | string | yes | Label of the data kit. Since v63.0. |

```sql
CALL cdp.datakit_create (data_kit_dev_name => 'NewDataKit', label => 'New Data Kit From API', data_kit_type => 'None', components => [(type = 'DataStreamBundle', info = (name = 'CRMBundle', connector_type = 'CRM', streams = [(dev_name = 'Lead_Home__dll', label = 'Lead_Home'), (dev_name = 'User_Home__dll', label = 'User_Home')]))]);
```

**Result**

One row. Schema `DataKitRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `components` | `components` | JSON (array of DataKitComponentRepresentation) | List of components in the data kit. Since v63.0. |
| `dev_name` | `devName` | VARCHAR | Developer name of the data kit. Since v63.0. |
| `label` | `label` | VARCHAR | Label of the data kit. Since v63.0. |

**Notes:** - **`data_kit_type` is effectively required.** The spec's required list misspells it `DataKitType`, which is why the table shows it as optional. [sf-pi](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/references/data-shapes.md) lists it as required.
- **Type values.** The spec allows `None` and `Sandbox`, while the [setup UI](https://developer.salesforce.com/docs/data/data-cloud-dev/guide/dc-deploy_data_kit_using_cli.md) offers `DevOps`. No source maps one to the other.
- **`components`** [may be empty](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/references/data-shapes.md) on an initial create.
- **`connector_type`** in `info` has the same problem as on deploy: the enum says `Crm`, the spec's example says `CRM`.
- **This doesn't deploy anything.** The kit still has to reach the target org in a package. See the [packaging guide](https://developer.salesforce.com/docs/data/data-cloud-dev/guide/packages-data-kits.md).

## datakit_deploy

`POST /ssot/data-kits/{dataKitDevName}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Kits/paths/~1ssot~1data-kits~1%7BdataKitDevName%7D/post) · tool `d360_datakit_deploy` · evidence O · changes org state

Deploy multiple components from a specific data kit. Since v64.0. **Note:** See [Supported Component Types for Data Kit Deployment](https://developer.salesforce.com/docs/data/connectapi/guide/deploy-data-kit-payloads.html) for the complete list of component types and their corresponding payload configurations.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `data_kit_dev_name` | `dataKitDevName` | path | string | yes | Developer name of the data kit. Since v64.0. |
| `async_mode` | `asyncMode` | query | boolean | yes | Specifies asynchronous data kit deployment. Must be set to `true`; other values are not currently supported. Since v64.0. |
| `dataspace` | `dataspace` | query | string |  | Name of the data space to which to deploy the data kit components. If unspecified, the `default` data space is used. Since v64.0. |
| `components` | `components` | body | array of [CdpDataKitDeployComponent](#cdpdatakitdeploycomponentrepresentation) | yes | List of components to deploy. Since v57.0. |

```sql
CALL cdp.datakit_deploy (data_kit_dev_name => 'Customer_Kit', async_mode => true, dataspace => 'default', components => [(type = 'DataLakeObject', config = (data_source_object_dev_name = 'Namespace__Customer', api_name = 'Customer', label = 'Customer', dataspace_name = 'default')), (type = 'CalculatedInsight', config = (api_name = 'Namespace__Revenue', api_name_override = 'Revenue', label = 'Revenue', publish_interval = 'NotScheduled'))]);
```

**Result**

One row. Schema `DataKitAsyncRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `job_id` | `jobId` | VARCHAR | The queued job ID. Since v63.0. |

**Done when:** `datakit_deploy_status.job_status` is `Complete` or `Completed`, with `errors` empty. It failed on `Error`, `Failed`, `Cancelled`, `Canceled` or `Aborted`. Expect 25 to 45 minutes. See [`datakit_deploy_status`](#datakit_deploy_status).

**Notes:** **Prerequisites.** The [official guide](https://developer.salesforce.com/docs/data/data-cloud-dev/guide/dc-deploy-data-kits-using-connect-api.md) requires the package to be installed in the target org and the Data 360 Architect permission set. A deploy in the org that created the kit was rejected ([community, one org](https://github.com/dsouza-anush/sf-plugin-data360/blob/main/docs/API_COVERAGE.md)).

**`async_mode`.** It's a query option and must be `true`. Without it the call [can time out](https://developer.salesforce.com/docs/data/data-cloud-dev/guide/dc-deploy-data-kits-using-connect-api.md), [after 60 s](https://github.com/salesforce-misc/Data360MedTechSolutionKit/blob/main/.claude/skills/datakit-install/SKILL.md) in the MedTech kit. The [MCP server](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/DataKitTools.java) makes it optional, the spec doesn't.

**What to send.** Sources disagree, and these shapes aren't in the table above:

| Goal | Body | Source |
|---|---|---|
| Deploy selected components | `components` with `type` and `config` | The spec, and the [payload guide](https://developer.salesforce.com/docs/data/connectapi/guide/deploy-data-kit-payloads.md) |
| Deploy the whole kit | `components => []` | [MedTech kit](https://github.com/salesforce-misc/Data360MedTechSolutionKit/blob/main/.claude/skills/datakit-install/SKILL.md), which says listing components installs only part of the kit |
| Deploy the whole kit | Empty body `{}` | [Retail kit](https://github.com/salesforce-misc/Data360AgentforceSolutionKitRetail/blob/main/.claude/skills/datakit-api-deploy/SKILL.md), which says `data_kit_name` in the body causes `JSON_PARSER_ERROR` |
| Deploy a DevOps kit | Only `developer_name` | [Official guide](https://developer.salesforce.com/docs/data/data-cloud-dev/guide/dc-deploy-data-kits-using-connect-api.md). This attribute isn't in the spec, so it has no option here |

**`config` by `type`.** The spec types `config` as an open object and says to use "the input object that corresponds". This table pairs types with the spec's input objects by their titles, and the [payload guide](https://developer.salesforce.com/docs/data/connectapi/guide/deploy-data-kit-payloads.md) shows examples for most. All attributes are optional in the spec.

| `type` | `config` attributes |
|---|---|
| `ActivationTarget` | `component_name`, `target_display_name` |
| `AnalyticsDashboard`, `AnalyticsVisualization`, `AnalyticsWorkspace` | `template_name`, `name`, `label`, `dataspace_name`. The guide also sends `component_type` |
| `CalculatedInsight` | `api_name`, `api_name_override`, `label`, `publish_interval` (`ExternallyManaged`, `NotScheduled`, `One`, `Six`, `Streaming`, `SystemManaged`, `Twelve`, `TwentyFour`), `publish_schedule_end_date`, `publish_schedule_start_date_time` |
| `CopyFieldEnrichment` | `template_dev_name` |
| `DataAction` | `developer_name`, `developer_name_override`, `label`, `dataspace_name` |
| `DataActionTarget` | `api_name`, `api_name_override`, `label`, `end_point_url_override` |
| `DataCleanRoomDataSpecDef` | `component_name`, `dataspace_name` |
| `DataCleanRoomProvider` | `package_name`, `component_name` |
| `DataConnection` | `name`, `new_credentials`, `override_label`, `override_parameters`. Parameters are `(param_name = ..., value = ...)` |
| `DataGraph` | `name`, `label`, `template_dev_name`, `primary_dmo`, `dataspace_name` |
| `DataLakeObject` | `data_source_object_dev_name`, `api_name`, `label`, `dataspace_name`, `dataspace_filter_criteria_api_config` |
| `DataSemanticSearch` | `search_index_name`, `data_kit_name`, `dataspace_name`, `name`, `api_name`, `label` |
| `DataShare` | `template_dev_name`, `data_share_developer_name`, `api_name`, `label`, `description`, `dataspace_name`, `dlos`, `dmos`, `cios` |
| `DataStreamBundle` | `connector_type`, `bundle_name`, `force_no_refresh`, `kq_config`, `bundle_config` (next table). `kq_config` items are `data_source_object`, `data_source_field`, `value` |
| `DataTransform` | `data_transform_type` (`BATCH` or `STREAMING` in the guide), `data_transform_dev_name`, `api_name`, `label`, `dataspace_name`, `connection`, `currency_iso_code`, `component_properties`, `data_object_overrides`, `definition_overrides` |
| `IdentityResolution` | The spec has `identity_resolution_dev_name`, `label`, `data_kit_dev_name`, `dataspace_name`. The guide sends `template_dev_name`, `data_kit_dev_name`, `dataspace_name` |
| `IdpConfiguration` | `template_dev_name` |
| `IrRelatedListEnrichment` | `developer_name`, `label` |
| `MarketSegment` | `name`, `data_kit_name`, `dataspace_name`, `label`, `target_display_name`, `target_segment_developer_name` |
| `MarketSegmentActivation` | `component_name`, `data_kit_name`, `target_display_name` |
| `MlConfiguredModel` | `api_name`, `label`, `connector_type`, `model_type` |
| `MlPredictionJob` | The spec has `prediction_job_name`, `data_kit_name`, `api_name`, `label`, `dataspace_name`. The guide uses `predictionJobDevName` and `data_kit_dev_name` instead of the first two |
| `MlRetriever` | `api_name`, `label`, `dataspace_name`, `retriever_query_type` (`Ensemble`, `NoCode`, `ProCode`) |
| `PersonalizationObjective`, `PersonalizationPoint`, `PersonalizationRecommender`, `PersonalizationSchema` | `api_name`, `label`, `template_developer_name`, `dataspace_name` |
| `SemanticModel` | `api_name`, `display_name`, `base_sdms`, `dataspace_name` |
| `TuaTemplatedObject` | `developer_name`, `label`, `data_kit_dev_name`, `dataspace_name`, `component_type`, `change_set_identifier` |

No source gives a payload for `CurrencyConfigObject`, `DataCustomCode`, `EngagementSignal`, `FiscalCalendarConfigObject`, `InternalDataConnector`, `PersnlBatchDecision` or `SecondaryIndex`. The spec says to use its generic input (`template_name`, `name`, `label`, `dataspace_name`) for "all others", but it also names a custom code input for which it has no schema. The guide confirms that `DataCustomCode` and `EngagementSignal` are supported.

Where the guide and the spec's attribute names differ, nothing shows which one the API accepts.

**`bundle_config` by `connector_type`.** The spec's enum and its own examples disagree on spelling. The guide and the spec's examples use upper case.

| Examples | Spec enum | `bundle_config` attributes |
|---|---|---|
| `CRM` | `Crm` | `org_id` |
| `COMMERCE` | `Commerce` | `instance_id` |
| `EXTERNAL` | `External` | `connection_name`. The guide calls this a BYOL bundle |
| `MORECONNECTORS` | `MoreConnectors`, `S3` | `connection_name` |
| `INGESTAPI` | `IngestApi` | `connector_name` |
| `STREAMINGAPP` | `StreamingApp` | `connector_name`, `streaming_app_data_connector_type` (`MobileApp`, `WebApp`) |
| None | `AccountEngagement` | `pardot_tenant_id`, `data_stream_type` (`EmailActivity`, `FormActivity`, `WebPageActivity`) |

All of these except `Commerce` also take `dataspace_filter_criteria_api_config`, whose items are `field_name`, `operator`, `filter_value` and `target_object_name`.

**Credentials.** `DataConnection` takes connection secrets in `new_credentials`, so write `(param_name = 'privateKey', value = secret(snowflake_key))`.

**Other traps:**

- The guide says the response is `202 Accepted`, the spec says `200`.
- A redeploy [overwrites changes](https://developer.salesforce.com/docs/data/data-cloud-dev/guide/packages-data-kits.md) made to deployed components. Components from a managed package are locked.
- Common failures in the [official guide](https://developer.salesforce.com/docs/data/data-cloud-dev/guide/dc-deploy-data-kits-using-connect-api.md): inactive connectors that need reauthorizing in the target org, duplicate API names in the target data space, and a target data space name that differs from the one used to create the kit.
- The MCP server's [`d360_datakit_deploy` example](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/resources/metadata/payload-examples.json) uses `name`, `action` and `type = 'CI'`, which doesn't match the spec or the guide.

## datakit_undeploy

`POST /ssot/data-kits/{dataKitName}/undeploy` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Kits/paths/~1ssot~1data-kits~1%7BdataKitName%7D~1undeploy/post) · tool `d360_datakit_undeploy` · evidence O · changes org state

Undeploy a component previously deployed from a data kit. The undeployment occurs in the sequential order of components specified in the request body. Since v63.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `data_kit_name` | `dataKitName` | path | string | yes | Developer name of the data kit. Since v63.0. |
| `async_mode` | `asyncMode` | query | boolean | yes | Indicates whether the deployment is asynchronous. Only the `true` value is accepted. Since v63.0. |
| `dataspace` | `dataspace` | query | string |  | Name of the data space. If unspecified, the `default` data space is used. Since v63.0. |
| `components` | `components` | body | array of [DataKitUnDeployComponentDetails](#datakitundeploycomponentdetails) | yes | Components from the data kit. Since v63.0. |

```sql
CALL cdp.datakit_undeploy (data_kit_name => 'Customer_Kit', async_mode => true, components => [(type = 'DataTransform', name = 'Customer_Transform'), (type = 'DataLakeObject', name = 'Customer__dll')]);
```

**Result**

One row. Schema `DataKitAsyncRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `job_id` | `jobId` | VARCHAR | The queued job ID. Since v63.0. |

**Done when:** No source documents a job status for undeploy. A [community plugin](https://github.com/dsouza-anush/sf-plugin-data360/blob/main/docs/API_COVERAGE.md) checks each component with `datakit_component_status`, whose `component_details[].status` includes `Deleting` and `Error`. No source says what a fully removed component returns.

**Notes:** Components are removed in the order given, so list dependents first. The spec's example removes a transform before its DLO. `datakit_component_deps` shows what depends on what.

The spec allows 18 `type` values here, and the [MCP server](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/DataKitTools.java) lists 38. Types outside the spec's list are unconfirmed.

A successful call returned a `job_id` ([community, one org](https://github.com/dsouza-anush/sf-plugin-data360/blob/main/docs/API_COVERAGE.md)). The [packaging guide](https://developer.salesforce.com/docs/data/data-cloud-dev/guide/packages-data-kits.md) says subscribers can't delete components deployed from a managed package, and doesn't say whether undeploy is an exception.

## datakit_get

`GET /ssot/data-kits/{id}` · tool `d360_datakit_get` · evidence S · read-only

Get one data kit by developer name. This comes from Salesforce's MCP server, not the spec, so prefer `datakit_list` or `datakit_manifest` when you need a documented response.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `data_kit_dev_name` | `id` | path | string | yes | The data kit developer name |
| `fbdk_accessible_in_lob` | `fbdkAccessibleInLob` | query | boolean |  | Filter by FBDK accessible in LOB flag |

```sql
CALL cdp.datakit_get (data_kit_dev_name => 'Customer_Kit');
```

**Result**

The public sources don't document this response. One row, with the response in `_raw`.

**Notes:** The spec defines `DELETE`, `PATCH` and `POST` on this path, but no `GET`. [sf-pi](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/references/connect-openapi-parity.md) lists the read as SDK-only, and a [community plugin](https://github.com/dsouza-anush/sf-plugin-data360/blob/main/docs/API_COVERAGE.md) says it doesn't exist in v67.

The evidence that it works is the [MCP server's tool](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/DataKitTools.java) and a remark in the [Retail kit](https://github.com/salesforce-misc/Data360AgentforceSolutionKitRetail/blob/main/.claude/skills/datakit-api-deploy/SKILL.md) that this path "returns Data Kit definition". The header shows `{id}`, but the tool sends the developer name.

`fbdk_accessible_in_lob` appears only in the MCP server, and no source defines it.

## datakit_deploy_status

`GET /ssot/data-kits/deployment-jobs/{jobId}` · tool `d360_datakit_deploy_status` · evidence S · read-only

Get the state of a data kit deployment job started by `datakit_deploy`. Poll it until the job reaches a final status. It isn't in the spec.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `job_id` | `jobId` | path | string | yes | The deployment job ID |

```sql
CALL cdp.datakit_deploy_status (job_id => '08Paj00000tPyr4');
```

**Result**

One row. The spec doesn't have this response. These columns come from the [Retail](https://github.com/salesforce-misc/Data360AgentforceSolutionKitRetail/blob/main/.claude/skills/datakit-api-deploy/SKILL.md) and [MedTech](https://github.com/salesforce-misc/Data360MedTechSolutionKit/blob/main/.claude/skills/datakit-install/SKILL.md) kits, and the Retail kit names the schema `CdpDataKitDeployJobOutputRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `job_id` | `jobId` | VARCHAR | The job ID returned by `datakit_deploy`. |
| `job_status` | `jobStatus` | VARCHAR | State of the job. See the notes for values. |
| `job_results` | `jobResults` | JSON | Array. The Retail kit shows component IDs. |
| `errors` | `errors` | JSON | Array of errors. The [official guide](https://developer.salesforce.com/docs/data/data-cloud-dev/guide/dc-deploy-data-kits-using-connect-api.md) says to read it when `job_status` is `Error`. |

**Done when:** `job_status` is `Complete` or `Completed` with `errors` empty, or it's `Error`, `Failed`, `Cancelled`, `Canceled` or `Aborted`.

**Notes:** **The path is disputed.** The header shows the [MCP server's](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/DataKitTools.java) `/ssot/data-kits/deployment-jobs/{jobId}`. The [official guide](https://developer.salesforce.com/docs/data/data-cloud-dev/guide/dc-deploy-data-kits-using-connect-api.md) links to `/ssot/datakit-deployment-job/{jobId}`, and the [Retail kit](https://github.com/salesforce-misc/Data360AgentforceSolutionKitRetail/blob/main/.claude/skills/datakit-api-deploy/SKILL.md) polls that path and calls it the correct one. The spec has neither, and [sf-pi](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/references/connect-openapi-parity.md) lists the MCP path as SDK-only. The [MedTech kit](https://github.com/salesforce-misc/Data360MedTechSolutionKit/blob/main/.claude/skills/datakit-install/SKILL.md) records a run through the hosted server's tool, which doesn't reveal the path. Prefer `/ssot/datakit-deployment-job/{jobId}`, since it has both the official guide and a kit that polls it.

**`job_status` values:**

| Meaning | Values | Source |
|---|---|---|
| Success | `Complete` | Retail and MedTech kits, from observed runs |
| Success | `Completed` | [Official guide](https://developer.salesforce.com/docs/data/data-cloud-dev/guide/dc-deploy-data-kits-using-connect-api.md) |
| Still running | `Queued`, `Running`, `InProgress` | Retail and MedTech kits. MedTech also has `Pending` |
| Failed | `Error` | Official guide and both kits |
| Failed | `Failed`, `Cancelled`, `Canceled`, `Aborted` | Both kits |

Accept both spellings of success. Treat any unknown value as still running, up to a time limit. The Retail kit says `Error` is what the API returns for "platform-contention failures, lock conflicts, and partial-component failures", and that a loop handling only `Failed` wasted up to 45 minutes per attempt. It also requires `errors` to be empty on `Complete`.

**Timing.** The Retail kit, at 612 metadata components, says 25 to 35 minutes in one place and 30 to 45 in another. The MedTech kit says 30 to 45. Both poll every 5 minutes, 9 times, and stop at 45 minutes. A timeout isn't a failure, and they report it without retrying.

**Retrying.** Sending `datakit_deploy` again starts a new job with a new `job_id`. The [Retail kit](https://github.com/salesforce-misc/Data360AgentforceSolutionKitRetail/blob/main/.claude/skills/datakit-api-deploy/SKILL.md) retries terminal failures up to 5 attempts in total, waiting 30 to 60 s, because locks from a failed run can take time to clear. It stops at once on `INSUFFICIENT_ACCESS`, `LICENSE_LIMIT_EXCEEDED`, `FEATURE_NOT_ENABLED`, `INVALID_TYPE`, or a message mentioning `permission` or `not licensed`. In [one org](https://github.com/salesforce-misc/Data360AgentforceSolutionKitRetail/blob/main/.claude/skills/base-metadata-deploy/SKILL.md), a metadata deploy stuck in `InProgress` blocked the kit deploy until it was cancelled.

Whether this call also tracks jobs from `datakit_undeploy` isn't documented.

## Schemas

Attribute names are keywords inside the object they belong to, so completion offers exactly these.

### CdpDataKitDeployBundleConfigForAccountEngagement

Represents the bundle configuration for an account engagement connector type.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `dataspace_filter_criteria_api_config` | `dataSpaceFilterCriteriaApiConfig` | array of [DataSpaceFilterConditionApiConfig](#dataspacefilterconditionapiconfig) |  | API configuration for the data space filer criteria. Since v63.0. |
| `data_stream_type` | `dataStreamType` | enum(EmailActivity, FormActivity, WebPageActivity) |  | Type of data stream. Since v63.0. |
| `pardot_tenant_id` | `pardotTenantId` | string |  | Pardot tenant ID of the connector. Since v63.0. |

### CdpDataKitDeployBundleConfigForCommerce

Represents the bundle configuration for a Commerce Cloud connector type.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `instance_id` | `instanceId` | string |  | Instance ID of the B2C Commerce Instance Since v63.0. |

### CdpDataKitDeployBundleConfigForConnectorsFramework

Represents the bundle configuration for a connector framework connector type.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `connection_name` | `connectionName` | string |  | APi name of the connection. Since v60.0. |
| `dataspace_filter_criteria_api_config` | `dataSpaceFilterCriteriaApiConfig` | array of [DataSpaceFilterConditionApiConfig](#dataspacefilterconditionapiconfig) |  | API configuration for the data space filter criteria. Since v61.0. |

### CdpDataKitDeployBundleConfigForCrm

Represents a bundle configuration for a CRM connector type.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `dataspace_filter_criteria_api_config` | `dataSpaceFilterCriteriaApiConfig` | array of [DataSpaceFilterConditionApiConfig](#dataspacefilterconditionapiconfig) |  | API configuration for the data space filter criteria. Since v61.0. |
| `org_id` | `orgId` | string |  | Org ID for the source CRM. Since v57.0. |

### CdpDataKitDeployBundleConfigForExternal

Represents the bundle configuration for an external connector type.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `connection_name` | `connectionName` | string |  | API name of the connection. Since v63.0. |
| `dataspace_filter_criteria_api_config` | `dataSpaceFilterCriteriaApiConfig` | array of [DataSpaceFilterConditionApiConfig](#dataspacefilterconditionapiconfig) |  | API configuration for the data space filter criteria. Since v63.0. |

### CdpDataKitDeployBundleConfigForIngestApi

Represents the bundle configuration for an ingest API connector type.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `connector_name` | `connectorName` | string |  | Connector API name For the ingest API connector. Since v60.0. |
| `dataspace_filter_criteria_api_config` | `dataSpaceFilterCriteriaApiConfig` | array of [DataSpaceFilterConditionApiConfig](#dataspacefilterconditionapiconfig) |  | API configuration for the data space filter criteria. Since v61.0. |

### CdpDataKitDeployBundleConfigForStreamingApp

Represents the bundle configuration for a streaming app connector type.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `connector_name` | `connectorName` | string |  | API name of the streaming app connector. Since v60.0. |
| `dataspace_filter_criteria_api_config` | `dataSpaceFilterCriteriaApiConfig` | array of [DataSpaceFilterConditionApiConfig](#dataspacefilterconditionapiconfig) |  | API configuration for the data space filter criteria. Since v61.0. |
| `streaming_app_data_connector_type` | `streamingAppDataConnectorType` | enum(MobileApp, WebApp) |  | Type of streaming app connector. Since v60.0. |

### CdpDataKitDeployComponentConfigCalculatedInsight

Represents the input component configuration for calculated insights.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `api_name` | `apiName` | string |  | API name of the calculated insight in the data kit to be deployed. Since v59.0. |
| `api_name_override` | `apiNameOverride` | string |  | Name of the new calculated insight deployed using the template. Since v59.0. |
| `label` | `label` | string |  | Master label of the calculated insight. Since v59.0. |
| `publish_interval` | `publishInterval` | enum(ExternallyManaged, NotScheduled, One, Six, Streaming, SystemManaged, Twelve, TwentyFour) |  | Publish interval for the calculated insight. Since v59.0. |
| `publish_schedule_end_date` | `publishScheduleEndDate` | string |  | Calculated insight publish schedule end date. The expected format is `yyyy-MM-dd`. Since v62.0. |
| `publish_schedule_start_date_time` | `publishScheduleStartDateTime` | string |  | Calculated insight publish schedule start date. The expected format is `yyyy-MM-dd`. Since v62.0. |

### CdpDataKitDeployComponentConfigForBundle

Represents the input component configuration for data kit bundles.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `bundle_config` | `bundleConfig` | one of [CdpDataKitDeployBundleConfigForAccountEngagement](#cdpdatakitdeploybundleconfigforaccountengagement), [CdpDataKitDeployBundleConfigForCommerce](#cdpdatakitdeploybundleconfigforcommerce), [CdpDataKitDeployBundleConfigForConnectorsFramework](#cdpdatakitdeploybundleconfigforconnectorsframework), [CdpDataKitDeployBundleConfigForCrm](#cdpdatakitdeploybundleconfigforcrm), [CdpDataKitDeployBundleConfigForExternal](#cdpdatakitdeploybundleconfigforexternal), [CdpDataKitDeployBundleConfigForIngestApi](#cdpdatakitdeploybundleconfigforingestapi), [CdpDataKitDeployBundleConfigForStreamingApp](#cdpdatakitdeploybundleconfigforstreamingapp) |  | Configuration for the bundle. Use the bundle config input object that corresponds to the connector type. For example, use the Data Kit Deploy Bundle Config For Account Engagement Input for the `AccountEngagement` connector type. - Use the Data Kit Deploy Bundle Config For Connectors Framework Input for the `MoreConnectors` and `S3` connector types. Since v57.0. |
| `bundle_name` | `bundleName` | string |  | Name of the bundle. Since v57.0. |
| `connector_type` | `connectorType` | enum(AccountEngagement, Commerce, Crm, External, IngestApi, MoreConnectors, S3, StreamingApp) |  | Connector type for the bundle. Since v57.0. |
| `force_no_refresh` | `forceNoRefresh` | boolean |  | Indicates whether to force a no refresh configuration on the data stream (`true`) or not (`false`). Since v57.0. |
| `kq_config` | `kqConfig` | array of [DataKitKQConfig](#datakitkqconfigrepresentation) |  | List of key qualifier configurations applied on data stream templates of the bundle. Since v63.0. |

### CdpDataKitDeployComponentConfigForDLO

Represents the input component configuration for DLOs.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `api_name` | `apiName` | string |  | API name of the DLO. Since v60.0. |
| `data_source_object_dev_name` | `dataSourceObjectDevName` | string |  | Developer name of the DLO. Since v60.0. |
| `dataspace_filter_criteria_api_config` | `dataSpaceFilterCriteriaApiConfig` | array of [DataSpaceFilterConditionApiConfig](#dataspacefilterconditionapiconfig) |  | Data space filter criteria for adding filters while deploying a DLO. Since v60.0. |
| `dataspace_name` | `dataSpaceName` | string |  | Name of the data space to deploy the data kit component in. Since v60.0. |
| `label` | `label` | string |  | Label name of the DLO. Since v60.0. |

### CdpDataKitDeployComponentConfigForDataAction

Represents the input component configuration for data actions.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `dataspace_name` | `dataSpaceName` | string |  | Name of the data space to deploy the data kit component in. Since v63.0. |
| `developer_name` | `developerName` | string |  | Developer name of the data action. Since v63.0. |
| `developer_name_override` | `developerNameOverride` | string |  | Developer name of the data action override. Since v63.0. |
| `label` | `label` | string |  | Label of the data action object. Since v63.0. |

### CdpDataKitDeployComponentConfigForDataActionTarget

Represents the input component configuration for data action targets.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `api_name` | `apiName` | string |  | API name of the data action target. Since v63.0. |
| `api_name_override` | `apiNameOverride` | string |  | API name of the data action target override. Since v63.0. |
| `end_point_url_override` | `endPointUrlOverride` | string |  | API name of the data action target endpoint URL override. Since v63.0. |
| `label` | `label` | string |  | Label of the data action target object. Since v63.0. |

### CdpDataKitDeployComponentConfigForDataSemanticSearch

Represents the input component configuration for data semantic search.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `api_name` | `apiName` | string |  | API name of the semantic search object. Since v63.0. |
| `data_kit_name` | `dataKitName` | string |  | Developer name of the data kit. Since v63.0. |
| `dataspace_name` | `dataSpaceName` | string |  | Name of the data space to deploy the data kit component in. Since v63.0. |
| `label` | `label` | string |  | Label of the semantic search object. Since v63.0. |
| `name` | `name` | string |  | Name of the specific semantic search instance. Since v63.0. |
| `search_index_name` | `searchIndexName` | string |  | Developer name of the underlying search index used by this component. Since v63.0. |

### CdpDataKitDeployComponentConfigForDataShare

Represents the input component configuration for data shares.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `api_name` | `apiName` | string |  | Definition name of the target data share. Since v63.0. |
| `cios` | `cios` | array of string |  | Developer names of the calculated insight objects. Since v63.0. |
| `data_share_developer_name` | `dataShareDeveloperName` | string |  | Definition name of the source data share. Since v63.0. |
| `dataspace_name` | `dataSpaceName` | string |  | Name of the data space to deploy the data kit component in. Since v63.0. |
| `description` | `description` | string |  | Description for the data share. Since v63.0. |
| `dlos` | `dlos` | array of string |  | Developer names of the DLOs. Since v63.0. |
| `dmos` | `dmos` | array of string |  | Developer names of the DMOs. Since v63.0. |
| `label` | `label` | string |  | Label of the data share. Since v63.0. |
| `template_dev_name` | `templateDevName` | string |  | Template developer name of the data share template that's used for creating the share in the data kit. Since v63.0. |

### CdpDataKitDeployComponentConfigForIdpConfiguration

Represents the input component configuration for Document AI.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `template_dev_name` | `templateDevName` | string |  | Developer name of the Document AI template. Since v63.0. |

### CdpDataKitDeployComponentConfigForPredictionJob

Represents the input component configuration for ML prediction jobs.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `api_name` | `apiName` | string |  | API name of the ML prediction job object. Since v63.0. |
| `data_kit_name` | `dataKitName` | string |  | Developer name of the data kit. Since v63.0. |
| `dataspace_name` | `dataSpaceName` | string |  | Name of the data space to deploy the data kit component in. Since v63.0. |
| `label` | `label` | string |  | Label of the ML prediction job object. Since v63.0. |
| `prediction_job_name` | `predictionJobName` | string |  | Developer name of the specific prediction job. Since v63.0. |

### CdpDataKitDeployComponentConfigForTuaFramework

Represents the input component configuration for TUA objects.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `change_set_identifier` | `changeSetIdentifier` | string |  | Unique ID for the change set. Since v63.0. |
| `component_type` | `componentType` | enum(ActivationTarget, AnalyticsDashboard, AnalyticsVisualization, AnalyticsWorkspace, CalculatedInsight, CopyFieldEnrichment, CurrencyConfigObject, DataAction, DataActionTarget, DataCleanRoomDataSpecDef, DataCleanRoomProvider, DataConnection, DataCustomCode, DataGraph, DataLakeObject, DataModelObject, DataSemanticSearch, DataShare, DataStreamBundle, DataTransform, EngagementSignal, FiscalCalendarConfigObject, IdentityResolution, IdpConfiguration, InternalDataConnector, IrRelatedListEnrichment, MarketSegment, MarketSegmentActivation, MlConfiguredModel, MlPredictionJob, MlRetriever, PersnlBatchDecision, PersonalizationObjective, PersonalizationPoint, PersonalizationRecommender, PersonalizationSchema, SecondaryIndex, SemanticModel, TuaTemplatedObject) |  | Type of TUA object component. Since v63.0. |
| `data_kit_dev_name` | `dataKitDevName` | string |  | Developer name of the data kit. Since v63.0. |
| `dataspace_name` | `dataSpaceName` | string |  | Name of the data space to deploy the data kit component in. Since v63.0. |
| `developer_name` | `developerName` | string |  | Developer name of the TUA object. Since v63.0. |
| `label` | `label` | string |  | Label of the TUA object. Since v63.0. |

### CdpDataKitDeployComponentConfigMlConfiguredModel

Represents the input component configuration for ML configured models.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `api_name` | `apiName` | string |  | API name of the ML configured model. Since v63.0. |
| `connector_type` | `connectorType` | enum(Anthropic, AzureOpenAI, Bedrock, Databricks, Generic, InternalEmbedding, OpenAI, OpenConnector, SageMaker, Salesforce, VertexAI) |  | Type of ML configured model connector. Since v63.0. |
| `label` | `label` | string |  | Label of the ML configured model. Since v63.0. |
| `model_type` | `modelType` | enum(Generative, Predictive, SpeechSynthesis, Summarization, Transcribe, Unknown) |  | Type of ML configured model. Since v63.0. |

### CdpDataKitDeployComponentConfigMlRetriever

Represents the input component configuration for ML retrievers.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `api_name` | `apiName` | string |  | API name of the retriever. Since v63.0. |
| `dataspace_name` | `dataSpaceName` | string |  | Name of the data space to deploy the data kit component in. Since v63.0. |
| `label` | `label` | string |  | Label of the retriever. Since v63.0. |
| `retriever_query_type` | `retrieverQueryType` | enum(Ensemble, NoCode, ProCode) |  | Query type of the retriever. Since v63.0. |

### CdpDataKitDeployComponentRepresentation

Represents a single component for a data kit deployment.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `config` | `config` | one of [CdpDataKitDeployComponentConfigForBundle](#cdpdatakitdeploycomponentconfigforbundle), [CdpDataKitDeployComponentConfigForDLO](#cdpdatakitdeploycomponentconfigfordlo), [CdpDataKitDeployComponentConfigCalculatedInsight](#cdpdatakitdeploycomponentconfigcalculatedinsight), [CdpDataKitDeployComponentConfigForDataAction](#cdpdatakitdeploycomponentconfigfordataaction), [CdpDataKitDeployComponentConfigForDataActionTarget](#cdpdatakitdeploycomponentconfigfordataactiontarget), [CdpDataKitDeployComponentConfigForDataSemanticSearch](#cdpdatakitdeploycomponentconfigfordatasemanticsearch), [CdpDataKitDeployComponentConfigForDataShare](#cdpdatakitdeploycomponentconfigfordatashare), [CdpDataKitDeployComponentConfigForIdpConfiguration](#cdpdatakitdeploycomponentconfigforidpconfiguration), [CdpDataKitDeployComponentConfigForPredictionJob](#cdpdatakitdeploycomponentconfigforpredictionjob), [CdpDataKitDeployComponentConfigForTuaFramework](#cdpdatakitdeploycomponentconfigfortuaframework), [CdpDataKitDeployComponentConfigMlConfiguredModel](#cdpdatakitdeploycomponentconfigmlconfiguredmodel), [CdpDataKitDeployComponentConfigMlRetriever](#cdpdatakitdeploycomponentconfigmlretriever), [DataCustomCodeInputRep](#datacustomcodeinputrep), [DataKitDeployActivationTarget](#datakitdeployactivationtargetrepresentation), [DataKitDeployComponentConfigCopyField](#datakitdeploycomponentconfigcopyfield), [DataKitDeployComponentConfigForIRRelatedList](#datakitdeploycomponentconfigforirrelatedlist), [DataKitDeployComponentConfigIdentityResolutionInput](#datakitdeploycomponentconfigidentityresolutioninput), [DataKitDeployComponentConfigSemanticModelInput](#datakitdeploycomponentconfigsemanticmodelinputrepresentation), [DataKitDeployDataCleanRoomMapping](#datakitdeploydatacleanroommappingrepresentation), [DataKitDeployDataCleanRoomProvider](#datakitdeploydatacleanroomproviderrepresentation), [DataKitDeployDataConnection](#datakitdeploydataconnectionrepresentation), [DataKitDeployDataGraphInput](#datakitdeploydatagraphinputrepresentation), [DataKitDeployDataTransform](#datakitdeploydatatransformrepresentation), [DataKitDeployMarketActivation](#datakitdeploymarketactivationrepresentation), [DataKitDeployMarketSegment](#datakitdeploymarketsegmentrepresentation), [DataKitDeployPersonalizationInput](#datakitdeploypersonalizationinputrepresentation), [DataKitDeployInput](#datakitdeployinputrepresentation) | yes | Configuration of the component. Use the input object that corresponds to the component type. For example, use the Data Kit Deploy Component Config For DLO Input for the `DataLakeObject` component type. - Use the Data Kit Deploy Personalization Input for all personalization-related component types, such as `PersonalizationObjective`, `PersonalizationPoint`, `PersonalizationRecommender`, and `PersonalizationSchema`. - Use the Data Kit Deploy Input for all others. See [Supported Component Types for Data Kit Deployment](https://developer.salesforce.com/docs/data/connectapi/guide/deploy-data-kit-payloads.html) for the complete list of component types and their corresponding payload configurations. Since v57.0. |
| `type` | `type` | enum(ActivationTarget, AnalyticsDashboard, AnalyticsVisualization, AnalyticsWorkspace, CalculatedInsight, CopyFieldEnrichment, CurrencyConfigObject, DataAction, DataActionTarget, DataCleanRoomDataSpecDef, DataCleanRoomProvider, DataConnection, DataCustomCode, DataGraph, DataLakeObject, DataSemanticSearch, DataShare, DataStreamBundle, DataTransform, EngagementSignal, FiscalCalendarConfigObject, IdentityResolution, IdpConfiguration, InternalDataConnector, IrRelatedListEnrichment, MarketSegment, MarketSegmentActivation, MlConfiguredModel, MlPredictionJob, MlRetriever, PersnlBatchDecision, PersonalizationObjective, PersonalizationPoint, PersonalizationRecommender, PersonalizationSchema, SecondaryIndex, SemanticModel, TuaTemplatedObject) | yes | Type of component. Since v57.0. |
| `name` | `name` | string |  | Not in the spec schema: from the MCP server's payload example. |
| `action` | `action` | string |  | Not in the spec schema: from the MCP server's payload example. |

### CdpDataKitStream

Represents a single stream in a data kit data stream bundle.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `dev_name` | `devName` | string | yes | Developer name of the stream. Since v57.0. |
| `label` | `label` | string | yes | Label of the stream. Since v57.0. |

### DataConnectionParameterInputRepresentation

Key-value pair for credentials and parameters of a data connection.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `param_name` | `paramName` | string | yes | Name of the parameter. Each attribute of the connector metadata is a possible parameter name that you provide. Since v61.0. |
| `value` | `value` | string | yes | Value of the parameter. Since v61.0. |
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

### DataCustomCodeInputRep

Represents the input component configuration for data custom code.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `template_dev_name` | `templateDevName` | string |  | Developer name of the custom code template. Since v63.0. |

### DataKitComponentInfoBaseInputRepresentation

Represents the input for data kit component information.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `name` | `name` | string |  | Name of the data kit component. Since v63.0. |
| `label` | `label` | string |  | Label of the data kit component. Since v63.0. |

### DataKitComponentInfoBundleInputRepresentation

Represents the input for bundle-specific component information.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `name` | `name` | string |  | Name of the data kit component. Since v63.0. |
| `connector_type` | `connectorType` | enum(AccountEngagement, Commerce, Crm, External, IngestApi, Mc, MoreConnectors, S3, StreamingApp) |  | Type of data kit bundle connector. Since v63.0. |
| `streams` | `streams` | array of [CdpDataKitStream](#cdpdatakitstream) |  | List of data streams. Since v63.0. |

### DataKitComponentInputRepresentation

Represents the input for a data kit component.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `info` | `info` | one of [DataKitComponentInfoBundleInput](#datakitcomponentinfobundleinputrepresentation), [DataKitComponentInfoBaseInput](#datakitcomponentinfobaseinputrepresentation) |  | Information about the data kit component. Use the component info input object that corresponds to the component type: - `DataStreamBundle`: Data Kit Component Info Bundle Input - All others: Data Kit Component Info Base Input Since v63.0. |
| `type` | `type` | enum(ActivationTarget, AnalyticsDashboard, AnalyticsVisualization, AnalyticsWorkspace, CalculatedInsight, CopyFieldEnrichment, CurrencyConfigObject, DataAction, DataActionTarget, DataCleanRoomDataSpecDef, DataCleanRoomProvider, DataConnection, DataCustomCode, DataGraph, DataLakeObject, DataModelObject, DataSemanticSearch, DataShare, DataStreamBundle, DataTransform, EngagementSignal, FiscalCalendarConfigObject, IdentityResolution, IdpConfiguration, InternalDataConnector, IrRelatedListEnrichment, MarketSegment, MarketSegmentActivation, MlConfiguredModel, MlPredictionJob, MlRetriever, PersnlBatchDecision, PersonalizationObjective, PersonalizationPoint, PersonalizationRecommender, PersonalizationSchema, SecondaryIndex, SemanticModel, TuaTemplatedObject) |  | Type of the data kit component. Since v63.0. |

### DataKitDeployActivationTargetRepresentation

Represents the input component configuration for activation targets.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `component_name` | `componentName` | string |  | Developer name of the activation target. Since v63.0. |
| `target_display_name` | `targetDisplayName` | string |  | Label of the activation target. Since v63.0. |

### DataKitDeployComponentConfigCopyField

Represents the input component configuration for copy field enrichments.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `template_dev_name` | `templateDevName` | string |  | Developer name of the copy field enrichment template. Since v63.0. |

### DataKitDeployComponentConfigForIRRelatedList

Represents the input component configuration for IR-related lists.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `developer_name` | `developerName` | string |  | Developer name of the IR-related list. Since v63.0. |
| `label` | `label` | string |  | Label of the IR-related list. Since v63.0. |

### DataKitDeployComponentConfigIdentityResolutionInput

Represents the input component configuration for identity resolutions.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `data_kit_dev_name` | `dataKitDevName` | string |  | Developer name of the data kit. Since v63.0. |
| `dataspace_name` | `dataSpaceName` | string |  | Name of the data space to deploy the data kit component in. Since v63.0. |
| `identity_resolution_dev_name` | `identityResolutionDevName` | string |  | Developer name of the identity resolution. Since v63.0. |
| `label` | `label` | string |  | Label of the identity resolution. Since v63.0. |

### DataKitDeployComponentConfigSemanticModelInputRepresentation

Represents the input component configuration for semantic search models.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `api_name` | `apiName` | string |  | API name of the semantic search model. Since v63.0. |
| `base_sdms` | `baseSDMs` | array of string |  | Base SDM API names of the semantic search model. Since v63.0. |
| `dataspace_name` | `dataSpaceName` | string |  | Name of the data space to deploy the data kit component in. Since v63.0. |
| `display_name` | `displayName` | string |  | Label of the semantic search model. Since v63.0. |

### DataKitDeployDataCleanRoomMappingRepresentation

Represents the input component configuration for clean room specification mapping.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `component_name` | `componentName` | string |  | Name of the data kit component. Since v63.0. |
| `dataspace_name` | `dataSpaceName` | string |  | Name of the data space to deploy the data kit component in. Since v63.0. |

### DataKitDeployDataCleanRoomProviderRepresentation

Represents the input component configuration for clean room providers.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `component_name` | `componentName` | string |  | Developer name of the clean room provider. Since v63.0. |
| `package_name` | `packageName` | string |  | Label of the clean room provider. Since v63.0. |

### DataKitDeployDataConnectionRepresentation

Represents the input component configuration for data connections.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `name` | `name` | string |  | Developer name of the connection. Since v63.0. |
| `new_credentials` | `newCredentials` | array of [DataConnectionParameterInput](#dataconnectionparameterinputrepresentation) |  | Connection credentials to use in the target org. Since v63.0. |
| `override_label` | `overrideLabel` | string |  | Override label to use in the target org. Since v63.0. |
| `override_parameters` | `overrideParameters` | array of [DataConnectionParameterInput](#dataconnectionparameterinputrepresentation) |  | Connection parameters to override in the target org. Since v63.0. |

### DataKitDeployDataGraphInputRepresentation

Represents the input component configuration for data graphs.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `dataspace_name` | `dataSpaceName` | string |  | Name of the data space to deploy the data kit component in. Since v63.0. |
| `label` | `label` | string |  | Label of the data graph. Since v63.0. |
| `name` | `name` | string |  | Developer name of the data graph. Since v63.0. |
| `primary_dmo` | `primaryDMO` | string |  | Developer name of the primary DMO. Since v63.0. |
| `template_dev_name` | `templateDevName` | string |  | Developer name of the data graph template. Since v63.0. |

### DataKitDeployDataTransformRepresentation

Represents the input component configuration for data transforms.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `api_name` | `apiName` | string |  | API Name of the data transform. Since v63.0. |
| `component_properties` | `componentProperties` | map to string |  | Component properties for different data transform types. Since v63.0. |
| `connection` | `connection` | string |  | Specific connection utilized for DLO-based transforms. Since v63.0. |
| `currency_iso_code` | `currencyIsoCode` | string |  | Currency ISO code for data transform creation. Since v63.0. |
| `data_object_overrides` | `dataObjectOverrides` | array of [DataTransformDataObjectOverride](#datatransformdataobjectoverride) |  | Overrides for specific input and output data object names defined in the transform. Since v63.0. |
| `dataspace_name` | `dataSpaceName` | string |  | Name of the data space to deploy the data kit component in. Since v63.0. |
| `data_transform_dev_name` | `dataTransformDevName` | string |  | Developer name of the data transform. Since v63.0. |
| `data_transform_type` | `dataTransformType` | string |  | Type of data transform. Since v63.0. |
| `definition_overrides` | `definitionOverrides` | array of [DataTransformDefinitionOverride](#datatransformdefinitionoverride) |  | Specific name or label overrides for data definitions sourced from the origin organization. Since v63.0. |
| `label` | `label` | string |  | Label of the data transform. Since v63.0. |

### DataKitDeployInputRepresentation

Represents the basic input component configuration for data kit objects.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `dataspace_name` | `dataSpaceName` | string |  | Name of the data space to deploy the data kit component in. Since v63.0. |
| `label` | `label` | string |  | Label of the data kit component. Since v63.0. |
| `name` | `name` | string |  | API name of the data kit component. Since v63.0. |
| `template_name` | `templateName` | string |  | Developer name of the template. Since v63.0. |

### DataKitDeployMarketActivationRepresentation

Represents the input component configuration for market activations.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `component_name` | `componentName` | string |  | Developer name of the activation. Since v63.0. |
| `data_kit_name` | `dataKitName` | string |  | Developer name of the data kit. Since v63.0. |
| `target_display_name` | `targetDisplayName` | string |  | Label of the activation. Since v63.0. |

### DataKitDeployMarketSegmentRepresentation

Represents the input component configuration for market segments.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `data_kit_name` | `dataKitName` | string |  | Developer name of the data kit. Since v63.0. |
| `dataspace_name` | `dataSpaceName` | string |  | Name of the data space to deploy the data kit component in. Since v63.0. |
| `label` | `label` | string |  | Label of the market segment. Since v63.0. |
| `name` | `name` | string |  | Developer name of the market segment. Since v63.0. |
| `target_display_name` | `targetDisplayName` | string |  | Target label for the market segment. Since v63.0. |
| `target_segment_developer_name` | `targetSegmentDeveloperName` | string |  | Target developer name for the market segment. Since v63.0. |

### DataKitDeployPersonalizationInputRepresentation

Represents the input component configuration for personalization objects.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `api_name` | `apiName` | string |  | API name of the personalization object. Since v63.0. |
| `dataspace_name` | `dataSpaceName` | string |  | Name of the data space to deploy the data kit component in. Since v63.0. |
| `label` | `label` | string |  | Label of the personalization object. Since v63.0. |
| `template_developer_name` | `templateDeveloperName` | string |  | Developer name of the personalization object template. Since v63.0. |

### DataKitKQConfigRepresentation

Represents the input for key qualifier (KQ) configurations.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `data_source_field` | `dataSourceField` | string |  | Name of the data source object field on which the KQ field is defined. Since v63.0. |
| `data_source_object` | `dataSourceObject` | string |  | Name of the data source object on which the KQ field is defined. Since v63.0. |
| `value` | `value` | string |  | Value of the KQ field. Since v63.0. |

### DataKitUnDeployComponentDetails

The details of a component to be un-deployed from a data kit.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `name` | `name` | string | yes | Name of the component to un-deploy. Since v63.0. |
| `type` | `type` | enum(ActivationTarget, CalculatedInsight, DataAction, DataActionTarget, DataConnection, DataGraph, DataLakeObject, DataSemanticSearch, DataShare, DataStreamBundle, DataTransform, IdentityResolution, MarketSegment, MarketSegmentActivation, MlConfiguredModel, MlPredictionJob, MlRetriever, SemanticModel) | yes | Data kit component type. Since v63.0. |

### DataSpaceFilterConditionApiConfig

Represents the component configuration for a data lake object (DLO).

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `field_name` | `fieldName` | string | yes | Field name for the filter condition . **Available Version: 61.0** |
| `filter_value` | `filterValue` | string | yes | Filter value for the filter condition. **Available Version: 61.0** |
| `operator` | `operator` | string | yes | Operator for the filter condition. **Available Version: 61.0** |
| `target_object_name` | `targetObjectName` | string | yes | Target object name for the filter condition. **Available Version: 61.0** |

### DataTransformDataObjectOverride

Represents the input for data transform object overrides.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `name_of_obj_in_publishing_org` | `nameOfObjInPublishingOrg` | string |  | Name of the data transform object in the publishing org. Since v63.0. |
| `name_of_obj_in_subscriber_org` | `nameOfObjInSubscriberOrg` | string |  | Name of the data transform object in the subscriber org. Since v63.0. |

### DataTransformDefinitionOverride

Represents the input for data transform definition overrides.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `dev_name` | `devName` | string |  | Updated or replaced definition developer name. Since v63.0. |
| `label` | `label` | string |  | Updated or replaced definition label. Since v63.0. |
| `template_dev_name` | `templateDevName` | string |  | Definition developer name in the data kit template. Since v63.0. |
