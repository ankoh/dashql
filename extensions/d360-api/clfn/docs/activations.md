<!-- Generated from extensions/d360-api/clfn/spec/activations.yaml, edit that and run: bazel run //extensions/d360-api:update -->

# Activations

Part of the [CDP function reference](functions.md). Nothing here is implemented or tested against an org. Every result also has the [standard columns](functions.md#result-schema).

An activation delivers an audience to an activation target. It says which rows to send (a segment or a DMO), what to send about each one (`attributes_config`), how to reach them (`contact_points_config`), and which records to keep (`direct_dmo_filters_config`, `related_dmo_filters_config`).

The segment and target come first. The [catalog](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/runtime/FamilyCatalog.java) says "Requires active segment + target", and the [removed official skill](https://github.com/forcedotcom/sf-skills/blob/2476476dda1b671762c6e963b9d10c4a7056f1c4/skills/data360-activate/SKILL.md) says the destination usually comes before the activation. The v67 metadata calls (`activation_channel_list`, `activation_channel_preference_list`, `activation_data_source_list`, the limit calls) help you fill in the create call. After it, watch `activation_get.last_publish_status` and `activation_history_list`.

Gotchas:

- **Enums:** the values in the spec's enums aren't what its own examples send. `activation_create` has the table. Nothing here has been tested, so check against an org.
- **Keys:** use the record ID (`85R...` in the spec's samples). The spec allows developer names on some paths, a [community test](https://github.com/szymonlewandowski/config-snapshot-data360/blob/main/docs/api-quirks.md) found they fail (one org), and the v67 action paths take IDs only.
- **Required fields:** the spec requires only `refresh_type`. The [MCP tool](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/ActivationTools.java) requires much more.
- **`activation_list`:** it omits attributes, contact points and filters, and takes no data space ([community](https://github.com/szymonlewandowski/config-snapshot-data360/blob/main/docs/api-quirks.md)).

```sql
CALL cdp.activation_channel_list (activate_on => 'ssot__Individual__dlm', dataspace => 'default');
CALL cdp.activation_create (
  name => 'high_value_s3', dataspace_name => 'default', segment_api_name => 'High_Value',
  activation_target_name => 's3_target', refresh_type => 'INCREMENTAL',
  activation_target_subject_config => (developer_name = 'ssot__Individual__dlm'),
  attributes_config => (attributes = [(name = 'ssot__Id__c', label = 'Individual Id', entity_name = 'ssot__Individual__dlm', data_source_type = 'Text', reference_attribute_name = 'Id', source = 'DIRECT', type = 'MODEL')]));
CALL cdp.activation_get (activation_id => '85RVF000000CEf72AG');
CALL cdp.activation_history_list (activation_id => '85RVF000000CEf72AG');
```

**Functions:** [`activation_delete`](#activation_delete), [`activation_list`](#activation_list), [`activation_get`](#activation_get), [`activation_record_list`](#activation_record_list), [`activation_history_list`](#activation_history_list), [`activation_data_object_category_list`](#activation_data_object_category_list), [`activation_channel_preference_list`](#activation_channel_preference_list), [`activation_channel_list`](#activation_channel_list), [`activation_consent_dmo_list`](#activation_consent_dmo_list), [`activation_data_source_list`](#activation_data_source_list), [`activation_related_attribute_quota_list`](#activation_related_attribute_quota_list), [`activation_related_attribute_limit_list`](#activation_related_attribute_limit_list), [`match_boost_identity_provider_list`](#match_boost_identity_provider_list), [`activation_streaming_eligibility_list`](#activation_streaming_eligibility_list), [`activation_create`](#activation_create), [`activation_publish`](#activation_publish), [`activation_disable`](#activation_disable), [`activation_enable`](#activation_enable), [`activation_full_refresh_run`](#activation_full_refresh_run), [`activation_sync_retry`](#activation_sync_retry), [`activation_update`](#activation_update)

## activation_delete

`DELETE /ssot/activations/{activationId}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Activations/paths/~1ssot~1activations~1%7BactivationId%7D/delete) · tool `d360_activation_delete` · evidence O · changes org state

Delete an activation. Because there are no dependency checks, ensure that there are no downstream systems that expect data from this activation before deleting it. After you delete an activation, Data 360 stops sending data to any downstream systems that are associated with the deleted activation. To identify the downstream system (activation target) that is associated with the activation, use the [get activation](https://developer.salesforce.com/docs/data/connectapi/references/spec?meta=getActivation) endpoint. The get activation endpoint provides the activation target details needed to evaluate the impact before deleting the activation. In the case of an invalid activation ID, the error message “Activation not found for Id: *activation_id*” is returned. Since v61.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `activation_id` | `activationId` | path | string | yes | Spec: the ID or developer name. A community live test got 400 or 404 for names, so use the ID ([quirk T1](https://github.com/szymonlewandowski/config-snapshot-data360/blob/main/docs/api-quirks.md), one org). |

```sql
CALL cdp.activation_delete (activation_id => '85RVF000000CEf72AG');
```

**Result**

No response body (HTTP 200). One row with only the standard columns.

## activation_list

`GET /ssot/activations` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Activations/paths/~1ssot~1activations/get) · tool `d360_activation_list` · evidence O · read-only

Get a list of activations with selected filters. Since v60.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `batch_size` | `batchSize` | query | integer |  | Number of results to return. Values are from `1` through `200`. If unspecified, the default value is `20`. Since v60.0. |
| `filters` | `filters` | query | string |  | Filter the result set to a more narrow scope or specific type. These filters are supported: - name (field name: name; description: name of the activation) - market_segment_id (field name: segment_id; description: segment ID of the activation) - activation_target_id (field name: activation_target.id; description: activation target ID of the activation) - activationRefreshType (field name: refresh_type; description: refresh type of the activation; example: incremental) - activation_status (field name: status; description: status of the activation, which accepts only the values in the `status` response field; example: active). **Example requests with filters:** - GET `https://{dne_cdpInstanceUrl}/services/data/v60.0/ssot/activations?filters = name in Activation001` - GET `https://{dne_cdpInstanceUrl}/services/data/v60.0/ssot/activations?filters = marketsegmentid in 00sgxx0001AAA` - GET `https//{dne_cdpInstanceUrl}/services/data/v60.0/ssot/activations?filters = activationRefreshType in incremental` - GET `https//{dne_cdpInstanceUrl}/services/data/v60.0/ssot/activations?filters = activationrefreshtype in incremental AND activationstatus in active` - GET `https//{dne_cdpInstanceUrl}/services/data/v60.0/ssot/activations?filters = activationtargetid in 85Uxx0000004CKKEA2 AND activationstatus in active&orderby = createddate desc&offset=0&batchsize=20` Since v60.0. |
| `offset` | `offset` | query | integer |  | Number of rows to skip before returning results. Must be greater than or equal to `0`. If unspecified, no rows are skipped. Since v60.0. |
| `order_by` | `orderBy` | query | string |  | Sort order for the result set by `created_date`. If unspecified, items are returned by ID in ascending order. Since v60.0. |

```sql
CALL cdp.activation_list (filters => 'activationStatus in active AND activationRefreshType in incremental', order_by => 'createdDate desc', batch_size => 200);
```

**Result**

One row per item of `/activations` in the response. Other response fields go to `_meta`: `batchSize`, `offset`, `orderByExpression`. Schema `ActivationRepresentation`.

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
| `activation_definition_id` | `activationDefinitionId` | VARCHAR | ID of the activation definition. Since v60.0. |
| `activation_mapping_schema` | `activationMappingSchema` | VARCHAR | Type of identifier to use for activation audience matching, such as `PII` or `ANON`. Since v63.0. |
| `activation_record_schema` | `activationRecordSchema` | VARCHAR | JSON schema representing the activation JSON payload in the activation_record field of the AudienceDMO. Since v62.0. |
| `activation_target` | `activationTarget` | JSON (ActivationTargetRepresentation) | Activation target details. Since v60.0. |
| `activation_target_subject_config` | `activationTargetSubjectConfig` | JSON (ActivationTargetSubjectRepresentation) | Activation target subject for the activation. Since v60.0. |
| `activation_type` | `activationType` | VARCHAR | Type of activation. Since v66.0. |
| `attribute_limiting_expression_config` | `attributeLimitingExpressionConfig` | JSON (AttributeLimitingExpressionConfigRepresentation) | Limiting expression configuration for the activation. Since v63.0. |
| `attributes_config` | `attributesConfig` | JSON (ActivationAttributesConfigRepresentation) | Attributes for the activation. Since v60.0. |
| `contact_points_config` | `contactPointsConfig` | JSON (ContactPointsConfigRepresentation) | Contact points for the activation. Since v60.0. |
| `curated_entity` | `curatedEntity` | JSON (CdpAssetReferenceRepresentation) | Curated entity object details for the activation. Since v63.0. |
| `customer_file_source` | `customerFileSource` | VARCHAR | Customer file source of the activation platform. Since v60.0. |
| `data_sources_config` | `dataSourcesConfig` | JSON (ActivationDataSourcesRepresentation) | Data sources for the activation. Since v60.0. |
| `dataspace_name` | `dataSpaceName` | VARCHAR | Data space name for the activation. Since v60.0. |
| `description` | `description` | VARCHAR | Description of the activation. Since v60.0. |
| `developer_name` | `developerName` | VARCHAR | Developer name for the activation. Since v60.0. |
| `direct_dmo_filters_config` | `directDmoFiltersConfig` | JSON (DmoFiltersConfigRepresentation) | Direct DMO filters for the activation. Since v60.0. |
| `enabled` | `enabled` | BOOLEAN | Indicates whether the activation is enabled (`true`) or not (`false`). Since v60.0. |
| `history_audience_dmo_api_name` | `historyAudienceDmoApiName` | VARCHAR | API name for the history audience DMO. Since v60.0. |
| `history_audience_dmo_label` | `historyAudienceDmoLabel` | VARCHAR | Name of the history audience DMO. Since v60.0. |
| `is_enabled` | `isEnabled` | BOOLEAN | Indicates whether the activation is enabled (`true`) or not (`false`). Since v60.0. |
| `last_publish_date` | `lastPublishDate` | VARCHAR | Last publish timestamp of the activation. Use the format `yyyy-mm-dd`. Since v60.0. |
| `last_publish_status` | `lastPublishStatus` | VARCHAR | Last publish status of the activation. Since v60.0. |
| `last_publish_status_error_msg` | `lastPublishStatusErrorMsg` | VARCHAR | Error message encountered during last publish. Since v60.0. |
| `latest_audience_dmo_api_name` | `latestAudienceDmoApiName` | VARCHAR | API name for the latest audience DMO. Since v62.0. |
| `latest_audience_dmo_label` | `latestAudienceDmoLabel` | VARCHAR | Name for the latest audience DMO. Since v62.0. |
| `latest_audience_dmo_last_run_timestamp` | `latestAudienceDmoLastRunTimestamp` | VARCHAR | Timestamp of the last run for the latest audience DMO. Use the format `yyyy-mm-dd`. Since v62.0. |
| `limit_value` | `limitValue` | BIGINT | Audience limit value for the activation. Since v63.0. |
| `market_segment_id` | `marketSegmentId` | VARCHAR | Segment ID of the activation. Returned for `Segment` type activations. Since v60.0. |
| `membership_name` | `membershipName` | VARCHAR | Membership name of the activation. Since v60.0. |
| `processing_type` | `processingType` | VARCHAR | Processing type for DMO activations. Since v67.0. |
| `query_path_config` | `queryPathConfig` | JSON (QueryPathConfigListRepresentation) | Query path for the activation target. Since v63.0. |
| `refresh_type` | `refreshType` | VARCHAR | Refresh type of the activation. Since v60.0. |
| `related_dmo_filters_config` | `relatedDmoFiltersConfig` | JSON (DmoFiltersConfigRepresentation) | DMO filters on related attributes for the activation. Since v60.0. |
| `segment_api_name` | `segmentApiName` | VARCHAR | Segment API name. Returned for `Segment` type activations. Since v60.0. |
| `segment_id` | `segmentId` | VARCHAR | Segment ID of the activation. Returned for `Segment` type activations. Since v60.0. |
| `should_exclude_deletes` | `shouldExcludeDeletes` | BOOLEAN | Indicates whether to exclude records removed since the last refresh (`true`) or not (`false`). Since v60.0. |
| `should_exclude_updates` | `shouldExcludeUpdates` | BOOLEAN | Indicates whether to exclude records modified since the last refresh (`true`) or not (`false`). Since v60.0. |
| `source_dmo_name` | `sourceDmoName` | VARCHAR | Developer name of the source DMO. Since v66.0. |
| `static_data_config` | `staticDataConfig` | JSON (StaticDataConfigRepresentation) | Campaign data attributes configuration for an activation, which includes both standard attributes (system-defined) and custom attributes (user-defined). Since v60.0. |
| `status` | `status` | VARCHAR | Status of the activation. Since v60.0. |
| `waterfall_selected_child_segments_config` | `waterfallSelectedChildSegmentsConfig` | JSON (WaterfallSelectedChildSegmentsConfigRepresentation) | Details about the selected Waterfall child segments. Required when segment_api_name references a Waterfall segment type; must not be present otherwise. Since v67.0. |
| `activation_target_id` | `activationTargetId` | VARCHAR | Not in the spec schema: from the spec's examples. |
| `activation_target_name` | `activationTargetName` | VARCHAR | Not in the spec schema: from the spec's examples. |

**Paging:** `batch_size`, `offset`.

**Notes:** The spec types `activations` as one object, but a live response returns an array ([sf-pi override](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/registry/connect-openapi-overrides.json)). List items have no attributes, contact points or filters, so those need one `activation_get` each ([quirk T2](https://github.com/szymonlewandowski/config-snapshot-data360/blob/main/docs/api-quirks.md), community).

The response has no `total_size`. Its `offset` is the next offset, counted from 0, and `batch_size` is the number returned ([quirk P7](https://github.com/szymonlewandowski/config-snapshot-data360/blob/main/docs/api-quirks.md), community). There's no data space option, so filter on `dataspace_name` yourself ([community](https://github.com/szymonlewandowski/config-snapshot-data360/blob/main/docs/api-quirks.md)).

The `filters` syntax differs from `activation_channel_list`: here it's `name in value`, joined with `AND`.

## activation_get

`GET /ssot/activations/{activationId}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Activations/paths/~1ssot~1activations~1%7BactivationId%7D/get) · tool `d360_activation_get` · evidence O · read-only

Get an activation by ID. Since v60.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `activation_id` | `activationId` | path | string | yes | Spec: the ID or developer name. A community live test got 400 or 404 for names, so use the ID ([quirk T1](https://github.com/szymonlewandowski/config-snapshot-data360/blob/main/docs/api-quirks.md), one org). |

```sql
CALL cdp.activation_get (activation_id => '85RVF000000CEf72AG');
```

**Result**

One row. Schema `ActivationRepresentation`.

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
| `activation_definition_id` | `activationDefinitionId` | VARCHAR | ID of the activation definition. Since v60.0. |
| `activation_mapping_schema` | `activationMappingSchema` | VARCHAR | Type of identifier to use for activation audience matching, such as `PII` or `ANON`. Since v63.0. |
| `activation_record_schema` | `activationRecordSchema` | VARCHAR | JSON schema representing the activation JSON payload in the activation_record field of the AudienceDMO. Since v62.0. |
| `activation_target` | `activationTarget` | JSON (ActivationTargetRepresentation) | Activation target details. Since v60.0. |
| `activation_target_subject_config` | `activationTargetSubjectConfig` | JSON (ActivationTargetSubjectRepresentation) | Activation target subject for the activation. Since v60.0. |
| `activation_type` | `activationType` | VARCHAR | Type of activation. Since v66.0. |
| `attribute_limiting_expression_config` | `attributeLimitingExpressionConfig` | JSON (AttributeLimitingExpressionConfigRepresentation) | Limiting expression configuration for the activation. Since v63.0. |
| `attributes_config` | `attributesConfig` | JSON (ActivationAttributesConfigRepresentation) | Attributes for the activation. Since v60.0. |
| `contact_points_config` | `contactPointsConfig` | JSON (ContactPointsConfigRepresentation) | Contact points for the activation. Since v60.0. |
| `curated_entity` | `curatedEntity` | JSON (CdpAssetReferenceRepresentation) | Curated entity object details for the activation. Since v63.0. |
| `customer_file_source` | `customerFileSource` | VARCHAR | Customer file source of the activation platform. Since v60.0. |
| `data_sources_config` | `dataSourcesConfig` | JSON (ActivationDataSourcesRepresentation) | Data sources for the activation. Since v60.0. |
| `dataspace_name` | `dataSpaceName` | VARCHAR | Data space name for the activation. Since v60.0. |
| `description` | `description` | VARCHAR | Description of the activation. Since v60.0. |
| `developer_name` | `developerName` | VARCHAR | Developer name for the activation. Since v60.0. |
| `direct_dmo_filters_config` | `directDmoFiltersConfig` | JSON (DmoFiltersConfigRepresentation) | Direct DMO filters for the activation. Since v60.0. |
| `enabled` | `enabled` | BOOLEAN | Indicates whether the activation is enabled (`true`) or not (`false`). Since v60.0. |
| `history_audience_dmo_api_name` | `historyAudienceDmoApiName` | VARCHAR | API name for the history audience DMO. Since v60.0. |
| `history_audience_dmo_label` | `historyAudienceDmoLabel` | VARCHAR | Name of the history audience DMO. Since v60.0. |
| `is_enabled` | `isEnabled` | BOOLEAN | Indicates whether the activation is enabled (`true`) or not (`false`). Since v60.0. |
| `last_publish_date` | `lastPublishDate` | VARCHAR | Last publish timestamp of the activation. Use the format `yyyy-mm-dd`. Since v60.0. |
| `last_publish_status` | `lastPublishStatus` | VARCHAR | Last publish status of the activation. Since v60.0. |
| `last_publish_status_error_msg` | `lastPublishStatusErrorMsg` | VARCHAR | Error message encountered during last publish. Since v60.0. |
| `latest_audience_dmo_api_name` | `latestAudienceDmoApiName` | VARCHAR | API name for the latest audience DMO. Since v62.0. |
| `latest_audience_dmo_label` | `latestAudienceDmoLabel` | VARCHAR | Name for the latest audience DMO. Since v62.0. |
| `latest_audience_dmo_last_run_timestamp` | `latestAudienceDmoLastRunTimestamp` | VARCHAR | Timestamp of the last run for the latest audience DMO. Use the format `yyyy-mm-dd`. Since v62.0. |
| `limit_value` | `limitValue` | BIGINT | Audience limit value for the activation. Since v63.0. |
| `market_segment_id` | `marketSegmentId` | VARCHAR | Segment ID of the activation. Returned for `Segment` type activations. Since v60.0. |
| `membership_name` | `membershipName` | VARCHAR | Membership name of the activation. Since v60.0. |
| `processing_type` | `processingType` | VARCHAR | Processing type for DMO activations. Since v67.0. |
| `query_path_config` | `queryPathConfig` | JSON (QueryPathConfigListRepresentation) | Query path for the activation target. Since v63.0. |
| `refresh_type` | `refreshType` | VARCHAR | Refresh type of the activation. Since v60.0. |
| `related_dmo_filters_config` | `relatedDmoFiltersConfig` | JSON (DmoFiltersConfigRepresentation) | DMO filters on related attributes for the activation. Since v60.0. |
| `segment_api_name` | `segmentApiName` | VARCHAR | Segment API name. Returned for `Segment` type activations. Since v60.0. |
| `segment_id` | `segmentId` | VARCHAR | Segment ID of the activation. Returned for `Segment` type activations. Since v60.0. |
| `should_exclude_deletes` | `shouldExcludeDeletes` | BOOLEAN | Indicates whether to exclude records removed since the last refresh (`true`) or not (`false`). Since v60.0. |
| `should_exclude_updates` | `shouldExcludeUpdates` | BOOLEAN | Indicates whether to exclude records modified since the last refresh (`true`) or not (`false`). Since v60.0. |
| `source_dmo_name` | `sourceDmoName` | VARCHAR | Developer name of the source DMO. Since v66.0. |
| `static_data_config` | `staticDataConfig` | JSON (StaticDataConfigRepresentation) | Campaign data attributes configuration for an activation, which includes both standard attributes (system-defined) and custom attributes (user-defined). Since v60.0. |
| `status` | `status` | VARCHAR | Status of the activation. Since v60.0. |
| `waterfall_selected_child_segments_config` | `waterfallSelectedChildSegmentsConfig` | JSON (WaterfallSelectedChildSegmentsConfigRepresentation) | Details about the selected Waterfall child segments. Required when segment_api_name references a Waterfall segment type; must not be present otherwise. Since v67.0. |
| `activation_target_id` | `activationTargetId` | VARCHAR | Not in the spec schema: from the spec's examples. |
| `activation_target_name` | `activationTargetName` | VARCHAR | Not in the spec schema: from the spec's examples. |

**Notes:** **State.** `status` and `last_publish_status` are in upper case in the spec's samples (`ACTIVE`, `SUCCESS`), though its enums use `Active` and `Success`. The `status` enum is `Active`, `Processing`, `Error`, `Inactive`. `enabled` and `is_enabled` have the same description.

**Not reusable as input.** The output differs from what `activation_create` takes. In the sample, a contact point has `contactPointEntityName` and `field_config.contactPointFields` where the input has `entity_name` and `attributes_config.attributes`.

**Encoded strings.** `contactPointPath` is JSON in a string with HTML entities, as the spec's sample shows ([quirk T4](https://github.com/szymonlewandowski/config-snapshot-data360/blob/main/docs/api-quirks.md), community). `activation_record_schema` is the same and repeats `attributes_config` ([quirk T6](https://github.com/szymonlewandowski/config-snapshot-data360/blob/main/docs/api-quirks.md), community). Paths there use `object_api_name`, unlike `query_path_config`.

## activation_record_list

`GET /ssot/activations/{activationId}/data` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Activations/paths/~1ssot~1activations~1%7BactivationId%7D~1data/get) · evidence O · read-only

Query activation data. Get a list of all activation records from Audience data model objects (DMOs). Since v61.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `X-Chatter-Entity-Encoding` | `X-Chatter-Entity-Encoding` | header | string | yes | Required. Value must be `false`. |
| `activation_id` | `activationId` | path | string | yes | Spec: the ID or developer name. A community live test got 400 or 404 for names, so use the ID ([quirk T1](https://github.com/szymonlewandowski/config-snapshot-data360/blob/main/docs/api-quirks.md), one org). |
| `batch_size` | `batchSize` | query | integer |  | Number of results to return. Values are from `1` through `4999`. If unspecified, the default value is `10000`. Since v61.0. |
| `filters` | `filters` | query | string |  | Filter the result set to a more narrow scope or specific type. This filter is supported: - `delta_type__c` (field name: delta_type; type: string; description: delta type of activation records) **Example request with filter:** - GET `https://{dne_cdpInstanceUrl}/services/data/v61.0/ssot/activations/{activationId}/data?filters = delta_type__c in 'A'` Since v61.0. |
| `offset` | `offset` | query | integer |  | Number of rows to skip before returning results. Must be greater than or equal to `0`. If unspecified, no rows are skipped. Maximum value is 10 million. Since v61.0. |

```sql
CALL cdp.activation_record_list ("X-Chatter-Entity-Encoding" => 'false', activation_id => '85RVF000000CEf72AG', filters => 'delta_type__c in ''A''', batch_size => 1000);
```

**Result**

One row per item of `/data` in the response. Other response fields go to `_meta`: `batchSize`, `offset`. Schema `ActivationDataRepresentation`.

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
| `activated_entity_fqk` | `activatedEntityFqk` | VARCHAR | Fully Qualified Key (FQK) of the activated entity. Since v61.0. |
| `activated_on_id` | `activatedOnId` | VARCHAR | ActivateOn entity ID, such as Individual.Id or Unified Individual.Id. Since v61.0. |
| `activation_record` | `activationRecord` | VARCHAR | Activated attributes payload as JSON BLOB Since v61.0. |
| `delta_type` | `deltaType` | VARCHAR | Activation delta type Since v61.0. |
| `publish_date` | `publishDate` | VARCHAR | Date that the activation was published. Since v61.0. |
| `segment_id` | `segmentId` | VARCHAR | Unique ID for each segment. Since v61.0. |
| `segment_on_id` | `segmentOnId` | VARCHAR | Key identifier based on the SegmentOn entity. Same as Activated-entity-id when ActivateOn = SegmentOn. Since v61.0. |
| `segmented_entity_fqk` | `segmentedEntityFqk` | VARCHAR | Fully Qualified Key of the segmented entity. Since v61.0. |

**Paging:** `batch_size`, `offset`.

**Notes:** The spec says `batch_size` runs from 1 to 4999 but defaults to 10000, so set it. `activation_record` is a JSON string. `id` isn't a row key: in the sample every row repeats the activation's ID. `activated_on_id` differs per row.

The only documented `delta_type` value is `A`, in the samples. The [removed official skill](https://github.com/forcedotcom/sf-skills/blob/2476476dda1b671762c6e963b9d10c4a7056f1c4/skills/data360-activate/SKILL.md) uses this call to verify delivery setup.

## activation_history_list

`GET /ssot/activations/{activationId}/history` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Activations/paths/~1ssot~1activations~1%7BactivationId%7D~1history/get) · evidence O · read-only

Returns a paginated list of publish-history records. With a market segment activation ID, returns the history for that single activation. With a market segment ID, returns the history for all activations under that segment. Routing is determined automatically based on the record ID. For paginated results, set `offset` to `0` in the initial request, then follow the `next_page_url` value in each response to retrieve subsequent pages. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `activation_id` | `activationId` | path | string | yes | Record ID (15- or 18-character) of a market segment activation or a market segment. Routing to single-activation or segment-wide history is determined automatically based on the record ID. Since v67.0. |
| `limit` | `limit` | query | integer |  | Maximum number of history records to return. Values are `1` through `200`. If unspecified, the default value is `20`. Since v67.0. |
| `offset` | `offset` | query | integer |  | Number of rows to skip before returning results. If unspecified, no rows are skipped. Since v67.0. |
| `order_by` | `orderBy` | query | string |  | Sort expression. If unspecified, the default value is `publishEndTime desc`. Since v67.0. |
| `page_token` | `pageToken` | query | string |  | Snapshot anchor for consistent pagination. Omit this value on the first request. The response's `next_page_url` includes the `page_token` for subsequent pages, which keeps the result set stable as new activations are published. Follow `next_page_url` rather than constructing this value. Since v67.0. |

```sql
CALL cdp.activation_history_list (activation_id => '1sgVF000000LfbFYAS', limit => 50);
```

**Result**

One row. Schema `ActivationHistoryCollectionRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `current_page_url` | `currentPageUrl` | VARCHAR | URL of the current page request, suitable for re-fetching the same page. Since v67.0. |
| `next_page_url` | `nextPageUrl` | VARCHAR | URL of the next page when more records are available. Absent on the last page. Since v67.0. |
| `records` | `records` | JSON (array of ActivationHistoryRecordRepresentation) | Publish-history records in the page. Most-recent-first by default. Since v67.0. |
| `total_pages` | `totalPages` | BIGINT | Total number of pages available for the query at the current page size. A next page exists while the current page index, derived from offset and limit, is below this value. Since v67.0. |
| `total_size` | `totalSize` | BIGINT | Number of publish-history records returned in the page. Because a grand total record count isn't returned, this value reflects the current page only. Use `total_pages` for the full pagination extent, and follow `next_page_url` to page through results. Since v67.0. |

**Paging:** Follow `next_page_url`, which carries `page_token`, until it's absent. Start with `offset` 0.

**Notes:** `activation_id` can also be a segment ID (`1sg...`), which returns the history of every activation on that segment. `records[].publishStatus` is `Created`, `Pending`, `Queued`, `Started`, `Running`, `Restarting`, `PartnerProcessing`, `Completed`, `Error`, `PartnerError`, `SegmentError` or `Skipped`, which differs from `last_publish_status`. `publishType` is `Manual` or `Scheduled`. Each record also has population counts and error fields.

`total_size` counts the current page only. The spec's sample `next_page_url` spells the page size `page_size`, while the option is `limit`, which is one more reason not to build the URL yourself.

## activation_data_object_category_list

`GET /ssot/activations/metadata/activatable-data-object-categories` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Activations/paths/~1ssot~1activations~1metadata~1activatable-data-object-categories/get) · evidence O · read-only

Returns the data object category types that are available for activation, optionally scoped to a data space. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `dataspace` | `dataSpace` | query | string |  | Name of the data space to scope the lookup. If unspecified, the request's data space context is used. Since v67.0. |

```sql
CALL cdp.activation_data_object_category_list (dataspace => 'default');
```

**Result**

One row. Schema `ActivatableDataObjectCategoriesRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `categories` | `categories` | JSON | List of category type identifiers that are available for activation, such as Profile, Engagement, and Other. Since v67.0. |

**Notes:** The column description names `Profile`, `Engagement` and `Other`, while the spec's sample returns `Engagement`, `Profile` and `Related`.

## activation_channel_preference_list

`GET /ssot/activations/metadata/channel-preferences` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Activations/paths/~1ssot~1activations~1metadata~1channel-preferences/get) · evidence O · read-only

Returns the channel preference options for a channel and data model object (DMO) pair, such as Primary phone or Secondary phone. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `channel` | `channel` | query | enum(DigitalId, Email, Phone, Push, Whatsapp) | yes | Contact point channel, such as `Email`, `Phone`, `Push`, `Whatsapp`, or `DigitalId`. Since v67.0. |
| `data_model_object_api_name` | `dataModelObjectApiName` | query | string | yes | API name of the contact point data model object (DMO). Since v67.0. |

```sql
CALL cdp.activation_channel_preference_list (channel => 'Email', data_model_object_api_name => 'ssot__ContactPointEmail__dlm');
```

**Result**

One row per item of `/preferences` in the response. Schema `ChannelPreferenceRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `label` | `label` | VARCHAR | Localized display label for the preference, such as `Primary` or `Secondary`. Since v67.0. |
| `option` | `option` | VARCHAR | Machine-readable preference option value. Since v67.0. |

**Notes:** The description mentions Primary and Secondary, but the spec's sample returns `ANY`, `PERSONAL`, `BUSINESS` and `PRIMARY`. Those match `data_source_preference = 'ANY'` in the `activation_create` examples, not the `ContactPointPref...` enum on that attribute. `channel` spells `Whatsapp` here, while contact point `type` has `WhatsApp`.

## activation_channel_list

`GET /ssot/activations/metadata/channels` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Activations/paths/~1ssot~1activations~1metadata~1channels/get) · evidence O · read-only

Returns the available activation channels for a data space. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `activate_on` | `activateOn` | query | string | yes | API name of the data model object (DMO) to activate on, such as `ssot__Individual__dlm`. The namespace prefix of the DMO resolves the contact point DMOs (Email, Phone, Push, and so on) for the data space. Since v67.0. |
| `batch_size` | `batchSize` | query | integer |  | Maximum number of results to return. Values are `1` through `200`. If unspecified, the default value is `20`. Since v67.0. |
| `dataspace` | `dataSpace` | query | string | yes | Name of the data space to scope channel mapping checks. Since v67.0. |
| `filters` | `filters` | query | string |  | Filter expression used to narrow results, such as `field eq value AND name contains foo`. Supported operators are `eq`, `!=`, `contains`, `in`, `>`, `<`, `>=`, and `<=`. Since v67.0. |
| `offset` | `offset` | query | integer |  | Number of rows to skip before returning results. If unspecified, no rows are skipped. Since v67.0. |
| `order_by` | `orderBy` | query | string |  | Sort expression in the form `field [asc\|desc][, field [asc\|desc]]*`. Since v67.0. |

```sql
CALL cdp.activation_channel_list (activate_on => 'ssot__Individual__dlm', dataspace => 'default');
```

**Result**

One row per item of `/channels` in the response. Other response fields go to `_meta`: `currentPageUrl`, `nextPageUrl`, `totalSize`. Schema `ChannelRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `api_name` | `apiName` | VARCHAR | API name of the underlying contact-point data model object (DMO), such as `ssot__ContactPointEmail__dlm`. Since v67.0. |
| `channel_type` | `channelType` | VARCHAR | Type of delivery channel. Since v67.0. |
| `is_mapped` | `isMapped` | BOOLEAN | Indicates whether the org has data mapped to the channel's data model object (DMO) in the requested data space (`true`) or not (`false`). Since v67.0. |
| `label` | `label` | VARCHAR | Display label for the channel's underlying data model object (DMO). Since v67.0. |

**Paging:** `next_page_url`.

**Notes:** Check `is_mapped`: `false` means the org has no data mapped to that channel's DMO in this data space. `api_name` values look like the contact point `entity_name` in `activation_create`, though the spec doesn't link them. `filters` takes `field eq value` here, unlike `activation_list`.

## activation_consent_dmo_list

`GET /ssot/activations/metadata/consent-data-model-objects` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Activations/paths/~1ssot~1activations~1metadata~1consent-data-model-objects/get) · evidence O · read-only

Returns the standard consent data model objects (DMOs) for a data space. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `activate_on` | `activateOn` | query | string | yes | API name of the data model object (DMO) to activate on, such as `ssot__Individual__dlm`. The namespace prefix of the DMO resolves the standard consent DMOs (ContactPointConsent, CommunicationSubscriptionConsent) for the data space. Since v67.0. |
| `dataspace` | `dataSpace` | query | string | yes | Name of the data space to scope the consent data model object lookup. Since v67.0. |

```sql
CALL cdp.activation_consent_dmo_list (activate_on => 'ssot__Individual__dlm', dataspace => 'default');
```

**Result**

One row. Schema `ConsentDataModelObjectsRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `data_model_objects` | `dataModelObjects` | JSON | Consent data model object (DMO) developer names. Currently always two entries: `contactPointConsent` and `communicationSubscriptionConsent`. Since v67.0. |

**Notes:** The column description says the entries are `contactPointConsent` and `communicationSubscriptionConsent`. The spec's sample returns `ssot__ContactPointConsent__dlm` and `ssot__CommunicationSubscriptionConsent__dlm`.

## activation_data_source_list

`GET /ssot/activations/metadata/data-sources` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Activations/paths/~1ssot~1activations~1metadata~1data-sources/get) · evidence O · read-only

Returns the data sources for a data model object (DMO). When you provide a channel, results are filtered to data sources compatible with that channel. The data space context is derived from the DMO. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `batch_size` | `batchSize` | query | integer |  | Maximum number of results to return. Values are `1` through `200`. If unspecified, the default value is `20`. Since v67.0. |
| `channel` | `channel` | query | enum(DigitalId, Email, Phone, Push, Whatsapp) |  | Contact point channel. If unspecified, data sources are returned for all channels compatible with the data model object (DMO). Since v67.0. |
| `data_model_object_api_name` | `dataModelObjectApiName` | query | string | yes | API name of the data model object (DMO) used as the activation target. The data space context is derived from this value. Since v67.0. |
| `filters` | `filters` | query | string |  | Filter expression used to narrow results, such as `field eq value AND name contains foo`. Supported operators are `eq`, `!=`, `contains`, `in`, `>`, `<`, `>=`, and `<=`. Since v67.0. |
| `offset` | `offset` | query | integer |  | Number of rows to skip before returning results. If unspecified, no rows are skipped. Since v67.0. |
| `order_by` | `orderBy` | query | string |  | Sort expression in the form `field [asc\|desc][, field [asc\|desc]]*`. Since v67.0. |

```sql
CALL cdp.activation_data_source_list (data_model_object_api_name => 'ssot__ContactPointEmail__dlm', channel => 'Email');
```

**Result**

One row per item of `/dataSources` in the response. Other response fields go to `_meta`: `currentPageUrl`, `nextPageUrl`, `totalSize`. Schema `DataSourceRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `data_source_objects` | `dataSourceObjects` | JSON | API names of the data-source objects backing the data source. Since v67.0. |
| `id` | `id` | VARCHAR | Record ID (18-character) of the data source. Since v67.0. |
| `name` | `name` | VARCHAR | Display name of the data source. Since v67.0. |

**Paging:** `next_page_url`.

**Notes:** These are data sources for one DMO, not a general list, and despite the option text, "activation target" here means a DMO, not an `activation_target`. There's no data space option. The spec calls `name` a display name, but sample values look like API names (`Salesforce_Home`). `data_source_objects` is empty in every sample row.

## activation_related_attribute_quota_list

`GET /ssot/activations/metadata/limits/related-attribute-activation-quota` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Activations/paths/~1ssot~1activations~1metadata~1limits~1related-attribute-activation-quota/get) · evidence O · read-only

Returns the related-attribute activation quota for the org. When you supply an activation ID, that activation is excluded from the current count, which supports edit flows. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `activation_id` | `activationId` | query | string |  | Record ID of an activation to exclude from the current count. Used during edit flows so that the activation being edited doesn't count against itself. Since v67.0. |

```sql
CALL cdp.activation_related_attribute_quota_list (activation_id => '85RVF000000CEf72AG');
```

**Result**

One row. Schema `RelatedAttributeActivationQuotaRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `current_activations` | `currentActivations` | BIGINT | Number of related-attribute activations currently in use. Since v67.0. |
| `has_met_limit` | `hasMetLimit` | BOOLEAN | Indicates whether `current_activations` has reached `max_activations` (`true`) or not (`false`). Since v67.0. |
| `max_activations` | `maxActivations` | BIGINT | Maximum number of related-attribute activations allowed for the org. Since v67.0. |

**Notes:** Returns one row, not a list. The spec's sample shows 49 of 20000.

## activation_related_attribute_limit_list

`GET /ssot/activations/metadata/limits/related-attribute-configuration-limits` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Activations/paths/~1ssot~1activations~1metadata~1limits~1related-attribute-configuration-limits/get) · evidence O · read-only

Returns the static configuration limits for related-attribute activations, such as maximum hops and attributes per activation. Since v67.0.

**Options**

None.

```sql
CALL cdp.activation_related_attribute_limit_list ();
```

**Result**

One row. Schema `RelatedAttributeConfigurationLimitsRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `attributes_per_activation` | `attributesPerActivation` | BIGINT | Maximum number of related attributes allowed per activation. Since v67.0. |
| `data_model_objects_per_activation` | `dataModelObjectsPerActivation` | BIGINT | Maximum number of data model objects (DMOs) referenced by a single activation. Since v67.0. |
| `data_model_objects_per_hop` | `dataModelObjectsPerHop` | BIGINT | Maximum number of data model objects (DMOs) that can be joined through per relationship hop. Since v67.0. |
| `max_hops` | `maxHops` | BIGINT | Maximum number of relationship hops allowed in a single related-attribute path. Since v67.0. |
| `max_segment_size` | `maxSegmentSize` | BIGINT | Maximum allowed segment size. Since v67.0. |
| `values_per_attribute` | `valuesPerAttribute` | BIGINT | Maximum number of distinct values allowed per attribute. Since v67.0. |

**Notes:** Returns one row, not a list. The spec's sample shows 300 attributes per activation, 8 DMOs per activation, 1 DMO per hop, 5 hops, a segment size of 150,000,000 and 25 values per attribute.

## match_boost_identity_provider_list

`GET /ssot/activations/metadata/match-boost-identity-providers` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Activations/paths/~1ssot~1activations~1metadata~1match-boost-identity-providers/get) · evidence O · read-only

Returns the identity providers for an activation target and data model object (DMO). Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `activate_on` | `activateOn` | query | string | yes | API name of the data model object (DMO), such as `ssot__Individual__dlm`. Since v67.0. |
| `activation_target_id` | `activationTargetId` | query | string | yes | Record ID (15- or 18-character) of the activation target. Since v67.0. |
| `dataspace` | `dataSpace` | query | string | yes | Name of the data space to scope the provider lookup. Since v67.0. |
| `selected_provider_id` | `selectedProviderId` | query | string |  | Record ID of the previously saved identity provider. Used in edit mode only. Since v67.0. |

```sql
CALL cdp.match_boost_identity_provider_list (activate_on => 'ssot__Individual__dlm', activation_target_id => '85UVF000000Dr4v2AC', dataspace => 'default');
```

**Result**

One row per item of `/providers` in the response. Schema `MatchBoostProviderRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `provider_id` | `providerId` | VARCHAR | Partner-issued provider ID. Since v67.0. |
| `provider_name` | `providerName` | VARCHAR | Display name of the identity provider. Since v67.0. |
| `supported_contact_points` | `supportedContactPoints` | JSON | Contact-point types that the provider can augment. Since v67.0. |

**Notes:** The spec has no option that sends a provider back. The [MCP request class](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/model/request/activation/ActivationCreateRequest.java) has `identity_provider_config` with [`id` and `name`](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/model/request/activation/IdentityMatchBoostProviderInput.java), which is missing from the spec. `supported_contact_points` shows `Email` and `PhoneNumber` in the sample.

## activation_streaming_eligibility_list

`GET /ssot/activations/metadata/streaming-eligibility` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Activations/paths/~1ssot~1activations~1metadata~1streaming-eligibility/get) · evidence O · read-only

Indicates whether streaming activation is allowed for a data model object (DMO), and provides the reason when it isn't. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `data_model_object_api_name` | `dataModelObjectApiName` | query | string | yes | API name of the data model object (DMO) to check streaming eligibility for. Since v67.0. |

```sql
CALL cdp.activation_streaming_eligibility_list (data_model_object_api_name => 'ssot__Individual__dlm');
```

**Result**

One row. Schema `StreamingEligibilityRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `allowed` | `allowed` | BOOLEAN | Indicates whether streaming activation is allowed for the requested data model object (DMO) (`true`) or not (`false`). Since v67.0. |
| `reason` | `reason` | VARCHAR | Human-readable explanation when `allowed` is `false`. Since v67.0. |

**Notes:** Returns one row, not a list. In the spec, `activation_create` accepts only `Batch` for `processing_type`, so it shows no way to request a streaming activation.

## activation_create

`POST /ssot/activations` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Activations/paths/~1ssot~1activations/post) · tool `d360_activation_create` · evidence O · changes org state

Create an activation. Since v60.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `id` | `id` | body | string |  | ID of the asset. Since v58.0. |
| `name` | `name` | body | string |  | Name of the asset. Since v58.0. |
| `namespace` | `namespace` | body | string |  | Namespace of the asset. Since v58.0. |
| `activation_mapping_schema` | `activationMappingSchema` | body | string |  | Type of identifier to use for activation audience matching, such as `PII` or `ANON`. Since v65.0. |
| `activation_target_name` | `activationTargetName` | body | string |  | Name for the activation target. Either activation_target_name or data_export_definition_id must be present. Since v60.0. |
| `activation_target_subject_config` | `activationTargetSubjectConfig` | body | [ActivationTargetSubjectConfigInput](#activationtargetsubjectconfiginputrepresentation) |  | Subject configuration for the activation target. Since v60.0. |
| `activation_type` | `activationType` | body | enum(ApiTriggered, Dmo, Segment) |  | Type of activation. If unspecified, defaults to `Segment`. Since v66.0. |
| `attribute_limiting_expression_config` | `attributeLimitingExpressionConfig` | body | [AttributeLimitingExpressionInputConfig](#attributelimitingexpressioninputconfigrepresentation) |  | Limiting expression configuration for the activation. Since v63.0. |
| `attributes_config` | `attributesConfig` | body | array of [AttributesConfigInput](#attributesconfiginputrepresentation) |  | Additional attributes for the activation. The `activate_on` attribute must be present. Since v60.0. |
| `contact_points_config` | `contactPointsConfig` | body | array of [ContactPointConfigInput](#contactpointconfiginputrepresentation) |  | Contact points configuration for the activation target. Since v60.0. |
| `curated_entity` | `curatedEntity` | body | [CuratedEntityInput](#curatedentityinputrepresentation) |  | Curated entity details for the activation. Since v63.0. |
| `customer_file_source` | `customerFileSource` | body | enum(FirstAndThirdParty, FirstParty, ThirdParty) |  | Customer file source for the activation target. Since v60.0. |
| `data_export_definition_id` | `dataExportDefinitionId` | body | string |  | Activation target ID for the activation. Either activation_target_name or data_export_definition_id must be present. Since v60.0. |
| `data_sources_config` | `dataSourcesConfig` | body | array of [ActivationDataSourceConfigInput](#activationdatasourceconfiginputrepresentation) |  | Data source configuration for the activation. Since v63.0. |
| `dataspace_name` | `dataSpaceName` | body | string |  | Name of the data space for the activation. Since v60.0. |
| `description` | `description` | body | string |  | Description of the activation. Since v60.0. |
| `developer_name` | `developerName` | body | string |  | Developer name of the activation. Must be unique. The request fails if an activation with the same developer name already exists. Since v67.0. |
| `direct_dmo_filters_config` | `directDmoFiltersConfig` | body | array of [DMOFilterConfigInput](#dmofilterconfiginputrepresentation) |  | Direct DMO filters. Since v60.0. |
| `limit_value` | `limitValue` | body | integer |  | Audience limit value for the activation. Since v63.0. |
| `market_segment_id` | `marketSegmentId` | body | string |  | Segment ID of the segment the activation needs to be created against. Either market_segment_id or segment_api_name must be present. Exclude this property for `ApiTriggered` activation types. Since v60.0. |
| `processing_type` | `processingType` | body | enum(Batch) |  | Processing type for DMO activations. Required when activation_type is `DMO`. Since v67.0. |
| `refresh_type` | `refreshType` | body | string | yes | Indicates the refresh type for the activation, (`Full` or `Incremental`). Since v60.0. |
| `related_dmo_filters_config` | `relatedDmoFiltersConfig` | body | array of [DMOFilterConfigInput](#dmofilterconfiginputrepresentation) |  | DMO filters on related attributes for the activation. Since v60.0. |
| `segment_api_name` | `segmentApiName` | body | string |  | Developer name of the segment. Either market_segment_id or segment_api_name must be present. Exclude this property for `ApiTriggered` activation types. Since v60.0. |
| `should_exclude_deletes` | `shouldExcludeDeletes` | body | boolean |  | Indicates whether to exclude records removed since the last refresh (`true`) or not (`false`). Since v60.0. |
| `should_exclude_updates` | `shouldExcludeUpdates` | body | boolean |  | Indicates whether to exclude records modified since the last refresh (`true`) or not (`false`). Since v60.0. |
| `source_dmo_name` | `sourceDmoName` | body | string |  | Developer name of the source DMO. Required for `ApiTriggered` activation types. Exclude this property for `Segment` activation types. Since v66.0. |
| `static_data_config` | `staticDataConfig` | body | array of [StaticDataConfigInput](#staticdataconfiginputrepresentation) |  | Configuration of campaign data attributes for an activation, which are name-value pairs including standard attributes (system-defined) and custom attributes (user-defined). Standard attributes are resolved by the system at activation run time and added as separate columns in the activation output. The available standard attributes are Activation Name, Activation ID, Segment Name, Segment ID, Activation Publish Start Time, and Activation Run ID. Standard attributes improve traceability, reconciliation, auditability, time-based processing, and disambiguation when multiple activations write to overlapping destinations. To use a standard attribute, select the exact standard attribute name and its corresponding value in the name-value pair. Since v60.0. |
| `waterfall_selected_child_segments_config` | `waterfallSelectedChildSegmentsConfig` | body | [WaterfallSelectedChildSegmentsConfigInput](#waterfallselectedchildsegmentsconfiginputrepresentation) |  | Details about the selected Waterfall child segments. Required when segment_api_name references a Waterfall segment type; must not be present otherwise. Since v67.0. |
| `segment_id` | `segmentId` | body | string |  | Not in the spec schema: from the MCP server's payload example. |
| `target_id` | `targetId` | body | string |  | Not in the spec schema: from the MCP server's payload example. |
| `schedule` | `schedule` | body | [activation_create_schedule](#activation_create_schedule) |  | Not in the spec schema: from the MCP server's payload example. |
| `mappings` | `mappings` | body | array of [activation_create_mappings](#activation_create_mappings) |  | Not in the spec schema: from the MCP server's payload example. |
| `activation_template_id` | `activationTemplateId` | body | string |  | Not in the spec schema: from the MCP server's request class. |
| `platform_name` | `platformName` | body | string |  | Not in the spec schema: from the MCP server's request class. |
| `identity_provider_config` | `identityProviderConfig` | body | array |  | Not in the spec schema: from the MCP server's request class. |

```sql
CALL cdp.activation_create (
  name => 'test_1234',
  dataspace_name => 'default',
  segment_api_name => 'seg_test',
  activation_target_name => 'S3_activation_target_test1',
  refresh_type => 'FULL_REFRESH',
  activation_target_subject_config => (developer_name = 'ssot__Individual__dlm'),
  attributes_config => (attributes = [
    (name = 'ssot__Id__c', label = 'Individual Id', entity_name = 'ssot__Individual__dlm', data_source_type = 'Text',
     reference_attribute_name = 'Id', preferred_name = 'attribute individual id', source = 'DIRECT', type = 'MODEL',
     query_path_config = (configs = [])),
    (name = 'ssot__Name__c', label = 'Account Name', entity_name = 'ssot__Account__dlm', data_source_type = 'Text',
     reference_attribute_name = 'Name', source = 'RELATED', type = 'MODELRELATED',
     query_path_config = (configs = [(query_paths = (query_path = [
       (field_name = 'ssot__Id__c', object_name = 'ssot__Individual__dlm'),
       (field_name = 'ssot__PartyId__c', object_name = 'ssot__Account__dlm')]))]))]),
  contact_points_config => (contact_points = [(
    type = 'EMAIL',
    entity_name = 'ssot__ContactPointEmail__dlm',
    attributes_config = (attributes = [(label = 'Email Address', name = 'ssot__EmailAddress__c')]),
    query_path_config = (configs = [(query_paths = (query_path = [
      (field_name = 'ssot__Id__c', object_name = 'ssot__Individual__dlm'),
      (field_name = 'ssot__PartyId__c', object_name = 'ssot__ContactPointEmail__dlm')]))]),
    sources_config = (contact_point_sources = [(data_source_preference = 'ANY', data_source_priority = 1, name = 'Any')]))]));
```

**Result**

One row. Schema `ActivationRepresentation`.

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
| `activation_definition_id` | `activationDefinitionId` | VARCHAR | ID of the activation definition. Since v60.0. |
| `activation_mapping_schema` | `activationMappingSchema` | VARCHAR | Type of identifier to use for activation audience matching, such as `PII` or `ANON`. Since v63.0. |
| `activation_record_schema` | `activationRecordSchema` | VARCHAR | JSON schema representing the activation JSON payload in the activation_record field of the AudienceDMO. Since v62.0. |
| `activation_target` | `activationTarget` | JSON (ActivationTargetRepresentation) | Activation target details. Since v60.0. |
| `activation_target_subject_config` | `activationTargetSubjectConfig` | JSON (ActivationTargetSubjectRepresentation) | Activation target subject for the activation. Since v60.0. |
| `activation_type` | `activationType` | VARCHAR | Type of activation. Since v66.0. |
| `attribute_limiting_expression_config` | `attributeLimitingExpressionConfig` | JSON (AttributeLimitingExpressionConfigRepresentation) | Limiting expression configuration for the activation. Since v63.0. |
| `attributes_config` | `attributesConfig` | JSON (ActivationAttributesConfigRepresentation) | Attributes for the activation. Since v60.0. |
| `contact_points_config` | `contactPointsConfig` | JSON (ContactPointsConfigRepresentation) | Contact points for the activation. Since v60.0. |
| `curated_entity` | `curatedEntity` | JSON (CdpAssetReferenceRepresentation) | Curated entity object details for the activation. Since v63.0. |
| `customer_file_source` | `customerFileSource` | VARCHAR | Customer file source of the activation platform. Since v60.0. |
| `data_sources_config` | `dataSourcesConfig` | JSON (ActivationDataSourcesRepresentation) | Data sources for the activation. Since v60.0. |
| `dataspace_name` | `dataSpaceName` | VARCHAR | Data space name for the activation. Since v60.0. |
| `description` | `description` | VARCHAR | Description of the activation. Since v60.0. |
| `developer_name` | `developerName` | VARCHAR | Developer name for the activation. Since v60.0. |
| `direct_dmo_filters_config` | `directDmoFiltersConfig` | JSON (DmoFiltersConfigRepresentation) | Direct DMO filters for the activation. Since v60.0. |
| `enabled` | `enabled` | BOOLEAN | Indicates whether the activation is enabled (`true`) or not (`false`). Since v60.0. |
| `history_audience_dmo_api_name` | `historyAudienceDmoApiName` | VARCHAR | API name for the history audience DMO. Since v60.0. |
| `history_audience_dmo_label` | `historyAudienceDmoLabel` | VARCHAR | Name of the history audience DMO. Since v60.0. |
| `is_enabled` | `isEnabled` | BOOLEAN | Indicates whether the activation is enabled (`true`) or not (`false`). Since v60.0. |
| `last_publish_date` | `lastPublishDate` | VARCHAR | Last publish timestamp of the activation. Use the format `yyyy-mm-dd`. Since v60.0. |
| `last_publish_status` | `lastPublishStatus` | VARCHAR | Last publish status of the activation. Since v60.0. |
| `last_publish_status_error_msg` | `lastPublishStatusErrorMsg` | VARCHAR | Error message encountered during last publish. Since v60.0. |
| `latest_audience_dmo_api_name` | `latestAudienceDmoApiName` | VARCHAR | API name for the latest audience DMO. Since v62.0. |
| `latest_audience_dmo_label` | `latestAudienceDmoLabel` | VARCHAR | Name for the latest audience DMO. Since v62.0. |
| `latest_audience_dmo_last_run_timestamp` | `latestAudienceDmoLastRunTimestamp` | VARCHAR | Timestamp of the last run for the latest audience DMO. Use the format `yyyy-mm-dd`. Since v62.0. |
| `limit_value` | `limitValue` | BIGINT | Audience limit value for the activation. Since v63.0. |
| `market_segment_id` | `marketSegmentId` | VARCHAR | Segment ID of the activation. Returned for `Segment` type activations. Since v60.0. |
| `membership_name` | `membershipName` | VARCHAR | Membership name of the activation. Since v60.0. |
| `processing_type` | `processingType` | VARCHAR | Processing type for DMO activations. Since v67.0. |
| `query_path_config` | `queryPathConfig` | JSON (QueryPathConfigListRepresentation) | Query path for the activation target. Since v63.0. |
| `refresh_type` | `refreshType` | VARCHAR | Refresh type of the activation. Since v60.0. |
| `related_dmo_filters_config` | `relatedDmoFiltersConfig` | JSON (DmoFiltersConfigRepresentation) | DMO filters on related attributes for the activation. Since v60.0. |
| `segment_api_name` | `segmentApiName` | VARCHAR | Segment API name. Returned for `Segment` type activations. Since v60.0. |
| `segment_id` | `segmentId` | VARCHAR | Segment ID of the activation. Returned for `Segment` type activations. Since v60.0. |
| `should_exclude_deletes` | `shouldExcludeDeletes` | BOOLEAN | Indicates whether to exclude records removed since the last refresh (`true`) or not (`false`). Since v60.0. |
| `should_exclude_updates` | `shouldExcludeUpdates` | BOOLEAN | Indicates whether to exclude records modified since the last refresh (`true`) or not (`false`). Since v60.0. |
| `source_dmo_name` | `sourceDmoName` | VARCHAR | Developer name of the source DMO. Since v66.0. |
| `static_data_config` | `staticDataConfig` | JSON (StaticDataConfigRepresentation) | Campaign data attributes configuration for an activation, which includes both standard attributes (system-defined) and custom attributes (user-defined). Since v60.0. |
| `status` | `status` | VARCHAR | Status of the activation. Since v60.0. |
| `waterfall_selected_child_segments_config` | `waterfallSelectedChildSegmentsConfig` | JSON (WaterfallSelectedChildSegmentsConfigRepresentation) | Details about the selected Waterfall child segments. Required when segment_api_name references a Waterfall segment type; must not be present otherwise. Since v67.0. |
| `activation_target_id` | `activationTargetId` | VARCHAR | Not in the spec schema: from the spec's examples. |
| `activation_target_name` | `activationTargetName` | VARCHAR | Not in the spec schema: from the spec's examples. |

**Notes:** **Required fields.** The spec marks only `refresh_type`. The [MCP tool](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/ActivationTools.java) also requires `name`, `dataspace_name`, `activation_target_subject_config` with `developer_name`, one of `activation_target_name` or `data_export_definition_id`, and one of `segment_api_name` or `market_segment_id`. It adds `attributes_config` with at least the primary entity's ID attribute. The [request class](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/model/request/activation/ActivationCreateRequest.java) says "exactly one" of each pair.

**What feeds the activation** depends on `activation_type`:

| Type | Source of rows | Evidence |
|---|---|---|
| `Segment` (default) | `segment_api_name` or `market_segment_id`. Add `waterfall_selected_child_segments_config` for a Waterfall segment | Spec |
| `ApiTriggered` | `source_dmo_name`, no segment | Spec |
| `Dmo` | `processing_type` = `Batch`. The spec's DMO example sets no segment and no `source_dmo_name`, and names the DMO only in `activation_target_subject_config`, though the option text says a segment is needed unless `ApiTriggered` | Spec, conflicting |

**Attributes.** In the spec's S3 example, `activation_target_subject_config.developerName` is the DMO you activate on, and `attributes_config` includes its ID (`ssot__Id__c` on `ssot__Individual__dlm`). A field on that DMO uses `source = 'DIRECT'`, `type = 'MODEL'` and an empty path. A field on another DMO uses `source = 'RELATED'`, `type = 'MODELRELATED'` and a `query_path_config` listing each hop from the subject. Paths use `object_name` and `field_name`, not `object_api_name` and `field_api_name` as segments do ([quirk T5](https://github.com/szymonlewandowski/config-snapshot-data360/blob/main/docs/api-quirks.md), community). `activation_related_attribute_limit_list` and `activation_related_attribute_quota_list` give the limits.

**Contact points.** Each entry names a contact point DMO in `entity_name`, such as `ssot__ContactPointEmail__dlm`, the kind of value in `activation_channel_list.api_name`. It also has the fields to send, the path from the subject, a filter and a source preference. The spec marks all seven attributes required, including `external_platform_hash_method`, but no spec example sends that one, and its Google Ads example has no contact points at all. The [MCP class](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/model/request/activation/ContactPointConfigInput.java) marks all of them optional.

**Enums.** The spec's enums don't match the values its examples send:

| Attribute | Spec | Spec examples |
|---|---|---|
| `refresh_type` | Text: `Full`, `Incremental`. Response enum: `Full_Refresh`, `Incremental` | `FULL_REFRESH`, `INCREMENTAL` |
| `activation_type` | `ApiTriggered`, `Dmo`, `Segment` | `DMO` |
| attribute `source` | `Direct`, `Related` | `DIRECT`, `RELATED` |
| attribute `type` | `Model`, `Model_Related` and others | `MODEL`, `MODELRELATED` |
| contact point `type` | `Email` and others | `EMAIL` |
| `data_source_preference` | `ContactPointPrefAny` and others | `ANY` |
| `filter_limit.order` | `Asc`, `Desc` | `ASC`, `DESC` |
| `attribute_limiting_expressions[].order` | `FilterSortOrderAsc`, `FilterSortOrderDesc` | `ASC`, `DESC` |

For `refresh_type`, the [request class](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/model/request/activation/ActivationCreateRequest.java) says `FULL_REFRESH/INCREMENTAL`, while the [tool text](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/ActivationTools.java) says `INCREMENTAL or Full`. Responses show `SEGMENT`, `DMO` and `API_TRIGGERED` for the type ([quirk T3](https://github.com/szymonlewandowski/config-snapshot-data360/blob/main/docs/api-quirks.md), community).

**Shapes.** The spec types `attributes_config`, `contact_points_config`, `direct_dmo_filters_config` and `related_dmo_filters_config` as arrays of a wrapper. Its examples send one wrapper object, `(attributes = [...])`, as shown here. Nested `query_path_config`, `query_paths`, `sources_config`, `filter_expression` and `entity_filter` differ in the same way. The MCP classes send a bare list with no wrapper.

**Attributes outside the spec.** The MCP request class also has `identity_provider_config`, `activation_template_id` and `platform_name`. The [payload example](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/resources/metadata/payload-examples.json) (`segment_id`, `target_id`, `schedule`, `mappings`) uses attributes found nowhere else, so don't follow it.

**Retries.** A repeat with the same `developer_name` fails, per the spec. No source covers a repeat without one, so don't retry this POST blindly.

## activation_publish

`POST /ssot/activations/{activationId}/actions/publish` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Activations/paths/~1ssot~1activations~1%7BactivationId%7D~1actions~1publish/post) · evidence O · changes org state

Initiate an on-demand publish job for a Batch data model object (DMO) activation. Since v66.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `activation_id` | `activationId` | path | string | yes | Unique identifier of a specific activation, such as the market segment activation ID or developer name. Since v66.0. |
| `full_refresh` | `fullRefresh` | body | boolean |  | Indicates whether the activation publish type is a full refresh (`true`) or incremental (`false`). **Note:** Execution behavior varies by DMO configuration. >**For Full Refresh DMOs**: Always performs a full refresh, regardless of this value. >**For Incremental DMOs**: - *Initial publish (day 0)*: Always performs a full refresh, regardless of this value. - *Subsequent publishes*: Defaults to incremental if `false` or omitted. Set to `true` to force a full refresh. Since v66.0. |

```sql
CALL cdp.activation_publish (activation_id => '85RVF000000CEf72AG', full_refresh => true);
```

**Result**

One row. Schema `ActivationPublishActionRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `errors` | `errors` | JSON (array of CdpErrorRepresentation) | List of errors that resulted from the action. Since v57.0. |
| `success` | `success` | BOOLEAN | Indicates whether the action was initiated successfully (`true`) or not (`false`). Since v57.0. |
| `publish_status` | `publishStatus` | VARCHAR | Publish status of the activation. Since v66.0. |

**Done when:** Poll `activation_get.last_publish_status`. The spec's enum is `Queued`, `Publishing`, `Partner_Processing`, `Success`, `Error`, `Partner_Error`, `Segment_Error`, `Skipped`, and its samples send `SUCCESS`, so compare case-insensitively. It doesn't say which values are final. `activation_history_list.records[].publishStatus` reports each run with another enum (`Completed` in samples).

**Notes:** For DMO activations only. In the spec's sample, `errors` holds one empty object while `success` is `true`, so read `success`. The spec documents `publish_status` values `Queued`, `Publishing`, `PartnerProcessing`, `Success`, `Error`, `PartnerError`, `SegmentError`, `Skipped` and `NotSupported`, and the sample returns `Publishing`.

## activation_disable

`POST /ssot/activations/actions/{activationId}/disable` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Activations/paths/~1ssot~1activations~1actions~1%7BactivationId%7D~1disable/post) · evidence O · changes org state

Disables a market segment activation. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `activation_id` | `activationId` | path | string | yes | Record ID (18-character) of the activation to disable. Since v67.0. |
| `dataspace` | `dataSpace` | query | string |  | Name of the data space to use as context for the request. Since v67.0. |

```sql
CALL cdp.activation_disable (activation_id => '85RVF000000CEf72AG');
```

**Result**

One row. Schema `ActionResultRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `message` | `message` | VARCHAR | Human-readable status or warning message. Can be null on success. Since v67.0. |
| `success` | `success` | BOOLEAN | Indicates whether the action completed successfully (`true`) or not (`false`). Since v67.0. |

**Notes:** The spec describes this for market segment activations and doesn't cover DMO activations. No source says what happens to data already delivered.

## activation_enable

`POST /ssot/activations/actions/{activationId}/enable` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Activations/paths/~1ssot~1activations~1actions~1%7BactivationId%7D~1enable/post) · evidence O · changes org state

Enables a market segment activation. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `activation_id` | `activationId` | path | string | yes | Record ID (18-character) of the activation to enable. Since v67.0. |
| `dataspace` | `dataSpace` | query | string |  | Name of the data space to use as context for the request. Since v67.0. |

```sql
CALL cdp.activation_enable (activation_id => '85RVF000000CEf72AG');
```

**Result**

One row. Schema `ActionResultRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `message` | `message` | VARCHAR | Human-readable status or warning message. Can be null on success. Since v67.0. |
| `success` | `success` | BOOLEAN | Indicates whether the action completed successfully (`true`) or not (`false`). Since v67.0. |

**Notes:** The spec describes this for market segment activations and doesn't cover DMO activations.

## activation_full_refresh_run

`POST /ssot/activations/actions/{activationId}/full-refresh` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Activations/paths/~1ssot~1activations~1actions~1%7BactivationId%7D~1full-refresh/post) · evidence O · changes org state

Triggers a full-refresh publish for an activation. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `activation_id` | `activationId` | path | string | yes | Record ID (15- or 18-character) of the market segment activation. Since v67.0. |

```sql
CALL cdp.activation_full_refresh_run (activation_id => '85RVF000000CEf72AG');
```

**Result**

One row. Schema `ActionResultRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `message` | `message` | VARCHAR | Human-readable status or warning message. Can be null on success. Since v67.0. |
| `success` | `success` | BOOLEAN | Indicates whether the action completed successfully (`true`) or not (`false`). Since v67.0. |

**Done when:** The spec documents no status for this call. `activation_get.last_publish_status` and `activation_history_list` are the available signals.

**Notes:** For market segment activations. DMO activations use `activation_publish` with `full_refresh`. `success` is about the action; the spec gives no job ID.

## activation_sync_retry

`POST /ssot/activations/actions/{activationId}/retry-sync` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Activations/paths/~1ssot~1activations~1actions~1%7BactivationId%7D~1retry-sync/post) · evidence O · changes org state

Retries the sync for an activation. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `activation_id` | `activationId` | path | string | yes | Record ID (15- or 18-character) of the market segment activation. Since v67.0. |

```sql
CALL cdp.activation_sync_retry (activation_id => '85RVF000000CEf72AG');
```

**Result**

One row. Schema `ActionResultRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `message` | `message` | VARCHAR | Human-readable status or warning message. Can be null on success. Since v67.0. |
| `success` | `success` | BOOLEAN | Indicates whether the action completed successfully (`true`) or not (`false`). Since v67.0. |

**Done when:** The spec documents no status for this call. `activation_get.last_publish_status` and `activation_history_list` are the available signals.

**Notes:** No source says what a retry resends or which states allow it.

## activation_update

`PUT /ssot/activations/{activationId}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Activations/paths/~1ssot~1activations~1%7BactivationId%7D/put) · tool `d360_activation_update` · evidence O · changes org state

Update a specific activation by ID. Since v60.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `activation_id` | `activationId` | path | string | yes | Spec: the ID or developer name. A community live test got 400 or 404 for names, so use the ID ([quirk T1](https://github.com/szymonlewandowski/config-snapshot-data360/blob/main/docs/api-quirks.md), one org). |
| `id` | `id` | body | string |  | ID of the asset. Since v58.0. |
| `name` | `name` | body | string |  | Name of the asset. Since v58.0. |
| `namespace` | `namespace` | body | string |  | Namespace of the asset. Since v58.0. |
| `activation_mapping_schema` | `activationMappingSchema` | body | string |  | Type of identifier to use for activation audience matching, such as `PII` or `ANON`. Since v65.0. |
| `activation_target_name` | `activationTargetName` | body | string |  | Name for the activation target. Either activation_target_name or data_export_definition_id must be present. Since v60.0. |
| `activation_target_subject_config` | `activationTargetSubjectConfig` | body | [ActivationTargetSubjectConfigInput](#activationtargetsubjectconfiginputrepresentation) |  | Subject configuration for the activation target. Since v60.0. |
| `activation_type` | `activationType` | body | enum(ApiTriggered, Dmo, Segment) |  | Type of activation. If unspecified, defaults to `Segment`. Since v66.0. |
| `attribute_limiting_expression_config` | `attributeLimitingExpressionConfig` | body | [AttributeLimitingExpressionInputConfig](#attributelimitingexpressioninputconfigrepresentation) |  | Limiting expression configuration for the activation. Since v63.0. |
| `attributes_config` | `attributesConfig` | body | array of [AttributesConfigInput](#attributesconfiginputrepresentation) |  | Additional attributes for the activation. The `activate_on` attribute must be present. Since v60.0. |
| `contact_points_config` | `contactPointsConfig` | body | array of [ContactPointConfigInput](#contactpointconfiginputrepresentation) |  | Contact points configuration for the activation target. Since v60.0. |
| `curated_entity` | `curatedEntity` | body | [CuratedEntityInput](#curatedentityinputrepresentation) |  | Curated entity details for the activation. Since v63.0. |
| `customer_file_source` | `customerFileSource` | body | enum(FirstAndThirdParty, FirstParty, ThirdParty) |  | Customer file source for the activation target. Since v60.0. |
| `data_export_definition_id` | `dataExportDefinitionId` | body | string |  | Activation target ID for the activation. Either activation_target_name or data_export_definition_id must be present. Since v60.0. |
| `data_sources_config` | `dataSourcesConfig` | body | array of [ActivationDataSourceConfigInput](#activationdatasourceconfiginputrepresentation) |  | Data source configuration for the activation. Since v63.0. |
| `dataspace_name` | `dataSpaceName` | body | string |  | Name of the data space for the activation. Since v60.0. |
| `description` | `description` | body | string |  | Description of the activation. Since v60.0. |
| `developer_name` | `developerName` | body | string |  | Developer name of the activation. Must be unique. The request fails if an activation with the same developer name already exists. Since v67.0. |
| `direct_dmo_filters_config` | `directDmoFiltersConfig` | body | array of [DMOFilterConfigInput](#dmofilterconfiginputrepresentation) |  | Direct DMO filters. Since v60.0. |
| `limit_value` | `limitValue` | body | integer |  | Audience limit value for the activation. Since v63.0. |
| `market_segment_id` | `marketSegmentId` | body | string |  | Segment ID of the segment the activation needs to be created against. Either market_segment_id or segment_api_name must be present. Exclude this property for `ApiTriggered` activation types. Since v60.0. |
| `processing_type` | `processingType` | body | enum(Batch) |  | Processing type for DMO activations. Required when activation_type is `DMO`. Since v67.0. |
| `refresh_type` | `refreshType` | body | string | yes | Indicates the refresh type for the activation, (`Full` or `Incremental`). Since v60.0. |
| `related_dmo_filters_config` | `relatedDmoFiltersConfig` | body | array of [DMOFilterConfigInput](#dmofilterconfiginputrepresentation) |  | DMO filters on related attributes for the activation. Since v60.0. |
| `segment_api_name` | `segmentApiName` | body | string |  | Developer name of the segment. Either market_segment_id or segment_api_name must be present. Exclude this property for `ApiTriggered` activation types. Since v60.0. |
| `should_exclude_deletes` | `shouldExcludeDeletes` | body | boolean |  | Indicates whether to exclude records removed since the last refresh (`true`) or not (`false`). Since v60.0. |
| `should_exclude_updates` | `shouldExcludeUpdates` | body | boolean |  | Indicates whether to exclude records modified since the last refresh (`true`) or not (`false`). Since v60.0. |
| `source_dmo_name` | `sourceDmoName` | body | string |  | Developer name of the source DMO. Required for `ApiTriggered` activation types. Exclude this property for `Segment` activation types. Since v66.0. |
| `static_data_config` | `staticDataConfig` | body | array of [StaticDataConfigInput](#staticdataconfiginputrepresentation) |  | Configuration of campaign data attributes for an activation, which are name-value pairs including standard attributes (system-defined) and custom attributes (user-defined). Standard attributes are resolved by the system at activation run time and added as separate columns in the activation output. The available standard attributes are Activation Name, Activation ID, Segment Name, Segment ID, Activation Publish Start Time, and Activation Run ID. Standard attributes improve traceability, reconciliation, auditability, time-based processing, and disambiguation when multiple activations write to overlapping destinations. To use a standard attribute, select the exact standard attribute name and its corresponding value in the name-value pair. Since v60.0. |
| `waterfall_selected_child_segments_config` | `waterfallSelectedChildSegmentsConfig` | body | [WaterfallSelectedChildSegmentsConfigInput](#waterfallselectedchildsegmentsconfiginputrepresentation) |  | Details about the selected Waterfall child segments. Required when segment_api_name references a Waterfall segment type; must not be present otherwise. Since v67.0. |
| `activation_template_id` | `activationTemplateId` | body | string |  | Not in the spec schema: from the MCP server's request class. |
| `platform_name` | `platformName` | body | string |  | Not in the spec schema: from the MCP server's request class. |
| `identity_provider_config` | `identityProviderConfig` | body | array |  | Not in the spec schema: from the MCP server's request class. |

```sql
CALL cdp.activation_update (activation_id => '85RVF000000CEf72AG', refresh_type => 'INCREMENTAL', should_exclude_deletes => true, should_exclude_updates => true, static_data_config => (static_data = [(name = 'Test_1', value = 'TestValue_1')]));
```

**Result**

One row. Schema `ActivationRepresentation`.

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
| `activation_definition_id` | `activationDefinitionId` | VARCHAR | ID of the activation definition. Since v60.0. |
| `activation_mapping_schema` | `activationMappingSchema` | VARCHAR | Type of identifier to use for activation audience matching, such as `PII` or `ANON`. Since v63.0. |
| `activation_record_schema` | `activationRecordSchema` | VARCHAR | JSON schema representing the activation JSON payload in the activation_record field of the AudienceDMO. Since v62.0. |
| `activation_target` | `activationTarget` | JSON (ActivationTargetRepresentation) | Activation target details. Since v60.0. |
| `activation_target_subject_config` | `activationTargetSubjectConfig` | JSON (ActivationTargetSubjectRepresentation) | Activation target subject for the activation. Since v60.0. |
| `activation_type` | `activationType` | VARCHAR | Type of activation. Since v66.0. |
| `attribute_limiting_expression_config` | `attributeLimitingExpressionConfig` | JSON (AttributeLimitingExpressionConfigRepresentation) | Limiting expression configuration for the activation. Since v63.0. |
| `attributes_config` | `attributesConfig` | JSON (ActivationAttributesConfigRepresentation) | Attributes for the activation. Since v60.0. |
| `contact_points_config` | `contactPointsConfig` | JSON (ContactPointsConfigRepresentation) | Contact points for the activation. Since v60.0. |
| `curated_entity` | `curatedEntity` | JSON (CdpAssetReferenceRepresentation) | Curated entity object details for the activation. Since v63.0. |
| `customer_file_source` | `customerFileSource` | VARCHAR | Customer file source of the activation platform. Since v60.0. |
| `data_sources_config` | `dataSourcesConfig` | JSON (ActivationDataSourcesRepresentation) | Data sources for the activation. Since v60.0. |
| `dataspace_name` | `dataSpaceName` | VARCHAR | Data space name for the activation. Since v60.0. |
| `description` | `description` | VARCHAR | Description of the activation. Since v60.0. |
| `developer_name` | `developerName` | VARCHAR | Developer name for the activation. Since v60.0. |
| `direct_dmo_filters_config` | `directDmoFiltersConfig` | JSON (DmoFiltersConfigRepresentation) | Direct DMO filters for the activation. Since v60.0. |
| `enabled` | `enabled` | BOOLEAN | Indicates whether the activation is enabled (`true`) or not (`false`). Since v60.0. |
| `history_audience_dmo_api_name` | `historyAudienceDmoApiName` | VARCHAR | API name for the history audience DMO. Since v60.0. |
| `history_audience_dmo_label` | `historyAudienceDmoLabel` | VARCHAR | Name of the history audience DMO. Since v60.0. |
| `is_enabled` | `isEnabled` | BOOLEAN | Indicates whether the activation is enabled (`true`) or not (`false`). Since v60.0. |
| `last_publish_date` | `lastPublishDate` | VARCHAR | Last publish timestamp of the activation. Use the format `yyyy-mm-dd`. Since v60.0. |
| `last_publish_status` | `lastPublishStatus` | VARCHAR | Last publish status of the activation. Since v60.0. |
| `last_publish_status_error_msg` | `lastPublishStatusErrorMsg` | VARCHAR | Error message encountered during last publish. Since v60.0. |
| `latest_audience_dmo_api_name` | `latestAudienceDmoApiName` | VARCHAR | API name for the latest audience DMO. Since v62.0. |
| `latest_audience_dmo_label` | `latestAudienceDmoLabel` | VARCHAR | Name for the latest audience DMO. Since v62.0. |
| `latest_audience_dmo_last_run_timestamp` | `latestAudienceDmoLastRunTimestamp` | VARCHAR | Timestamp of the last run for the latest audience DMO. Use the format `yyyy-mm-dd`. Since v62.0. |
| `limit_value` | `limitValue` | BIGINT | Audience limit value for the activation. Since v63.0. |
| `market_segment_id` | `marketSegmentId` | VARCHAR | Segment ID of the activation. Returned for `Segment` type activations. Since v60.0. |
| `membership_name` | `membershipName` | VARCHAR | Membership name of the activation. Since v60.0. |
| `processing_type` | `processingType` | VARCHAR | Processing type for DMO activations. Since v67.0. |
| `query_path_config` | `queryPathConfig` | JSON (QueryPathConfigListRepresentation) | Query path for the activation target. Since v63.0. |
| `refresh_type` | `refreshType` | VARCHAR | Refresh type of the activation. Since v60.0. |
| `related_dmo_filters_config` | `relatedDmoFiltersConfig` | JSON (DmoFiltersConfigRepresentation) | DMO filters on related attributes for the activation. Since v60.0. |
| `segment_api_name` | `segmentApiName` | VARCHAR | Segment API name. Returned for `Segment` type activations. Since v60.0. |
| `segment_id` | `segmentId` | VARCHAR | Segment ID of the activation. Returned for `Segment` type activations. Since v60.0. |
| `should_exclude_deletes` | `shouldExcludeDeletes` | BOOLEAN | Indicates whether to exclude records removed since the last refresh (`true`) or not (`false`). Since v60.0. |
| `should_exclude_updates` | `shouldExcludeUpdates` | BOOLEAN | Indicates whether to exclude records modified since the last refresh (`true`) or not (`false`). Since v60.0. |
| `source_dmo_name` | `sourceDmoName` | VARCHAR | Developer name of the source DMO. Since v66.0. |
| `static_data_config` | `staticDataConfig` | JSON (StaticDataConfigRepresentation) | Campaign data attributes configuration for an activation, which includes both standard attributes (system-defined) and custom attributes (user-defined). Since v60.0. |
| `status` | `status` | VARCHAR | Status of the activation. Since v60.0. |
| `waterfall_selected_child_segments_config` | `waterfallSelectedChildSegmentsConfig` | JSON (WaterfallSelectedChildSegmentsConfigRepresentation) | Details about the selected Waterfall child segments. Required when segment_api_name references a Waterfall segment type; must not be present otherwise. Since v67.0. |
| `activation_target_id` | `activationTargetId` | VARCHAR | Not in the spec schema: from the spec's examples. |
| `activation_target_name` | `activationTargetName` | VARCHAR | Not in the spec schema: from the spec's examples. |

**Notes:** This is a `PUT`, and the spec still requires `refresh_type`. The spec's example sends only a few fields, and the [MCP class](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/model/request/activation/ActivationUpdateRequest.java) says "populate only what you want to change". No source says whether omitted fields keep their values, so compare with `activation_get` afterwards. The enum and shape conflicts under `activation_create` apply here too, and the output of `activation_get` can't be sent back as input.

No source lists the fields that can't change.

## Schemas

Attribute names are keywords inside the object they belong to, so completion offers exactly these.

### ActivationAdditionalAttributesConfigInputRepresentation

Represents the additional attributes configuration for the market segment activation input.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `activation_platform_attr_id` | `activationPlatformAttrId` | string |  | Activation platform attribute ID. Since v60.0. |
| `data_source_type` | `dataSourceType` | string |  | Type of the data source. Since v60.0. |
| `entity_name` | `entityName` | string |  | List of records in an Audience DMO. Since v60.0. |
| `external_platform_attribute_name` | `externalPlatformAttributeName` | string |  | Attribute destination name for an external platform. Since v64.0. |
| `filter_expression` | `filterExpression` | [AttributeFilterExpressionInput](#attributefilterexpressioninputrepresentation) |  | Attribute filter expression. Since v60.0. |
| `is_rolluppable` | `isRolluppable` | boolean |  | Indicates whether the attribute can roll up (`true`) or not (`false`). Since v60.0. |
| `label` | `label` | string |  | Label of the attribute. Since v60.0. |
| `name` | `name` | string |  | Name of the attribute. Since v60.0. |
| `preferred_name` | `preferredName` | string |  | Preferred name of the attribute. Since v60.0. |
| `query_path_config` | `queryPathConfig` | array of [QueryPathConfigListInput](#querypathconfiglistinputrepresentation) |  | Query path from the `activate_on` entity to the additional attribute entity. Since v60.0. |
| `reference_attribute_name` | `referenceAttributeName` | string |  | Developer name of the reference attribute. Since v60.0. |
| `source` | `source` | enum(Direct, Related) |  | Data export source type. Since v60.0. |
| `type` | `type` | enum(Computed_Dimension, Computed_Measure, Model, Model_Related, Non_Aggregatable_Computed_Measure) |  | Data export attribute type. Since v60.0. |

### ActivationContactPointInputRepresentation

Represents the activation contact point input.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `attributes_config` | `attributesConfig` | array of [ContactPointAttributesConfigInput](#contactpointattributesconfiginputrepresentation) | yes | Attributes for the contact point. Since v60.0. |
| `entity_name` | `entityName` | string | yes | Entity name for the contact point. Since v60.0. |
| `external_platform_hash_method` | `externalPlatformHashMethod` | string |  | The spec marks this required, but the example here leaves it out. External platform hash method for the contact point. Since v60.0. |
| `filter_expression` | `filterExpression` | array of [ContactPointFilterExpressionInput](#contactpointfilterexpressioninputrepresentation) |  | The spec marks this required, but the example here leaves it out. Filter expression for the contact point. Since v60.0. |
| `query_path_config` | `queryPathConfig` | array of [QueryPathConfigListInput](#querypathconfiglistinputrepresentation) | yes | Query path configuration list. Since v63.0. |
| `sources_config` | `sourcesConfig` | array of [ContactPointSourcesConfigInput](#contactpointsourcesconfiginputrepresentation) | yes | Source configurations for the contact point. Since v60.0. |
| `type` | `type` | enum(Email, Maid, Ott, Phone, Push, SubscriberKeyEmail, SubscriberKeyPhone, WhatsApp) | yes | Type of contact point. Since v60.0. |

### ActivationDataSourceConfigInputRepresentation

Represents the configuration input for an activation data source.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `data_sources` | `dataSources` | array of [DataSourceNameConfigInput](#datasourcenameconfiginputrepresentation) | yes | List of data sources for the activation. Since v63.0. |

### ActivationTargetSubjectConfigInputRepresentation

Represents the activation target subject configuration input.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `id` | `id` | string |  | ID of the asset. Since v58.0. |
| `name` | `name` | string |  | Name of the asset. Since v58.0. |
| `namespace` | `namespace` | string |  | Namespace of the asset. Since v58.0. |
| `developer_name` | `developerName` | string |  | Developer name of activation target subject configuration. Since v60.0. |
| `query_path_config` | `queryPathConfig` | array of [QueryPathConfigListInput](#querypathconfiglistinputrepresentation) |  | Path of the activation target subject configuration. Since v60.0. |

### AttributeFilterExpressionInputRepresentation

Represents the attribute filter expression input.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `id` | `id` | string |  | ID of the asset. Since v58.0. |
| `name` | `name` | string |  | Name of the asset. Since v58.0. |
| `namespace` | `namespace` | string |  | Namespace of the asset. Since v58.0. |
| `conjunction` | `conjunction` | enum(FilterConjunctionAnd, FilterConjunctionOr) |  | Filter conjunction. Since v60.0. |
| `filters` | `filters` | array of [AttributeFilterInput](#attributefilterinputrepresentation) |  | Attribute filters. Since v60.0. |

### AttributeFilterInputRepresentation

Represents the attribute filter input.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `id` | `id` | string |  | ID of the asset. Since v58.0. |
| `name` | `name` | string |  | Name of the asset. Since v58.0. |
| `namespace` | `namespace` | string |  | Namespace of the asset. Since v58.0. |
| `attribute_id` | `attributeId` | string |  | ID of the attribute. Since v60.0. |
| `attribute_name` | `attributeName` | string |  | Name of the attribute. Since v60.0. |
| `date_units` | `dateUnits` | enum(Days, Months, Years) |  | Date unit filter. Since v60.0. |
| `operator` | `operator` | string |  | Operator of the attribute. Since v60.0. |
| `type` | `type` | enum(FilterOperatorDataTypeBoolean, FilterOperatorDataTypeDate, FilterOperatorDataTypeDateOnly, FilterOperatorDataTypeExactlyRelativeDate, FilterOperatorDataTypeNumber, FilterOperatorDataTypeRelateToNowDate, FilterOperatorDataTypeText) |  | Filter operator type. Since v60.0. |
| `value` | `value` | array of [FilterValuesInput](#filtervaluesinputrepresentation) |  | Filter values. Since v60.0. |

### AttributeLimitingExpressionInputConfigRepresentation

Represents the limiting expression configuration input for an activation.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `attribute_limiting_expressions` | `attributeLimitingExpressions` | array of [AttributeLimitingExpressionInput](#attributelimitingexpressioninputrepresentation) | yes | Input list of an attribute's limiting expressions. Since v63.0. |

### AttributeLimitingExpressionInputRepresentation

Represents the limiting expression input for an activation.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `attribute_name` | `attributeName` | string | yes | Name of the attribute. Since v63.0. |
| `entity_name` | `entityName` | string | yes | Name of the entity. Since v63.0. |
| `order` | `order` | enum(FilterSortOrderAsc, FilterSortOrderDesc) | yes | Sort order for the filter. Since v63.0. |
| `query_path_config` | `queryPathConfig` | array of [QueryPathConfigListInput](#querypathconfiglistinputrepresentation) | yes | Query path configuration input. Since v63.0. |
| `type` | `type` | string | yes | Type of attribute. Since v63.0. |

### AttributesConfigInputRepresentation

Represents the configuration input for attributes.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `attributes` | `attributes` | array of [ActivationAdditionalAttributesConfigInput](#activationadditionalattributesconfiginputrepresentation) | yes | Additional attributes for the activation. Since v63.0. |

### BaseComparisonInputRepresentation

Represents the base comparison input. Abstract parent of: - [Entity Scoped Group Input](https://developer.salesforce.com/docs/data/connectapi/references/spec?meta=type%3AEntity%2BScoped%2BGroup%2BInput) - [Logical Comparison Input](https://developer.salesforce.com/docs/data/connectapi/references/spec?meta=type%3ALogical%2BComparison%2BInput) - [Primitive Comparison Input](https://developer.salesforce.com/docs/data/connectapi/references/spec?meta=type%3APrimitive%2BComparison%2BInput)

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `filters_config` | `filtersConfig` | array of [TypeAndFilterInputRepresentationConfig](#typeandfilterinputrepresentationconfig) | yes | Logical comparison input list wrapper. Since v60.0. |
| `operator` | `operator` | string | yes | Operator of the comparison. Since v60.0. |
| `attribute_source` | `attributeSource` | string |  | Not in the spec schema: from the spec's examples. |
| `condition` | `condition` | [BaseComparisonInput_condition](#basecomparisoninput_condition) |  | Not in the spec schema: from the spec's examples. |
| `type` | `type` | string |  | Not in the spec schema: from the spec's examples. |
| `object_name` | `objectName` | string |  | Not in the spec schema: from the spec's examples. |
| `query_path_config_from_activate_on_to_entity` | `queryPathConfigFromActivateOnToEntity` | [BaseComparisonInput_queryPathConfigFromActivateOnToEntity](#basecomparisoninput_querypathconfigfromactivateontoentity) |  | Not in the spec schema: from the spec's examples. |

### BaseComparisonInput_condition

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `filters_config` | `filtersConfig` | [BaseComparisonInput_condition_filtersConfig](#basecomparisoninput_condition_filtersconfig) |  | Seen in examples: the spec types the parent as a free-form object. |
| `operator` | `operator` | string |  | Seen in examples: the spec types the parent as a free-form object. |
| `self_reference` | `selfReference` | boolean |  | Seen in examples: the spec types the parent as a free-form object. |
| `subject` | `subject` | [BaseComparisonInput_condition_subject](#basecomparisoninput_condition_subject) |  | Seen in examples: the spec types the parent as a free-form object. |
| `filter_config` | `filterConfig` | [BaseComparisonInput_condition_filterConfig](#basecomparisoninput_condition_filterconfig) |  | Seen in examples: the spec types the parent as a free-form object. |

### BaseComparisonInput_condition_filterConfig

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `values` | `values` | array |  | Seen in examples: the spec types the parent as a free-form object. |

### BaseComparisonInput_condition_filtersConfig

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `filters` | `filters` | array |  | Seen in examples: the spec types the parent as a free-form object. |

### BaseComparisonInput_condition_subject

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `field_name` | `fieldName` | string |  | Seen in examples: the spec types the parent as a free-form object. |
| `object_name` | `objectName` | string |  | Seen in examples: the spec types the parent as a free-form object. |

### BaseComparisonInput_queryPathConfigFromActivateOnToEntity

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `configs` | `configs` | array of [BaseComparisonInput_queryPathConfigFromActivateOnToEntity_configs](#basecomparisoninput_querypathconfigfromactivateontoentity_configs) |  | Seen in examples: the spec types the parent as a free-form object. |

### BaseComparisonInput_queryPathConfigFromActivateOnToEntity_configs

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `query_paths` | `queryPaths` | [BaseComparisonInput_queryPathConfigFromActivateOnToEntity_configs_queryPaths](#basecomparisoninput_querypathconfigfromactivateontoentity_configs_querypaths) |  | Seen in examples: the spec types the parent as a free-form object. |

### BaseComparisonInput_queryPathConfigFromActivateOnToEntity_configs_queryPaths

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `query_path` | `queryPath` | array of [BaseComparisonInput_queryPathConfigFromActivateOnToEntity_configs_queryPaths_queryPath](#basecomparisoninput_querypathconfigfromactivateontoentity_configs_querypaths_querypath) |  | Seen in examples: the spec types the parent as a free-form object. |

### BaseComparisonInput_queryPathConfigFromActivateOnToEntity_configs_queryPaths_queryPath

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `field_name` | `fieldName` | string |  | Seen in examples: the spec types the parent as a free-form object. |
| `object_name` | `objectName` | string |  | Seen in examples: the spec types the parent as a free-form object. |

### ContactPointAttributeInputRepresentation

Represents the attribute of an activation contact point.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `label` | `label` | string | yes | Label of the attribute. Since v63.0. |
| `name` | `name` | string | yes | Name of the attribute. Since v63.0. |
| `preferred_name` | `preferredName` | string |  | The spec marks this required, but the example here leaves it out. Preferred name of the attribute. Since v63.0. |

### ContactPointAttributesConfigInputRepresentation

Represents the configuration input for the attributes of an activation contact point.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `attributes` | `attributes` | array of [ContactPointAttributeInput](#contactpointattributeinputrepresentation) | yes | List of attributes for the activations. Since v63.0. |

### ContactPointConfigInputRepresentation

Represents the activation contact point configuration input.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `id` | `id` | string |  | ID of the asset. Since v58.0. |
| `name` | `name` | string |  | Name of the asset. Since v58.0. |
| `namespace` | `namespace` | string |  | Namespace of the asset. Since v58.0. |
| `contact_points` | `contactPoints` | array of [ActivationContactPointInput](#activationcontactpointinputrepresentation) |  | List of contact points. |

### ContactPointFilterExpressionInputRepresentation

Represents the input for an activation contact point filter expression.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `contact_point_dmo_filters` | `contactPointDmoFilters` | array of [DMOFilterInput](#dmofilterinputrepresentation) | yes | List of contact point DMO filters. Since v63.0. |

### ContactPointSourceInputRepresentation

Represents the contact point source input.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `id` | `id` | string |  | ID of the asset. Since v58.0. |
| `name` | `name` | string |  | Name of the asset. Since v58.0. |
| `namespace` | `namespace` | string |  | Namespace of the asset. Since v58.0. |
| `data_source_id` | `dataSourceId` | string |  | Record ID for the data source. Since v60.0. |
| `data_source_preference` | `dataSourcePreference` | enum(ContactPointPrefAny, ContactPointPrefBusiness, ContactPointPrefPersonal, ContactPointPrefPrimary) |  | Preference for the data source. Since v60.0. |
| `data_source_priority` | `dataSourcePriority` | integer |  | Priority for the data source. Since v60.0. |

### ContactPointSourcesConfigInputRepresentation

Represents the configuration input for contact point sources.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `contact_point_sources` | `contactPointSources` | array of [ContactPointSourceInput](#contactpointsourceinputrepresentation) | yes | List of contact point sources. Since v63.0. |

### CuratedEntityInputRepresentation

Represents the input details for a curated entity.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `label` | `label` | string | yes | DMO label of the curated entity. Since v63.0. |
| `name` | `name` | string | yes | DMO API name of the curated entity. Since v63.0. |

### DMOFilterConfigInputRepresentation

Represents DMO filter configuration input.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `filters` | `filters` | array of [DMOFilterInput](#dmofilterinputrepresentation) |  | Filters for the DMO filter configuration. |

### DMOFilterInputRepresentation

Represents the DMO filter input.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `id` | `id` | string |  | ID of the asset. Since v58.0. |
| `name` | `name` | string |  | Name of the asset. Since v58.0. |
| `namespace` | `namespace` | string |  | Namespace of the asset. Since v58.0. |
| `entity_filter` | `entityFilter` | array of [BaseComparisonInput](#basecomparisoninputrepresentation) |  | Entity filter. Since v60.0. |
| `entity_filter_type` | `entityFilterType` | string |  | Type of the entity filter. Since v60.0. |
| `entity_name` | `entityName` | string |  | Name of the entity. Since v60.0. |
| `filter_limit` | `filterLimit` | [DmoFilterLimitInput](#dmofilterlimitinputrepresentation) |  | Filter limit. Since v60.0. |
| `inherited_filter` | `inheritedFilter` | array of [BaseComparisonInput](#basecomparisoninputrepresentation) |  | Inherited filter. Since v60.0. |
| `inherited_filter_type` | `inheritedFilterType` | string |  | Type of the inherited filter. Since v60.0. |
| `query_path_config_for_activate_on_to_container` | `queryPathConfigForActivateOnToContainer` | array of [QueryPathConfigListInput](#querypathconfiglistinputrepresentation) |  | Path from the activation to the container. *Type:** Query Config List Input Since v60.0. |
| `query_path_config_from_container_to_entity` | `queryPathConfigFromContainerToEntity` | array of [QueryPathConfigListInput](#querypathconfiglistinputrepresentation) |  | Path from the container to the entity. Since v60.0. |

### DataSourceNameConfigInputRepresentation

Represents the data source name configuration input.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `id` | `id` | string |  | ID of the asset. Since v58.0. |
| `name` | `name` | string |  | Name of the asset. Since v58.0. |
| `namespace` | `namespace` | string |  | Namespace of the asset. Since v58.0. |
| `data_source_name` | `dataSourceName` | string | yes | Data source API name for the activation. Since v60.0. |

### DmoFilterLimitInputRepresentation

Represents the DMO filter limit input.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `id` | `id` | string |  | ID of the asset. Since v58.0. |
| `name` | `name` | string |  | Name of the asset. Since v58.0. |
| `namespace` | `namespace` | string |  | Namespace of the asset. Since v58.0. |
| `attribute_name` | `attributeName` | string |  | Name of the attribute. Since v60.0. |
| `max_number_of_values` | `maxNumberOfValues` | integer |  | Max number of values. Since v60.0. |
| `order` | `order` | enum(Asc, Desc) |  | Filter sort order. Since v60.0. |

### FilterValuesInputRepresentation

Represents the input for filter values.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `values` | `values` | array of string | yes | List of values. Since v60.0. |

### QueryPathConfigInputRepresentation

Represents the query path configuration input.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `id` | `id` | string |  | ID of the asset. Since v58.0. |
| `name` | `name` | string |  | Name of the asset. Since v58.0. |
| `namespace` | `namespace` | string |  | Namespace of the asset. Since v58.0. |
| `query_paths` | `queryPaths` | array of [QueryPathInputRepresentationConfig](#querypathinputrepresentationconfig) |  | List of query path configurations. Since v60.0. |

### QueryPathConfigListInputRepresentation

Represents the query path configuration list input.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `id` | `id` | string |  | ID of the asset. Since v58.0. |
| `name` | `name` | string |  | Name of the asset. Since v58.0. |
| `namespace` | `namespace` | string |  | Namespace of the asset. Since v58.0. |
| `configs` | `configs` | array of [QueryPathConfigInput](#querypathconfiginputrepresentation) |  | Query path configuration. |

### QueryPathInputRepresentation

Represents the query path input.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `id` | `id` | string |  | ID of the asset. Since v58.0. |
| `name` | `name` | string |  | Name of the asset. Since v58.0. |
| `namespace` | `namespace` | string |  | Namespace of the asset. Since v58.0. |
| `field_label` | `fieldLabel` | string |  | Field label. Since v60.0. |
| `field_name` | `fieldName` | string |  | Field name. Since v60.0. |
| `object_label` | `objectLabel` | string |  | Object label. Since v60.0. |
| `object_name` | `objectName` | string |  | Object name. Since v60.0. |

### QueryPathInputRepresentationConfig

Represents the input for a list of query paths.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `query_path` | `queryPath` | array of [QueryPathInput](#querypathinputrepresentation) | yes | List of query paths. Since v60.0. |

### StaticDataConfigInputRepresentation

Represents the configuration input for static data.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `static_data` | `staticData` | array of [StaticDataInput](#staticdatainputrepresentation) | yes | List of standard attributes. Since v60.0. |

### StaticDataInputRepresentation

Represents the input for static data.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `name` | `name` | string | yes | Name of the campaign data attribute. For custom attributes, provide any user-defined name-value pair. For standard attributes, use one of these name-value pairs: - Activation Name: `ACTIVATION_NAME` - Activation ID: `ACTIVATION_ID` - Segment Name: `SEGMENT_NAME` - Segment ID: `SEGMENT_ID` - Activation Publish Start Time: `PUBLISH_TIMESTAMP` - Activation Run ID: `ACTIVATION_RUN_ID` Since v60.0. |
| `value` | `value` | string | yes | Value of the campaign data attribute. For custom attributes, provide the constant value to include in the activation output. For standard attributes, provide the exact value associated with the selected standard attribute name. The system replaces this value with the actual metadata value at activation run time. Since v60.0. |

### TypeAndFilterInputRepresentation

Represents a wrapper for logical comparison filters.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `filter` | `filter` | array of [BaseComparisonInput](#basecomparisoninputrepresentation) | yes | Filter for the entity. Since v60.0. |
| `type` | `type` | string | yes | Name of the entity. Since v60.0. |

### TypeAndFilterInputRepresentationConfig

Represents logical comparison input for a filter configuration.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `filters` | `filters` | array of [TypeAndFilterInput](#typeandfilterinputrepresentation) | yes | List of filters. Since v60.0. |

### WaterfallChildSegmentNamesInputRepresentation

Represents a list of child segments input for a Waterfall activation.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `child_segments` | `childSegments` | array of string |  | List of child segment developer names. Since v67.0. |

### WaterfallSelectedChildSegmentsConfigInputRepresentation

Represents the input configuration of the selected child segments for a Waterfall activation.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `child_segments_config` | `childSegmentsConfig` | [WaterfallChildSegmentNamesInput](#waterfallchildsegmentnamesinputrepresentation) |  | List of child segment developer names selected for the Waterfall activation. Since v67.0. |
| `selected_all_segments` | `selectedAllSegments` | boolean |  | Indicates whether all child segments of the Waterfall segment are selected (`true`) or not (`false`). Since v67.0. |

### activation_create_mappings

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `segment_field` | `segment_field` | string |  | Seen in examples: the spec types the parent as a free-form object. |
| `target_field` | `target_field` | string |  | Seen in examples: the spec types the parent as a free-form object. |

### activation_create_schedule

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `frequency` | `frequency` | string |  | Seen in examples: the spec types the parent as a free-form object. |
| `time` | `time` | string |  | Seen in examples: the spec types the parent as a free-form object. |
