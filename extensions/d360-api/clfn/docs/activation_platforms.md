<!-- Generated from extensions/d360-api/clfn/spec/activation_platforms.yaml, edit that and run: bazel run //extensions/d360-api:update -->

# Activation Platforms

Part of the [CDP function reference](functions.md). Nothing here is implemented or tested against an org. Every result also has the [standard columns](functions.md#result-schema).

An activation platform defines a destination: its output format, attributes, identifiers and connector. An [activation target](activation_targets.md) is a configured use of a platform in a data space, and an [activation](activations.md) sends a segment to a target. So the order is platform, target, activation.

Packaged partner platforms, such as Google Ads and Meta, carry the prefix `cdpactvstrgptnr` in the spec's examples. You read those and point a target at them. You create a platform only for your own destination, such as an S3 bucket.

Things to watch:

- **Three read views.** `activation_external_platform_list` (since v64) returns destination attributes. `activation_platform_list` (since v67) returns summaries. [`activation_platform_metadata_list`](activation_targets.md#activation_platform_metadata_list) also covers built-in destinations such as Commerce Cloud. Everything else here needs v67, and DashQL calls v64 today.
- **Three name forms.** For Meta's platform, the spec's examples show `name` `Meta_Conversions_API`, `key_prefix_name` `cdpactvstrgptnr`, and the path form `cdpactvstrgptnr__Meta_Conversions_API`. A target's `platform_name` holds the label, such as `Google Ads Platform`.
- **Enum case differs.** The external family returns `ACTIVE` and `ADVERTISING`; `activation_platform_*` returns `Active` and `Advertising`.
- **Feature gating.** A disabled org can return 403 ([one org](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/registry/connect-openapi-overrides.json)).

```sql
/* A packaged platform: find it, then point a target at it. */
CALL cdp.activation_external_platform_list ();
CALL cdp.activation_target_create (name => 'google_ads_target', dataspace_name => 'default', platform_type => 'ExternalPlatform', connector => (name = 'PremiumPartnerGoogle', key_prefix_name = 'cdpactvstrgptnr'));

/* Your own platform, after activation_platform_create: */
CALL cdp.activation_platform_get (id_or_name => 'abc_user_identifiers');
CALL cdp.activation_platform_publish (id_or_name => 'abc_user_identifiers');
```

**Functions:** [`activation_platform_delete`](#activation_platform_delete), [`activation_external_platform_list`](#activation_external_platform_list), [`activation_external_platform_get`](#activation_external_platform_get), [`activation_platform_list`](#activation_platform_list), [`activation_platform_get`](#activation_platform_get), [`activation_platform_action_source_list`](#activation_platform_action_source_list), [`activation_platform_event_list`](#activation_platform_event_list), [`activation_platform_partner_object_type_list`](#activation_platform_partner_object_type_list), [`activation_platform_update`](#activation_platform_update), [`activation_platform_create`](#activation_platform_create), [`activation_platform_disable`](#activation_platform_disable), [`activation_platform_enable`](#activation_platform_enable), [`activation_platform_publish`](#activation_platform_publish), [`activation_platform_sync_retry`](#activation_platform_sync_retry), [`activation_platform_privacy_type_set`](#activation_platform_privacy_type_set)

## activation_platform_delete

`DELETE /ssot/activation-platforms/{idOrName}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Activation-Platforms/paths/~1ssot~1activation-platforms~1%7BidOrName%7D/delete) · evidence O · changes org state

Deletes an activation platform. Returns a 412 error if the platform is referenced by activation targets or market segment activations. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `id_or_name` | `idOrName` | path | string | yes | Record ID or API name of the activation platform. |

```sql
CALL cdp.activation_platform_delete (id_or_name => 'abc_user_identifiers');
```

**Result**

No response body (HTTP 200). One row with only the standard columns.

**Notes:** The spec's description gives the 412, but its response list doesn't include it. To find blockers first, filter `activation_target_list` by `platform_name`. That column holds the platform's label, not its API name (for example `filters => 'platformName in Google Ads Platform'`).

## activation_external_platform_list

`GET /ssot/activation-external-platforms` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Activation-External-Platforms/paths/~1ssot~1activation-external-platforms/get) · evidence O · read-only

Lists the org's activation external platforms with their status, type, namespace prefix and destination attributes. Use it to find the name and prefix that a target's connector needs.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `batch_size` | `batchSize` | query | integer |  | Number of external platforms to return. Values are from `1` through `20`. If unspecified, the default value is `20`. Since v64.0. |
| `limit` | `limit` | query | integer |  | Maximum number of external platforms to return. If unspecified, the default value is `20`. Since v64.0. |
| `offset` | `offset` | query | integer |  | Number of rows to skip before returning results. Must be greater than or equal to `0`. If unspecified, no rows are skipped. Since v64.0. |
| `order_by` | `orderBy` | query | string |  | Order in which to sort the results based on the `created_date` field. Specify the field name followed by `asc` for ascending order or `desc` for descending order. If you specify only the field name or omit the parameter, results are sorted in ascending order. For example, `created_date asc` and `created_date` yield the same results. Since v64.0. |

```sql
CALL cdp.activation_external_platform_list ();
```

**Result**

One row per item of `/platforms` in the response. Other response fields go to `_meta`: `currentPageUrl`, `nextPageUrl`, `totalSize`. Schema `ActivationExternalPlatformRepresentation`.

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
| `attribute_config` | `attributeConfig` | JSON (ActivationExternalPlatformAttributeConfigRepresentation) | Configuration of the external platform attributes. Since v64.0. |
| `creation_type` | `creationType` | VARCHAR | Creation type for the external platform. Since v64.0. |
| `key_prefix_name` | `keyPrefixName` | VARCHAR | Namespace prefix of the external platform. Since v64.0. |
| `privacy_type` | `privacyType` | VARCHAR | Privacy type for the external platform. Since v64.0. |
| `status` | `status` | VARCHAR | Status of the external platform. Since v64.0. |
| `type` | `type` | VARCHAR | Platform type for the external platform. Since v64.0. |

**Paging:** `next_page_url`.

**Notes:** Values are uppercase here: the spec's examples show `status` `ACTIVE`, `type` `ADVERTISING`, `privacy_type` `THIRDPARTY` and `creation_type` `MANUAL` or `JSON`. Salesforce's sf-pi repo [relaxed its schema](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/registry/connect-openapi-overrides.json) because live responses used uppercase values outside the published enum (one org).

The spec's list example has no `id` in its items, so key on `name` and `key_prefix_name`. `creation_type` is absent on the packaged platform in that example, and `privacy_type` is absent on the two others. `order_by` sorts on `created_date` only.

A community guide reads the error text `CdpActivationExternalPlatform` as [the feature being gated](https://github.com/Jaganpro/sf-skills/blob/main/skills/sf-datacloud/references/feature-readiness.md) for the org or user, and advises against [retrying blindly](https://github.com/Jaganpro/sf-skills/blob/main/skills/sf-datacloud-act/SKILL.md) (community). Platform connections have a [Setup page](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-browser/docs/data-cloud-destinations.md) at `/lightning/setup/ExternalActivationPlatform/home`.

A target's `connector` takes `name` and `key_prefix_name`, and `field_config` for platform fields. These appear in the spec's target examples and in the [MCP server's request class](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/model/request/activation/ConnectorInput.java), but `key_prefix_name` and `field_config` are missing from the spec's connector schema.

## activation_external_platform_get

`GET /ssot/activation-external-platforms/{idOrName}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Activation-External-Platforms/paths/~1ssot~1activation-external-platforms~1%7BidOrName%7D/get) · evidence O · read-only

Returns one external platform with its attribute configuration. Pass an event name and action source to scope the attributes to that event.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `id_or_name` | `idOrName` | path | string | yes | Unique identifier of a specific activation external platform, such as the ID or developer name. Since v67.0. |
| `action_source` | `actionSource` | query | string |  | Action source used, together with `event_name`, to scope the returned attribute configuration. Since v67.0. |
| `event_name` | `eventName` | query | string |  | Standard event name used, together with `action_source`, to scope the returned attribute configuration. For example, the platform's standard event. Since v67.0. |

```sql
CALL cdp.activation_external_platform_get (id_or_name => '1sqxx0000000087AAA', event_name => 'Purchase', action_source => 'Website');
```

**Result**

One row. Schema `ActivationExternalPlatformRepresentation`.

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
| `attribute_config` | `attributeConfig` | JSON (ActivationExternalPlatformAttributeConfigRepresentation) | Configuration of the external platform attributes. Since v64.0. |
| `creation_type` | `creationType` | VARCHAR | Creation type for the external platform. Since v64.0. |
| `key_prefix_name` | `keyPrefixName` | VARCHAR | Namespace prefix of the external platform. Since v64.0. |
| `privacy_type` | `privacyType` | VARCHAR | Privacy type for the external platform. Since v64.0. |
| `status` | `status` | VARCHAR | Status of the external platform. Since v64.0. |
| `type` | `type` | VARCHAR | Platform type for the external platform. Since v64.0. |

**Notes:** This is since v67, while the list is since v64. In an org with this detail disabled it [returned 403 with an error array](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/registry/connect-openapi-overrides.json), which the spec doesn't declare (one org).

`attribute_config.attributes[].destinationName` is what an activation's `external_platform_attribute_name` refers to, going by that option's description. The scoped example also carries `valueSource` (`CONSTANT` with `values`, or `MAPPED`), which the attribute schema omits.

**Event spelling is unclear.** The scoped example shows `event_name` `AddToCart` and `action_source` `website`, while `activation_platform_event_list` returns `Add to Cart` and `activation_platform_action_source_list` returns `Website`. No source says which spelling `event_name` and `action_source` expect. The spec's `activation_platform_action_source_list` example uses `Purchase`, which avoids the question.

## activation_platform_list

`GET /ssot/activation-platforms` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Activation-Platforms/paths/~1ssot~1activation-platforms/get) · evidence O · read-only

Returns a paginated list of activation platforms. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `activation_platform_view` | `activationPlatformView` | query | enum(All, Developer, Subscriber) |  | Set of platforms to return. If unspecified, the default value is `All`. Since v67.0. |
| `batch_size` | `batchSize` | query | integer |  | Maximum number of results to return. Values are `1` through `200`. If unspecified, the default value is `20`. Since v67.0. |
| `offset` | `offset` | query | integer |  | Number of rows to skip before returning results. If unspecified, no rows are skipped. Since v67.0. |
| `order_by` | `orderBy` | query | string |  | Sort expression in the form `<field_name> <ASC\|DESC>`. Since v67.0. |

```sql
CALL cdp.activation_platform_list ();
```

**Result**

One row per item of `/activationPlatforms` in the response. Other response fields go to `_meta`: `batchSize`, `offset`, `totalSize`. Schema `ActivationPlatformSummaryRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `activation_platform_creation_type` | `activationPlatformCreationType` | VARCHAR | How the platform was created. Since v67.0. |
| `can_publish_now` | `canPublishNow` | BOOLEAN | Indicates whether the platform is ready to be published (`true`) or not (`false`). Since v67.0. |
| `enabled` | `enabled` | BOOLEAN | Indicates whether the activation platform is enabled (`true`) or not (`false`). Since v67.0. |
| `id` | `id` | VARCHAR | Salesforce ID of the activation platform. Since v67.0. |
| `label` | `label` | VARCHAR | Display label of the activation platform. Since v67.0. |
| `name` | `name` | VARCHAR | API name of the activation platform. Since v67.0. |
| `platform_processing_type` | `platformProcessingType` | VARCHAR | How the platform processes activations. Since v67.0. |
| `platform_type` | `platformType` | VARCHAR | Category of the activation platform. Since v67.0. |
| `status` | `status` | VARCHAR | Status of the activation platform. Since v67.0. |

**Paging:** `batch_size`, `offset`.

**Notes:** `enabled` and `status` are separate: the spec's example has platforms that are enabled with status `Error`. No source defines the `Developer` and `Subscriber` views. Summaries have no `privacy_type` or `description`, so call `activation_platform_get` for those.

## activation_platform_get

`GET /ssot/activation-platforms/{idOrName}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Activation-Platforms/paths/~1ssot~1activation-platforms~1%7BidOrName%7D/get) · evidence O · read-only

Returns an activation platform by record ID or API name. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `id_or_name` | `idOrName` | path | string | yes | Record ID or API name of the activation platform. |

```sql
CALL cdp.activation_platform_get (id_or_name => 'abc_user_identifiers');
```

**Result**

One row. Schema `ActivationPlatformRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `activation_flow_type` | `activationFlowType` | VARCHAR | Type of activation flow. Since v67.0. |
| `activation_platform_attributes` | `activationPlatformAttributes` | JSON (array of ActivationPlatformAttributeRepresentation) | Activation attributes for data mapping. Since v67.0. |
| `activation_platform_creation_type` | `activationPlatformCreationType` | VARCHAR | How the platform was created. Since v67.0. |
| `additional_metadata` | `additionalMetadata` | JSON (ActivationPlatformAdditionalMetadataRepresentation) | Additional platform metadata, such as event configuration, mappings, and output properties. Since v67.0. |
| `can_publish_now` | `canPublishNow` | BOOLEAN | Indicates whether the platform is ready to be published (`true`) or not (`false`). Since v67.0. |
| `connector` | `connector` | JSON | Connector configuration for S3 or OAuth. Since v67.0. |
| `connector_type` | `connectorType` | VARCHAR | Type of connector. Since v67.0. |
| `created_by` | `createdBy` | JSON (ActivationPlatformUserRepresentation) | User who created the platform. Since v67.0. |
| `created_date` | `createdDate` | TIMESTAMPTZ | Date and time when the platform was created. Since v67.0. |
| `customer_id_type_mapping` | `customerIdTypeMapping` | JSON (ActivationPlatformCustomerIdTypeMappingRepresentation) | Customer ID type mapping configuration. Since v67.0. |
| `description` | `description` | VARCHAR | Description of the activation platform. Since v67.0. |
| `enabled` | `enabled` | BOOLEAN | Indicates whether the activation platform is enabled (`true`) or not (`false`). Since v67.0. |
| `error_code` | `errorCode` | VARCHAR | Error code returned when the status is `Error`. Since v67.0. |
| `event_parameter_hierarchy_map` | `eventParameterHierarchyMap` | JSON | Map of valid parameter value pairings keyed by hierarchy combination, such as `Event__ActionSource`. Since v67.0. |
| `event_parameters` | `eventParameters` | JSON (array of ActivationEventParameterValuesRepresentation) | Event parameter definitions with hierarchy and allowed values. Since v67.0. |
| `external_provider` | `externalProvider` | VARCHAR | External provider associated with the platform. Since v67.0. |
| `fields` | `fields` | JSON (array of ActivationPlatformFieldRepresentation) | Configuration fields for the platform. Since v67.0. |
| `id` | `id` | VARCHAR | Salesforce ID of the activation platform. Since v67.0. |
| `identifiers` | `identifiers` | JSON (array of ActivationPlatformIdentifierRepresentation) | Platform audience identifiers. Since v67.0. |
| `include_segment_names` | `includeSegmentNames` | BOOLEAN | Indicates whether segment names are included in output files (`true`) or not (`false`). Since v67.0. |
| `is_strategic_partner` | `isStrategicPartner` | BOOLEAN | Indicates whether the platform is a strategic partner platform (`true`) or not (`false`). Since v67.0. |
| `label` | `label` | VARCHAR | Display label of the activation platform. Since v67.0. |
| `last_modified_by` | `lastModifiedBy` | JSON (ActivationPlatformUserRepresentation) | User who last modified the platform. Since v67.0. |
| `last_modified_date` | `lastModifiedDate` | TIMESTAMPTZ | Date and time when the platform was last modified. Since v67.0. |
| `logo_url` | `logoUrl` | VARCHAR | URL to the platform logo for UI display. Since v67.0. |
| `name` | `name` | VARCHAR | API name of the activation platform. Since v67.0. |
| `namespace` | `namespace` | VARCHAR | Namespace prefix for managed packages. Null for unmanaged. Since v67.0. |
| `notes` | `notes` | VARCHAR | Additional notes or admin commentary. Since v67.0. |
| `output_format` | `outputFormat` | VARCHAR | Format of the output files. Since v67.0. |
| `output_grouping` | `outputGrouping` | VARCHAR | How output files are grouped. Since v67.0. |
| `platform_processing_type` | `platformProcessingType` | VARCHAR | How the platform processes activations. Since v67.0. |
| `platform_type` | `platformType` | VARCHAR | Category of the activation platform. Since v67.0. |
| `privacy_type` | `privacyType` | VARCHAR | Privacy classification of the platform. Since v67.0. |
| `refresh_settings` | `refreshSettings` | JSON (RefreshSettingsRepresentation) | Refresh configuration for the platform. Since v67.0. |
| `show_event_source_annotations` | `showEventSourceAnnotations` | BOOLEAN | Indicates whether event source annotations are shown in the UI (`true`) or not (`false`). Since v67.0. |
| `status` | `status` | VARCHAR | Status of the activation platform. Since v67.0. |
| `supported_event_types` | `supportedEventTypes` | JSON | Supported event types for streaming platforms. Since v67.0. |

**Notes:** Enum values, from the spec: `status` is `Active`, `Error` or `Processing`; `privacy_type` is `NotApplicable`, `ServiceProvider`, `ThirdParty` or `UpdateFailed`, and null after create in the examples; `connector_type` is `Oauth` or `S3`. The response has no `custom_metadata`, and the example `connector` holds only `bucket_name`, `exportDirectory` and `id`, so credentials don't come back.

## activation_platform_action_source_list

`GET /ssot/activation-platforms/{idOrName}/metadata/action-sources` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Activation-Platforms/paths/~1ssot~1activation-platforms~1%7BidOrName%7D~1metadata~1action-sources/get) · evidence O · read-only

Returns the action sources valid for an event on the platform. Use it after activation_platform_event_list, to pick the pairing that scopes activation_external_platform_get.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `id_or_name` | `idOrName` | path | string | yes | 15- or 18-character ID or API name of the activation platform. Since v67.0. |
| `event_name` | `eventName` | query | string | yes | Name of the event whose action sources to return. Since v67.0. |
| `offset` | `offset` | query | integer |  | Number of rows to skip before returning results. If unspecified, no rows are skipped. Since v67.0. |
| `page_size` | `pageSize` | query | integer |  | Maximum number of action sources to return. Values are `1` through `200`. If unspecified, the default value is `20`. Since v67.0. |

```sql
CALL cdp.activation_platform_action_source_list (id_or_name => 'cdpactvstrgptnr__Meta_Conversions_API', event_name => 'Purchase');
```

**Result**

One row per item of `/actionSources` in the response. Other response fields go to `_meta`: `currentPageUrl`, `nextPageUrl`, `totalSize`. Schema `ActionSourceRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `name` | `name` | VARCHAR | Name of the action source, such as Website, App, or Offline. Since v67.0. |

**Paging:** `next_page_url`.

**Notes:** Names are display text, not codes. The spec's example returns `Business Messaging - WhatsApp`, `Phone Call`, `Physical Store` and `Website`, not the `App` and `Offline` its description mentions. Its path uses the prefixed name.

## activation_platform_event_list

`GET /ssot/activation-platforms/{idOrName}/metadata/events` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Activation-Platforms/paths/~1ssot~1activation-platforms~1%7BidOrName%7D~1metadata~1events/get) · evidence O · read-only

Returns the standard event names configured for the activation platform's streaming metadata, such as Purchase or AddToCart. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `id_or_name` | `idOrName` | path | string | yes | 15- or 18-character ID or API name of the activation platform. Since v67.0. |
| `offset` | `offset` | query | integer |  | Number of rows to skip before returning results. If unspecified, no rows are skipped. Since v67.0. |
| `page_size` | `pageSize` | query | integer |  | Maximum number of events to return. Values are `1` through `200`. If unspecified, the default value is `20`. Since v67.0. |

```sql
CALL cdp.activation_platform_event_list (id_or_name => 'cdpactvstrgptnr__Meta_Conversions_API');
```

**Result**

One row per item of `/events` in the response. Other response fields go to `_meta`: `currentPageUrl`, `nextPageUrl`, `totalSize`. Schema `EventRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `name` | `name` | VARCHAR | Name of the event, such as Purchase or AddToCart. Since v67.0. |

**Paging:** `next_page_url`.

**Notes:** The description says `AddToCart`, but the spec's example returns `Add to Cart` and `CRM - Lead Record Change Events`, so names can contain spaces. This reads streaming metadata. No source says what a batch platform returns.

## activation_platform_partner_object_type_list

`GET /ssot/activation-platforms/{idOrName}/metadata/partner-object-types` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Activation-Platforms/paths/~1ssot~1activation-platforms~1%7BidOrName%7D~1metadata~1partner-object-types/get) · evidence O · read-only

Returns the partner-object types valid for the activation platform, such as Pixel, App, or ConversionRule, each with a display label. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `id_or_name` | `idOrName` | path | string | yes | 15- or 18-character ID or API name of the activation platform. Since v67.0. |
| `offset` | `offset` | query | integer |  | Number of rows to skip before returning results. If unspecified, no rows are skipped. Since v67.0. |
| `page_size` | `pageSize` | query | integer |  | Maximum number of partner-object types to return. Values are `1` through `200`. If unspecified, the default value is `20`. Since v67.0. |

```sql
CALL cdp.activation_platform_partner_object_type_list (id_or_name => 'cdpactvstrgptnr__LinkedInPlatform');
```

**Result**

One row per item of `/partnerObjectTypes` in the response. Other response fields go to `_meta`: `currentPageUrl`, `nextPageUrl`, `totalSize`. Schema `PartnerObjectTypeRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `label` | `label` | VARCHAR | Display label for the partner-object type. Since v67.0. |
| `type` | `type` | VARCHAR | Partner-object type identifier, such as Pixel, App, or ConversionRule. Values are partner-defined. Since v67.0. |

**Paging:** `next_page_url`.

**Notes:** `type` is the value to pass to `activation_target_partner_object_list.partner_object_type`. The spec calls the values partner-defined here but gives that option a closed enum: `App`, `ConversionRule`, `CrmEventSet`, `MobileApp`, `OfflineEventSet`, `Pixel`.

## activation_platform_update

`PATCH /ssot/activation-platforms/{idOrName}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Activation-Platforms/paths/~1ssot~1activation-platforms~1%7BidOrName%7D/patch) · evidence O · changes org state

Updates an activation platform by record ID or API name. Only the fields you provide are modified. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `id_or_name` | `idOrName` | path | string | yes | Record ID or API name of the activation platform. |
| `activation_platform_attributes` | `activationPlatformAttributes` | body | array of [ActivationPlatformAttributeInput](#activationplatformattributeinputrepresentation) |  | Activation attributes for data mapping. Replaces the full set. Any existing attributes not included are removed. Since v67.0. |
| `additional_metadata` | `additionalMetadata` | body | [ActivationPlatformAdditionalMetadataInput](#activationplatformadditionalmetadatainputrepresentation) |  | Additional platform metadata, such as event configuration, mappings, and output properties. Since v67.0. |
| `connector` | `connector` | body | map to string |  | Connector configuration as key-value string pairs. Since v67.0. |
| `custom_metadata` | `customMetadata` | body | [ActivationPlatformCustomMetadataInput](#activationplatformcustommetadatainputrepresentation) |  | Connector credentials for toolkit-created platforms. Since v67.0. |
| `description` | `description` | body | string |  | Description of the activation platform. Since v67.0. |
| `fields` | `fields` | body | array of [ActivationPlatformFieldInput](#activationplatformfieldinputrepresentation) |  | Configuration fields for the platform. Replaces the full set. Any existing fields not included are removed. Since v67.0. |
| `identifiers` | `identifiers` | body | array of [ActivationPlatformIdentifierInput](#activationplatformidentifierinputrepresentation) |  | Platform audience identifiers. Replaces the full set. Any existing identifiers not included are removed. Since v67.0. |
| `label` | `label` | body | string |  | Display label of the activation platform. Since v67.0. |
| `logo_url` | `logoUrl` | body | string |  | URL to the platform logo. Since v67.0. |
| `output_format` | `outputFormat` | body | enum(Csv, Json, Parquet) |  | Format of the output files. Since v67.0. |
| `output_grouping` | `outputGrouping` | body | enum(PerAccount, PerSegment) |  | How output files are grouped. Since v67.0. |
| `platform_processing_type` | `platformProcessingType` | body | enum(Batch, Streaming) |  | How the platform processes activations. Since v67.0. |
| `refresh_settings` | `refreshSettings` | body | [RefreshSettingsInput](#refreshsettingsinputrepresentation) |  | Refresh configuration for the platform. Since v67.0. |

```sql
CALL cdp.activation_platform_update (id_or_name => 'abc_user_identifiers', description => 'Activates only user identifiers', refresh_settings => (mode = 'Incremental', frequency = 'TwentyFourHours', periodic_full_refresh = 'Every30Days'));
```

**Result**

One row. Schema `ActivationPlatformRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `activation_flow_type` | `activationFlowType` | VARCHAR | Type of activation flow. Since v67.0. |
| `activation_platform_attributes` | `activationPlatformAttributes` | JSON (array of ActivationPlatformAttributeRepresentation) | Activation attributes for data mapping. Since v67.0. |
| `activation_platform_creation_type` | `activationPlatformCreationType` | VARCHAR | How the platform was created. Since v67.0. |
| `additional_metadata` | `additionalMetadata` | JSON (ActivationPlatformAdditionalMetadataRepresentation) | Additional platform metadata, such as event configuration, mappings, and output properties. Since v67.0. |
| `can_publish_now` | `canPublishNow` | BOOLEAN | Indicates whether the platform is ready to be published (`true`) or not (`false`). Since v67.0. |
| `connector` | `connector` | JSON | Connector configuration for S3 or OAuth. Since v67.0. |
| `connector_type` | `connectorType` | VARCHAR | Type of connector. Since v67.0. |
| `created_by` | `createdBy` | JSON (ActivationPlatformUserRepresentation) | User who created the platform. Since v67.0. |
| `created_date` | `createdDate` | TIMESTAMPTZ | Date and time when the platform was created. Since v67.0. |
| `customer_id_type_mapping` | `customerIdTypeMapping` | JSON (ActivationPlatformCustomerIdTypeMappingRepresentation) | Customer ID type mapping configuration. Since v67.0. |
| `description` | `description` | VARCHAR | Description of the activation platform. Since v67.0. |
| `enabled` | `enabled` | BOOLEAN | Indicates whether the activation platform is enabled (`true`) or not (`false`). Since v67.0. |
| `error_code` | `errorCode` | VARCHAR | Error code returned when the status is `Error`. Since v67.0. |
| `event_parameter_hierarchy_map` | `eventParameterHierarchyMap` | JSON | Map of valid parameter value pairings keyed by hierarchy combination, such as `Event__ActionSource`. Since v67.0. |
| `event_parameters` | `eventParameters` | JSON (array of ActivationEventParameterValuesRepresentation) | Event parameter definitions with hierarchy and allowed values. Since v67.0. |
| `external_provider` | `externalProvider` | VARCHAR | External provider associated with the platform. Since v67.0. |
| `fields` | `fields` | JSON (array of ActivationPlatformFieldRepresentation) | Configuration fields for the platform. Since v67.0. |
| `id` | `id` | VARCHAR | Salesforce ID of the activation platform. Since v67.0. |
| `identifiers` | `identifiers` | JSON (array of ActivationPlatformIdentifierRepresentation) | Platform audience identifiers. Since v67.0. |
| `include_segment_names` | `includeSegmentNames` | BOOLEAN | Indicates whether segment names are included in output files (`true`) or not (`false`). Since v67.0. |
| `is_strategic_partner` | `isStrategicPartner` | BOOLEAN | Indicates whether the platform is a strategic partner platform (`true`) or not (`false`). Since v67.0. |
| `label` | `label` | VARCHAR | Display label of the activation platform. Since v67.0. |
| `last_modified_by` | `lastModifiedBy` | JSON (ActivationPlatformUserRepresentation) | User who last modified the platform. Since v67.0. |
| `last_modified_date` | `lastModifiedDate` | TIMESTAMPTZ | Date and time when the platform was last modified. Since v67.0. |
| `logo_url` | `logoUrl` | VARCHAR | URL to the platform logo for UI display. Since v67.0. |
| `name` | `name` | VARCHAR | API name of the activation platform. Since v67.0. |
| `namespace` | `namespace` | VARCHAR | Namespace prefix for managed packages. Null for unmanaged. Since v67.0. |
| `notes` | `notes` | VARCHAR | Additional notes or admin commentary. Since v67.0. |
| `output_format` | `outputFormat` | VARCHAR | Format of the output files. Since v67.0. |
| `output_grouping` | `outputGrouping` | VARCHAR | How output files are grouped. Since v67.0. |
| `platform_processing_type` | `platformProcessingType` | VARCHAR | How the platform processes activations. Since v67.0. |
| `platform_type` | `platformType` | VARCHAR | Category of the activation platform. Since v67.0. |
| `privacy_type` | `privacyType` | VARCHAR | Privacy classification of the platform. Since v67.0. |
| `refresh_settings` | `refreshSettings` | JSON (RefreshSettingsRepresentation) | Refresh configuration for the platform. Since v67.0. |
| `show_event_source_annotations` | `showEventSourceAnnotations` | BOOLEAN | Indicates whether event source annotations are shown in the UI (`true`) or not (`false`). Since v67.0. |
| `status` | `status` | VARCHAR | Status of the activation platform. Since v67.0. |
| `supported_event_types` | `supportedEventTypes` | JSON | Supported event types for streaming platforms. Since v67.0. |

**Done when:** `activation_platform_get.status` leaves `Processing` for `Active` or `Error`. This is read from the status enum and the spec's example responses; no source documents the timing.

**Notes:** `activation_platform_attributes`, `fields` and `identifiers` replace the full set, so read with `activation_platform_get` and send everything back, or the rest is removed. There are no options for `name`, `platform_type` or `activation_flow_type`. `platform_processing_type` can be set here but not on create. The spec's example response keeps the attribute names it was sent, and shows `status` `Processing` and `enabled` `false`.

## activation_platform_create

`POST /ssot/activation-platforms` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Activation-Platforms/paths/~1ssot~1activation-platforms/post) · evidence O · changes org state

Creates an activation platform. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `activation_flow_type` | `activationFlowType` | body | enum(Dmo, Segment) |  | Type of activation flow. Since v67.0. |
| `activation_platform_attributes` | `activationPlatformAttributes` | body | array of [ActivationPlatformAttributeInput](#activationplatformattributeinputrepresentation) |  | Activation attributes for data mapping. Since v67.0. |
| `additional_metadata` | `additionalMetadata` | body | [ActivationPlatformAdditionalMetadataInput](#activationplatformadditionalmetadatainputrepresentation) |  | Additional platform metadata, such as event configuration, mappings, and output properties. Since v67.0. |
| `connector` | `connector` | body | map to string |  | Connector configuration as key-value string pairs, such as `bucket_name` and `exportDirectory`. Since v67.0. |
| `custom_metadata` | `customMetadata` | body | [ActivationPlatformCustomMetadataInput](#activationplatformcustommetadatainputrepresentation) |  | Connector credentials for toolkit-created platforms. Since v67.0. |
| `description` | `description` | body | string | yes | Description of the activation platform. Since v67.0. |
| `fields` | `fields` | body | array of [ActivationPlatformFieldInput](#activationplatformfieldinputrepresentation) |  | Configuration fields for the platform. Since v67.0. |
| `identifiers` | `identifiers` | body | array of [ActivationPlatformIdentifierInput](#activationplatformidentifierinputrepresentation) |  | Platform audience identifiers. Since v67.0. |
| `label` | `label` | body | string | yes | Display label of the activation platform. Since v67.0. |
| `logo_url` | `logoUrl` | body | string |  | URL to the platform logo. Since v67.0. |
| `name` | `name` | body | string | yes | API name of the activation platform. Since v67.0. |
| `output_format` | `outputFormat` | body | enum(Csv, Json, Parquet) | yes | Format of the output files. Since v67.0. |
| `output_grouping` | `outputGrouping` | body | enum(PerAccount, PerSegment) | yes | How output files are grouped. Since v67.0. |
| `platform_type` | `platformType` | body | enum(Advertising, Analytics, Marketing, Publishing, Technology) | yes | Category of the activation platform. Since v67.0. |
| `refresh_settings` | `refreshSettings` | body | [RefreshSettingsInput](#refreshsettingsinputrepresentation) | yes | Refresh configuration for the platform. Since v67.0. |

```sql
CALL cdp.activation_platform_create (
  name => 'abc_user_identifiers',
  label => 'abc-user-identifiers',
  description => 'Activates only user identifiers',
  platform_type => 'Advertising',
  output_format => 'Csv',
  output_grouping => 'PerAccount',
  refresh_settings => (mode = 'Full', frequency = 'TwentyFourHours'),
  connector => (bucketName = 'example-bucket', exportDirectory = 'datacloud-activations'),
  custom_metadata => (connector_type = 'S3', access_key = :s3_access_key, secret_key = :s3_secret_key),
  activation_platform_attributes => [(name = 'EmailAddress', label = 'Hashed Email', destination_name = 'EmailAddress', object_name = 'ContactPointEmail', field_name = 'Email', is_required = true, apply_hash = true, is_identifier = true)],
  fields => [(name = 'AccountId', is_required = true, is_hidden = false, type = 'Text')],
  additional_metadata => (hash_method = 'SHA256')
);
```

**Result**

One row. Schema `ActivationPlatformRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `activation_flow_type` | `activationFlowType` | VARCHAR | Type of activation flow. Since v67.0. |
| `activation_platform_attributes` | `activationPlatformAttributes` | JSON (array of ActivationPlatformAttributeRepresentation) | Activation attributes for data mapping. Since v67.0. |
| `activation_platform_creation_type` | `activationPlatformCreationType` | VARCHAR | How the platform was created. Since v67.0. |
| `additional_metadata` | `additionalMetadata` | JSON (ActivationPlatformAdditionalMetadataRepresentation) | Additional platform metadata, such as event configuration, mappings, and output properties. Since v67.0. |
| `can_publish_now` | `canPublishNow` | BOOLEAN | Indicates whether the platform is ready to be published (`true`) or not (`false`). Since v67.0. |
| `connector` | `connector` | JSON | Connector configuration for S3 or OAuth. Since v67.0. |
| `connector_type` | `connectorType` | VARCHAR | Type of connector. Since v67.0. |
| `created_by` | `createdBy` | JSON (ActivationPlatformUserRepresentation) | User who created the platform. Since v67.0. |
| `created_date` | `createdDate` | TIMESTAMPTZ | Date and time when the platform was created. Since v67.0. |
| `customer_id_type_mapping` | `customerIdTypeMapping` | JSON (ActivationPlatformCustomerIdTypeMappingRepresentation) | Customer ID type mapping configuration. Since v67.0. |
| `description` | `description` | VARCHAR | Description of the activation platform. Since v67.0. |
| `enabled` | `enabled` | BOOLEAN | Indicates whether the activation platform is enabled (`true`) or not (`false`). Since v67.0. |
| `error_code` | `errorCode` | VARCHAR | Error code returned when the status is `Error`. Since v67.0. |
| `event_parameter_hierarchy_map` | `eventParameterHierarchyMap` | JSON | Map of valid parameter value pairings keyed by hierarchy combination, such as `Event__ActionSource`. Since v67.0. |
| `event_parameters` | `eventParameters` | JSON (array of ActivationEventParameterValuesRepresentation) | Event parameter definitions with hierarchy and allowed values. Since v67.0. |
| `external_provider` | `externalProvider` | VARCHAR | External provider associated with the platform. Since v67.0. |
| `fields` | `fields` | JSON (array of ActivationPlatformFieldRepresentation) | Configuration fields for the platform. Since v67.0. |
| `id` | `id` | VARCHAR | Salesforce ID of the activation platform. Since v67.0. |
| `identifiers` | `identifiers` | JSON (array of ActivationPlatformIdentifierRepresentation) | Platform audience identifiers. Since v67.0. |
| `include_segment_names` | `includeSegmentNames` | BOOLEAN | Indicates whether segment names are included in output files (`true`) or not (`false`). Since v67.0. |
| `is_strategic_partner` | `isStrategicPartner` | BOOLEAN | Indicates whether the platform is a strategic partner platform (`true`) or not (`false`). Since v67.0. |
| `label` | `label` | VARCHAR | Display label of the activation platform. Since v67.0. |
| `last_modified_by` | `lastModifiedBy` | JSON (ActivationPlatformUserRepresentation) | User who last modified the platform. Since v67.0. |
| `last_modified_date` | `lastModifiedDate` | TIMESTAMPTZ | Date and time when the platform was last modified. Since v67.0. |
| `logo_url` | `logoUrl` | VARCHAR | URL to the platform logo for UI display. Since v67.0. |
| `name` | `name` | VARCHAR | API name of the activation platform. Since v67.0. |
| `namespace` | `namespace` | VARCHAR | Namespace prefix for managed packages. Null for unmanaged. Since v67.0. |
| `notes` | `notes` | VARCHAR | Additional notes or admin commentary. Since v67.0. |
| `output_format` | `outputFormat` | VARCHAR | Format of the output files. Since v67.0. |
| `output_grouping` | `outputGrouping` | VARCHAR | How output files are grouped. Since v67.0. |
| `platform_processing_type` | `platformProcessingType` | VARCHAR | How the platform processes activations. Since v67.0. |
| `platform_type` | `platformType` | VARCHAR | Category of the activation platform. Since v67.0. |
| `privacy_type` | `privacyType` | VARCHAR | Privacy classification of the platform. Since v67.0. |
| `refresh_settings` | `refreshSettings` | JSON (RefreshSettingsRepresentation) | Refresh configuration for the platform. Since v67.0. |
| `show_event_source_annotations` | `showEventSourceAnnotations` | BOOLEAN | Indicates whether event source annotations are shown in the UI (`true`) or not (`false`). Since v67.0. |
| `status` | `status` | VARCHAR | Status of the activation platform. Since v67.0. |
| `supported_event_types` | `supportedEventTypes` | JSON | Supported event types for streaming platforms. Since v67.0. |

**Done when:** `activation_platform_get.status` leaves `Processing` for `Active` or `Error`. This is read from the status enum and the spec's example responses; no source documents the timing. Publish once `can_publish_now` is `true`.

**Notes:** **The spec's example has literal credentials.**

The server renames children. The spec's example sends attribute `EmailAddress` and field `AccountId`, and gets back generated names such as `abc_user_identifiers1786035439839`, with `AccountId` kept as the `label`. Read the names back before an update.

The new platform comes back with `status` `Processing`, `enabled` `false` and `can_publish_now` `false`. Publish sets it active. No source gives the order of publish and enable. There's no privacy option: use `activation_platform_privacy_type_set`.

A platform's `fields` are the configuration a target fills in through `connector.fieldConfig.fields`, and `activation_target_platform_field_list` lists them. The spec's target example sends `AccountId`; no source says if it matches the label or the generated name.

The [Metadata API `ActivationPlatform` type](https://developer.salesforce.com/docs/atlas.en-us.api_meta.meta/api_meta/meta_activationplatform.htm), another way to ship a platform, disagrees with the spec. It lists a `PER_USER` grouping that the spec lacks, and only `TWENTY_FOUR` for refresh frequency, where the spec also has `FourHours` and `TwelveHours`.

## activation_platform_disable

`POST /ssot/activation-platforms/{idOrName}/actions/disable` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Activation-Platforms/paths/~1ssot~1activation-platforms~1%7BidOrName%7D~1actions~1disable/post) · evidence O · changes org state

Disables an activation platform. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `id_or_name` | `idOrName` | path | string | yes | 18-character ID or API name of the activation platform. Since v67.0. |

```sql
CALL cdp.activation_platform_disable (id_or_name => 'abc_user_identifiers');
```

**Result**

One row. Schema `ActionResultRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `message` | `message` | VARCHAR | Human-readable status or warning message. Can be null on success. Since v67.0. |
| `success` | `success` | BOOLEAN | Indicates whether the action completed successfully (`true`) or not (`false`). Since v67.0. |

**Notes:** The spec doesn't say what this does to existing targets and activations.

## activation_platform_enable

`POST /ssot/activation-platforms/{idOrName}/actions/enable` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Activation-Platforms/paths/~1ssot~1activation-platforms~1%7BidOrName%7D~1actions~1enable/post) · evidence O · changes org state

Enables an activation platform. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `id_or_name` | `idOrName` | path | string | yes | 18-character ID or API name of the activation platform. Since v67.0. |

```sql
CALL cdp.activation_platform_enable (id_or_name => 'abc_user_identifiers');
```

**Result**

One row. Schema `ActionResultRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `message` | `message` | VARCHAR | Human-readable status or warning message. Can be null on success. Since v67.0. |
| `success` | `success` | BOOLEAN | Indicates whether the action completed successfully (`true`) or not (`false`). Since v67.0. |

## activation_platform_publish

`POST /ssot/activation-platforms/{idOrName}/actions/publish` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Activation-Platforms/paths/~1ssot~1activation-platforms~1%7BidOrName%7D~1actions~1publish/post) · evidence O · changes org state

Publishes an activation platform and sets its status to active. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `id_or_name` | `idOrName` | path | string | yes | Record ID (18-character) or API name of the activation platform to publish. Since v67.0. |

```sql
CALL cdp.activation_platform_publish (id_or_name => 'abc_user_identifiers');
```

**Result**

One row. Schema `ActionResultRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `message` | `message` | VARCHAR | Human-readable status or warning message. Can be null on success. Since v67.0. |
| `success` | `success` | BOOLEAN | Indicates whether the action completed successfully (`true`) or not (`false`). Since v67.0. |

**Done when:** `activation_platform_get.status` is `Active`, which the spec says publish sets. `success` and `message` report the call itself.

**Notes:** Check `activation_platform_get.can_publish_now` first. The spec doesn't say what publishing a platform with `can_publish_now` `false` returns.

## activation_platform_sync_retry

`POST /ssot/activation-platforms/{idOrName}/actions/retry-sync` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Activation-Platforms/paths/~1ssot~1activation-platforms~1%7BidOrName%7D~1actions~1retry-sync/post) · evidence O · changes org state

Retries the sync operation for an activation platform that previously failed. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `id_or_name` | `idOrName` | path | string | yes | 18-character ID or API name of the activation platform. Since v67.0. |

```sql
CALL cdp.activation_platform_sync_retry (id_or_name => 'abc_user_identifiers');
```

**Result**

One row. Schema `ActionResultRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `message` | `message` | VARCHAR | Human-readable status or warning message. Can be null on success. Since v67.0. |
| `success` | `success` | BOOLEAN | Indicates whether the action completed successfully (`true`) or not (`false`). Since v67.0. |

**Done when:** `activation_platform_get.status` leaves `Processing` for `Active` or `Error`. This is read from the status enum and the spec's example responses; no source documents the timing.

**Notes:** Use it when `activation_platform_get.status` is `Error`; `error_code` holds the cause. The spec's example platform `PremiumPartnerGoogle` is in this state while `enabled` is `true`.

## activation_platform_privacy_type_set

`POST /ssot/activation-platforms/{idOrName}/actions/set-privacy-type` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Activation-Platforms/paths/~1ssot~1activation-platforms~1%7BidOrName%7D~1actions~1set-privacy-type/post) · evidence O · changes org state

Sets the privacy type classification for an activation platform. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `id_or_name` | `idOrName` | path | string | yes | 18-character ID or API name of the activation platform. Since v67.0. |
| `privacy_type` | `privacyType` | body | enum(ThirdParty, ServiceProvider, UpdateFailed, NotApplicable) | yes | Privacy type classification for the platform. Since v67.0. |

```sql
CALL cdp.activation_platform_privacy_type_set (id_or_name => 'abc_user_identifiers', privacy_type => 'NotApplicable');
```

**Result**

One row. Schema `ActionResultRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `message` | `message` | VARCHAR | Human-readable status or warning message. Can be null on success. Since v67.0. |
| `success` | `success` | BOOLEAN | Indicates whether the action completed successfully (`true`) or not (`false`). Since v67.0. |

**Notes:** A target's `platform_privacy_type` is derived from this value (spec). `UpdateFailed` is in the accepted enum, and no source says what setting it means. The external family returns the same concept in uppercase (`THIRDPARTY`).

## Schemas

Attribute names are keywords inside the object they belong to, so completion offers exactly these.

### ActivationEventParameterHierarchyCombinationInputRepresentation

Represents the input for a key-values pair within a hierarchy combination.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `key` | `key` | string | yes | Parameter value key, such as `Purchase`. Since v67.0. |
| `values` | `values` | array of string |  | Valid child parameter values for the key. Since v67.0. |

### ActivationEventParameterHierarchyInputRepresentation

Represents the input for a hierarchy combination.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `hierarchy_combination` | `hierarchyCombination` | string | yes | Combination key, such as `Event__ActionSource`. Since v67.0. |
| `hierarchy_combination_data` | `hierarchyCombinationData` | array of [ActivationEventParameterHierarchyCombinationInput](#activationeventparameterhierarchycombinationinputrepresentation) |  | Valid value pairings for the combination. Since v67.0. |

### ActivationEventParameterInputRepresentation

Represents the input for an event parameter reference.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `name` | `name` | string | yes | Parameter value name, such as `Purchase` or `Website`. Since v67.0. |
| `sub_event_parameter` | `subEventParameter` | [ActivationEventParameterInput](#activationeventparameterinputrepresentation) |  | Nested event parameter reference for the next level in the hierarchy. Since v67.0. |
| `type` | `type` | enum(ActionSource, Event) | yes | Type of event parameter. Since v67.0. |

### ActivationEventParameterValuesInputRepresentation

Represents the input for an event parameter definition.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `hierarchy` | `hierarchy` | integer |  | Hierarchy level, starting at 1. Since v67.0. |
| `name` | `name` | string | yes | Parameter name, such as `Event` or `Action Source`. Since v67.0. |
| `type` | `type` | enum(ActionSource, Event) | yes | Type of event parameter. Since v67.0. |
| `values` | `values` | array of string |  | Allowed values for the parameter. Since v67.0. |

### ActivationMappingSchemaInputRepresentation

Represents the input for a mapping schema.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `description` | `description` | string |  | Description of the mapping schema. Since v67.0. |
| `icon` | `icon` | string |  | Icon identifier. Since v67.0. |
| `is_default` | `isDefault` | boolean |  | Indicates whether the schema is the default mapping schema (`true`) or not (`false`). Since v67.0. |
| `name` | `name` | string | yes | Name of the mapping schema. Since v67.0. |
| `title` | `title` | string |  | Display title. Since v67.0. |

### ActivationPlatformAdditionalMetadataInputRepresentation

Represents the input for additional platform metadata, such as event configuration, mappings, and output properties.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `activation_platform_event_metadata` | `activationPlatformEventMetadata` | [ActivationPlatformEventMetadataInput](#activationplatformeventmetadatainputrepresentation) |  | Event metadata configuration. Since v67.0. |
| `custom_attribute_prefix` | `customAttributePrefix` | string |  | Prefix for custom attributes, such as `custom__`. Since v67.0. |
| `customer_file_sources` | `customerFileSources` | array of string |  | Customer file source types, such as `FirstParty`, `ThirdParty`, or `FirstPartyAndThirdParty`. Since v67.0. |
| `hash_method` | `hashMethod` | string |  | Hash method applied to identifiers. Since v67.0. |
| `mapping_schemas` | `mappingSchemas` | array of [ActivationMappingSchemaInput](#activationmappingschemainputrepresentation) |  | Available mapping schemas for the platform. Since v67.0. |
| `output_properties` | `outputProperties` | [ActivationPlatformOutputPropertiesInput](#activationplatformoutputpropertiesinputrepresentation) |  | File output configuration properties. Since v67.0. |
| `partner_supported_ids` | `partnerSupportedIds` | array of [ActivationPlatformPartnerSupportedIdInput](#activationplatformpartnersupportedidinputrepresentation) |  | Partner-supported identifier types per destination. Since v67.0. |

### ActivationPlatformAttributeInputRepresentation

Represents the input for an activation attribute.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `apply_hash` | `applyHash` | boolean |  | Indicates whether hashing is applied to the attribute (`true`) or not (`false`). Since v67.0. |
| `destination_name` | `destinationName` | string |  | Destination name for the attribute. Since v67.0. |
| `field_name` | `fieldName` | string |  | Source field name. Since v67.0. |
| `is_identifier` | `isIdentifier` | boolean |  | Indicates whether the attribute is an identifier (`true`) or not (`false`). Since v67.0. |
| `is_required` | `isRequired` | boolean | yes | Indicates whether the attribute is required (`true`) or not (`false`). Since v67.0. |
| `label` | `label` | string |  | Attribute display label. Since v67.0. |
| `name` | `name` | string | yes | Attribute name. Since v67.0. |
| `object_name` | `objectName` | string |  | Source object name. Since v67.0. |
| `value` | `value` | string |  | Constant value for the attribute. Since v67.0. |

### ActivationPlatformAttributeSystemMapCriteriaInputRepresentation

Represents the input for system-mapped attribute criteria.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `data_type` | `dataType` | string | yes | Data type of the mapped field. Since v67.0. |
| `destination_name` | `destinationName` | string | yes | Destination attribute name. Since v67.0. |
| `source_mapping_field` | `sourceMappingField` | string | yes | Source field to auto-map from, such as `commit_timestamp`. Since v67.0. |
| `supported_dmo_types` | `supportedDMOTypes` | array of string |  | Data model object (DMO) types that support the system mapping, such as `Profile`. Since v67.0. |

### ActivationPlatformCustomEventInputRepresentation

Represents the input for custom event details.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `attribute_mapping_info` | `attributeMappingInfo` | array of [ActivationPlatformEventAttributeMappingInput](#activationplatformeventattributemappinginputrepresentation) |  | Attribute mapping rules for custom events. Since v67.0. |
| `attributes_override` | `attributesOverride` | [ActivationPlatformEventAttributeOverrideInput](#activationplatformeventattributeoverrideinputrepresentation) |  | Attribute override categorization for custom events. Since v67.0. |

### ActivationPlatformCustomMetadataInputRepresentation

Represents the connector credentials for toolkit-created activation platforms. The required fields depend on the connector type. For example, S3 requires `access_key` and `secret_key`.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `access_key` | `accessKey` | string |  | Access key for the connector. Required for S3. Since v67.0. |
| `connector_type` | `connectorType` | string | yes | Connector type, such as `S3`, `Sftp`, or `AzureBlob`. Since v67.0. |
| `secret_key` | `secretKey` | string |  | Secret key for the connector. Required for S3. Since v67.0. |

### ActivationPlatformEventAttributeInputRepresentation

Represents the input for a destination attribute with an optional constant value.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `destination_name` | `destinationName` | string | yes | Destination attribute name. Since v67.0. |
| `value` | `value` | string |  | Constant value. Null if mapped dynamically. Since v67.0. |

### ActivationPlatformEventAttributeMappingInputRepresentation

Represents the input for an attribute mapping rule.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `attributes_override` | `attributesOverride` | [ActivationPlatformEventAttributeOverrideInput](#activationplatformeventattributeoverrideinputrepresentation) |  | Attribute override categorization for the mapping. Since v67.0. |
| `event_parameter` | `eventParameter` | [ActivationEventParameterInput](#activationeventparameterinputrepresentation) |  | Event parameter reference for the mapping. Since v67.0. |
| `key` | `key` | string | yes | Mapping key, such as `Purchase__Website` or `Global`. Since v67.0. |
| `reference_attributes` | `referenceAttributes` | array of string |  | Keys of parent mappings whose attributes are inherited. Since v67.0. |

### ActivationPlatformEventAttributeOverrideInputRepresentation

Represents the input for attribute override categorization.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `exclude` | `exclude` | array of [ActivationPlatformEventAttributeInput](#activationplatformeventattributeinputrepresentation) |  | Excluded attributes for this context. Since v67.0. |
| `identifiers` | `identifiers` | array of [ActivationPlatformEventAttributeInput](#activationplatformeventattributeinputrepresentation) |  | Identifier attributes for this context. Since v67.0. |
| `optional` | `optional` | array of [ActivationPlatformEventAttributeInput](#activationplatformeventattributeinputrepresentation) |  | Optional attributes for this context. Since v67.0. |
| `required` | `required` | array of [ActivationPlatformEventAttributeInput](#activationplatformeventattributeinputrepresentation) |  | Required attributes for this context. Since v67.0. |
| `system_mapping_attributes` | `systemMappingAttributes` | array of [ActivationPlatformAttributeSystemMapCriteriaInput](#activationplatformattributesystemmapcriteriainputrepresentation) |  | System-mapped attributes with auto-population criteria. Since v67.0. |

### ActivationPlatformEventMetadataInputRepresentation

Represents the input for event metadata configuration.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `custom_event_details` | `customEventDetails` | [ActivationPlatformCustomEventInput](#activationplatformcustomeventinputrepresentation) |  | Custom event details with attribute overrides. Since v67.0. |
| `show_event_source_annotations` | `showEventSourceAnnotations` | boolean |  | Indicates whether event source annotations are shown in the UI (`true`) or not (`false`). Since v67.0. |
| `standard_event_details` | `standardEventDetails` | [ActivationPlatformStandardEventInput](#activationplatformstandardeventinputrepresentation) |  | Standard event details, including event parameters, hierarchy, and attribute mapping info. Since v67.0. |
| `supported_event_types` | `supportedEventTypes` | array of string |  | Supported event types, such as `Standard` and `Custom`. Since v67.0. |

### ActivationPlatformFieldInputRepresentation

Represents the input for a configuration field.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `help_text` | `helpText` | string |  | Help text for the field. Since v67.0. |
| `is_hidden` | `isHidden` | boolean |  | Indicates whether the field is hidden in the UI (`true`) or not (`false`). Since v67.0. |
| `is_required` | `isRequired` | boolean | yes | Indicates whether the field is required (`true`) or not (`false`). Since v67.0. |
| `label` | `label` | string |  | Field display label. Since v67.0. |
| `name` | `name` | string | yes | Field API name. Since v67.0. |
| `type` | `type` | enum(Date, Number, Text) | yes | Data type of the field. Since v67.0. |
| `values` | `values` | array of [ActivationPlatformFieldValueInput](#activationplatformfieldvalueinputrepresentation) |  | Allowed values for picklist fields. The spec's output schema says exactly one value must have `is_default` set to `true`. Since v67.0. |

### ActivationPlatformFieldValueInputRepresentation

Represents the input for a field picklist value.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `is_default` | `isDefault` | boolean |  | Indicates whether the value is the default value (`true`) or not (`false`). Since v67.0. |
| `value` | `value` | string |  | Picklist value. Since v67.0. |

### ActivationPlatformIdentifierInputRepresentation

Represents the input for a platform audience identifier.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `identifier_hash_method` | `identifierHashMethod` | enum(Md5, None, Sha1, Sha256) |  | Hash method applied to the identifier. Since v67.0. |
| `identifier_type` | `identifierType` | enum(Email, Maid, Ott, Phone) |  | Type of audience identifier. Since v67.0. |

### ActivationPlatformOutputPropertiesInputRepresentation

Represents the input for file output configuration properties.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `compression` | `compression` | enum(Bzip2, Gzip, None) |  | Compression method applied to output files. Since v67.0. |
| `delimiter` | `delimiter` | enum(BrokenPipe, Caret, Colon, Comma, Hash, Pipe, Semicolon, Slash, Tab, Tilde, Underscore) |  | Field delimiter used in output files. Since v67.0. |
| `max_file_size_in_mb` | `maxFileSizeInMB` | integer |  | Maximum file size in megabytes. Since v67.0. |
| `max_records_per_file` | `maxRecordsPerFile` | number (int64) |  | Maximum records per output file. Since v67.0. |
| `min_records_per_file` | `minRecordsPerFile` | number (int64) |  | Minimum records per output file. Since v67.0. |
| `output_format` | `outputFormat` | enum(Csv, Json, Parquet) |  | Format of the output files. Since v67.0. |
| `output_partitions` | `outputPartitions` | number (int64) |  | Number of output partitions. Since v67.0. |

### ActivationPlatformPartnerSupportedIdInputRepresentation

Represents the input for partner-supported identifier types.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `destination_name` | `destinationName` | string | yes | Destination attribute that accepts these ID types. Since v67.0. |
| `supported_id_types` | `supportedIdTypes` | array of string |  | Supported identifier type values. Since v67.0. |

### ActivationPlatformStandardEventInputRepresentation

Represents the input for standard event details.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `attribute_mapping_info` | `attributeMappingInfo` | array of [ActivationPlatformEventAttributeMappingInput](#activationplatformeventattributemappinginputrepresentation) |  | Attribute mapping rules per event/action-source combination. Since v67.0. |
| `event_parameter_hierarchy` | `eventParameterHierarchy` | array of [ActivationEventParameterHierarchyInput](#activationeventparameterhierarchyinputrepresentation) |  | Hierarchy combinations defining valid parameter value pairings. Since v67.0. |
| `event_parameters` | `eventParameters` | array of [ActivationEventParameterValuesInput](#activationeventparametervaluesinputrepresentation) |  | Event parameter definitions with hierarchy and allowed values. Since v67.0. |

### RefreshSettingsInputRepresentation

Represents the refresh configuration input for creating or updating an activation platform.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `frequency` | `frequency` | enum(FourHours, TwelveHours, TwentyFourHours) |  | How often the activation platform refreshes. Since v67.0. |
| `mode` | `mode` | enum(Full, Incremental) |  | Refresh mode for the activation platform. Since v67.0. |
| `periodic_full_refresh` | `periodicFullRefresh` | enum(Every30Days, Every60Days) |  | How often a periodic full refresh runs. Applies [with incremental refresh mode](https://developer.salesforce.com/docs/atlas.en-us.api_meta.meta/api_meta/meta_activationplatform.htm). Since v67.0. |
