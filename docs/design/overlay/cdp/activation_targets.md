# Activation Targets

Part of the [CDP function reference](functions.md). Nothing here is implemented or tested against an org. Every result also has the [standard columns](functions.md#result-schema).

An activation target is a destination for segment data: a file drop such as Amazon S3 or SFTP, Marketing Cloud, Data 360 itself, or an ad platform. You set it up once, then [`activation_create`](activations.md#activation_create) sends a segment to it by `activation_target_name`. So the order is: find the platform, create the target, check that it's active, and only then create the activation.

The gotchas that matter most:

- **The spec undersells `connector`.** Its schema lists only `name` and `output_format`, while its own examples send more per platform. [`activation_target_create`](#activation_target_create) has the table.
- **Enum spelling isn't stable.** The schema says `Active`, examples show `ACTIVE`, and filters use `active`. Compare without case.
- **Id or name depends on the call.** Enable and disable take an 18-character id. Get, update and delete claim both, but [one org](https://github.com/szymonlewandowski/config-snapshot-data360/blob/main/docs/api-quirks.md) found id only (community).
- **Availability is uneven.** Enable, disable, retry, ad accounts and the `metadata` lists are `Since v67.0`, and ad connectors such as Google Ads need an [add-on license](https://developer.salesforce.com/docs/data/data-cloud-int/guide/c360-a-googleadsadaudiences-connector.md).
- **Gated orgs.** `CdpActivationTarget` or `CdpActivationExternalPlatform` means the surface is [gated for this org or user](https://github.com/forcedotcom/sf-skills/blob/2476476dda1b671762c6e963b9d10c4a7056f1c4/skills/data360-activate/SKILL.md), so don't retry blindly.

```sql
CALL cdp.activation_platform_metadata_list (platform_type => 'Sftp');

CALL cdp.activation_target_create (
  name => 'sftp_exports',
  dataspace_name => 'default',
  platform_type => 'Sftp',
  connector => (name = 'sftpTargetConnector'),
  egress_properties => (predetermined_filename = 'SegmentActivation', filename_date_suffix_format = 'yyyy-MM-dd-HH-mm-ss', output_delimiter = 'Comma', output_compression_format = 'Gzip', output_max_file_size_mega_bytes = 500, output_format = 'CSV')
);

/* Wait for status Active, using the id from the create result */
CALL cdp.activation_target_get (activation_target_id => '85USB000004ADXx2AO');
```

**Functions:** [`activation_target_delete`](#activation_target_delete), [`activation_target_list`](#activation_target_list), [`activation_target_get`](#activation_target_get), [`activation_target_ad_account_list`](#activation_target_ad_account_list), [`activation_target_partner_object_list`](#activation_target_partner_object_list), [`activation_platform_metadata_list`](#activation_platform_metadata_list), [`communication_capping_data_space_list`](#communication_capping_data_space_list), [`ad_account_availability_get`](#ad_account_availability_get), [`marketing_cloud_enterprise_list`](#marketing_cloud_enterprise_list), [`activation_target_platform_field_list`](#activation_target_platform_field_list), [`activation_target_update`](#activation_target_update), [`activation_target_create`](#activation_target_create), [`activation_target_ad_account_assign`](#activation_target_ad_account_assign), [`activation_target_disable`](#activation_target_disable), [`activation_target_enable`](#activation_target_enable), [`activation_target_sync_retry`](#activation_target_sync_retry)

## activation_target_delete

`DELETE /ssot/activation-targets/{activationTargetId}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Activation-Targets/paths/~1ssot~1activation-targets~1%7BactivationTargetId%7D/delete) · evidence O · changes org state

Delete an activation target by ID or developer name. Since v60.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `activation_target_id` | `activationTargetId` | path | string | yes | ID or developer name, per the spec. See the conflict noted on `activation_target_get`. |

```sql
CALL cdp.activation_target_delete (activation_target_id => '85UVF000000Dr4v2AC');
```

**Result**

No response body (HTTP 200). One row with only the standard columns.

**Notes:** The spec doesn't say what happens to activations that still use the target. [`activation_platform_delete`](activation_platforms.md#activation_platform_delete) documents a 412 when a platform is referenced, but no such rule is documented here. For id versus name, see [`activation_target_get`](#activation_target_get).

## activation_target_list

`GET /ssot/activation-targets` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Activation-Targets/paths/~1ssot~1activation-targets/get) · tool `d360_activation_target_list` · evidence O · read-only

Get a list of activation targets with selected filters. Since v60.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `batch_size` | `batchSize` | query | integer |  | Number of results to return. Values are from `1` through `200`. If unspecified, the default value is `20`. Since v60.0. |
| `filters` | `filters` | query | string |  | Filter expression using `in`, joined with `AND`. Fields: `master_label` (target name), `targetStatus` (such as `active`), `connectionType` (a `platform_type` value) and `platform_name`. Spec examples: `targetStatus in active AND platform_name in Amazon S3`, `MasterLabel in Target002`. Since v60.0. |
| `offset` | `offset` | query | integer |  | Number of rows to skip before returning results. Must be greater than or equal to `0`. If unspecified, no rows are skipped. Since v60.0. |
| `order_by` | `orderBy` | query | string |  | Sort order for the result set by `created_date`. If unspecified, items are returned by ID in ascending order. Since v60.0. |

```sql
CALL cdp.activation_target_list (filters => 'targetStatus in active AND platformName in Amazon S3', order_by => 'createdDate desc', batch_size => 50);
```

**Result**

One row per item of `/activationTargets` in the response. Other response fields go to `_meta`: `batchSize`, `offset`, `orderByExpression`. Schema `ActivationTargetRepresentation`.

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
| `connector` | `connector` | JSON (DataConnectorRepresentation) | Details about the connector that is used for the activation target. Since v60.0. |
| `dataspace_name` | `dataSpaceName` | VARCHAR | Data space name for this activation target. Since v60.0. |
| `description` | `description` | VARCHAR | Description of the activation target. Since v60.0. |
| `egress_properties` | `egressProperties` | JSON (EgressPropertiesRepresentation) | Egress properties for the activation target, which are applicable only for file-based activation targets. Since v63.0. |
| `history_audience_dmo_api_name` | `historyAudienceDmoApiName` | VARCHAR | API name for the history audience DMO. Since v60.0. |
| `history_audience_dmo_label` | `historyAudienceDmoLabel` | VARCHAR | Name of the history audience DMO. Since v60.0. |
| `is_capping_enabled` | `isCappingEnabled` | BOOLEAN | Indicates whether communication capping is enabled for the activation (`true`) or not (`false`). Since v60.0. |
| `is_enabled` | `isEnabled` | BOOLEAN | Indicates whether the activation target is enabled (`true`) or not (`false`). Since v60.0. |
| `latest_audience_dmo_api_name` | `latestAudienceDmoApiName` | VARCHAR | API name for the latest audience DMO. Since v62.0. |
| `latest_audience_dmo_label` | `latestAudienceDmoLabel` | VARCHAR | Name of the latest audience DMO. Since v62.0. |
| `organization_id` | `organizationId` | VARCHAR | Organization ID of the activation target. Since v60.0. |
| `platform_name` | `platformName` | VARCHAR | Platform name for the activation target. Since v60.0. |
| `platform_privacy_type` | `platformPrivacyType` | VARCHAR | Platform privacy type for the activation target. Derived from Activation Platform. Since v60.0. |
| `platform_type` | `platformType` | VARCHAR | Platform type for the activation target. Since v60.0. |
| `status` | `status` | VARCHAR | Target status of the activation target. Since v60.0. |

**Paging:** `batch_size`, `offset` from 0 ([community, one org](https://github.com/szymonlewandowski/config-snapshot-data360/blob/main/docs/api-quirks.md)). The response has no `total_size`.

**Notes:** There's no data space option, and [one org](https://github.com/szymonlewandowski/config-snapshot-data360/blob/main/docs/api-quirks.md) found the endpoint doesn't support one, so filter on `dataspace_name` yourself (community). `status` can arrive in spellings the schema doesn't declare: [`sf-pi` accepts this as a known exception](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/registry/connect-openapi-overrides.json) based on a live response, and the spec's own example shows `ACTIVE` against a declared `Active`. The spec's list example leaves out `connector`, `egress_properties` and `is_enabled`, so use `activation_target_get` when you need those. The `filters` language here (`in`) differs from the `eq` and `contains` language of the `metadata` lists in this section.

## activation_target_get

`GET /ssot/activation-targets/{activationTargetId}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Activation-Targets/paths/~1ssot~1activation-targets~1%7BactivationTargetId%7D/get) · tool `d360_activation_target_get` · evidence O · read-only

Get an activation target by ID or developer name. Since v60.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `activation_target_id` | `activationTargetId` | path | string | yes | ID or developer name, per the spec. One org found id only (community), see notes. |

```sql
CALL cdp.activation_target_get (activation_target_id => '85UVF000000Dr4v2AC');
```

**Result**

One row. Schema `ActivationTargetRepresentation`.

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
| `connector` | `connector` | JSON (DataConnectorRepresentation) | Details about the connector that is used for the activation target. Since v60.0. |
| `dataspace_name` | `dataSpaceName` | VARCHAR | Data space name for this activation target. Since v60.0. |
| `description` | `description` | VARCHAR | Description of the activation target. Since v60.0. |
| `egress_properties` | `egressProperties` | JSON (EgressPropertiesRepresentation) | Egress properties for the activation target, which are applicable only for file-based activation targets. Since v63.0. |
| `history_audience_dmo_api_name` | `historyAudienceDmoApiName` | VARCHAR | API name for the history audience DMO. Since v60.0. |
| `history_audience_dmo_label` | `historyAudienceDmoLabel` | VARCHAR | Name of the history audience DMO. Since v60.0. |
| `is_capping_enabled` | `isCappingEnabled` | BOOLEAN | Indicates whether communication capping is enabled for the activation (`true`) or not (`false`). Since v60.0. |
| `is_enabled` | `isEnabled` | BOOLEAN | Indicates whether the activation target is enabled (`true`) or not (`false`). Since v60.0. |
| `latest_audience_dmo_api_name` | `latestAudienceDmoApiName` | VARCHAR | API name for the latest audience DMO. Since v62.0. |
| `latest_audience_dmo_label` | `latestAudienceDmoLabel` | VARCHAR | Name of the latest audience DMO. Since v62.0. |
| `organization_id` | `organizationId` | VARCHAR | Organization ID of the activation target. Since v60.0. |
| `platform_name` | `platformName` | VARCHAR | Platform name for the activation target. Since v60.0. |
| `platform_privacy_type` | `platformPrivacyType` | VARCHAR | Platform privacy type for the activation target. Derived from Activation Platform. Since v60.0. |
| `platform_type` | `platformType` | VARCHAR | Platform type for the activation target. Since v60.0. |
| `status` | `status` | VARCHAR | Target status of the activation target. Since v60.0. |
| `attribute_config` | `attributeConfig` | JSON | Not in the spec schema: from the spec's examples. |
| `key_prefix_name` | `keyPrefixName` | VARCHAR | Not in the spec schema: from the spec's examples. |
| `type` | `type` | VARCHAR | Not in the spec schema: from the spec's examples. |

**Notes:** **Sources disagree on the key.** The spec accepts the id or the developer name. [One org](https://github.com/szymonlewandowski/config-snapshot-data360/blob/main/docs/api-quirks.md) got 400 `INVALID_INPUT` or 404 `ITEM_NOT_FOUND` by name, on v67.0 (community). Use the id, which starts with `85U` in the spec's examples. `status` is declared as `Active`, `Processing`, `Error` or `Inactive`, but examples show upper case, so compare without case. `is_enabled` and `status` are separate columns, and no source explains how they relate.

## activation_target_ad_account_list

`GET /ssot/activation-targets/{activationTargetId}/available-ad-accounts` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Activation-Targets/paths/~1ssot~1activation-targets~1%7BactivationTargetId%7D~1available-ad-accounts/get) · evidence O · read-only

Returns the ad accounts that aren't already assigned in the specified data space. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `activation_target_id` | `activationTargetId` | path | string | yes | Record ID (15- or 18-character) of the activation target. Since v67.0. |
| `dataspace` | `dataSpace` | query | string | yes | Name of the data space used to filter out already-assigned accounts. Since v67.0. |
| `platform_id_or_name` | `platformIdOrName` | query | string | yes | Record ID (15- or 18-character) or API name of the activation platform. Since v67.0. |

```sql
CALL cdp.activation_target_ad_account_list (activation_target_id => '85UVF000000NaQz2AK', dataspace => 'default', platform_id_or_name => 'cdpactvstrgptnr__PremiumPartnerGoogle');
```

**Result**

One row per item of `/adAccounts` in the response. Schema `AdAccountRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `account_name` | `accountName` | VARCHAR | Display name of the ad account. Since v67.0. |
| `account_number` | `accountNumber` | VARCHAR | Ad account number on the partner platform. Since v67.0. |
| `active` | `active` | BOOLEAN | Indicates whether the ad account is currently active (`true`) or not (`false`). Since v67.0. |
| `errors` | `errors` | JSON (array of CdpErrorRepresentation) | Validation errors for the account. Since v67.0. |
| `has_error` | `hasError` | BOOLEAN | Indicates whether validation errors exist for the account (`true`) or not (`false`). Since v67.0. |
| `manager_account_id` | `managerAccountId` | VARCHAR | Manager account ID, if the account is managed by another account. Since v67.0. |

**Notes:** The target must exist first, because its id is in the path. Accounts already assigned in `dataspace` are left out, so an empty result can mean they're all taken. `platform_id_or_name` takes `api_name` from [`activation_platform_metadata_list`](#activation_platform_metadata_list). Check `has_error` and `errors` before assigning an account.

## activation_target_partner_object_list

`GET /ssot/activation-targets/{activationTargetId}/partner-objects` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Activation-Targets/paths/~1ssot~1activation-targets~1%7BactivationTargetId%7D~1partner-objects/get) · evidence O · read-only

Returns partner-platform objects of the specified type. Results are cursor-paginated: follow `next_page_url` to retrieve each subsequent page instead of supplying an offset. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `activation_target_id` | `activationTargetId` | path | string | yes | Record ID (15- or 18-character) of the activation target. Since v67.0. |
| `page_token` | `pageToken` | query | string |  | **Sensitive:** use `secret()`. Cursor for the next page of results. Omit this value on the first request. The response's `next_page_url` includes the `page_token` to fetch the next page, so follow `next_page_url` rather than constructing this value. Since v67.0. |
| `partner_object_type` | `partnerObjectType` | query | enum(App, ConversionRule, CrmEventSet, MobileApp, OfflineEventSet, Pixel) | yes | Type of partner object to retrieve. Since v67.0. |

```sql
CALL cdp.activation_target_partner_object_list (activation_target_id => '85UVF000000NaQz2AK', partner_object_type => 'ConversionRule');
```

**Result**

One row per item of `/partnerObjects` in the response. Other response fields go to `_meta`: `currentPageUrl`, `nextPageUrl`, `totalSize`. Schema `PartnerObjectRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `name` | `name` | VARCHAR | Display name on the external platform. Since v67.0. |
| `partner_object_id` | `partnerObjectId` | VARCHAR | Identifier on the external platform. Since v67.0. |
| `status` | `status` | VARCHAR | Status of the partner object. Since v67.0. |
| `type` | `type` | VARCHAR | Partner-object type identifier. Since v67.0. |

**Paging:** `next_page_url`.

**Notes:** To see which types a platform has, use [`activation_platform_partner_object_type_list`](activation_platforms.md#activation_platform_partner_object_type_list). The spec's example returns LinkedIn conversion rules with `status` null, so don't filter on `status`.

## activation_platform_metadata_list

`GET /ssot/activation-targets/metadata/activation-platforms` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Activation-Targets/paths/~1ssot~1activation-targets~1metadata~1activation-platforms/get) · evidence O · read-only

Lists the platforms you can create a target on, including their `api_name`, category and whether they process in batch or streaming. Use it first when setting up a destination. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `batch_size` | `batchSize` | query | integer |  | Maximum number of results to return. Values are `1` through `200`. If unspecified, the default value is `20`. Since v67.0. |
| `dataspace` | `dataSpace` | query | string |  | Name of the data space to scope the lookup. If unspecified, the request's data space context is used. Since v67.0. |
| `filters` | `filters` | query | string |  | Filter expression used to narrow results, such as `field eq value AND name contains foo`. Supported operators are `eq`, `!=`, `contains`, `in`, `>`, `<`, `>=`, and `<=`. Since v67.0. |
| `name` | `name` | query | string |  | Filter results by activation platform name. Must be an exact match. Since v67.0. |
| `offset` | `offset` | query | integer |  | Number of rows to skip before returning results. If unspecified, no rows are skipped. Since v67.0. |
| `order_by` | `orderBy` | query | string |  | Sort expression in the form `field [asc\|desc][, field [asc\|desc]]*`. Since v67.0. |
| `platform_type` | `platformType` | query | enum(AzureBlob, DataCloud, External, GoogleCloudStorage, InteractionStudio, S3, S3V2, SfApp, Sfcc, Sfmc, Sftp, Strategic, StreamingFlow) |  | Filter results by platform type, such as `Sfmc`, `Sftp`, `External`, or `Strategic`. Since v67.0. |

```sql
CALL cdp.activation_platform_metadata_list (platform_type => 'Strategic', order_by => 'name asc');
```

**Result**

One row per item of `/activationTargetPlatforms` in the response. Other response fields go to `_meta`: `currentPageUrl`, `nextPageUrl`, `totalSize`. Schema `ActivationTargetPlatformRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `api_name` | `apiName` | VARCHAR | Stable identifier for the activation platform. Since v67.0. |
| `category` | `category` | VARCHAR | Category of the activation platform. Since v67.0. |
| `description` | `description` | VARCHAR | Description of the activation platform. Since v67.0. |
| `external_provider` | `externalProvider` | VARCHAR | External partner provider for the activation platform. Since v67.0. |
| `name` | `name` | VARCHAR | Display name of the activation platform. Since v67.0. |
| `platform_type` | `platformType` | VARCHAR | Type of the activation platform. Since v67.0. |
| `processing_type` | `processingType` | VARCHAR | How the platform processes activations. Since v67.0. |
| `sort_order` | `sortOrder` | BIGINT | Sort order used to display platforms in pickers. Lower values appear first. Since v67.0. |

**Paging:** `next_page_url`.

**Notes:** **`platform_type` here isn't the target's `platform_type`.** This list uses `Sfmc`, `S3`, `External`, `Strategic` and so on, while `activation_target_create` uses `SalesforceMarketingCloud`, `AmazonS3`, `ExternalPlatform`. In the spec's examples, a `Strategic` platform such as Google Ads is created with `platform_type => 'ExternalPlatform'`. In those examples, `api_name` splits into two connector attributes: `cdpactvstrgptnr__PremiumPartnerGoogle` appears at create as `key_prefix_name = 'cdpactvstrgptnr'`, `name = 'PremiumPartnerGoogle'`. To administer platforms rather than pick one, see [Activation Platforms](activation_platforms.md).

## communication_capping_data_space_list

`GET /ssot/activation-targets/metadata/communication-capping-data-spaces` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Activation-Targets/paths/~1ssot~1activation-targets~1metadata~1communication-capping-data-spaces/get) · evidence O · read-only

Returns all data spaces with communication capping definitions linked to activation targets. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `batch_size` | `batchSize` | query | integer |  | Maximum number of results to return. Values are `1` through `200`. If unspecified, the default value is `20`. Since v67.0. |
| `filters` | `filters` | query | string |  | Filter expression used to narrow results, such as `field eq value AND name contains foo`. Supported operators are `eq`, `!=`, `contains`, `in`, `>`, `<`, `>=`, and `<=`. Since v67.0. |
| `offset` | `offset` | query | integer |  | Number of rows to skip before returning results. If unspecified, no rows are skipped. Since v67.0. |
| `order_by` | `orderBy` | query | string |  | Sort expression in the form `field [asc\|desc][, field [asc\|desc]]*`. Since v67.0. |

```sql
CALL cdp.communication_capping_data_space_list ();
```

**Result**

One row per item of `/dataSpaces` in the response. Other response fields go to `_meta`: `currentPageUrl`, `nextPageUrl`, `totalSize`. Schema `CommunicationCappingDataSpaceRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `api_name` | `apiName` | VARCHAR | - |
| `data_communication_cap_def_id` | `dataCommunicationCapDefId` | VARCHAR | Record ID (18-character) of the DataCommunicationCapDefinition record. Since v67.0. |
| `dataspace_id` | `dataSpaceId` | VARCHAR | - |
| `dataspace_name` | `dataSpaceName` | VARCHAR | - |
| `dataspace` | `dataSpace` | VARCHAR | Not in the spec schema: from the spec's examples. |

**Paging:** `next_page_url`.

**Notes:** **Result columns are unsettled.** The spec gives `api_name`, `data_communication_cap_def_id`, `dataspace_id` and `dataspace_name`. Its older copy and its response example have only `dataCommunicationCapDefId` and `dataSpace`, so expect a value in `_raw` if the known columns come back empty. No source explains how a capping definition relates to `is_capping_enabled` on a target.

## ad_account_availability_get

`GET /ssot/activation-targets/metadata/dataspace-account-validation` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Activation-Targets/paths/~1ssot~1activation-targets~1metadata~1dataspace-account-validation/get) · evidence O · read-only

Indicates whether an ad account is available to assign to an activation target. Returns `true` when the account isn't already assigned. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `account_id` | `accountId` | query | string | yes | Identifier of the ad account on the partner platform. Since v67.0. |
| `dataspace` | `dataSpace` | query | string | yes | Name of the data space to check against. Since v67.0. |
| `platform_id_or_name` | `platformIdOrName` | query | string | yes | Record ID (15- or 18-character) or API name of the activation platform. Since v67.0. |

```sql
CALL cdp.ad_account_availability_get (account_id => '6586160339', dataspace => 'default', platform_id_or_name => 'cdpactvstrgptnr__PremiumPartnerGoogle');
```

**Result**

One row. Schema `DataspaceAccountValidationRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `available` | `available` | BOOLEAN | Indicates whether the ad account is available, meaning not already assigned (`true`) or not (`false`). Since v67.0. |

**Notes:** The check is per platform and data space, not per target. `account_id` here is called `account_number` in `activation_target_ad_account_list` and `activation_target_ad_account_assign`. They're described alike, but no source says they're the same value.

## marketing_cloud_enterprise_list

`GET /ssot/activation-targets/metadata/mc-enterprises` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Activation-Targets/paths/~1ssot~1activation-targets~1metadata~1mc-enterprises/get) · evidence O · read-only

Returns Marketing Cloud enterprises and their business units. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `batch_size` | `batchSize` | query | integer |  | Maximum number of results to return. Values are `1` through `200`. If unspecified, the default value is `20`. Since v67.0. |
| `offset` | `offset` | query | integer |  | Number of rows to skip before returning results. If unspecified, no rows are skipped. Since v67.0. |

```sql
CALL cdp.marketing_cloud_enterprise_list ();
```

**Result**

One row per item of `/enterprises` in the response. Other response fields go to `_meta`: `currentPageUrl`, `nextPageUrl`, `totalSize`. Schema `McEnterpriseRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `business_units` | `businessUnits` | JSON (array of McBusinessUnitRepresentation) | Business units belonging to the enterprise. Since v67.0. |
| `connector_id` | `connectorId` | VARCHAR | Connector ID linking the enterprise to Data Cloud. Since v67.0. |
| `enterprise_id` | `enterpriseId` | VARCHAR | Marketing Cloud enterprise ID (EID). Since v67.0. |
| `enterprise_name` | `enterpriseName` | VARCHAR | Display name of the enterprise. Since v67.0. |

**Paging:** `next_page_url`.

**Notes:** Use it to fill `connector.businessUnitConfig` on a Marketing Cloud target. **The ids don't line up in the spec.** `business_units[].id` is described as the MID, but its example shows `3khVF0000000MQLYA2`, with the numeric id only inside the name. The create example passes numeric values such as `524000668`. The spec's description of `activation_target_create` points to [`connection_list`](connections.md#connection_list) for connector details instead.

## activation_target_platform_field_list

`GET /ssot/activation-targets/metadata/target-platform-fields` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Activation-Targets/paths/~1ssot~1activation-targets~1metadata~1target-platform-fields/get) · evidence O · read-only

Returns the target-level configuration fields for an activation platform. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `platform_id_or_name` | `platformIdOrName` | query | string | yes | Record ID (15- or 18-character) or API name of the activation platform. Since v67.0. |

```sql
CALL cdp.activation_target_platform_field_list (platform_id_or_name => 'cdpactvstrgptnr__PremiumPartnerGoogle');
```

**Result**

One row per item of `/platformFields` in the response. Schema `ActivationPlatformFieldRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `activation_platform_id` | `activationPlatformId` | VARCHAR | ID of the parent activation platform. Since v67.0. |
| `activation_platform_name` | `activationPlatformName` | VARCHAR | Name of the parent activation platform. Since v67.0. |
| `help_text` | `helpText` | VARCHAR | Help text for the field. Since v67.0. |
| `id` | `id` | VARCHAR | Field ID. Since v67.0. |
| `is_hidden` | `isHidden` | BOOLEAN | Indicates whether the field is hidden in the UI (`true`) or not (`false`). Since v67.0. |
| `is_required` | `isRequired` | BOOLEAN | Indicates whether the field is required (`true`) or not (`false`). Since v67.0. |
| `label` | `label` | VARCHAR | Field display label. Since v67.0. |
| `name` | `name` | VARCHAR | Field API name. Since v67.0. |
| `type` | `type` | VARCHAR | Data type of the field. Since v67.0. |
| `values` | `values` | JSON (array of ActivationPlatformFieldValueRepresentation) | Allowed values for picklist fields. Exactly one value must have `is_default` set to `true`. Since v67.0. |

**Notes:** Lists what `connector.fieldConfig` needs on an external platform target. The spec's examples suggest matching on `label`, not `name`: a field with `label` `AccountId` and `name` `ISVWithEmailOnly1707182166910` is sent at create as `name = 'AccountId'`. Those examples may not come from the same platform, so check this against an org.

## activation_target_update

`PATCH /ssot/activation-targets/{activationTargetId}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Activation-Targets/paths/~1ssot~1activation-targets~1%7BactivationTargetId%7D/patch) · tool `d360_activation_target_update` · evidence O · changes org state

Update a specific activation target by ID or developer name. Since v60.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `activation_target_id` | `activationTargetId` | path | string | yes | ID or developer name, per the spec. See the conflict noted on `activation_target_get`. |
| `connector` | `connector` | body | [DataConnectorInput](#dataconnectorinputrepresentation) |  | Details of the connector used for the activation target. Since v60.0. |
| `dataspace_name` | `dataSpaceName` | body | string | yes | Name of the data space for the activation target. Since v60.0. |
| `description` | `description` | body | string |  | Description for the activation target. Since v60.0. |
| `egress_properties` | `egressProperties` | body | [EgressPropertiesInput](#egresspropertiesinputrepresentation) |  | Egress properties for the activation target, which are applicable only for file-based activation targets. Since v60.0. |
| `is_capping_enabled` | `isCappingEnabled` | body | boolean |  | Indicates whether communication capping is enabled (`true`) or not (`false`). Since v60.0. |
| `name` | `name` | body | string | yes | Name of the activation target. Since v60.0. |
| `platform_type` | `platformType` | body | enum(AccountEngagement, AmazonS3, AmazonS3V2, AwsKinesisDS, AzureBlob, BigQuery, ConnectorsFramework, ConversationStorage, CuratedEntity, DataCloud, ExternalPlatform, Generic, GoogleCloudStorage, Ibm, IngestApi, RedShift, S3Arn, SalesforceCommerceCloud, SalesforceDotCom, SalesforceInteractionStudio, SalesforceMarketingCloud, Sftp, Snowflake, StreamingApp, StreamingFlow, Upload) |  | Platform type for the activation target. Since v60.0. |

```sql
CALL cdp.activation_target_update (activation_target_id => '85UVF000000Dr4v2AC', dataspace_name => 'default', name => 's3_target2', description => 'Nightly audience exports');
```

**Result**

One row. Schema `ActivationTargetRepresentation`.

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
| `connector` | `connector` | JSON (DataConnectorRepresentation) | Details about the connector that is used for the activation target. Since v60.0. |
| `dataspace_name` | `dataSpaceName` | VARCHAR | Data space name for this activation target. Since v60.0. |
| `description` | `description` | VARCHAR | Description of the activation target. Since v60.0. |
| `egress_properties` | `egressProperties` | JSON (EgressPropertiesRepresentation) | Egress properties for the activation target, which are applicable only for file-based activation targets. Since v63.0. |
| `history_audience_dmo_api_name` | `historyAudienceDmoApiName` | VARCHAR | API name for the history audience DMO. Since v60.0. |
| `history_audience_dmo_label` | `historyAudienceDmoLabel` | VARCHAR | Name of the history audience DMO. Since v60.0. |
| `is_capping_enabled` | `isCappingEnabled` | BOOLEAN | Indicates whether communication capping is enabled for the activation (`true`) or not (`false`). Since v60.0. |
| `is_enabled` | `isEnabled` | BOOLEAN | Indicates whether the activation target is enabled (`true`) or not (`false`). Since v60.0. |
| `latest_audience_dmo_api_name` | `latestAudienceDmoApiName` | VARCHAR | API name for the latest audience DMO. Since v62.0. |
| `latest_audience_dmo_label` | `latestAudienceDmoLabel` | VARCHAR | Name of the latest audience DMO. Since v62.0. |
| `organization_id` | `organizationId` | VARCHAR | Organization ID of the activation target. Since v60.0. |
| `platform_name` | `platformName` | VARCHAR | Platform name for the activation target. Since v60.0. |
| `platform_privacy_type` | `platformPrivacyType` | VARCHAR | Platform privacy type for the activation target. Derived from Activation Platform. Since v60.0. |
| `platform_type` | `platformType` | VARCHAR | Platform type for the activation target. Since v60.0. |
| `status` | `status` | VARCHAR | Target status of the activation target. Since v60.0. |
| `attribute_config` | `attributeConfig` | JSON | Not in the spec schema: from the spec's examples. |
| `key_prefix_name` | `keyPrefixName` | VARCHAR | Not in the spec schema: from the spec's examples. |
| `type` | `type` | VARCHAR | Not in the spec schema: from the spec's examples. |

**Notes:** It's a `PATCH`, but the spec reuses the create schema, so `dataspace_name` and `name` are required, and its example sends both. [Salesforce's MCP server](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/model/request/activation/ActivationTargetUpdateRequest.java) treats every field as optional. Send both. `is_enabled` isn't an input, so use [`activation_target_enable`](#activation_target_enable) and [`activation_target_disable`](#activation_target_disable). Activations refer to a target by `activation_target_name`, and no source says what a rename does to them. The `connector` table on [`activation_target_create`](#activation_target_create) applies here too.

## activation_target_create

`POST /ssot/activation-targets` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Activation-Targets/paths/~1ssot~1activation-targets/post) · tool `d360_activation_target_create` · evidence O · changes org state

Creates the destination that activations send segment data to. Call it after choosing a platform and before `activation_create`. Since v60.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `connector` | `connector` | body | [DataConnectorInput](#dataconnectorinputrepresentation) |  | Details of the connector used for the activation target. Since v60.0. |
| `dataspace_name` | `dataSpaceName` | body | string | yes | Name of the data space for the activation target. Since v60.0. |
| `description` | `description` | body | string |  | Description for the activation target. Since v60.0. |
| `egress_properties` | `egressProperties` | body | [EgressPropertiesInput](#egresspropertiesinputrepresentation) |  | Egress properties for the activation target, which are applicable only for file-based activation targets. Since v60.0. |
| `is_capping_enabled` | `isCappingEnabled` | body | boolean |  | Indicates whether communication capping is enabled (`true`) or not (`false`). Since v60.0. |
| `name` | `name` | body | string | yes | Name of the activation target. Since v60.0. |
| `platform_type` | `platformType` | body | enum(AccountEngagement, AmazonS3, AmazonS3V2, AwsKinesisDS, AzureBlob, BigQuery, ConnectorsFramework, ConversationStorage, CuratedEntity, DataCloud, ExternalPlatform, Generic, GoogleCloudStorage, Ibm, IngestApi, RedShift, S3Arn, SalesforceCommerceCloud, SalesforceDotCom, SalesforceInteractionStudio, SalesforceMarketingCloud, Sftp, Snowflake, StreamingApp, StreamingFlow, Upload) |  | Platform type for the activation target. Since v60.0. |
| `target_type` | `targetType` | body | string |  | Not in the spec schema: from the MCP server's payload example. |
| `connection_id` | `connectionId` | body | string |  | Not in the spec schema: from the MCP server's payload example. |
| `config` | `config` | body | [activation_target_create_config](#activation_target_create_config) |  | Not in the spec schema: from the MCP server's payload example. |

```sql
CALL cdp.activation_target_create (name => 's3_target2', dataspace_name => 'default', platform_type => 'AmazonS3', connector => (name = 's3_conn_1', output_format = 'CSV', bucket_name = 'audience-exports', folder_name = 'nightly', access_key = secret(s3_access_key), secret_key = secret(s3_secret_key)));
```

**Result**

One row. Schema `ActivationTargetRepresentation`.

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
| `connector` | `connector` | JSON (DataConnectorRepresentation) | Details about the connector that is used for the activation target. Since v60.0. |
| `dataspace_name` | `dataSpaceName` | VARCHAR | Data space name for this activation target. Since v60.0. |
| `description` | `description` | VARCHAR | Description of the activation target. Since v60.0. |
| `egress_properties` | `egressProperties` | JSON (EgressPropertiesRepresentation) | Egress properties for the activation target, which are applicable only for file-based activation targets. Since v63.0. |
| `history_audience_dmo_api_name` | `historyAudienceDmoApiName` | VARCHAR | API name for the history audience DMO. Since v60.0. |
| `history_audience_dmo_label` | `historyAudienceDmoLabel` | VARCHAR | Name of the history audience DMO. Since v60.0. |
| `is_capping_enabled` | `isCappingEnabled` | BOOLEAN | Indicates whether communication capping is enabled for the activation (`true`) or not (`false`). Since v60.0. |
| `is_enabled` | `isEnabled` | BOOLEAN | Indicates whether the activation target is enabled (`true`) or not (`false`). Since v60.0. |
| `latest_audience_dmo_api_name` | `latestAudienceDmoApiName` | VARCHAR | API name for the latest audience DMO. Since v62.0. |
| `latest_audience_dmo_label` | `latestAudienceDmoLabel` | VARCHAR | Name of the latest audience DMO. Since v62.0. |
| `organization_id` | `organizationId` | VARCHAR | Organization ID of the activation target. Since v60.0. |
| `platform_name` | `platformName` | VARCHAR | Platform name for the activation target. Since v60.0. |
| `platform_privacy_type` | `platformPrivacyType` | VARCHAR | Platform privacy type for the activation target. Derived from Activation Platform. Since v60.0. |
| `platform_type` | `platformType` | VARCHAR | Platform type for the activation target. Since v60.0. |
| `status` | `status` | VARCHAR | Target status of the activation target. Since v60.0. |
| `attribute_config` | `attributeConfig` | JSON | Not in the spec schema: from the spec's examples. |
| `key_prefix_name` | `keyPrefixName` | VARCHAR | Not in the spec schema: from the spec's examples. |
| `type` | `type` | VARCHAR | Not in the spec schema: from the spec's examples. |

**Done when:** `activation_target_get.status` is `Active`, compared without case. The spec's Data Cloud example returns `PROCESSING` from create, and its other examples return `ACTIVE`. The schema also declares `Error`.

**Notes:** **`connector` has more attributes than the schema table shows.** The spec's schema has only `name` and `output_format`. These come from the examples in its older copy, and agree with [Salesforce's MCP server](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/model/request/activation/ConnectorInput.java):

| `platform_type` | `connector` attributes |
|---|---|
| `AmazonS3` | `name`, `output_format`, `bucket_name`, `folder_name`, `access_key`, `secret_key` |
| `SalesforceMarketingCloud` | `name`, `target_sub_type` (`DE` in the example), `business_unit_config = (business_units = ['524000668'])` |
| `Sftp`, `GoogleCloudStorage`, `AzureBlob` | `name`, plus `egress_properties` |
| `DataCloud` | none: the example sends an empty object |
| `ExternalPlatform`, ecosystem | `name`, `key_prefix_name`, `field_config = (fields = [(name = 'AccountId', value = '...')])` |
| `ExternalPlatform`, strategic | `name`, `key_prefix_name` |

The MCP class types `business_unit_config` as a list of strings and `field_config` as a list of name and value pairs, without the `business_units` and `fields` wrappers in the spec's examples. Neither shape has been tested.

**Which `platform_type` values work.** The spec lists 26 values, but its older copy and the [MCP request class](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/model/request/activation/ActivationTargetCreateRequest.java) list seven: `AmazonS3`, `AzureBlob`, `DataCloud`, `ExternalPlatform`, `GoogleCloudStorage`, `SalesforceMarketingCloud`, `Sftp`. The MCP class also treats `platform_type` and `connector` as required, where the spec has them optional. Send both.

**Spelling in `egress_properties`.** The schema says `Gzip`, `Comma`, `SegmentActivation`, while the spec's SFTP example sends `GZIP`, `COMMA`, `SEGMENT_ACTIVATION` and `platform_type` `SFTP`. Responses and the MCP class also have `fileNameType` (`Custom`, `Predetermined`), which the spec's input schema omits. Its 400 error text calls the size limit `maxFileSize`, 1 to 500 MB.

**Other sources.**
- The [catalog](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/runtime/FamilyCatalog.java) says a target "must reference existing Connection", yet the S3 example passes credentials inline. Marketing Cloud connector details come from [`connection_list`](connections.md#connection_list).
- The [MCP payload example](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/resources/metadata/payload-examples.json) uses `target_type`, `connection_id` and `config`. None of them are in the spec or in the server's own request class, so ignore it.
- S3 activation needs [write and delete permission](https://developer.salesforce.com/docs/data/data-cloud-int/guide/c360-a-awss3-bucket-policies-reference.md) on the bucket, on top of the ingestion permissions.
- The [Google Ads setup](https://developer.salesforce.com/docs/data/data-cloud-int/guide/c360-a-googleadsadaudiences-setup.md) is documented only through the UI, with an OAuth redirect and an Enable click. No source shows the API covering that step.

No source says what a repeated name does, so after a timeout check `activation_target_list` before retrying.

## activation_target_ad_account_assign

`POST /ssot/activation-targets/actions/{activationTargetId}/assign-ad-account` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Activation-Targets/paths/~1ssot~1activation-targets~1actions~1%7BactivationTargetId%7D~1assign-ad-account/post) · evidence O · changes org state

Assigns the specified ad account to the activation target. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `activation_target_id` | `activationTargetId` | path | string | yes | Record ID (15- or 18-character) of the activation target. Since v67.0. |
| `account_number` | `accountNumber` | body | string | yes | Ad account number to assign. Since v67.0. |
| `dataspace` | `dataSpace` | body | string | yes | Name of the data space to associate with the ad account. Since v67.0. |
| `manager_account_id` | `managerAccountId` | body | string |  | Manager account ID for the ad account. Since v67.0. |

```sql
CALL cdp.activation_target_ad_account_assign (activation_target_id => '85UVF000000NaQz2AK', account_number => '6586160339', manager_account_id => '6586160339', dataspace => 'default');
```

**Result**

One row. Schema `ActionResultRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `message` | `message` | VARCHAR | Human-readable status or warning message. Can be null on success. Since v67.0. |
| `success` | `success` | BOOLEAN | Indicates whether the action completed successfully (`true`) or not (`false`). Since v67.0. |

**Notes:** Before calling, take the account from [`activation_target_ad_account_list`](#activation_target_ad_account_list) or check it with [`ad_account_availability_get`](#ad_account_availability_get). Here `dataspace` is a body field, unlike the query option on those two. Read `success` and `message`: the spec doesn't say whether a failure can return 200 with `success` false. The spec's example sets `manager_account_id` equal to `account_number`.

## activation_target_disable

`POST /ssot/activation-targets/actions/{activationTargetId}/disable` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Activation-Targets/paths/~1ssot~1activation-targets~1actions~1%7BactivationTargetId%7D~1disable/post) · evidence O · changes org state

Disables an activation target. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `activation_target_id` | `activationTargetId` | path | string | yes | Record ID (18-character) of the activation target to disable. Since v67.0. |
| `dataspace` | `dataSpace` | query | string |  | Name of the data space to use as context for the request. Since v67.0. |

```sql
CALL cdp.activation_target_disable (activation_target_id => '85UVF000000Dr4v2AC', dataspace => 'default');
```

**Result**

One row. Schema `ActionResultRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `message` | `message` | VARCHAR | Human-readable status or warning message. Can be null on success. Since v67.0. |
| `success` | `success` | BOOLEAN | Indicates whether the action completed successfully (`true`) or not (`false`). Since v67.0. |

**Notes:** The spec asks for the 18-character record id, not the name. It doesn't say what happens to activations that use the target. Read `success`, as the spec doesn't say whether a failure can return 200.

## activation_target_enable

`POST /ssot/activation-targets/actions/{activationTargetId}/enable` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Activation-Targets/paths/~1ssot~1activation-targets~1actions~1%7BactivationTargetId%7D~1enable/post) · evidence O · changes org state

Enables an activation target. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `activation_target_id` | `activationTargetId` | path | string | yes | Record ID (18-character) of the activation target to enable. Since v67.0. |
| `dataspace` | `dataSpace` | query | string |  | Name of the data space to use as context for the request. Since v67.0. |

```sql
CALL cdp.activation_target_enable (activation_target_id => '85UVF000000Dr4v2AC', dataspace => 'default');
```

**Result**

One row. Schema `ActionResultRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `message` | `message` | VARCHAR | Human-readable status or warning message. Can be null on success. Since v67.0. |
| `success` | `success` | BOOLEAN | Indicates whether the action completed successfully (`true`) or not (`false`). Since v67.0. |

**Notes:** The spec asks for the 18-character record id, not the name. The [Google Ads setup](https://developer.salesforce.com/docs/data/data-cloud-int/guide/c360-a-googleadsadaudiences-setup.md) ends with an Enable click after OAuth, and no source says whether this call replaces that step. Read `success`, as the spec doesn't say whether a failure can return 200.

## activation_target_sync_retry

`POST /ssot/activation-targets/actions/{activationTargetId}/retry-sync` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Activation-Targets/paths/~1ssot~1activation-targets~1actions~1%7BactivationTargetId%7D~1retry-sync/post) · evidence O · changes org state

Retries the sync for an activation target. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `activation_target_id` | `activationTargetId` | path | string | yes | Record ID (15- or 18-character) of the activation target. Since v67.0. |

```sql
CALL cdp.activation_target_sync_retry (activation_target_id => '85USB000004LBZF2A4');
```

**Result**

One row. Schema `ActionResultRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `message` | `message` | VARCHAR | Human-readable status or warning message. Can be null on success. Since v67.0. |
| `success` | `success` | BOOLEAN | Indicates whether the action completed successfully (`true`) or not (`false`). Since v67.0. |

**Notes:** The spec doesn't say which states this applies to, or how to tell that the sync finished. `status` on [`activation_target_get`](#activation_target_get) is the only visible signal. It accepts a 15- or 18-character id, unlike enable and disable.

## Schemas

Attribute names are keywords inside the object they belong to, so completion offers exactly these.

### DataConnectorInputRepresentation

Represents the data connector details input.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `name` | `name` | string |  | Developer name of the connector ([MCP server](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/model/request/activation/ConnectorInput.java)). The spec's text says "Name of the activation target", but its examples use a connector name here. |
| `output_format` | `outputFormat` | string |  | Output file format. The MCP server lists this as S3 only, and the S3 example uses `CSV`. |
| `bucket_name` | `bucketName` | string |  | Not in the spec schema: from the spec's examples. |
| `folder_name` | `folderName` | string |  | Not in the spec schema: from the spec's examples. |
| `access_key` | `accessKey` | string |  | Not in the spec schema: from the spec's examples. |
| `secret_key` | `secretKey` | string |  | Not in the spec schema: from the spec's examples. |
| `target_sub_type` | `targetSubType` | string |  | Not in the spec schema: from the spec's examples. |
| `business_unit_config` | `businessUnitConfig` | [DataConnectorInput_businessUnitConfig](#dataconnectorinput_businessunitconfig) |  | Not in the spec schema: from the spec's examples. |
| `key_prefix_name` | `keyPrefixName` | string |  | Not in the spec schema: from the spec's examples. |
| `field_config` | `fieldConfig` | [DataConnectorInput_fieldConfig](#dataconnectorinput_fieldconfig) |  | Not in the spec schema: from the spec's examples. |

### DataConnectorInput_businessUnitConfig

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `business_units` | `businessUnits` | array |  | Seen in examples: the spec types the parent as a free-form object. |

### DataConnectorInput_fieldConfig

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `fields` | `fields` | array of [DataConnectorInput_fieldConfig_fields](#dataconnectorinput_fieldconfig_fields) |  | Seen in examples: the spec types the parent as a free-form object. |

### DataConnectorInput_fieldConfig_fields

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `name` | `name` | string |  | Seen in examples: the spec types the parent as a free-form object. |
| `value` | `value` | string |  | Seen in examples: the spec types the parent as a free-form object. |

### EgressPropertiesInputRepresentation

Represents the input details for egress properties of the activation target.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `child_folder` | `childFolder` | string |  | Path of the child folder. The child folder is created in the parent directory for copying activation files. Since v63.0. |
| `custom_filename` | `customFilename` | string |  | Custom name of the output file. Either `custom_filename` or `predetermined_filename` must be present. Since v63.0. |
| `filename_date_suffix_format` | `filenameDateSuffixFormat` | string | yes | Date suffix format for the output file name. Use the format `yyyy-MM-dd-HH-mm-ss` or `yyyy-MM-dd-HH-mm-ss-SSS`. Since v63.0. |
| `is_subfolder_creation_enabled` | `isSubfolderCreationEnabled` | boolean |  | Indicates whether subfolder creation is enabled (`true`) or not (`false`). If `true`, a custom subfolder is created. The default is `false`. Since v63.0. |
| `output_compression_format` | `outputCompressionFormat` | enum(Bzip2, Gzip, None) | yes | Compression format for the output file. Since v63.0. |
| `output_delimiter` | `outputDelimiter` | enum(BrokenPipe, Caret, Colon, Comma, Hash, Pipe, Semicolon, Slash, Tab, Tilde, Underscore) | yes | Field delimiter to use in output files. Since v63.0. |
| `output_format` | `outputFormat` | string | yes | Output format for the activation target. Since v63.0. |
| `output_max_file_size_mega_bytes` | `outputMaxFileSizeMegaBytes` | integer | yes | Maximum size of the output file in megabytes from `1` through `500`. Since v63.0. |
| `output_max_records_per_file` | `outputMaxRecordsPerFile` | integer |  | Maximum number of records in the output file from `1` through `100000`. Since v63.0. |
| `predetermined_filename` | `predeterminedFilename` | enum(Activation, Segment, SegmentActivation) |  | Predetermined name of the output file. Either `custom_filename` or `predetermined_filename` must be present. Since v63.0. |

### activation_target_create_config

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `object` | `object` | string |  | Seen in examples: the spec types the parent as a free-form object. |
| `identifier_field` | `identifierField` | string |  | Seen in examples: the spec types the parent as a free-form object. |
| `field_mapping` | `fieldMapping` | [activation_target_create_config_fieldMapping](#activation_target_create_config_fieldmapping) |  | Seen in examples: the spec types the parent as a free-form object. |
| `upsert_behavior` | `upsertBehavior` | string |  | Seen in examples: the spec types the parent as a free-form object. |

### activation_target_create_config_fieldMapping

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `individual_id` | `individual_id` | string |  | Seen in examples: the spec types the parent as a free-form object. |
| `email` | `email` | string |  | Seen in examples: the spec types the parent as a free-form object. |
| `phone` | `phone` | string |  | Seen in examples: the spec types the parent as a free-form object. |
| `first_name` | `first_name` | string |  | Seen in examples: the spec types the parent as a free-form object. |
| `last_name` | `last_name` | string |  | Seen in examples: the spec types the parent as a free-form object. |
| `segment_tier` | `segment_tier` | string |  | Seen in examples: the spec types the parent as a free-form object. |
