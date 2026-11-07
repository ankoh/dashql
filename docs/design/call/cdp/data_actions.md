# Data Actions

Part of the [CDP function reference](functions.md). Nothing here is implemented or tested against an org. Every result also has the [standard columns](functions.md#result-schema).

A data action watches a source object, usually a data model object (`__dlm`), for created, updated or deleted rows. When a change passes its conditions, Data 360 sends an event to one or more targets in [near real time](https://developer.salesforce.com/blogs/2024/01/unleashing-the-power-of-data-actions-using-a-webhook-as-a-target). These targets are separate from [activation targets](activation_targets.md), which receive segments.

The target comes first: the action names it in `data_action_target_names`. The source object must also exist with its fields materialized. Target types are `WebHook`, `Core` (a Platform Event in a connected Salesforce org) and `MarketingCloud`, plus `Internal_WebHook`, which no source explains. There is no Flow type. A Flow subscribes to the Platform Event of a `Core` target.

Gotchas:

- A webhook target without a signing key [receives no payloads](https://developer.salesforce.com/docs/data/data-cloud-int/references/webhook-data-action-targets/c360a-api-webhook-data-action-targets-in-customer-data-platform.md). Calls are marked `Signing Key Not Found`.
- Targets and actions provision asynchronously. Both return `Processing` first, then reach `Active` or `Error`.
- Spellings change between request and response: `WebHook` comes back as `WEBHOOK`, and `source_name` as `objectDevName`.
- The spec has only list and create for actions, and no update for targets. The other calls here rest on weaker sources, shown per function.

```sql
CALL cdp.dataaction_target_create (type => 'WebHook', label => 'Contact webhook', api_name => 'contact_webhook', config => (target_endpoint = 'https://hooks.example.com/data360'));
CALL cdp.dataaction_target_get (api_name => 'contact_webhook');
CALL cdp.dataaction_target_signing_key_generate (api_name => 'contact_webhook');
CALL cdp.dataaction_create (data_action_target_names => ['contact_webhook'], body_dataspace => 'default', data_action_name => 'Rate changed', developer_name => 'Rate_Changed', description => 'Notify on rate changes', master_label => 'Rate changed', data_action_sources => [(source_name = 'StaticCurrencyRates_Home__dlm', source_type = 'DataModelEntity', source_cdc_subscriptions = ['CREATE', 'UPDATE'])], action_condition_expression => '', action_conditions => [], data_action_enrichment_properties => [], data_action_projected_fields => []);
CALL cdp.dataaction_list (dataspace => 'default');
```

**Functions:** [`dataaction_target_delete`](#dataaction_target_delete), [`dataaction_target_list`](#dataaction_target_list), [`dataaction_target_get`](#dataaction_target_get), [`dataaction_list`](#dataaction_list), [`dataaction_target_create`](#dataaction_target_create), [`dataaction_target_signing_key_generate`](#dataaction_target_signing_key_generate), [`dataaction_create`](#dataaction_create), [`dataaction_get`](#dataaction_get), [`dataaction_target_update`](#dataaction_target_update), [`dataaction_update`](#dataaction_update), [`dataaction_delete`](#dataaction_delete)

## dataaction_target_delete

`DELETE /ssot/data-action-targets/{apiName}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Action-Targets/paths/~1ssot~1data-action-targets~1%7BapiName%7D/delete) · tool `d360_dataaction_target_delete` · evidence O · changes org state

Delete a data action target. Since v58.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `api_name` | `apiName` | path | string | yes | Developer name of the target, not a record id. |

```sql
CALL cdp.dataaction_target_delete (api_name => 'contact_webhook');
```

**Result**

No response body (HTTP 200). One row with only the standard columns.

**Notes:** Salesforce's MCP source says to [ensure no data actions reference the target first](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/DataActionTools.java). The spec has no call to delete an action; see [`dataaction_delete`](#dataaction_delete) for the community-only path. `status_error_code` has a `DeleteFailed` value, so check the target afterwards if the delete doesn't take effect.

## dataaction_target_list

`GET /ssot/data-action-targets` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Action-Targets/paths/~1ssot~1data-action-targets/get) · tool `d360_dataaction_target_list` · evidence O · read-only

Get a paginated list of data action targets. Since v58.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `batch_size` | `batchSize` | query | integer |  | Number of items returned. Since v58.0. |
| `offset` | `offset` | query | integer |  | Number of rows to skip before returning results. If unspecified, no rows are skipped. Since v58.0. |
| `order_by` | `orderby` | query | string |  | Sort order for the result set, such as `GenderId__c ASC,\u200BOccupation__c DESC`. If unspecified, items are returned in the order they are retrieved. Since v58.0. |

```sql
CALL cdp.dataaction_target_list ();
```

**Result**

One row per item of `/dataActionTargets` in the response. Other response fields go to `_meta`: `currentPageUrl`, `nextPageUrl`. Schema `CdpDataActionTargetOutputRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `api_name` | `apiName` | VARCHAR | Developer name of the data action target. Since v62.0. |
| `config` | `config` | JSON | Configuration for the data action target. The endpoint returns the config output object that corresponds to the type of data action target. For example, the Data Action Target Core Config Output is returned for the `Core` type. Since v62.0. |
| `external_record_identifier` | `externalRecordIdentifier` | VARCHAR | External record ID. Since v62.0. |
| `label` | `label` | VARCHAR | Data action target name. Since v62.0. |
| `status` | `status` | VARCHAR | Status Since v62.0. |
| `status_error_code` | `statusErrorCode` | VARCHAR | Status error code. Since v62.0. |
| `sub_type` | `subType` | VARCHAR | Sub type Since v62.0. |
| `type` | `type` | VARCHAR | Data action target type. Since v62.0. |

**Paging:** `next_page_url`.

**Notes:** Returns data action targets only, not activation targets. Spec examples return `type` and `status` in upper case (`WEBHOOK`, `ACTIVE`), while the spec's enums say `WebHook` and `Active`. Compare them case-insensitively. A community implementation [saw both spellings of `status`](https://github.com/javrrr/afd360/blob/main/src/resources/data-action-target.ts) (community).

## dataaction_target_get

`GET /ssot/data-action-targets/{apiName}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Action-Targets/paths/~1ssot~1data-action-targets~1%7BapiName%7D/get) · tool `d360_dataaction_target_get` · evidence O · read-only

Get a data action target. Since v58.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `api_name` | `apiName` | path | string | yes | Developer name of the target, not a record id. |

```sql
CALL cdp.dataaction_target_get (api_name => 'contact_webhook');
```

**Result**

One row. Schema `CdpDataActionTargetOutputRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `api_name` | `apiName` | VARCHAR | Developer name of the data action target. Since v62.0. |
| `config` | `config` | JSON | Configuration for the data action target. The endpoint returns the config output object that corresponds to the type of data action target. For example, the Data Action Target Core Config Output is returned for the `Core` type. Since v62.0. |
| `external_record_identifier` | `externalRecordIdentifier` | VARCHAR | External record ID. Since v62.0. |
| `label` | `label` | VARCHAR | Data action target name. Since v62.0. |
| `status` | `status` | VARCHAR | Status Since v62.0. |
| `status_error_code` | `statusErrorCode` | VARCHAR | Status error code. Since v62.0. |
| `sub_type` | `subType` | VARCHAR | Sub type Since v62.0. |
| `type` | `type` | VARCHAR | Data action target type. Since v62.0. |

**Notes:** This is the readiness check after [`dataaction_target_create`](#dataaction_target_create). The shape of `config` depends on `type`: a `WebHook` target returns `target_endpoint`, and a `Core` target returns `label` and `org_id`. Note `label` here, where the request says `org_label`. A community implementation found that a `Core` target [doesn't store `target_endpoint`](https://github.com/javrrr/afd360/blob/main/src/resources/data-action-target.ts), so don't diff it against what you sent (community). The output schema has no signing key field.

## dataaction_list

`GET /ssot/data-actions` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Actions/paths/~1ssot~1data-actions/get) · tool `d360_dataaction_list` · evidence O · read-only

Get a paginated list of data actions in the org. Since v58.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `batch_size` | `batchSize` | query | integer |  | Number of items returned. Since v62.0. |
| `dataspace` | `dataspace` | query | string |  | The Data 360 data space from which to return data actions. Since v62.0. |
| `offset` | `offset` | query | integer |  | Number of rows to skip before returning results. If unspecified, no rows are skipped. Since v62.0. |
| `order_by` | `orderby` | query | string |  | Name of the field to order the results by. Since v62.0. |

```sql
CALL cdp.dataaction_list (dataspace => 'default', batch_size => 50);
```

**Result**

One row per item of `/dataActions` in the response. Other response fields go to `_meta`: `currentPageUrl`, `nextPageUrl`. Schema `CdpDataActionOutputRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `action_condition_expression` | `actionConditionExpression` | VARCHAR | The action's condition expression. Since v62.0. |
| `action_conditions` | `actionConditions` | JSON (array of DataActionConditionOutputRepresentation) | The action conditions. Since v62.0. |
| `data_action_enrichment_properties` | `dataActionEnrichmentProperties` | JSON (array of DataActionEnrichmentOutputRepresentation) | The data action enrichment properties. Since v62.0. |
| `data_action_name` | `dataActionName` | VARCHAR | Data action's name. Since v62.0. |
| `data_action_projected_fields` | `dataActionProjectedFields` | JSON (array of DataActionProjectedFieldOutputRepresentation) | The data action's projected fields. Since v62.0. |
| `data_action_sources` | `dataActionSources` | JSON (array of DataActionSourceOutputRepresentation) | Data action sources. Since v62.0. |
| `data_action_status` | `dataActionStatus` | VARCHAR | Data action's status. Since v62.0. |
| `data_action_targets` | `dataActionTargets` | JSON | Data action targets. Since v62.0. |
| `dataspace_dev_name` | `dataSpaceDevName` | VARCHAR | Developer name of the data space. Since v62.0. |
| `description` | `description` | VARCHAR | Description of the data action. Since v62.0. |
| `developer_name` | `developerName` | VARCHAR | Developer name of the data action. Since v62.0. |
| `event_trigger_condition` | `eventTriggerCondition` | VARCHAR | Event trigger condition for the data action. Since v62.0. |
| `external_record_identifier` | `externalRecordIdentifier` | VARCHAR | Data action's external record identifier. Since v62.0. |
| `is_real_time_action` | `isRealTimeAction` | BOOLEAN | Indicates whether the data action is a real-time action (`true`) or not (`false`). Since v62.0. |
| `last_action_status_date_time` | `lastActionStatusDateTime` | VARCHAR | Date and time that the most recent data action status was set. Since v62.0. |
| `last_action_status_error_code` | `lastActionStatusErrorCode` | VARCHAR | Status of the data action's error code. Since v62.0. |
| `master_label` | `masterLabel` | VARCHAR | Data action's master label. Since v62.0. |
| `should_trigger_event_only_first_time` | `shouldTriggerEventOnlyFirstTime` | BOOLEAN | If `true`, the related event is triggered only the first time that the data action is used. If `false`, the event is triggered each time the data action is used. Since v62.0. |
| `subscriber_key` | `subscriberKey` | VARCHAR | Data action subscriber key. Since v62.0. |

**Paging:** `next_page_url`.

**Notes:** This is the only spec-documented way to read an action's status. To find one action, filter on `developer_name`, which is its stable key, and pass `dataspace` because a community implementation [treats the list as scoped to a data space](https://github.com/javrrr/afd360/blob/main/docs/resources.md) (community). `data_action_targets` holds target API names in the spec examples. Inside `data_action_sources`, the spec examples return `objectDevName`, `objectType` and `subscriptionModes`, not the attribute names used on create. Spec examples show upper-case `data_action_status` (`ACTIVE`) and `last_action_status_error_code` (`CREATE_FAILED`).

## dataaction_target_create

`POST /ssot/data-action-targets` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Action-Targets/paths/~1ssot~1data-action-targets/post) · tool `d360_dataaction_target_create` · evidence O · changes org state

Create a new data action target. Since v58.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `api_name` | `apiName` | body | string | yes | Data action target API name. Since v62.0. |
| `config` | `config` | body | one of [CdpDataActionTargetCRMConfig](#cdpdataactiontargetcrmconfig), [CdpDataActionTargetInternalWebConfig](#cdpdataactiontargetinternalwebconfig), [CdpDataActionTargetMCConfig](#cdpdataactiontargetmcconfig), [CdpDataActionTargetWebConfig](#cdpdataactiontargetwebconfig) | yes | Configuration for the data action target. Use the config input object that corresponds to the type of data action target. For example, use the Data Action Target Internal Web Config Input for the `Internal_WebHook` type. Since v62.0. |
| `external_record_identifier` | `externalRecordIdentifier` | body | string |  | External record ID. Since v62.0. |
| `label` | `label` | body | string | yes | Data action target name. Since v62.0. |
| `sub_type` | `subType` | body | enum(Grpc, Rest) |  | Data action target sub type. Since v62.0. |
| `type` | `type` | body | enum(Core, Internal_WebHook, MarketingCloud, WebHook) | yes | Data action target type. Since v62.0. |
| `name` | `name` | body | string |  | Not in the spec schema: from the MCP server's payload example. |

```sql
CALL cdp.dataaction_target_create (type => 'WebHook', label => 'Contact webhook', api_name => 'contact_webhook', config => (target_endpoint = 'https://hooks.example.com/data360'));
```

**Result**

One row. Schema `CdpDataActionTargetOutputRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `api_name` | `apiName` | VARCHAR | Developer name of the data action target. Since v62.0. |
| `config` | `config` | JSON | Configuration for the data action target. The endpoint returns the config output object that corresponds to the type of data action target. For example, the Data Action Target Core Config Output is returned for the `Core` type. Since v62.0. |
| `external_record_identifier` | `externalRecordIdentifier` | VARCHAR | External record ID. Since v62.0. |
| `label` | `label` | VARCHAR | Data action target name. Since v62.0. |
| `status` | `status` | VARCHAR | Status Since v62.0. |
| `status_error_code` | `statusErrorCode` | VARCHAR | Status error code. Since v62.0. |
| `sub_type` | `subType` | VARCHAR | Sub type Since v62.0. |
| `type` | `type` | VARCHAR | Data action target type. Since v62.0. |

**Done when:** `dataaction_target_get.status` is `Active`. `Error` is terminal, with the reason in `status_error_code`. The create response itself shows `PROCESSING`. Compare case-insensitively.

**Notes:** The spec types `config` as `any`. Its attributes depend on `type` and are listed in [DataActionTargetConfig](#dataactiontargetconfig).

- **Webhook:** set `target_endpoint`, then call [`dataaction_target_signing_key_generate`](#dataaction_target_signing_key_generate). Without a key the target [gets no payloads](https://developer.salesforce.com/docs/data/data-cloud-int/references/webhook-data-action-targets/c360a-api-generate-secret-key-for-signature-validation.md).
- **Platform Event and Flow:** use `type => 'Core'` with `config => (org_id = '00DX2000001ZUi5', org_label = 'MyCompany Org')`. Help says these events use the standard [`DataObjectDataChgEvent`](https://help.salesforce.com/s/articleView?id=sf.c360_a_data_actions_CDP.htm&language=en_US&type=5). That event's [channel is `/event/DataObjectDataChgEvent`](https://developer.salesforce.com/docs/atlas.en-us.platform_events.meta/platform_events/sforce_api_objects_dataobjectdatachgevent.htm), and Flows, Apex triggers and the Pub/Sub API can subscribe. Its payload fields hold up to 125,000 characters. A [community article](https://www.salesforceben.com/unleashing-apex-with-salesforce-data-cloud-segments/) filters events on `ActionDeveloperName` in the subscriber (community).
- **Source conflict on `Core`:** afd360 [passes a custom event name such as `AccountInsightIngested__e` as `target_endpoint`](https://github.com/javrrr/afd360/blob/main/src/resources/data-action-target.ts) and reports that the platform drops it (community). The spec's `Core` example omits it.
- **`Core` prerequisite:** the org needs a Salesforce CRM connection. Otherwise the target goes from `Processing` to `Error` after about 4 to 5 minutes, and the POST doesn't report it (community, same source).
- **Marketing Cloud:** the spec example also sends `data_action_destination_type = 'API_EVENT'`, which the spec's config schema doesn't list.
- **`sub_type`:** the spec has it optional and its examples omit it. The MCP class [lists gRPC config attributes](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/model/request/dataaction/DataActionTargetConfig.java) that the spec lacks.
- **Limit:** [100 targets per tenant](https://help.salesforce.com/s/articleView?language=en_US&id=sf.c360_a_limits_and_guidelines.htm). An [older Customer Data Platform page](https://help.salesforce.com/s/articleView?language=en_US&id=sf.c360_a_limits_and_guidelines_cdp.htm&type=5) says 3.

## dataaction_target_signing_key_generate

`POST /ssot/data-action-targets/{apiName}/signing-key` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Action-Targets/paths/~1ssot~1data-action-targets~1%7BapiName%7D~1signing-key/post) · evidence O · changes org state

Generate the signing key for a data action target. Since v62.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `api_name` | `apiName` | path | string | yes | Developer name of the target, not a record id. |

```sql
CALL cdp.dataaction_target_signing_key_generate (api_name => 'contact_webhook');
```

**Result**

One row. Schema `CdpDataActionTargetSigningKeyOutputRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `signing_algorithm` | `signingAlgorithm` | VARCHAR | Signing algorithm. Since v62.0. |
| `signing_key` | `signingKey` | VARCHAR | Signing key. Since v62.0. |

**Notes:** The result holds the key in clear text. Copy it to the webhook receiver and don't keep the row around. The docs describe keys only for webhook targets, and [recommend regenerating at least every 12 months](https://developer.salesforce.com/docs/data/data-cloud-int/references/webhook-data-action-targets/c360a-api-regenerate-secret-key.md).

**Don't retry blindly.** A community SDK [treats a second POST as a reset](https://github.com/javrrr/data-360-sdk/blob/main/src/resources/data-action-targets.ts) (community). A regenerated key takes up to 15 minutes to take effect, and validation at the target fails until then. That SDK also has a `GET` on this path, which the spec doesn't list.

**Receiver side:** each request has the signature in the [`x-signature` header](https://developer.salesforce.com/docs/data/data-cloud-int/references/webhook-data-action-targets/c360a-api-payload-signature.md). It is the [Base64 of an HMAC-SHA256](https://developer.salesforce.com/docs/data/data-cloud-int/references/webhook-data-action-targets/c360a-api-validating-the-signature.md) over the UTF-8 payload, keyed with the UTF-8 bytes of `signing_key`. The docs say to perform JSON escaping on the received payload first. The [body has `creationDateTime`, `count`, `schemas` and `events`](https://developer.salesforce.com/docs/data/data-cloud-int/references/webhook-data-action-targets/c360a-api-webhook-data-action-targets-in-customer-data-platform.md), with events in `DataObjectDataChgEvent` format. A 2024 blog says [events are retained for four days](https://developer.salesforce.com/blogs/2024/01/unleashing-the-power-of-data-actions-using-a-webhook-as-a-target), so it recommends a queue in front of the consumer.

## dataaction_create

`POST /ssot/data-actions` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Actions/paths/~1ssot~1data-actions/post) · tool `d360_dataaction_create` · evidence O · changes org state

Create a new data action. Since v58.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `dataspace` | `dataspace` | query | string |  | The Data 360 data space fromm which to return the data action. Since v62.0. |
| `action_condition_expression` | `actionConditionExpression` | body | string | yes | The action's condition expression. Since v62.0. |
| `action_conditions` | `actionConditions` | body | array of object | yes | The action conditions. Since v62.0. |
| `data_action_enrichment_properties` | `dataActionEnrichmentProperties` | body | array of object | yes | The data action enrichment properties. Since v62.0. |
| `data_action_name` | `dataActionName` | body | string | yes | Name of the data action. Since v62.0. |
| `data_action_projected_fields` | `dataActionProjectedFields` | body | array of object | yes | Projected fields for the data action. Since v62.0. |
| `data_action_sources` | `dataActionSources` | body | array of [CdpDataActionInput_dataActionSources](#cdpdataactioninput_dataactionsources) | yes | Data action sources. Since v62.0. |
| `data_action_target_names` | `dataActionTargetNames` | body | array of string | yes | List of names of the data action targets. Since v62.0. |
| `body_dataspace` | `dataspace` | body | string | yes | Name of the data space to use for the request. Since v62.0. |
| `description` | `description` | body | string | yes | Data action's description. Since v62.0. |
| `developer_name` | `developerName` | body | string | yes | Data action developer name. Since v62.0. |
| `event_trigger_condition` | `eventTriggerCondition` | body | string |  | Data action's event trigger condition. Since v62.0. |
| `external_record_identifier` | `externalRecordIdentifier` | body | string |  | Data action's external record identifier. Since v62.0. |
| `is_real_time_action` | `isRealTimeAction` | body | boolean |  | `true` if the data action is a real time action, otherwise `false`. Since v62.0. |
| `master_label` | `masterLabel` | body | string | yes | Data action's master label. Since v62.0. |
| `should_process_day_zero` | `shouldProcessDayZero` | body | boolean |  | `true` if the data action should be processed immediately, otherwise `false`. Since v62.0. |
| `should_trigger_event_only_first_time` | `shouldTriggerEventOnlyFirstTime` | body | boolean |  | If `true`, the related event is triggered only the first time that the data action is used. If `false`, the event is triggered each time the data action is used. Since v62.0. |
| `subscriber_key` | `subscriberKey` | body | string |  | Data action subscriber key. Since v62.0. |
| `name` | `name` | body | string |  | Not in the spec schema: from the MCP server's payload example. |
| `config` | `config` | body | [dataaction_create_config](#dataaction_create_config) |  | Not in the spec schema: from the MCP server's payload example. |
| `data_action_status` | `dataActionStatus` | body | string |  | Not in the spec schema: from the MCP server's request class. |
| `search_config` | `searchConfig` | body | object |  | Not in the spec schema: from the MCP server's request class. |

```sql
CALL cdp.dataaction_create (dataspace => 'default', body_dataspace => 'default', data_action_target_names => ['contact_webhook'], data_action_name => 'High rate', developer_name => 'High_Rate', description => 'Notify when a rate crosses the threshold', master_label => 'High rate', data_action_sources => [(source_name = 'StaticCurrencyRates_Home__dlm', source_type = 'DataModelEntity', source_cdc_subscriptions = ['CREATE', 'UPDATE'])], action_condition_expression => '(1 AND 2)', action_conditions => [(objectName = 'StaticCurrencyRates_Home__dlm', fieldName = 'RateDenominatorNumber__c', operator = 'GreaterThan', order = '1', value = '0.3'), (objectName = 'StaticCurrencyRates_Home__dlm', fieldName = 'RateNumeratorNumber__c', operator = 'LessThanOrEqualTo', order = '2', value = '100')], data_action_enrichment_properties => [], data_action_projected_fields => [(objectApiName = 'StaticCurrencyRates_Home__dlm', fieldApiName = 'RateNumeratorNumber__c', fieldAliasName = 'Rate__c')]);
```

**Result**

One row. Schema `CdpDataActionOutputRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `action_condition_expression` | `actionConditionExpression` | VARCHAR | The action's condition expression. Since v62.0. |
| `action_conditions` | `actionConditions` | JSON (array of DataActionConditionOutputRepresentation) | The action conditions. Since v62.0. |
| `data_action_enrichment_properties` | `dataActionEnrichmentProperties` | JSON (array of DataActionEnrichmentOutputRepresentation) | The data action enrichment properties. Since v62.0. |
| `data_action_name` | `dataActionName` | VARCHAR | Data action's name. Since v62.0. |
| `data_action_projected_fields` | `dataActionProjectedFields` | JSON (array of DataActionProjectedFieldOutputRepresentation) | The data action's projected fields. Since v62.0. |
| `data_action_sources` | `dataActionSources` | JSON (array of DataActionSourceOutputRepresentation) | Data action sources. Since v62.0. |
| `data_action_status` | `dataActionStatus` | VARCHAR | Data action's status. Since v62.0. |
| `data_action_targets` | `dataActionTargets` | JSON | Data action targets. Since v62.0. |
| `dataspace_dev_name` | `dataSpaceDevName` | VARCHAR | Developer name of the data space. Since v62.0. |
| `description` | `description` | VARCHAR | Description of the data action. Since v62.0. |
| `developer_name` | `developerName` | VARCHAR | Developer name of the data action. Since v62.0. |
| `event_trigger_condition` | `eventTriggerCondition` | VARCHAR | Event trigger condition for the data action. Since v62.0. |
| `external_record_identifier` | `externalRecordIdentifier` | VARCHAR | Data action's external record identifier. Since v62.0. |
| `is_real_time_action` | `isRealTimeAction` | BOOLEAN | Indicates whether the data action is a real-time action (`true`) or not (`false`). Since v62.0. |
| `last_action_status_date_time` | `lastActionStatusDateTime` | VARCHAR | Date and time that the most recent data action status was set. Since v62.0. |
| `last_action_status_error_code` | `lastActionStatusErrorCode` | VARCHAR | Status of the data action's error code. Since v62.0. |
| `master_label` | `masterLabel` | VARCHAR | Data action's master label. Since v62.0. |
| `should_trigger_event_only_first_time` | `shouldTriggerEventOnlyFirstTime` | BOOLEAN | If `true`, the related event is triggered only the first time that the data action is used. If `false`, the event is triggered each time the data action is used. Since v62.0. |
| `subscriber_key` | `subscriberKey` | VARCHAR | Data action subscriber key. Since v62.0. |

**Done when:** `dataaction_list.data_action_status` is `Active` for the row with this `developer_name`. `Error` is terminal, with the reason in `last_action_status_error_code`. The create response itself shows `PROCESSING`. Compare case-insensitively.

**Notes:** Salesforce's catalog says it [must have a target configured](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/runtime/FamilyCatalog.java). afd360 [waits for the target to reach `Active`](https://github.com/javrrr/afd360/blob/main/docs/resources.md) first (community).

- **Nested attributes:** the spec types the four arrays as plain `object`. Their attributes come from the MCP request classes and spec examples: [DataActionSource](#dataactionsource), [DataActionCondition](#dataactioncondition), [DataActionProjectedField](#dataactionprojectedfield), [DataActionEnrichment](#dataactionenrichment).
- **Required flags disagree:** the spec requires all four arrays, `action_condition_expression`, `description` and `master_label`. The MCP class has `description` and `master_label` optional. afd360's [body omits most of these](https://github.com/javrrr/afd360/blob/main/src/resources/data-action.ts) and reports it works (community). Sending them empty, as the spec example does, satisfies both.
- **Two data spaces:** `dataspace` is the query parameter and `body_dataspace` the body attribute. afd360 says [create needs both](https://github.com/javrrr/afd360/blob/main/docs/resources.md) (community).
- **Conditions:** in the spec examples `action_condition_expression` is `(1 AND 2)`, where the numbers refer to each condition's `order`. afd360 documents a filter such as `Score__c != null` instead (community).
- **Timing:** projected fields exist only once the source DMO's fact table has materialized, up to about 90 seconds after the mapping. afd360 [retries on that error](https://github.com/javrrr/afd360/blob/main/src/resources/data-action.ts) (community).
- **Attributes outside the spec:** the [MCP class](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/model/request/dataaction/DataActionCreateRequest.java) also has `data_action_status` and `search_config`, which the spec lacks.
- **Limits:** [200 actions per tenant](https://help.salesforce.com/s/articleView?language=en_US&id=sf.c360_a_limits_and_guidelines.htm), and an [older page](https://help.salesforce.com/s/articleView?language=en_US&id=sf.c360_a_limits_and_guidelines_cdp.htm&type=5) says 10. The UI allows [up to 10 related attributes](https://developer.salesforce.com/blogs/2024/01/unleashing-the-power-of-data-actions-using-a-webhook-as-a-target) for enrichment (2024 blog).
- **Calculated insights:** the same blog says the UI accepts them as a source. No source gives the `source_type` value.

## dataaction_get

`GET /ssot/data-actions/{id}` · tool `d360_dataaction_get` · evidence S · read-only

Reads one data action by developer name, to inspect its conditions, sources and targets.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `action_developer_name` | `id` | path | string | yes | The data action developer name |
| `dataspace` | `dataspace` | query | string |  | Dataspace name |

```sql
CALL cdp.dataaction_get (action_developer_name => 'High_Rate', dataspace => 'default');
```

**Result**

The public sources don't document this response. One row, with the response in `_raw`.

**Notes:** This path isn't in the spec. It comes from [Salesforce's MCP source](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/DataActionTools.java), which puts the developer name in the path despite the `{id}` placeholder in its annotation. The list and create calls return `CdpDataActionOutputRepresentation`, but no source says this one does. afd360 [avoids this call](https://github.com/javrrr/afd360/blob/main/src/resources/data-action.ts) and pages [`dataaction_list`](#dataaction_list) instead (community).

## dataaction_target_update

`PATCH /ssot/data-action-targets/{id}` · tool `d360_dataaction_target_update` · evidence S · changes org state

Changes an existing data action target, such as its endpoint URL. All body attributes are optional.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `target_api_name` | `id` | path | string | yes | Developer name of the target to change. |
| `api_name` | `apiName` | body | string |  | API name of the target. |
| `label` | `label` | body | string |  | Display name of the target. |
| `type` | `type` | body | enum(Core, Internal_WebHook, MarketingCloud, WebHook) |  | Target type. |
| `sub_type` | `subType` | body | enum(Grpc, Rest) |  | Target sub type. |
| `external_record_identifier` | `externalRecordIdentifier` | body | string |  | External record ID. |
| `config` | `config` | body | [DataActionTargetConfig](#dataactiontargetconfig) |  | Target configuration. Set only the attributes that apply to `type`. |

```sql
CALL cdp.dataaction_target_update (target_api_name => 'contact_webhook', config => (target_endpoint = 'https://hooks.example.com/data360/v2'));
```

**Result**

The public sources don't document this response. One row, with the response in `_raw`.

**Notes:** The spec has no `PATCH` at this path, and neither does the Postman catalog. The only source is [Salesforce's MCP source](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/DataActionTools.java), whose [request class](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/model/request/dataaction/DataActionTargetUpdateRequest.java) gives these attributes. Its description also mentions credentials, but the class has no credential attribute. afd360 [deletes and recreates instead](https://github.com/javrrr/afd360/blob/main/src/resources/data-action-target.ts), because a `PATCH` on a target that an action references could leave a half-rebound endpoint (community).

## dataaction_update

`PATCH /ssot/data-actions/{name}` · evidence C · changes org state

Meant to change an existing data action. No public source documents this call or its body, so it has no body options here.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `action_developer_name` | `name` | path | string | yes | Developer name of the data action. |

```sql
CALL cdp.dataaction_update (action_developer_name => 'High_Rate');
```

**Result**

The public sources don't document this response. One row, with the response in `_raw`.

**Notes:** No source found supports this call. It isn't in the spec, the Postman catalog, Salesforce's MCP source or the community SDK and CLI plugin. afd360 [doesn't implement it and deletes and recreates instead](https://github.com/javrrr/afd360/blob/main/src/resources/data-action.ts) (community). Use [`dataaction_delete`](#dataaction_delete) and [`dataaction_create`](#dataaction_create) if the delete path works in your org.

## dataaction_delete

`DELETE /ssot/data-actions/{name}` · evidence C · changes org state

Deletes a data action by developer name. Use it before deleting the action's target, or to recreate an action with new settings.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `action_developer_name` | `name` | path | string | yes | Developer name of the data action. |
| `dataspace` | `dataspace` | query | string |  | Data space that holds the action. The community source always sends it. |

```sql
CALL cdp.dataaction_delete (action_developer_name => 'High_Rate', dataspace => 'default');
```

**Result**

The public sources don't document this response. One row, with the response in `_raw`.

**Notes:** This path isn't in the spec. The only source is [afd360](https://github.com/javrrr/afd360/blob/main/src/resources/data-action.ts), which calls `DELETE /ssot/data-actions/{developerName}?dataspace=...` and treats a 404 as already deleted (community).

## Schemas

Attribute names are keywords inside the object they belong to, so completion offers exactly these.

### CdpDataActionInput_dataActionSources

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `source_name` | `sourceName` | string |  | Seen in examples: the spec types the parent as a free-form object. |
| `source_type` | `sourceType` | string |  | Seen in examples: the spec types the parent as a free-form object. |
| `source_cdc_subscriptions` | `sourceCdcSubscriptions` | array |  | Seen in examples: the spec types the parent as a free-form object. |

### CdpDataActionTargetCRMConfig

Represents the config input for CRM data action targets.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `api_contract` | `apiContract` | string |  | API contract for the data action target. Since v58.0. |
| `target_endpoint` | `targetEndpoint` | string |  | Target endpoint. Since v58.0. |
| `org_id` | `orgId` | string |  | ID for the target CRM org. Since v58.0. |
| `org_label` | `orgLabel` | string |  | Label for the target CRM org. Since v58.0. |

### CdpDataActionTargetInternalWebConfig

Represents the config input for internal web data action targets.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `api_contract` | `apiContract` | string |  | API contract for the data action target. Since v58.0. |
| `target_endpoint` | `targetEndpoint` | string |  | Target endpoint. Since v58.0. |

### CdpDataActionTargetMCConfig

Represents the config input for Marketing Cloud data action targets.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `api_contract` | `apiContract` | string |  | API contract for the data action target. Since v58.0. |
| `target_endpoint` | `targetEndpoint` | string |  | Target endpoint. Since v58.0. |
| `content_key` | `contentKey` | string |  | Content key for Marketing Cloud. Since v58.0. |
| `content_template` | `contentTemplate` | string |  | Content template. Since v58.0. |

### CdpDataActionTargetWebConfig

Represents the config input for web data hook action targets.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `api_contract` | `apiContract` | string |  | API contract for the data action target. Since v58.0. |
| `target_endpoint` | `targetEndpoint` | string |  | Target endpoint. Since v58.0. |

### dataaction_create_config

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `type` | `type` | string |  | Seen in examples: the spec types the parent as a free-form object. |
| `template` | `template` | string |  | Seen in examples: the spec types the parent as a free-form object. |
| `target_audience` | `targetAudience` | string |  | Seen in examples: the spec types the parent as a free-form object. |
| `recipient_field` | `recipientField` | string |  | Seen in examples: the spec types the parent as a free-form object. |
| `personalization_fields` | `personalizationFields` | array |  | Seen in examples: the spec types the parent as a free-form object. |

### DataActionCondition

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `object_name` | `objectName` | string |  | Object the condition reads, such as a `__dlm` name. |
| `field_name` | `fieldName` | string |  | Field the condition reads. |
| `operator` | `operator` | string |  | Spec examples show `Equal`, `GreaterThan` and `LessThanOrEqualTo`. No source gives the full list. |
| `value` | `value` | string |  | Value to compare against, as a string. |
| `order` | `order` | string |  | Sequence number of the rule, as a string. `action_condition_expression` refers to it, as in `(1 AND 2)`. |
| `condition_source_type` | `conditionSourceType` | string |  | Condition source type. The sources give no values. |
| `condition_type` | `conditionType` | string |  | Separates regular conditions from additional ones. |
| `data_graph_name` | `dataGraphName` | string |  | Data graph name, for conditions on a data graph. |
| `object_data_graph_name` | `objectDataGraphName` | string |  | Unique object name in the data graph. |

### DataActionEnrichment

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `enrichment_name` | `enrichmentName` | string |  | Enrichment name. |
| `data_graph_api_name` | `dataGraphApiName` | string |  | API name of the data graph. |
| `data_action_projected_fields` | `dataActionProjectedFields` | array of [DataActionProjectedField](#dataactionprojectedfield) |  | Fields the enrichment adds to the event. |
| `data_action_relationship_edges` | `dataActionRelationshipEdges` | array of [DataActionRelationshipEdge](#dataactionrelationshipedge) |  | How the related object joins to the source. |

### DataActionProjectedField

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `object_api_name` | `objectApiName` | string |  | Object the field belongs to. |
| `field_api_name` | `fieldApiName` | string |  | Source field to carry onto the event. |
| `field_alias_name` | `fieldAliasName` | string |  | Field name on the event. afd360 uses it as the Platform Event field name (community). |
| `object_data_graph_name` | `objectDataGraphName` | string |  | Object name in the data graph. |

### DataActionRelationshipEdge

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `source_object_api_name` | `sourceObjectApiName` | string |  | Object on the source side. |
| `source_field_api_name` | `sourceFieldApiName` | string |  | Join field on the source side. |
| `target_object_api_name` | `targetObjectApiName` | string |  | Object on the target side. |
| `target_field_api_name` | `targetFieldApiName` | string |  | Join field on the target side. |
| `target_object_data_graph_name` | `targetObjectDataGraphName` | string |  | Target object's name in the data graph. |

### DataActionSource

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `source_name` | `sourceName` | string |  | Source object. A `DataModelEntity` source is the full DMO name ending in `__dlm` (community). Returned as `objectDevName`. |
| `source_type` | `sourceType` | string |  | `DataModelEntity` for a DMO in the spec example. afd360 also names `DataGraph` (community). Returned as `objectType`. |
| `source_cdc_subscriptions` | `sourceCdcSubscriptions` | array of string |  | Changes that fire the action. The spec example uses `CREATE`, `UPDATE`, `DELETE`. The MCP class and afd360 use `Create`, `Update`, `Delete`. Returned as `subscriptionModes`. |
| `actions_source_object` | `actionsSourceObject` | string |  | Source object for the action. For `DataGraph` sources only (community). |
| `actions_source_object_path` | `actionsSourceObjectPath` | string |  | Path to the source object. For `DataGraph` sources only (community). |
| `actions_source_object_type` | `actionsSourceObjectType` | string |  | Source object type. For `DataGraph` sources only (community). |

### DataActionTargetConfig

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `target_endpoint` | `targetEndpoint` | string |  | `WebHook`: the URL that receives events. `MarketingCloud`: the events endpoint in the spec example. `Core`: see the source conflict under [`dataaction_target_create`](#dataaction_target_create). |
| `api_contract` | `apiContract` | string |  | API contract for the target. |
| `org_id` | `orgId` | string |  | `Core` only. ID of the target CRM org. |
| `org_label` | `orgLabel` | string |  | `Core` only. Label of the target CRM org. Returned as `label`. |
| `content_key` | `contentKey` | string |  | `MarketingCloud` only. Content key. |
| `content_template` | `contentTemplate` | string |  | `MarketingCloud` only. Content template. The spec example passes an API event name. |
| `data_action_destination_type` | `dataActionDestinationType` | string |  | `MarketingCloud`. Appears only in the spec example, with the value `API_EVENT`. |
| `service_name` | `serviceName` | string |  | `WebHook` with `sub_type` `Grpc` only. Name of the gRPC service (MCP source only). |
| `method_name` | `methodName` | string |  | `WebHook` with `sub_type` `Grpc` only. gRPC method to invoke (MCP source only). |
| `proto_buffer_content` | `protoBufferContent` | string |  | `WebHook` with `sub_type` `Grpc` only. Contents of the proto definition (MCP source only). |
| `mapping_config` | `mappingConfig` | [DataActionTargetGrpcMappingConfig](#dataactiontargetgrpcmappingconfig) |  | `WebHook` with `sub_type` `Grpc` only. Maps the event payload to the gRPC message (MCP source only). |
| `custom_metadata` | `customMetadata` | object |  | `WebHook` with `sub_type` `Grpc` only. String map of metadata sent with the gRPC request (MCP source only). |

### DataActionTargetGrpcMappingConfig

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `array_field` | `arrayField` | string |  | Array field. The MCP source says no more. |
| `event_mappings` | `eventMappings` | object |  | String map of the event payload mapping. |
