<!-- Generated from overlay/d360/api/clean_rooms.yaml, edit that and run: bazel run //overlay/d360:update -->

# Clean Rooms

Part of the [CDP function reference](functions.md). Nothing here is implemented or tested against an org. Every result also has the [standard columns](functions.md#result-schema).

A clean room lets two companies compare customer data without handing it over. A provider usually holds the data, and a consumer wants insights from it. A template fixes the match keys, the allowed queries, who runs them and who sees results. Results are summarized and must cover a minimum group size, and queries are logged in a Clean Room Audit Log DMO ([Trailhead](https://trailhead.salesforce.com/content/learn/modules/data-360-clean-rooms-quick-look/get-started-with-data-360-clean-rooms)).

**Order.** No public source gives the full sequence, so this is pieced together from the spec's examples: a provider with its templates, then one specification per member that maps template attributes to that member's DMO fields, then a collaboration, which invites the other member. That member accepts with its own specification. Once the collaboration is `ACTIVE`, a member runs a query and polls the job.

**Gotchas:**

- Keys change per call. `clean_room_collaboration_create` takes developer names, which are often generated. Accepting takes record IDs.
- The spec's schemas and examples disagree. Several `array of` attributes are sent as one object, and enums are Title Case in schemas but uppercase in examples. Examples here follow the spec's request examples.
- Accept and reject only start the change, and a job's failure shows up only in `clean_room_query_job_list`.
- The spec has no update or delete for providers or collaborations, only `clean_room_collaboration_disable`.

**Evidence** is thin: the spec, its examples and one Trailhead unit. [`FamilyCatalog.java`](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/runtime/FamilyCatalog.java) has no clean room tools.

```sql
CALL cdp.clean_room_template_list ();
CALL cdp.clean_room_collaboration_create (label => 'collab21', provider_dev_name => 'X00DSB00000eLeZh2AK_ReportsPackage1763536436462', specification_dev_name => 'sampleMapping', template_name => 'Overlap', data_cloud_org_id => '00DSB00000eMue32AC');
/* The other member, in its own org */
CALL cdp.clean_room_invitation_accept (collaboration_id_or_api_name => 'collab21_00DSB00000eMue3', invitation_id => '1TOSB000000COGH4A4', specification_id => '1TIxx0000004CSOGA2');
CALL cdp.clean_room_query_run (collaboration_id_or_api_name => 'collab21_00DSB00000eMue3', query_execution_name => 'overlap_run_1', query_parameters => (threshold_count = '4'));
CALL cdp.clean_room_query_job_list (collaboration_id_or_api_name => 'collab21_00DSB00000eMue3');
```

**Functions:** [`clean_room_specification_delete`](#clean_room_specification_delete), [`clean_room_collaboration_list`](#clean_room_collaboration_list), [`clean_room_query_job_list`](#clean_room_query_job_list), [`clean_room_collaboration_result_object_list`](#clean_room_collaboration_result_object_list), [`clean_room_provider_list`](#clean_room_provider_list), [`clean_room_provider_get`](#clean_room_provider_get), [`clean_room_provider_template_list`](#clean_room_provider_template_list), [`clean_room_specification_list`](#clean_room_specification_list), [`clean_room_template_list`](#clean_room_template_list), [`clean_room_template_collaboration_list`](#clean_room_template_collaboration_list), [`clean_room_collaboration_create`](#clean_room_collaboration_create), [`clean_room_invitation_accept`](#clean_room_invitation_accept), [`clean_room_collaboration_disable`](#clean_room_collaboration_disable), [`clean_room_invitation_reject`](#clean_room_invitation_reject), [`clean_room_query_run`](#clean_room_query_run), [`clean_room_provider_create`](#clean_room_provider_create), [`clean_room_specification_create`](#clean_room_specification_create), [`clean_room_connection_test`](#clean_room_connection_test), [`clean_room_collaboration_metadata_refresh`](#clean_room_collaboration_metadata_refresh)

## clean_room_specification_delete

`DELETE /ssot/data-clean-room/specifications/{specificationIdOrApiName}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Clean-Rooms/paths/~1ssot~1data-clean-room~1specifications~1%7BspecificationIdOrApiName%7D/delete) · evidence O · changes org state

Deletes a specific clean room specification. Since v66.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `specification_id_or_api_name` | `specificationIdOrApiName` | path | string | yes | ID or API name of the clean room specification. Since v66.0. |

```sql
CALL cdp.clean_room_specification_delete (specification_id_or_api_name => 'sampleMapping');
```

**Result**

No response body (HTTP 200). One row with only the standard columns.

**Notes:** The spec lists no 400 response and doesn't say what happens to a specification that a collaboration still uses.

## clean_room_collaboration_list

`GET /ssot/data-clean-room/collaborations` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Clean-Rooms/paths/~1ssot~1data-clean-room~1collaborations/get) · evidence O · read-only

Get a list of clean room collaborations. Since v63.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `filters` | `filters` | query | string |  | Field names by which to filter results. Specify a comma-separated list of equality expressions, such as `developer_name eq extensiblepackage0123456789012`. By default, no filter is applied. Since v63.0. |
| `limit` | `limit` | query | integer |  | Maximum number of clean room collaborations to return from `1` through `20`. By default, `20` collaborations are returned. Since v63.0. |
| `offset` | `offset` | query | integer |  | Number of rows to skip before returning results. If unspecified, no rows are skipped. Since v63.0. |
| `order_by` | `orderBy` | query | string |  | Sort order for the result set. Specify a field and an order, ascending (`ASC`) or descending (`DESC`). For example, `created_date DESC`. By default, items are returned in the order they are retrieved. Since v63.0. |

```sql
CALL cdp.clean_room_collaboration_list (order_by => 'createdDate DESC', limit => 20);
```

**Result**

One row per item of `/collaborations` in the response. Other response fields go to `_meta`: `currentPageUrl`, `nextPageUrl`, `totalSize`, `limit`, `offset`. Schema `DataCleanRoomCollaborationRepresentation`.

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
| `api_key` | `apiKey` | VARCHAR | API key of the clean room. Since v63.0. |
| `dataspace` | `dataSpace` | JSON (DataSpaceRepresentation) | Data space details for the clean room. Since v66.0. |
| `description` | `description` | VARCHAR | Description of the collaboration. Since v63.0. |
| `members` | `members` | JSON (array of DataCleanRoomMemberRepresentation) | List of the collaboration members. Since v63.0. |
| `status` | `status` | VARCHAR | Status of the collaboration. Since v63.0. |
| `template_version` | `templateVersion` | JSON (DataCleanRoomTemplateRepresentation) | Information about the template version that the collaboration supports. Since v63.0. |

**Paging:** `next_page_url`.

**Notes:** This is where you find an invitation: the ID is `members[].invitationId`. In the spec's example the provider member shows `invitation_status` `RECEIVED` and the consumer shows `SENT`. The collaboration's `name` carries the consumer's org prefix, which suggests the consumer created it.

Schema enums: `status` is `Active`, `Disabled`, `Error` or `Inactive`. `members[].memberStatus` is `Active`, `Inactive` or `Mapping_Incomplete`. `members[].invitationStatus` is `Pending`, `Sent`, `Send_Error`, `Received`, `Accept_Initiated`, `Accepted`, `Accept_Error`, `Reject_Initiated`, `Rejected` or `Reject_Error`. Examples show these in uppercase.

The spec lists no filterable fields. Its `filters` example uses `developer_name`, which isn't a result column; `name` holds the developer name.

## clean_room_query_job_list

`GET /ssot/data-clean-room/collaborations/{collaborationIdOrApiName}/jobs` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Clean-Rooms/paths/~1ssot~1data-clean-room~1collaborations~1%7BcollaborationIdOrApiName%7D~1jobs/get) · evidence O · read-only

Get a list of clean room query jobs. Since v63.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `collaboration_id_or_api_name` | `collaborationIdOrApiName` | path | string | yes | ID or developer name of the clean room collaboration. Since v63.0. |
| `filters` | `filters` | query | string |  | Field names by which to filter results. Specify a comma-separated list of equality expressions, such as `developer_name eq extensiblepackage0123456789012`. By default, no filter is applied. Since v63.0. |
| `limit` | `limit` | query | integer |  | Maximum number of clean room query jobs to return from `1` through `20`. By default, `20` query jobs are returned. Since v63.0. |
| `offset` | `offset` | query | integer |  | Number of rows to skip before returning results. If unspecified, no rows are skipped. Since v63.0. |
| `order_by` | `orderBy` | query | string |  | Sort order for the result set. Specify a field and an order, ascending (`ASC`) or descending (`DESC`). For example, `created_date DESC`. By default, items are returned in the order they are retrieved. Since v63.0. |

```sql
CALL cdp.clean_room_query_job_list (collaboration_id_or_api_name => 'collab21_00DSB00000eMue3', limit => 20);
```

**Result**

One row per item of `/queryJobs` in the response. Other response fields go to `_meta`: `currentPageUrl`, `nextPageUrl`, `totalSize`, `limit`, `offset`. Schema `DataCleanRoomQueryJobRepresentation`.

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
| `completed_date` | `completedDate` | VARCHAR | Date and time the query run job was completed. Since v63.0. |
| `error_code` | `errorCode` | VARCHAR | Error code (if any) caused by a query failure. Since v63.0. |
| `error_message` | `errorMessage` | VARCHAR | Error message (if any) that specifies the query failure reason. Since v63.0. |
| `executed_by` | `executedBy` | VARCHAR | Name of the user who executed the query job. Since v63.0. |
| `output_dmo_name` | `outputDMOName` | VARCHAR | Developer name of the resulting data model object (DMO) for Activation use cases. For other use cases, this value is the name of the resulting report. Since v63.0. |
| `query_param` | `queryParam` | JSON | Map of query parameters and their values. Since v63.0. |
| `report_id` | `reportId` | VARCHAR | ID of the report associated with the output DMO. Since v63.0. |
| `report_name` | `reportName` | VARCHAR | Name of the report associated with the output DMO. Since v63.0. |
| `segment_names` | `segmentNames` | JSON | List of segment names. Since v63.0. |
| `status` | `status` | VARCHAR | Status of the query job. Since v63.0. |
| `triggered_date` | `triggeredDate` | VARCHAR | Date and time the query run job was started. Since v63.0. |

**Paging:** `next_page_url`.

**Notes:** The spec has no call that gets one job, so this list is the only way to poll. `id` is a UUID in the spec's examples, not the 18-character ID the column description says.

The schema's `status` values are `Created`, `Running`, `Success` and `Failed`. Examples show them in uppercase.

A job can fail on setup rather than on its query. The spec's example shows `FAILED` with `error_code` `DCR_INVALID_STATE_ERROR` and `CONSUMER member 1TPSB0000000VYU has no specification ID`.

An unknown collaboration may not give a clean error. The spec lists both a 400 (`Failed to find clean room with idOrDevName`) and a 500 (`Cannot invoke ... because dataCleanRoom is null`).

## clean_room_collaboration_result_object_list

`GET /ssot/data-clean-room/collaborations/{collaborationIdOrApiName}/result-data-objects` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Clean-Rooms/paths/~1ssot~1data-clean-room~1collaborations~1%7BcollaborationIdOrApiName%7D~1result-data-objects/get) · evidence O · read-only

Retrieve a list of all data model objects (DMOs) created by a specific clean room collaboration. Since v66.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `collaboration_id_or_api_name` | `collaborationIdOrApiName` | path | string | yes | ID or developer name of the clean room collaboration. Since v66.0. |

```sql
CALL cdp.clean_room_collaboration_result_object_list (collaboration_id_or_api_name => 'collab21_00DSB00000eMue3');
```

**Result**

One row per item of `/collaborationResultDataObjects` in the response. Schema `DataCleanRoomCollaborationResultDataObjectRepresentation`.

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
| `status` | `status` | VARCHAR | Status of the DMO. Since v66.0. |

**Notes:** The spec's example returns names ending in `__dlm`, such as `INDV_BOOSTED1__dlm`, with `status` `active` in lowercase. The schema's values are `Active`, `Error`, `Inactive` and `Processing`.

The spec lists a 400 for this read when the member's invitation `is not in a valid state to execute query`.

## clean_room_provider_list

`GET /ssot/data-clean-room/providers` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Clean-Rooms/paths/~1ssot~1data-clean-room~1providers/get) · evidence O · read-only

Get a list of clean room providers. Since v63.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `filters` | `filters` | query | string |  | Field names by which to filter results. Specify a comma-separated list of equality expressions, such as `developer_name eq extensiblepackage0123456789012`. By default, no filter is applied. Since v63.0. |
| `limit` | `limit` | query | integer |  | Maximum number of clean room providers to return from `1` through `20`. By default, `20` providers are returned. Since v63.0. |
| `offset` | `offset` | query | integer |  | Number of rows to skip before returning results. If unspecified, no rows are skipped. Since v63.0. |
| `order_by` | `orderBy` | query | string |  | Sort order for the result set. Specify a field and an order, ascending (`ASC`) or descending (`DESC`). For example, `created_date DESC`. By default, items are returned in the order they are retrieved. Since v63.0. |

```sql
CALL cdp.clean_room_provider_list ();
```

**Result**

One row per item of `/providers` in the response. Other response fields go to `_meta`: `currentPageUrl`, `nextPageUrl`, `totalSize`, `limit`, `offset`. Schema `DataCleanRoomProviderRepresentation`.

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
| `creation_type` | `creationType` | VARCHAR | Type of provider creation. Since v64.0. |
| `data_cloud_org_id` | `dataCloudOrgId` | VARCHAR | Core org ID where Data 360 clean room is enabled. Since v63.0. |
| `description` | `description` | VARCHAR | Description of the provider. Since v63.0. |
| `domain_url` | `domainUrl` | VARCHAR | Domain URL of the provider. Since v63.0. |
| `logo_url` | `logoUrl` | VARCHAR | URL of the provider logo. Since v63.0. |
| `off_core_tenant_id` | `offCoreTenantId` | VARCHAR | Off-core tenant ID of the provider. Since v63.0. |
| `package_type` | `packageType` | VARCHAR | Type of package. Since v66.0. |
| `provider_data_source` | `providerDataSource` | VARCHAR | Source of the provider's data. Since v66.0. |
| `provider_name` | `providerName` | VARCHAR | Name of the provider. Since v64.0. |
| `source` | `source` | VARCHAR | Source type of the provider. Since v64.0. |
| `source_configuration` | `sourceConfiguration` | JSON (DataCleanRoomProviderSourceConfigRepresentation) | Other source-related configurations for the provider. The endpoint returns the source config output object that corresponds to the type of provider. For example, the Data Clean Room AWS Source Config Output is returned for the `AWS` type. Since v64.0. |
| `template_names` | `templateNames` | JSON | List of template names. Since v63.0. |
| `use_case_type_config` | `useCaseTypeConfig` | JSON (DataCleanRoomUseCaseTypeRepresentation) | Configuration for the type of use case template. Since v65.0. |

**Paging:** `next_page_url`.

**Notes:** `name` is what `clean_room_collaboration_create` needs as `provider_dev_name`. When you don't set it, the spec's examples show a generated value such as `X00DSB00000eLeZh2AK_ReportsPackage1763536436462`.

`template_names` can be empty: all three of the spec's `clean_room_provider_create` response examples return `[]`, including those sent with `template_json`. Use `clean_room_provider_template_list` to see templates.

Schema enums: `creation_type` is `Packaged` or `Peer`, `package_type` is `DataCollaboration` or `IdEnrichment`, `provider_data_source` is `Snowflake`, and `source` is `AWS` or `DATA_CLOUD`.

## clean_room_provider_get

`GET /ssot/data-clean-room/providers/{providerIdOrName}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Clean-Rooms/paths/~1ssot~1data-clean-room~1providers~1%7BproviderIdOrName%7D/get) · evidence O · read-only

Get a clean room provider. Since v63.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `provider_id_or_name` | `providerIdOrName` | path | string | yes | ID or developer name of the clean room provider. Since v63.0. |

```sql
CALL cdp.clean_room_provider_get (provider_id_or_name => 'X00DSB00000eLeZh2AK_ReportsPackage1763536436462');
```

**Result**

One row. Schema `DataCleanRoomProviderRepresentation`.

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
| `creation_type` | `creationType` | VARCHAR | Type of provider creation. Since v64.0. |
| `data_cloud_org_id` | `dataCloudOrgId` | VARCHAR | Core org ID where Data 360 clean room is enabled. Since v63.0. |
| `description` | `description` | VARCHAR | Description of the provider. Since v63.0. |
| `domain_url` | `domainUrl` | VARCHAR | Domain URL of the provider. Since v63.0. |
| `logo_url` | `logoUrl` | VARCHAR | URL of the provider logo. Since v63.0. |
| `off_core_tenant_id` | `offCoreTenantId` | VARCHAR | Off-core tenant ID of the provider. Since v63.0. |
| `package_type` | `packageType` | VARCHAR | Type of package. Since v66.0. |
| `provider_data_source` | `providerDataSource` | VARCHAR | Source of the provider's data. Since v66.0. |
| `provider_name` | `providerName` | VARCHAR | Name of the provider. Since v64.0. |
| `source` | `source` | VARCHAR | Source type of the provider. Since v64.0. |
| `source_configuration` | `sourceConfiguration` | JSON (DataCleanRoomProviderSourceConfigRepresentation) | Other source-related configurations for the provider. The endpoint returns the source config output object that corresponds to the type of provider. For example, the Data Clean Room AWS Source Config Output is returned for the `AWS` type. Since v64.0. |
| `template_names` | `templateNames` | JSON | List of template names. Since v63.0. |
| `use_case_type_config` | `useCaseTypeConfig` | JSON (DataCleanRoomUseCaseTypeRepresentation) | Configuration for the type of use case template. Since v65.0. |

## clean_room_provider_template_list

`GET /ssot/data-clean-room/providers/{providerIdOrName}/templates` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Clean-Rooms/paths/~1ssot~1data-clean-room~1providers~1%7BproviderIdOrName%7D~1templates/get) · evidence O · read-only

Get a list of all templates associated with a clean room provider. Since v63.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `provider_id_or_name` | `providerIdOrName` | path | string | yes | ID or developer name of the clean room provider. Since v63.0. |
| `filters` | `filters` | query | string |  | Field names by which to filter results. Specify a comma-separated list of equality expressions, such as `developer_name eq extensiblepackage0123456789012`. By default, no filter is applied. Since v63.0. |
| `limit` | `limit` | query | integer |  | Maximum number of clean room templates to return from `1` through `20`. By default, `20` templates are returned. Since v63.0. |
| `offset` | `offset` | query | integer |  | Number of rows to skip before returning results. If unspecified, no rows are skipped. Since v63.0. |
| `order_by` | `orderBy` | query | string |  | Sort order for the result set. Specify a field and an order, ascending (`ASC`) or descending (`DESC`). For example, `created_date DESC`. By default, items are returned in the order they are retrieved. Since v63.0. |

```sql
CALL cdp.clean_room_provider_template_list (provider_id_or_name => 'X00DSB00000eLeZh2AK_ReportsPackage1763536436462');
```

**Result**

One row per item of `/templates` in the response. Other response fields go to `_meta`: `currentPageUrl`, `nextPageUrl`, `totalSize`, `limit`, `offset`. Schema `DataCleanRoomTemplateRepresentation`.

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
| `configuration` | `configuration` | JSON (UseCaseTemplateConfigRepresentation) | Configuration of the use case template. Since v63.0. |
| `description` | `description` | VARCHAR | Description of the use case template. Since v63.0. |
| `metadata_configuration` | `metadataConfiguration` | JSON (DataCleanRoomMetadataConfigurationRepresentation) | Configuration metadata containing member-specific settings and use-case-dependent operational parameters. Since v66.0. |
| `provider_id` | `providerId` | VARCHAR | Provider ID that the template is associated with. Since v63.0. |
| `query_template` | `queryTemplate` | JSON | Defined query template for the use case template. Since v63.0. |
| `template_type` | `templateType` | VARCHAR | Type of use case template. Since v63.0. |
| `template_version` | `templateVersion` | VARCHAR | Version of the use case template. Since v63.0. |
| `use_case_type` | `useCaseType` | VARCHAR | Type of use case for the template. Since v63.0. |

**Paging:** `next_page_url`.

**Notes:** Same row shape and traps as [`clean_room_template_list`](#clean_room_template_list).

## clean_room_specification_list

`GET /ssot/data-clean-room/specifications` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Clean-Rooms/paths/~1ssot~1data-clean-room~1specifications/get) · evidence O · read-only

Get a list of all clean room specifications. Since v63.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `filters` | `filters` | query | string |  | Field names by which to filter results. Specify a comma-separated list of equality expressions, such as `developer_name eq extensiblepackage0123456789012`. By default, no filter is applied. Since v63.0. |
| `limit` | `limit` | query | integer |  | Maximum number of clean room specifications to return from `1` through `20`. By default, `20` specifications are returned. Since v63.0. |
| `offset` | `offset` | query | integer |  | Number of records to skip before returning results. If unspecified, no rows are skipped. Since v63.0. |
| `order_by` | `orderBy` | query | string |  | Sort order for the result set. Specify a field and an order, ascending (`ASC`) or descending (`DESC`). For example, `created_date DESC`. By default, items are returned in the order they are retrieved. Since v63.0. |

```sql
CALL cdp.clean_room_specification_list ();
```

**Result**

One row per item of `/cleanroomSpecifications` in the response. Other response fields go to `_meta`: `currentPageUrl`, `nextPageUrl`, `totalSize`, `limit`, `offset`. Schema `DataCleanRoomDataSpecificationRepresentation`.

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
| `data_mapping` | `dataMapping` | JSON (UseCaseTemplateMappingRepresentation) | Data mapping details for a clean room member in JSON format. Since v63.0. |
| `dataspace` | `dataSpace` | JSON (DataSpaceRepresentation) | Data space details for the clean room. Since v66.0. |
| `description` | `description` | VARCHAR | Description of the specification. Since v63.0. |
| `member_type` | `memberType` | VARCHAR | Type of clean room member. Since v63.0. |
| `owner_org_id` | `ownerOrgId` | VARCHAR | Data 360 org ID where the mapping is created. Since v63.0. |
| `status` | `status` | VARCHAR | Status of the specification. Since v63.0. |
| `template_version` | `templateVersion` | JSON (DataCleanRoomTemplateRepresentation) | Details of the use case template version for which the mapping is provided. Since v63.0. |
| `dataspace_name` | `dataSpaceName` | VARCHAR | Not in the spec schema: from the spec's examples. |

**Paging:** `next_page_url`.

**Notes:** `id` is what `clean_room_invitation_accept` needs as `specification_id`, and `name` is what `clean_room_collaboration_create` needs as `specification_dev_name`.

Schema enums: `status` is `Active`, `Error`, `Inactive` or `Processing`, and `member_type` is `Consumer` or `Provider`.

## clean_room_template_list

`GET /ssot/data-clean-room/templates` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Clean-Rooms/paths/~1ssot~1data-clean-room~1templates/get) · evidence O · read-only

Get a list of all clean room templates. Since v63.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `filters` | `filters` | query | string |  | Field names by which to filter results. Specify a comma-separated list of equality expressions, such as `developer_name eq extensiblepackage0123456789012`. By default, no filter is applied. Since v63.0. |
| `limit` | `limit` | query | integer |  | Maximum number of clean room templates to return from `1` through `20`. By default, `20` templates are returned. Since v63.0. |
| `offset` | `offset` | query | integer |  | Number of records to skip before returning results. If unspecified, no rows are skipped. Since v63.0. |
| `order_by` | `orderBy` | query | string |  | Sort order for the result set. Specify a field and an order, ascending (`ASC`) or descending (`DESC`). For example, `created_date DESC`. By default, items are returned in the order they are retrieved. Since v63.0. |

```sql
CALL cdp.clean_room_template_list ();
```

**Result**

One row per item of `/templates` in the response. Other response fields go to `_meta`: `currentPageUrl`, `nextPageUrl`, `totalSize`, `limit`, `offset`. Schema `DataCleanRoomTemplateRepresentation`.

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
| `configuration` | `configuration` | JSON (UseCaseTemplateConfigRepresentation) | Configuration of the use case template. Since v63.0. |
| `description` | `description` | VARCHAR | Description of the use case template. Since v63.0. |
| `metadata_configuration` | `metadataConfiguration` | JSON (DataCleanRoomMetadataConfigurationRepresentation) | Configuration metadata containing member-specific settings and use-case-dependent operational parameters. Since v66.0. |
| `provider_id` | `providerId` | VARCHAR | Provider ID that the template is associated with. Since v63.0. |
| `query_template` | `queryTemplate` | JSON | Defined query template for the use case template. Since v63.0. |
| `template_type` | `templateType` | VARCHAR | Type of use case template. Since v63.0. |
| `template_version` | `templateVersion` | VARCHAR | Version of the use case template. Since v63.0. |
| `use_case_type` | `useCaseType` | VARCHAR | Type of use case for the template. Since v63.0. |

**Paging:** `next_page_url`.

**Notes:** The spec's examples suggest `name` feeds `template_name` and `id` feeds `template_version_id`. Each member's required attributes are in `configuration.memberConfigs[].attributeConfigs`, and their `id` values feed `clean_room_specification_create`.

`metadata_configuration.memberConfig[]` says who can do what: `canTriggerQuery`, `canReceiveResult`, `contributesData` and `paysForQueries`.

`query_template` needs care. The spec's example holds `{"template": "SELECT ..."}`, and the SQL in both of its templates has `&quot;` HTML entities. Salesforce's `sf-pi` [overrides this response](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/registry/connect-openapi-overrides.json), citing live results with "additional enum values and scalar query-template fields not represented by the published schema". Don't rely on the shape of `configuration` or `query_template`, or on the listed enums.

## clean_room_template_collaboration_list

`GET /ssot/data-clean-room/templates/{useCaseTemplateType}/collaborations` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Clean-Rooms/paths/~1ssot~1data-clean-room~1templates~1%7BuseCaseTemplateType%7D~1collaborations/get) · evidence O · read-only

Retrieve a paginated list of all collaborations for a specific type of use case template. Since v66.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `use_case_template_type` | `useCaseTemplateType` | path | string | yes | Type of use case template. Since v66.0. |
| `filters` | `filters` | query | string |  | Field names by which to filter results. Specify a comma-separated list of equality expressions, such as `developer_name eq extensiblepackage0123456789012`. By default, no filter is applied. Since v66.0. |
| `limit` | `limit` | query | integer |  | Maximum number of clean room templates to return from `1` through `20`. By default, `20` collaborations are returned. Since v66.0. |
| `offset` | `offset` | query | integer |  | Number of records to skip before returning results. If unspecified, no rows are skipped. Since v66.0. |
| `order_by` | `orderBy` | query | string |  | Sort order for the result set. Specify a field and an order, ascending (`ASC`) or descending (`DESC`). For example, `created_date DESC`. By default, items are returned in the order they are retrieved. Since v66.0. |

```sql
CALL cdp.clean_room_template_collaboration_list (use_case_template_type => 'Overlap');
```

**Result**

One row per item of `/collaborations` in the response. Other response fields go to `_meta`: `currentPageUrl`, `nextPageUrl`, `totalSize`, `limit`, `offset`. Schema `DataCleanRoomCollaborationForUseCaseTypeRepresentation`.

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
| `dataspace` | `dataSpace` | JSON (DataSpaceRepresentation) | Name of the data space. Since v66.0. |
| `description` | `description` | VARCHAR | Description of the clean room. Since v66.0. |
| `members` | `members` | JSON (array of DataCleanRoomMemberForUseCaseTypeRepresentation) | List of collaboration members. Since v66.0. |
| `output_object_to_dev_name` | `outputObjectToDevName` | JSON | Map of output object names to their developer names. Since v66.0. |
| `status` | `status` | VARCHAR | Status of the clean room. Since v66.0. |
| `template_version` | `templateVersion` | JSON (DataCleanRoomTemplateRepresentation) | Version information of the template from which the clean room was created. Since v66.0. |

**Paging:** `next_page_url`.

**Notes:** The spec gives no values for `use_case_template_type`. Its schemas have `Custom` and `Overlap` on templates, and `Activation`, `Custom`, `MatchBoost` and `Overlap` on use case configuration.

The spec's only response example doesn't match its schema: it shows one template with `use_case_type` `MATCH_BOOST`, not a `collaborations` list. The result table follows the schema.

## clean_room_collaboration_create

`POST /ssot/data-clean-room/collaborations` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Clean-Rooms/paths/~1ssot~1data-clean-room~1collaborations/post) · evidence O · changes org state

Create a new clean room collaboration. Since v63.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `dataspace_name` | `dataSpaceName` | body | string |  | Name of the data space where the collaboration is to be created. Since v63.0. |
| `description` | `description` | body | string |  | Description of the collaboration. Since v59.0. |
| `label` | `label` | body | string | yes | Label of the clean room. Since v63.0. |
| `name` | `name` | body | string |  | API name of the collaboration. When omitted, the spec's example returns a generated name, such as `collab21_00DSB00000eMue3`. Since v59.0. |
| `api_key` | `apiKey` | body | string |  | API key of the clean room. Since v63.0. |
| `data_cloud_org_id` | `dataCloudOrgId` | body | string | yes | Core org ID where the Data 360 clean room is enabled. Since v63.0. |
| `provider_dev_name` | `providerDevName` | body | string | yes | Developer name of the provider definition for the clean room. Since v63.0. |
| `specification_dev_name` | `specificationDevName` | body | string | yes | Developer Name of the clean room specification. Since v63.0. |
| `template_name` | `templateName` | body | string | yes | Developer name of the use case template that the collaboration is to support. Since v63.0. |
| `template_version_id` | `templateVersionId` | body | string |  | Template version ID that the collaboration is to support. Since v63.0. |

```sql
CALL cdp.clean_room_collaboration_create (label => 'collab21', provider_dev_name => 'X00Dxx00nZbkbQyW_TestProviderName1746172733791', template_version_id => '00Dxx00nZbkbBjk8ef', template_name => 'OVERLAP', specification_dev_name => 'X00Dxx00MhXCjA7M_null1746504015424', data_cloud_org_id => '00Dxx00nZbkbQgmEIE');
```

**Result**

One row. Schema `DataCleanRoomCollaborationRepresentation`.

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
| `api_key` | `apiKey` | VARCHAR | API key of the clean room. Since v63.0. |
| `dataspace` | `dataSpace` | JSON (DataSpaceRepresentation) | Data space details for the clean room. Since v66.0. |
| `description` | `description` | VARCHAR | Description of the collaboration. Since v63.0. |
| `members` | `members` | JSON (array of DataCleanRoomMemberRepresentation) | List of the collaboration members. Since v63.0. |
| `status` | `status` | VARCHAR | Status of the collaboration. Since v63.0. |
| `template_version` | `templateVersion` | JSON (DataCleanRoomTemplateRepresentation) | Information about the template version that the collaboration supports. Since v63.0. |

**Notes:** In the spec's example the new collaboration is `INACTIVE`. The provider member has `invitation_status` `RECEIVED` and `member_status` `INACTIVE`, and `clean_room_query_run` needs an `ACTIVE` collaboration.

`provider_dev_name` and `specification_dev_name` are the `name` values from `clean_room_provider_list` and `clean_room_specification_list`, not IDs. The spec lists a 500 for `Multiple records found for the given provider_dev_name`.

The spec's example sends `template_name` `OVERLAP`, while its template list example has `Overlap`. The spec doesn't say what `api_key` is for.

The spec documents no idempotency, and has no delete for collaborations. Check `clean_room_collaboration_list` before retrying a failed call.

## clean_room_invitation_accept

`POST /ssot/data-clean-room/collaborations/{collaborationIdOrApiName}/actions/accept-invitation` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Clean-Rooms/paths/~1ssot~1data-clean-room~1collaborations~1%7BcollaborationIdOrApiName%7D~1actions~1accept-invitation/post) · evidence O · changes org state

Accept an invitation for a clean room collaboration. Since v63.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `collaboration_id_or_api_name` | `collaborationIdOrApiName` | path | string | yes | ID or developer name of the clean room collaboration. Since v63.0. |
| `dataspace_name` | `dataSpaceName` | body | string |  | Name of the data space in which to accept the invitation. Since v66.0. |
| `invitation_id` | `invitationId` | body | string | yes | Record ID of of the collaboration invitation. Since v63.0. |
| `output_configuration` | `outputConfiguration` | body | [DataCleanRoomOutputConfiguration](#datacleanroomoutputconfigurationrepresentation) |  | Configuration details for the output. Since v66.0. |
| `specification_id` | `specificationId` | body | string | yes | Record ID of the clean room specification. Since v63.0. |

```sql
CALL cdp.clean_room_invitation_accept (
  collaboration_id_or_api_name => 'collab21_00DSB00000eMue3',
  invitation_id => '1TOxx0000004CQoGAM',
  specification_id => '1TIxx0000004CH6GAM',
  output_configuration => (
    output_destination_type = 'EXTERNAL_CONNECTOR',
    external_id = 'ext12345678',
    connection_attributes = (connector_type = 'CleanroomSnowflake', account_url = 'https://your-account.snowflakecomputing.com/', warehouse_name = 'COMPUTE_WH', database_name = 'TEST_DB', schema_name = 'TEST_SCHEMA', service_user = 'CLEAN_ROOM_USER')
  )
);
```

**Result**

One row. Schema `DataCleanRoomMemberRepresentation`.

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
| `invitation_id` | `invitationId` | VARCHAR | ID of the invitation that enabled the member to join the collaboration. Since v63.0. |
| `invitation_status` | `invitationStatus` | VARCHAR | Status of the invitation. Since v63.0. |
| `member_configs` | `memberConfigs` | JSON (array of DataCleanRoomMemberConfigRepresentation) | List of member configurations. Since v66.0. |
| `member_data_cloud_region` | `memberDataCloudRegion` | VARCHAR | Region of the member org. Since v66.0. |
| `member_domain_url` | `memberDomainUrl` | VARCHAR | Domain URL of the member org. Since v66.0. |
| `member_id` | `memberId` | VARCHAR | ID of the collaboration member. Since v63.0. |
| `member_org_id` | `memberOrgId` | VARCHAR | ID of the collaboration member's org. Since v63.0. |
| `member_status` | `memberStatus` | VARCHAR | Status of the collaboration member. Since v63.0. |
| `member_type` | `memberType` | VARCHAR | Type of collaboration member. Since v63.0. |
| `provider_id` | `providerId` | VARCHAR | Reference key of the provider record of the clean room. Since v63.0. |
| `specification_id` | `specificationId` | VARCHAR | Reference key of the data specification record of the clean room. Since v63.0. |

**Done when:** `clean_room_collaboration_list.members[].invitationStatus` for this invitation. The call returns `ACCEPT_INITIATED` in the spec's example. The schema's enum implies `Accepted` on success and `Accept_Error` on failure. Before running queries, also wait for `clean_room_collaboration_list.status` = `Active`.

**Notes:** `invitation_id` comes from `clean_room_collaboration_list.members[].invitationId`, and `specification_id` is the `id` of your own specification from `clean_room_specification_list`. Both are record IDs, unlike `clean_room_collaboration_create`.

When `output_configuration` is needed isn't stated. The schema's `output_destination_type` values are `ExternalConnector` and `Lakehouse`, while the spec's examples send `EXTERNAL_CONNECTOR`. `connection_attributes` depends on `connector_type`:

- `CleanroomSnowflake`: `account_url`, `warehouse_name`, `database_name`, `schema_name`, `service_user`
- `CleanroomAwsS3`: `role_arn`, `s3_url`

An invitation in the wrong state returns a 400: `Data clean room member invitation is not in a valid state to accept`.

## clean_room_collaboration_disable

`POST /ssot/data-clean-room/collaborations/{collaborationIdOrApiName}/actions/disable` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Clean-Rooms/paths/~1ssot~1data-clean-room~1collaborations~1%7BcollaborationIdOrApiName%7D~1actions~1disable/post) · evidence O · changes org state

Disable a clean room collaboration. Since v66.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `collaboration_id_or_api_name` | `collaborationIdOrApiName` | path | string | yes | ID or developer name of the clean room collaboration. Since v66.0. |

```sql
CALL cdp.clean_room_collaboration_disable (collaboration_id_or_api_name => 'collab21_00DSB00000eMue3');
```

**Result**

One row. Schema `DataCleanRoomCollaborationRepresentation`.

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
| `api_key` | `apiKey` | VARCHAR | API key of the clean room. Since v63.0. |
| `dataspace` | `dataSpace` | JSON (DataSpaceRepresentation) | Data space details for the clean room. Since v66.0. |
| `description` | `description` | VARCHAR | Description of the collaboration. Since v63.0. |
| `members` | `members` | JSON (array of DataCleanRoomMemberRepresentation) | List of the collaboration members. Since v63.0. |
| `status` | `status` | VARCHAR | Status of the collaboration. Since v63.0. |
| `template_version` | `templateVersion` | JSON (DataCleanRoomTemplateRepresentation) | Information about the template version that the collaboration supports. Since v63.0. |

**Notes:** The spec has no enable call, so treat this as one-way. The spec's example returns `status` `DISABLED`, and shows `dataspace` as a string where the schema has an object.

## clean_room_invitation_reject

`POST /ssot/data-clean-room/collaborations/{collaborationIdOrApiName}/actions/reject-invitation` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Clean-Rooms/paths/~1ssot~1data-clean-room~1collaborations~1%7BcollaborationIdOrApiName%7D~1actions~1reject-invitation/post) · evidence O · changes org state

Reject an invitation for a clean room collaboration. Since v63.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `collaboration_id_or_api_name` | `collaborationIdOrApiName` | path | string | yes | ID or developer name of the clean room collaboration. Since v63.0. |
| `invitation_id` | `invitationId` | body | string | yes | Record ID of the collaboration invitation. Since v63.0. |

```sql
CALL cdp.clean_room_invitation_reject (collaboration_id_or_api_name => 'collab21_00DSB00000eMue3', invitation_id => '1TOxx0000004D3UGAU');
```

**Result**

One row. Schema `DataCleanRoomMemberRepresentation`.

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
| `invitation_id` | `invitationId` | VARCHAR | ID of the invitation that enabled the member to join the collaboration. Since v63.0. |
| `invitation_status` | `invitationStatus` | VARCHAR | Status of the invitation. Since v63.0. |
| `member_configs` | `memberConfigs` | JSON (array of DataCleanRoomMemberConfigRepresentation) | List of member configurations. Since v66.0. |
| `member_data_cloud_region` | `memberDataCloudRegion` | VARCHAR | Region of the member org. Since v66.0. |
| `member_domain_url` | `memberDomainUrl` | VARCHAR | Domain URL of the member org. Since v66.0. |
| `member_id` | `memberId` | VARCHAR | ID of the collaboration member. Since v63.0. |
| `member_org_id` | `memberOrgId` | VARCHAR | ID of the collaboration member's org. Since v63.0. |
| `member_status` | `memberStatus` | VARCHAR | Status of the collaboration member. Since v63.0. |
| `member_type` | `memberType` | VARCHAR | Type of collaboration member. Since v63.0. |
| `provider_id` | `providerId` | VARCHAR | Reference key of the provider record of the clean room. Since v63.0. |
| `specification_id` | `specificationId` | VARCHAR | Reference key of the data specification record of the clean room. Since v63.0. |

**Done when:** `clean_room_collaboration_list.members[].invitationStatus` for this invitation. The call returns `REJECT_INITIATED` in the spec's example. The schema's enum implies `Rejected` on success and `Reject_Error` on failure.

**Notes:** The spec's listed 400 for an invalid state says `not in a valid state to accept`, even on this reject call. The spec has no call to reopen a rejected invitation.

## clean_room_query_run

`POST /ssot/data-clean-room/collaborations/{collaborationIdOrApiName}/actions/run` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Clean-Rooms/paths/~1ssot~1data-clean-room~1collaborations~1%7BcollaborationIdOrApiName%7D~1actions~1run/post) · evidence O · changes org state

Run a query job on a clean room. You can start a query run only if the collaboration status is `ACTIVE`. Since v63.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `collaboration_id_or_api_name` | `collaborationIdOrApiName` | path | string | yes | ID or developer name of the clean room collaboration. Since v63.0. |
| `query_execution_name` | `queryExecutionName` | body | string | yes | Name of the query that is to be executed. Since v63.0. |
| `query_parameters` | `queryParameters` | body | map to string |  | Map of query parameters and their values. Since v63.0. |
| `segment_ids` | `segmentIds` | body | array of string |  | Segment IDs on which the query is to be executed. Since v63.0. |

```sql
CALL cdp.clean_room_query_run (collaboration_id_or_api_name => 'collab21_00DSB00000eMue3', query_execution_name => 'rawtalks1', query_parameters => (threshold_count = '4'));
```

**Result**

One row. Schema `DataCleanRoomQueryJobRepresentation`.

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
| `completed_date` | `completedDate` | VARCHAR | Date and time the query run job was completed. Since v63.0. |
| `error_code` | `errorCode` | VARCHAR | Error code (if any) caused by a query failure. Since v63.0. |
| `error_message` | `errorMessage` | VARCHAR | Error message (if any) that specifies the query failure reason. Since v63.0. |
| `executed_by` | `executedBy` | VARCHAR | Name of the user who executed the query job. Since v63.0. |
| `output_dmo_name` | `outputDMOName` | VARCHAR | Developer name of the resulting data model object (DMO) for Activation use cases. For other use cases, this value is the name of the resulting report. Since v63.0. |
| `query_param` | `queryParam` | JSON | Map of query parameters and their values. Since v63.0. |
| `report_id` | `reportId` | VARCHAR | ID of the report associated with the output DMO. Since v63.0. |
| `report_name` | `reportName` | VARCHAR | Name of the report associated with the output DMO. Since v63.0. |
| `segment_names` | `segmentNames` | JSON | List of segment names. Since v63.0. |
| `status` | `status` | VARCHAR | Status of the query job. Since v63.0. |
| `triggered_date` | `triggeredDate` | VARCHAR | Date and time the query run job was started. Since v63.0. |

**Done when:** `clean_room_query_job_list.status` for the row whose `id` matches this result's `id`: `Success` or `Failed` in the schema, uppercase in examples. Failure details are in `error_code` and `error_message`.

**Notes:** The spec's examples show two forms. The AWS flow sends `query_parameters`, and the native flow sends `segment_ids` such as `1sgRO00000000FB`. Parameter values are strings even when the template declares `INTEGER`.

`query_execution_name` is unclear. The spec calls it the name of the query, but its examples send `rawtalks1` and `queryJob2`, which come back as the job's `label` and match no template query shown. How a template with several queries picks one isn't documented.

The 200 response only means the job was created, with `status` `CREATED`. A setup problem can still end in `FAILED` later. Who may run a query and who pays is in the template's `metadata_configuration.memberConfig[]`, as `canTriggerQuery` and `paysForQueries`.

The spec documents no idempotency, so a retry may start a second job. Check `clean_room_query_job_list` first.

## clean_room_provider_create

`POST /ssot/data-clean-room/providers` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Clean-Rooms/paths/~1ssot~1data-clean-room~1providers/post) · evidence O · changes org state

Registers a provider definition: where its data lives and which templates it offers. Since v63.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `dataspace_name` | `dataSpaceName` | body | string |  | Name of the data space. If unspecified, the `default` data space is used. Since v59.0. |
| `description` | `description` | body | string |  | Description of the provider. The schema doesn't require it, but the spec lists `Data clean room provider description cannot be empty` as a 400. Since v59.0. |
| `label` | `label` | body | string | yes | Label of the provider definition. Since v63.0. |
| `name` | `name` | body | string |  | API name of the provider. The spec's examples omit it and get a generated name. Since v59.0. |
| `data_cloud_org_id` | `dataCloudOrgId` | body | string |  | Core org ID where the Data 360 clean room is enabled. Since v63.0. |
| `domain_url` | `domainUrl` | body | string |  | Domain URL of the provider. Since v63.0. |
| `logo_url` | `logoUrl` | body | string |  | URL path to the provider logo. Since v63.0. |
| `off_core_tenant_id` | `offCoreTenantId` | body | string |  | Off core tenant ID of the provider. Since v63.0. |
| `package_type` | `packageType` | body | enum(DataCollaboration, IdEnrichment) |  | Type of provider package. Since v66.0. |
| `provider_data_source` | `providerDataSource` | body | enum(Snowflake) |  | Source of the provider data. Since v66.0. |
| `provider_name` | `providerName` | body | string |  | Name of the provider. Since v63.0. |
| `source` | `source` | body | enum(AWS, DATA_CLOUD) |  | Source of the provider. Since v63.0. |
| `source_configuration` | `sourceConfiguration` | body | [DataCleanRoomProviderSourceConfigInput](#datacleanroomprovidersourceconfiginputrepresentation) |  | Other source-related configurations for the provider. Use the source config input object that corresponds to the type of provider. For example, use the Data Clean Room AWS Source Config Input for the `AWS` type. Since v63.0. |
| `template_json` | `templateJson` | body | [CustomUseCaseTemplateInput](#customusecasetemplateinputrepresentation) |  | Custom JSON template configuration for extensible template flow. Since v63.0. |
| `template_names` | `templateNames` | body | array of string |  | List of use case templates that the provider supports. Since v63.0. |
| `template_type` | `templateType` | body | enum(Custom, Salesforce) |  | Type of use case template. Since v63.0. |
| `use_case_type_config` | `useCaseTypeConfig` | body | array of [DataCleanRoomUseCaseTypeInput](#datacleanroomusecasetypeinputrepresentation) |  | Configuration for the type of use case template. Since v63.0. |

```sql
CALL cdp.clean_room_provider_create (
  label => 'package_AWS',
  description => 'AWS',
  provider_name => 'package_AWS',
  source => 'AWS',
  template_type => 'CUSTOM',
  source_configuration => (type = 'AWS', account_id = '041291292938', supported_regions = ['us-east-1', 'us-west-2']),
  template_json => (
    name = 'Example1',
    description = 'Example of Clean Room Customized Templates',
    tables = (table_configs = [
      (name = 'Provider', role = 'Provider', description = 'Provider table', columns = [
        (name = 'SegmentName', type = 'STRING', description = 'Name of the segment.'),
        (name = 'MemberId', type = 'STRING', description = 'Member ID.'),
        (name = 'HashedEmailAddress', type = 'HASHED_EMAIL', description = 'Contact ID hashed with SHA256')
      ]),
      (name = 'Consumer', role = 'Consumer', description = 'Consumer table', columns = [
        (name = 'SegmentId', type = 'STRING', description = 'Segment ID'),
        (name = 'HashedEmailAddress', type = 'HASHED_EMAIL', description = 'Contact ID hashed with SHA256')
      ])
    ]),
    queries = (query_configs = [(
      name = 'QueryOverlap',
      use_case = 'Overlap',
      type = 'SQL',
      description = 'Overlap between consumers and providers.',
      source = $$
        SELECT Consumer.SegmentId AS Segment_Id__c,
               Provider.SegmentName AS Provider_Segment_Name__c,
               COUNT(DISTINCT Provider.MemberId) AS Matching_Population_Count__c
        FROM Consumer JOIN Provider ON Consumer.HashedEmailAddress = Provider.HashedEmailAddress
        GROUP BY Consumer.SegmentId, Provider.SegmentName
        HAVING COUNT(DISTINCT Provider.MemberId) >= :threshold_count
      $$,
      query_parameters = (query_param_configs = [(name = 'threshold_count', type = 'INTEGER', description = 'threshold_count')]),
      referenced_tables = ['Consumer', 'Provider']
    )])
  )
);
```

**Result**

One row. Schema `DataCleanRoomProviderRepresentation`.

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
| `creation_type` | `creationType` | VARCHAR | Type of provider creation. Since v64.0. |
| `data_cloud_org_id` | `dataCloudOrgId` | VARCHAR | Core org ID where Data 360 clean room is enabled. Since v63.0. |
| `description` | `description` | VARCHAR | Description of the provider. Since v63.0. |
| `domain_url` | `domainUrl` | VARCHAR | Domain URL of the provider. Since v63.0. |
| `logo_url` | `logoUrl` | VARCHAR | URL of the provider logo. Since v63.0. |
| `off_core_tenant_id` | `offCoreTenantId` | VARCHAR | Off-core tenant ID of the provider. Since v63.0. |
| `package_type` | `packageType` | VARCHAR | Type of package. Since v66.0. |
| `provider_data_source` | `providerDataSource` | VARCHAR | Source of the provider's data. Since v66.0. |
| `provider_name` | `providerName` | VARCHAR | Name of the provider. Since v64.0. |
| `source` | `source` | VARCHAR | Source type of the provider. Since v64.0. |
| `source_configuration` | `sourceConfiguration` | JSON (DataCleanRoomProviderSourceConfigRepresentation) | Other source-related configurations for the provider. The endpoint returns the source config output object that corresponds to the type of provider. For example, the Data Clean Room AWS Source Config Output is returned for the `AWS` type. Since v64.0. |
| `template_names` | `templateNames` | JSON | List of template names. Since v63.0. |
| `use_case_type_config` | `useCaseTypeConfig` | JSON (DataCleanRoomUseCaseTypeRepresentation) | Configuration for the type of use case template. Since v65.0. |

**Notes:** `label` is the only attribute the schema requires, but the spec's listed 400s add more: `description` can't be empty, and a Salesforce template type needs a use case type or template names. The spec also lists `Unrecognized field template_type` as a 400, although `template_type` is in the schema.

The spec has three request examples:

- **AWS:** `source` `AWS`, `template_type` `CUSTOM`, `template_json`, and `source_configuration` with `account_id` and `supported_regions`.
- **Extensible:** `source` `DATA_CLOUD`, `template_type` `CUSTOM`, `template_json`, and `source_configuration` with `data_cloud_org_id`, `domain_url` and `off_core_tenant_id`.
- **Native:** `source` `DATA_CLOUD`, `template_type` `SALESFORCE`, `use_case_type_config => (use_case_types = ['Overlap'])`, and the same `source_configuration`.

These examples conflict with the schema, and the example above follows them. `tables`, `queries`, `query_parameters` and `use_case_type_config` are declared as arrays but sent as single objects, and `use_case_type_config` also comes back as one object. `template_type` is declared `Custom` or `Salesforce` but sent uppercase.

The response has a generated `name`, such as `X00Dxx00QA6JqfVUEMZ_package_AWS1765305467896`. The spec has no update or delete for providers, and documents no idempotency, so check `clean_room_provider_list` before retrying.

## clean_room_specification_create

`POST /ssot/data-clean-room/specifications` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Clean-Rooms/paths/~1ssot~1data-clean-room~1specifications/post) · evidence O · changes org state

Maps a template's attributes to one member's DMO fields. A member needs a specification to create or accept a collaboration. Since v63.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `dataspace_name` | `dataSpaceName` | body | string |  | Name of the data space where the specification is to be created. Since v63.0. Sources also spell it `dataspaceName`: quote that name to send that spelling. |
| `description` | `description` | body | string |  | Description of the mapping. Since v63.0. |
| `label` | `label` | body | string | yes | Label of the clean room specification. Since v63.0. |
| `name` | `name` | body | string |  | API name of the specification. The spec's example sets it, and it comes back unchanged as `name`. Since v59.0. |
| `data_mapping` | `dataMapping` | body | array of [UseCaseTemplateMapping](#usecasetemplatemappingrepresentation) | yes | Data mapping details for a clean room member. Since v63.0. |
| `member_type` | `memberType` | body | string | yes | Type of clean room member, `Provider` or `Consumer`. Since v63.0. |
| `owner_org_id` | `ownerOrgId` | body | string | yes | Data 360 org ID where the mapping is to be created. Since v63.0. |
| `template_name` | `templateName` | body | string | yes | Name of the use case template for which the mapping is provided. Since v63.0. |
| `template_type` | `templateType` | body | enum(Custom, Salesforce) | yes | Type of template. Since v63.0. |
| `template_version_id` | `templateVersionId` | body | string | yes | Template version ID that is to be used for mapping. Since v63.0. |
| `use_case_type` | `useCaseType` | body | enum(Custom, Overlap) | yes | Type of use case template. Since v63.0. |

```sql
CALL cdp.clean_room_specification_create (
  name => 'sampleMapping',
  label => 'sampleMapping',
  dataspace_name => 'default',
  member_type => 'CONSUMER',
  owner_org_id => '00Dxx00QA6JqfVUEMZ',
  template_name => 'Overlap',
  template_version_id => '1TTxx0000004Cc4GAE',
  template_type => 'SALESFORCE',
  use_case_type => 'Overlap',
  data_mapping => (
    collaboration_entity = 'ssot__ContactPointEmail__dlm',
    attributes = [
      (attribute_id = 'SegmentId', alias = 'SegmentId', subject_attribute = (object_name = 'ssot__ContactPointEmail__dlm', object_label = 'Contact Point Email', field_name = 'ssot__InternalOrganizationId__c', field_label = 'Internal Organization')),
      (attribute_id = 'HashedEmailAddress', alias = 'HashedEmailAddress', subject_attribute = (object_name = 'ssot__ContactPointEmail__dlm', object_label = 'Contact Point Email', field_name = 'ssot__DataSourceId__c', field_label = 'Data Source'))
    ]
  )
);
```

**Result**

One row. Schema `DataCleanRoomDataSpecificationRepresentation`.

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
| `data_mapping` | `dataMapping` | JSON (UseCaseTemplateMappingRepresentation) | Data mapping details for a clean room member in JSON format. Since v63.0. |
| `dataspace` | `dataSpace` | JSON (DataSpaceRepresentation) | Data space details for the clean room. Since v66.0. |
| `description` | `description` | VARCHAR | Description of the specification. Since v63.0. |
| `member_type` | `memberType` | VARCHAR | Type of clean room member. Since v63.0. |
| `owner_org_id` | `ownerOrgId` | VARCHAR | Data 360 org ID where the mapping is created. Since v63.0. |
| `status` | `status` | VARCHAR | Status of the specification. Since v63.0. |
| `template_version` | `templateVersion` | JSON (DataCleanRoomTemplateRepresentation) | Details of the use case template version for which the mapping is provided. Since v63.0. |
| `dataspace_name` | `dataSpaceName` | VARCHAR | Not in the spec schema: from the spec's examples. |

**Notes:** `attribute_id` takes an `id` from the template's `configuration.memberConfigs[].attributeConfigs`. `collaboration_entity` is the central DMO for the mapping.

The spec's example conflicts with its schema, and the example above follows the example's shape. `data_mapping` is declared as an array, but the example sends one object and the response returns one object. `template_type` and `member_type` are sent uppercase, and the declared values are Title Case. The spec's example also sends `dataspaceName`, which isn't an attribute; the option is `dataSpaceName`, and the spec lists `Unrecognized field` as a 400.

`data_mapping` reuses a response schema, so its attribute list includes read-only fields such as `created_by`. The spec's example sends only `collaboration_entity` and `attributes`, with `attribute_id`, `alias` and `subject_attribute` on each attribute.

Attributes with an empty `subject_attribute` may vanish. The spec's example sends five attributes, two with `subject_attribute = ()`, and those two are missing from its response.

The schema's `status` has `Processing` and `Error`, while the spec's example returns `ACTIVE` at once. Check `status` before using the specification. The spec has no update for specifications.

## clean_room_connection_test

`POST /ssot/data-clean-room/test-connection` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Clean-Rooms/paths/~1ssot~1data-clean-room~1test-connection/post) · evidence O · read-only

Test the connection between the clean room and the provider's external storage. Since v66.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `connection_attributes` | `connectionAttributes` | body | map to string |  | Map of connection attributes. Since v66.0. |
| `connector_type` | `connectorType` | body | enum(CleanroomAwsS3, CleanroomSnowflake) |  | Type of connector. Since v66.0. |
| `consumer_org_id` | `consumerOrgId` | body | string |  | 18-character org ID of the target consumer. Since v66.0. |

```sql
CALL cdp.clean_room_connection_test (consumer_org_id => '00D000000000001', connector_type => 'CleanroomAwsS3', connection_attributes => (authenticationOption = 'idp', bucketName = 'cleanroom-data-bucket', parentDirectory = '/shared-data/', iamRoleName = 'arn:aws:iam::123456789012:role/CleanroomDataAccessRole', externalId = 'app:DE809C7E:A1B2C3D4'));
```

**Result**

One row. Schema `CleanRoomTestConnectionRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `details` | `details` | JSON | Additional information including error details passed by the DCF service's test connection. Since v66.0. |
| `error_code` | `errorCode` | VARCHAR | Error code, if any. Since v66.0. |
| `message` | `message` | VARCHAR | Message that provides additional context about the connection test result. Since v66.0. |
| `success` | `success` | BOOLEAN | Indicates whether the connection test was successful (`true`) or not (`false`). Since v66.0. |

**Notes:** A failed test is still HTTP 200, so check `success`. The spec's failure example has `error_code` `CONNECTORS_FRAMEWORK_TEST_FAILED` and `details` with `subErrorCode` `INVALID_IAM_ROLE`.

`connection_attributes` keys are documented only by that one S3 example: `authenticationOption`, `bucket_name`, `parentDirectory`, `iamRoleName` and `external_id`. They differ from the `role_arn` and `s3_url` that `clean_room_invitation_accept` takes for the same connector. The spec gives no Snowflake keys for this call.

`consumer_org_id` is described as 18 characters, but the spec's example has 15.

## clean_room_collaboration_metadata_refresh

`PUT /ssot/data-clean-room/collaborations/{collaborationIdOrApiName}/actions/refresh-metadata` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Clean-Rooms/paths/~1ssot~1data-clean-room~1collaborations~1%7BcollaborationIdOrApiName%7D~1actions~1refresh-metadata/put) · evidence O · changes org state

Refresh metadata for a clean room collaboration. Since v66.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `collaboration_id_or_api_name` | `collaborationIdOrApiName` | path | string | yes | ID or developer name of the clean room collaboration. Since v66.0. |

```sql
CALL cdp.clean_room_collaboration_metadata_refresh (collaboration_id_or_api_name => 'collab21_00DSB00000eMue3');
```

**Result**

One row. Schema `DataCleanRoomGenericResponseRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `errors` | `errors` | JSON (array of CdpErrorRepresentation) | List of errors that resulted from the action. Since v57.0. |
| `success` | `success` | BOOLEAN | Indicates whether the action was initiated successfully (`true`) or not (`false`). Since v57.0. |

**Done when:** The spec documents no completion signal. `success` = `true` only means the refresh was initiated.

**Notes:** The spec doesn't say what metadata is refreshed or when you'd need this.

Don't treat `errors` as a failure signal. The spec's success example has `success` `true` with `errors` holding one entry of empty strings.

## Schemas

Attribute names are keywords inside the object they belong to, so completion offers exactly these.

### CdpUserRepresentation

Represents a user.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `id` | `id` | string |  | 18-character user ID. Since v60.0. |
| `name` | `name` | string |  | Name of the user. Since v60.0. |
| `profile_photo_url` | `profilePhotoUrl` | string |  | Profile photo of the user to show in the UI. Since v60.0. |

### CustomUseCaseTemplateAnalysisConfigRepresentation

Represents the analysis configuration for a custom use case template for a clean room.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `output_path` | `outputPath` | string |  | Output path for saving the query result. Since v63.0. |

### CustomUseCaseTemplateColumnRepresentation

Represents a column in a clean room custom use case template table.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `default_value` | `defaultValue` | string |  | Default value of the column in the template table. Since v63.0. |
| `description` | `description` | string |  | Description of the column in the template table. Since v63.0. |
| `name` | `name` | string |  | Name of the column in the template table. Since v63.0. |
| `tooltip` | `tooltip` | string |  | Helper text to show in the UI with an info icon. Since v66.0. |
| `type` | `type` | string |  | Type of column value. The spec's description names `STRING`, `INTEGER` and `BOOLEAN`, and its examples also use `NUMBER` and `HASHED_EMAIL`. Since v63.0. |

### CustomUseCaseTemplateInputRepresentation

Represents the input for a custom use case template for a clean room.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `description` | `description` | string |  | Description of the custom use case template. Since v63.0. |
| `name` | `name` | string |  | Name of the custom use case template. Since v63.0. |
| `queries` | `queries` | array of [CustomUseCaseTemplateQueryInput](#customusecasetemplatequeryinputrepresentation) |  | List of queries defined in the custom use case template. Since v63.0. |
| `tables` | `tables` | array of [CustomUseCaseTemplateTableInput](#customusecasetemplatetableinputrepresentation) |  | List of tables referenced in the template queries. Since v63.0. |
| `use_case_configs` | `useCaseConfigs` | map to [MatchBoostUsecaseConfigInput](#matchboostusecaseconfiginputrepresentation) |  | Configuration of use case template types. Only applies to the `MatchBoost` use case type. Since v66.0. |
| `version` | `version` | string |  | Version of the custom use case template. Since v63.0. |

### CustomUseCaseTemplateQueryConfig

Represents the query configuration for a custom use case template for a clean room.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `analysis_configs` | `analysisConfigs` | [CustomUseCaseTemplateAnalysisConfig](#customusecasetemplateanalysisconfigrepresentation) |  | Additional configurations for the template query, such as output location. Since v63.0. |
| `description` | `description` | string |  | Description of the template query. Since v63.0. |
| `name` | `name` | string |  | Name of the template query. Since v63.0. |
| `query_parameters` | `queryParameters` | array of [CustomUseCaseTemplateQueryParam](#customusecasetemplatequeryparamrepresentation) |  | List of query parameters. Since v63.0. |
| `referenced_tables` | `referencedTables` | array of string |  | List of tables referenced by the template query. Since v63.0. |
| `source` | `source` | string |  | SQL text of the query in the spec's examples, with parameters written `:threshold_count`. The spec's description says it's the name of the query to execute. Since v63.0. |
| `type` | `type` | string |  | Type of template query, such as `SQL` or `SparkSQL`. Since v63.0. |
| `use_case` | `useCase` | string |  | Name of the use case associated with the template query. Since v63.0. |

### CustomUseCaseTemplateQueryInputRepresentation

Represents the input for querying a custom use case template for a clean room.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `query_configs` | `queryConfigs` | array of [CustomUseCaseTemplateQueryConfig](#customusecasetemplatequeryconfig) |  | List of queries defined in the custom use case template. Since v63.0. |

### CustomUseCaseTemplateQueryParamConfig

Represents the query parameter configuration for a custom use case template for a clean room.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `description` | `description` | string |  | Description of the query parameter table column. Since v63.0. |
| `name` | `name` | string |  | Name of the query parameter table column. Since v63.0. |
| `type` | `type` | string |  | Type of query parameter table value, such as `STRING`, `INTEGER`, or `BOOLEAN`. Since v63.0. |

### CustomUseCaseTemplateQueryParamRepresentation

Represents the query parameters defined for a custom use case template for a clean room.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `query_param_configs` | `queryParamConfigs` | array of [CustomUseCaseTemplateQueryParamConfig](#customusecasetemplatequeryparamconfig) |  | List of queries defined in the template. Since v63.0. |

### CustomUseCaseTemplateTableConfig

Represents the configuration of a clean room custom use case template table.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `columns` | `columns` | array of [CustomUseCaseTemplateColumn](#customusecasetemplatecolumnrepresentation) |  | List of columns in the template table. Since v63.0. |
| `description` | `description` | string |  | Description of the template table. Since v63.0. |
| `name` | `name` | string |  | Name of the template table. Since v63.0. |
| `role` | `role` | string |  | Role of the custom template, `Provider` or `Consumer`. Since v63.0. |

### CustomUseCaseTemplateTableInputRepresentation

Represents the input for a clean room custom use case template table.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `table_configs` | `tableConfigs` | array of [CustomUseCaseTemplateTableConfig](#customusecasetemplatetableconfig) |  | List of tables referenced in the template query. Since v63.0. |

### DataCleanRoomAwsS3ConnectionAttributesRepresentation

Represents the attributes for an AWS S3 connection.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `connector_type` | `connectorType` | enum(CleanroomAwsS3, CleanroomSnowflake) |  | Type of metadata connector. Since v66.0. |
| `role_arn` | `roleArn` | string |  | IAM role used to connect to the provided S3 URL. Since v66.0. |
| `s3_url` | `s3Url` | string |  | Full path of the S3 bucket with folders where the user wants the data to be shared. Since v66.0. |

### DataCleanRoomOutputConfigurationRepresentation

Represents the input for clean room output configurations.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `connection_attributes` | `connectionAttributes` | one of [DataCleanRoomAwsS3ConnectionAttributes](#datacleanroomawss3connectionattributesrepresentation), [DataCleanRoomSnowflakeConnectionAttributes](#datacleanroomsnowflakeconnectionattributesrepresentation) |  | Connection details, by `connector_type`. `CleanroomAwsS3` takes `role_arn` and `s3_url`. `CleanroomSnowflake` takes `account_url`, `warehouse_name`, `database_name`, `schema_name` and `service_user`. Since v66.0. |
| `external_id` | `externalId` | string |  | The spec describes this as the specification ID for the mapping details. Its examples send `ext12345678`, and the matching output field is the ID of the output destination connection. Since v66.0. |
| `output_destination_type` | `outputDestinationType` | enum(ExternalConnector, Lakehouse) | yes | Type of output destination. The spec's examples send `EXTERNAL_CONNECTOR`. Since v66.0. |

### DataCleanRoomProviderSourceConfigInputRepresentation

Represents the source type configuration input for a clean room provider.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `data_cloud_org_id` | `dataCloudOrgId` | string |  | - |
| `domain_url` | `domainUrl` | string |  | - |
| `off_core_tenant_id` | `offCoreTenantId` | string |  | - |
| `type` | `type` | enum(AWS, DATA_CLOUD) |  | Source type of the provider. `AWS` also takes `account_id` and `supported_regions`. `DATA_CLOUD` also takes `data_cloud_org_id`, `domain_url` and `off_core_tenant_id`. Since v63.0. |
| `account_id` | `accountId` | string |  | - |
| `supported_regions` | `supportedRegions` | array of string |  | - |

### DataCleanRoomSnowflakeConnectionAttributesRepresentation

Represents the attributes for a Snowflake connection.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `connector_type` | `connectorType` | enum(CleanroomAwsS3, CleanroomSnowflake) |  | Type of metadata connector. Since v66.0. |
| `account_url` | `accountUrl` | string |  | URL of the provider's Snowflake account. Since v66.0. |
| `database_name` | `databaseName` | string |  | Name of the database containing the provider's final dataset. Since v66.0. |
| `schema_name` | `schemaName` | string |  | Name of the schema containing the provider's final dataset. Since v66.0. |
| `service_user` | `serviceUser` | string |  | Name of the user authorized to access the shared database and schema. Since v66.0. |
| `warehouse_name` | `warehouseName` | string |  | Name of the warehouse used to host or process the provider's final dataset. Since v66.0. |

### DataCleanRoomUseCaseTypeInputRepresentation

Represents the input for a type of clean room use case.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `use_case_types` | `useCaseTypes` | array of enum(Custom, Overlap) |  | Use case types that the provider supports. Since v63.0. |

### MatchBoostOutputBridgeTableInputRepresentation

Represents the bridge table input for a match boost use case template object.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `source_id_field_name` | `sourceIdFieldName` | string |  | Column name corresponding to the equivalent column in the shared data. Since v66.0. |

### MatchBoostOutputObjectConfigRepresentation

Represents the configuration input for match boost use case template output objects.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `bridge_table` | `bridgeTable` | [MatchBoostOutputBridgeTableInput](#matchboostoutputbridgetableinputrepresentation) |  | Details about the bridge table. Since v66.0. |
| `object_name` | `objectName` | string |  | Name of the object. Since v66.0. |
| `related_table` | `relatedTable` | array of [MatchBoostOutputBridgeTableInput](#matchboostoutputbridgetableinputrepresentation) |  | Details about the related table. Since v66.0. |

### MatchBoostOutputObjectInputRepresentation

Represents the input for match boost use case template output objects.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `output_object_configs` | `outputObjectConfigs` | array of [MatchBoostOutputObjectConfig](#matchboostoutputobjectconfigrepresentation) |  | Configuration of the output objects. Since v66.0. |

### MatchBoostUsecaseConfigInputRepresentation

Represents the input for match boost use case template types.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `use_case_type` | `useCaseType` | enum(Activation, Custom, MatchBoost, Overlap) |  | Type of use case template. Since v66.0. |
| `output_objects` | `outputObjects` | array of [MatchBoostOutputObjectInput](#matchboostoutputobjectinputrepresentation) |  | List of output objects for the use case template. Since v66.0. |
| `supported_contact_points` | `supportedContactPoints` | array of enum(Email, PhoneNumber) |  | List of contact points supported by the provider. Since v66.0. |

### UseCaseTemplateMappingAttributeFilterOptionRepresentation

Represents the filter options for the mapping attributes for a clean room use case template.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `operator` | `operator` | string |  | Logical operator to apply on the attribute values. Since v63.0. |
| `values` | `values` | array of string |  | List of values qualified for filter application Since v63.0. |

### UseCaseTemplateMappingAttributeRepresentation

Represents the mapping attributes for a clean room use case template.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `created_by` | `createdBy` | [CdpUser](#cdpuserrepresentation) |  | Who or what created the model configuration, artifact, or other asset. Since v60.0. |
| `created_date` | `createdDate` | string |  | Date that the artifact was created. Since v60.0. |
| `id` | `id` | string |  | 18-character ID of the asset. Since v60.0. |
| `label` | `label` | string |  | Label of the asset. Not applicable to the [get activation](https://developer.salesforce.com/docs/data/connectapi/references/spec?meta=getActivation) endpoint. Since v60.0. |
| `last_modified_by` | `lastModifiedBy` | [CdpUser](#cdpuserrepresentation) |  | Who or what last modified the asset. Since v60.0. |
| `last_modified_date` | `lastModifiedDate` | string |  | When the asset was last modified. Since v60.0. |
| `name` | `name` | string |  | Name of the asset. Since v60.0. |
| `namespace` | `namespace` | string |  | Namespace of the asset. Not applicable to the [get activation](https://developer.salesforce.com/docs/data/connectapi/references/spec?meta=getActivation) endpoint. Since v60.0. |
| `url` | `url` | string |  | The artifact's, configured model's, or other asset's URL. Not applicable to the [get activation](https://developer.salesforce.com/docs/data/connectapi/references/spec?meta=getActivation) endpoint. Since v60.0. |
| `alias` | `alias` | string |  | Alias for the mapping attribute. Since v63.0. |
| `attribute_id` | `attributeId` | string |  | ID of the template attribute being mapped, from the template's `configuration.memberConfigs[].attributeConfigs`. Since v63.0. |
| `default_value` | `defaultValue` | string |  | Default value of the mapping attribute if it is not mapped. Since v63.0. |
| `filter_options` | `filterOptions` | [UseCaseTemplateMappingAttributeFilterOption](#usecasetemplatemappingattributefilteroptionrepresentation) |  | Filter criteria to be applied to the attribute values. Since v63.0. |
| `path` | `path` | array of [UseCaseTemplateMappingPathAttribute](#usecasetemplatemappingpathattributerepresentation) |  | Path that defines the relationship between this attribute and the collaboration entity. Since v63.0. |
| `subject_attribute` | `subjectAttribute` | [UseCaseTemplateMappingSubjectAttribute](#usecasetemplatemappingsubjectattributerepresentation) |  | Pair that identifies the mapping between the template field and the mapped field. Since v63.0. |
| `table_name` | `tableName` | string |  | Logical table name with which the attribute is associated. Since v63.0. |

### UseCaseTemplateMappingPathAttributeRepresentation

Represents the mapping path of attributes for a clean room use case template.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `source_attribute` | `sourceAttribute` | [UseCaseTemplateMappingSubjectAttribute](#usecasetemplatemappingsubjectattributerepresentation) |  | Details of the source attribute in the path component. Since v63.0. |
| `target_attribute` | `targetAttribute` | [UseCaseTemplateMappingSubjectAttribute](#usecasetemplatemappingsubjectattributerepresentation) |  | Details of the target attribute in the path component. Since v63.0. |

### UseCaseTemplateMappingRepresentation

Represents a mapping for a clean room use case template.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `created_by` | `createdBy` | [CdpUser](#cdpuserrepresentation) |  | Who or what created the model configuration, artifact, or other asset. Since v60.0. |
| `created_date` | `createdDate` | string |  | Date that the artifact was created. Since v60.0. |
| `id` | `id` | string |  | 18-character ID of the asset. Since v60.0. |
| `label` | `label` | string |  | Label of the asset. Not applicable to the [get activation](https://developer.salesforce.com/docs/data/connectapi/references/spec?meta=getActivation) endpoint. Since v60.0. |
| `last_modified_by` | `lastModifiedBy` | [CdpUser](#cdpuserrepresentation) |  | Who or what last modified the asset. Since v60.0. |
| `last_modified_date` | `lastModifiedDate` | string |  | When the asset was last modified. Since v60.0. |
| `name` | `name` | string |  | Name of the asset. Since v60.0. |
| `namespace` | `namespace` | string |  | Namespace of the asset. Not applicable to the [get activation](https://developer.salesforce.com/docs/data/connectapi/references/spec?meta=getActivation) endpoint. Since v60.0. |
| `url` | `url` | string |  | The artifact's, configured model's, or other asset's URL. Not applicable to the [get activation](https://developer.salesforce.com/docs/data/connectapi/references/spec?meta=getActivation) endpoint. Since v60.0. |
| `attributes` | `attributes` | array of [UseCaseTemplateMappingAttribute](#usecasetemplatemappingattributerepresentation) |  | Mapping attributes for the use case template. Since v63.0. |
| `collaboration_entity` | `collaborationEntity` | string |  | Name of the central entity for the use case template mapping. All attributes are mapped using this collaboration entity. Since v63.0. |

### UseCaseTemplateMappingSubjectAttributeRepresentation

Represents a mapping subject attribute for a clean room use case template.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `field_label` | `fieldLabel` | string |  | Label of the mapped entity field. Since v63.0. |
| `field_name` | `fieldName` | string |  | Name of the mapped entity field. Since v63.0. |
| `object_label` | `objectLabel` | string |  | Label of the mapped entity. Since v63.0. |
| `object_name` | `objectName` | string |  | Name of the mapped entity. Since v63.0. |
