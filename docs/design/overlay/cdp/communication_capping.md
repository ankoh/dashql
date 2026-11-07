# Communication Capping

Part of the [CDP function reference](functions.md). Nothing here is implemented or tested against an org. Every result also has the [standard columns](functions.md#result-schema).

Communication capping limits how many messages a customer, lead or prospect receives, for regulation, message fatigue or budget ([Trailhead](https://trailhead.salesforce.com/content/learn/modules/communication-capping-in-data-cloud-quick-look/get-to-know-communication-capping)). You define dimensions, which the UI calls parameters, such as channel and line of business. You give each dimension values, then write rules that cap a combination of values over a date window. A capping activation target is mapped to the same values, and segments activated through it get filtered.

Trailhead's order is dimensions, rules, target mapping, then segment activation. The rule path needs a configuration id, so the configuration comes before its rules. The target itself comes from [`activation_target_create`](activation_targets.md#activation_target_create). No source says when to call enable, so the flow below puts it last.

The gotchas that matter most:

- The spec has no call that lists configurations, so keep the `id` from create.
- Results show up in DMOs, not in this API: `CG_Audience_Dropped` holds the excluded profiles and the rule that dropped them, and `CG_Audience_Qualified` holds the included ones.
- Capping [consumes Data 360 credits](https://trailhead.salesforce.com/content/learn/modules/communication-capping-in-data-cloud-quick-look/get-to-know-communication-capping).
- Availability varies: [one changelog](https://help.salesforce.com/s/articleView?id=sf.c360_a_changelog_usage_and_access.htm&language=en_US&type=5) lists capping as a pilot and the [release notes](https://help.salesforce.com/s/articleView?id=release-notes.rn_c360_truth.htm&language=en_US&release=252&type=5) as a beta.

The spec has no descriptions for this family. Field meanings below come from Trailhead and from search excerpts of the [API reference](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Communication-Capping) and Salesforce Help, whose full text couldn't be downloaded.

```sql
CALL cdp.communication_capping_dimension_create (api_name => 'Channel', dimension_name => 'ssot__CommunicationChannel__dlm', hierarchy_order => 1, dimension_values => [(value = 'Email')]);
CALL cdp.communication_capping_configuration_create (name => 'Marketing caps', data_comm_cap_dataspaces => [(dataspace_id = 'DATA_SPACE_ID')], data_comm_cap_related_dims => [(api_name = 'Channel', data_comm_cap_dim_id = 'DIMENSION_ID')]);
CALL cdp.communication_capping_rule_create (id => 'CONFIGURATION_ID', api_name => 'Email_daily', limits => 10, start_date => '2027-05-01T00:00:00Z', end_date => '2027-05-31T00:00:00Z', data_comm_cap_rule_dim => [(dim_id = 'DIMENSION_ID', dim_value_ids = ['DIMENSION_VALUE_ID'])]);
CALL cdp.communication_capping_activation_target_metadata_map (activation_target_id => 'TARGET_ID', activation_target_name => 'Email_capped', data_comm_cap_dim_info => [(data_comm_cap_dim_id = 'DIMENSION_ID', data_comm_cap_dim_value_id = 'DIMENSION_VALUE_ID')]);
CALL cdp.communication_capping_enable (id => 'CONFIGURATION_ID');
```

**Functions:** [`communication_capping_activation_target_metadata_delete`](#communication_capping_activation_target_metadata_delete), [`communication_capping_rule_delete`](#communication_capping_rule_delete), [`communication_capping_configuration_get`](#communication_capping_configuration_get), [`communication_capping_activation_target_list`](#communication_capping_activation_target_list), [`communication_capping_rule_list`](#communication_capping_rule_list), [`communication_capping_activation_target_metadata_get`](#communication_capping_activation_target_metadata_get), [`communication_capping_dimension_list`](#communication_capping_dimension_list), [`communication_capping_configuration_update`](#communication_capping_configuration_update), [`communication_capping_rule_update`](#communication_capping_rule_update), [`communication_capping_dimension_update`](#communication_capping_dimension_update), [`communication_capping_dimension_priority_update`](#communication_capping_dimension_priority_update), [`communication_capping_configuration_create`](#communication_capping_configuration_create), [`communication_capping_disable`](#communication_capping_disable), [`communication_capping_enable`](#communication_capping_enable), [`communication_capping_rule_create`](#communication_capping_rule_create), [`communication_capping_activation_target_metadata_map`](#communication_capping_activation_target_metadata_map), [`communication_capping_dimension_create`](#communication_capping_dimension_create)

## communication_capping_activation_target_metadata_delete

`DELETE /ssot/communication-capping/activation-target-capping-metadata/{activationTargetId}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Communication-Capping/paths/~1ssot~1communication-capping~1activation-target-capping-metadata~1%7BactivationTargetId%7D/delete) · evidence O · changes org state

Removes the dimension mapping of a capping activation target. Use it to detach a target from its dimension values.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `activation_target_id` | `activationTargetId` | path | string | yes | - |

```sql
CALL cdp.communication_capping_activation_target_metadata_delete (activation_target_id => 'TARGET_ID');
```

**Result**

No response body (HTTP 204). One row with only the standard columns.

**Notes:** The sources don't say whether segments already activated through the target are affected.

## communication_capping_rule_delete

`DELETE /ssot/communication-capping/rules/{ruleIdOrName}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Communication-Capping/paths/~1ssot~1communication-capping~1rules~1%7BruleIdOrName%7D/delete) · evidence O · changes org state

Deletes a capping rule. Use it to retire a cap before its end date passes.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `rule_id_or_name` | `ruleIdOrName` | path | string | yes | Rule `id`, or a name. The sources don't say which name; `api_name` is the only name in the rule schema. |

```sql
CALL cdp.communication_capping_rule_delete (rule_id_or_name => 'Email_daily');
```

**Result**

No response body (HTTP 204). One row with only the standard columns.

**Notes:** This is the only rule call whose path has no configuration id: delete is `/rules/{ruleIdOrName}`, and update is `/{id}/rules/{ruleIdOrName}`.

## communication_capping_configuration_get

`GET /ssot/communication-capping/{id}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Communication-Capping/paths/~1ssot~1communication-capping~1%7Bid%7D/get) · evidence O · read-only

Returns one capping configuration with its data spaces, dimensions and status. Use it to check the state of a configuration after you create or change it.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `id` | `id` | path | string | yes | Configuration id, the `id` that `communication_capping_configuration_create` returns. |

```sql
CALL cdp.communication_capping_configuration_get (id => 'CONFIGURATION_ID');
```

**Result**

One row. Schema `CommunicationCappingRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `dataspaces_info` | `dataspacesInfo` | JSON | - |
| `description` | `description` | VARCHAR | - |
| `dimensions` | `dimensions` | JSON | - |
| `id` | `id` | VARCHAR | - |
| `label` | `label` | VARCHAR | - |
| `name` | `name` | VARCHAR | - |
| `status` | `status` | VARCHAR | - |

**Notes:** The spec has no call that lists configurations. The nearest is [`communication_capping_data_space_list`](activation_targets.md#communication_capping_data_space_list), which returns `data_communication_cap_def_id` per data space, but no source says this call's `id` accepts that value. This result has `status`, while create and update call the same thing `data_communication_cap_status`.

## communication_capping_activation_target_list

`GET /ssot/communication-capping/{id}/activation-targets` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Communication-Capping/paths/~1ssot~1communication-capping~1%7Bid%7D~1activation-targets/get) · evidence O · read-only

Lists the activation targets of a configuration, one row per target mapping with its dimension and dimension value. Use it to audit which targets a configuration governs.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `id` | `id` | path | string | yes | Configuration id, the `id` that `communication_capping_configuration_create` returns. |
| `limit` | `limit` | query | integer |  | - |
| `offset` | `offset` | query | integer |  | - |
| `order_by_column` | `orderByColumn` | query | enum(Id, ActivationTargetId, Name, CreatedById, CreatedDate, LastModifiedById, LastModifiedDate, DataCommCapDimId, DataCommCapDimValueId) |  | - |
| `order_by_direction` | `orderByDirection` | query | enum(ASC, DESC) |  | - |

```sql
CALL cdp.communication_capping_activation_target_list (id => 'CONFIGURATION_ID', limit => 50, offset => 0, order_by_column => 'Name', order_by_direction => 'ASC');
```

**Result**

One row per item of `/activationTargets` in the response. Schema `CommunicationCappingActivationTargetRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `activation_target_id` | `activationTargetId` | VARCHAR | - |
| `actv_target_name` | `actvTargetName` | VARCHAR | - |
| `data_comm_cap_dim` | `dataCommCapDim` | JSON (CommunicationCappingDimRepresentation) | - |
| `data_comm_cap_dim_value` | `dataCommCapDimValue` | JSON (CommunicationCappingDimValueRepresentation) | - |
| `id` | `id` | VARCHAR | - |

**Paging:** `limit`, `offset`.

**Notes:** The response has only `activationTargets`, with no total or next-page field, so a short page is the only end signal in the schema.

## communication_capping_rule_list

`GET /ssot/communication-capping/{id}/rules` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Communication-Capping/paths/~1ssot~1communication-capping~1%7Bid%7D~1rules/get) · evidence O · read-only

Lists the rules of a configuration with their limits and date windows. Use it to review caps or find a rule's id.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `id` | `id` | path | string | yes | Configuration id, the `id` that `communication_capping_configuration_create` returns. |
| `limit` | `limit` | query | integer |  | - |
| `offset` | `offset` | query | integer |  | - |
| `order_by_column` | `orderByColumn` | query | enum(Id, DeveloperName, MasterLabel, StartDate, EndDate, Limits, Source, CreatedById, CreatedDate, LastModifiedById, LastModifiedDate) |  | - |
| `order_by_direction` | `orderByDirection` | query | enum(ASC, DESC) |  | - |

```sql
CALL cdp.communication_capping_rule_list (id => 'CONFIGURATION_ID', limit => 50, offset => 0, order_by_column => 'StartDate', order_by_direction => 'DESC');
```

**Result**

One row per item of `/rules` in the response. Schema `CommunicationCappingRuleRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `api_name` | `apiName` | VARCHAR | - |
| `data_comm_cap_rule_dim` | `dataCommCapRuleDim` | JSON (array of CommunicationCappingRuleDimRepresentation) | - |
| `data_communication_cap_def_id` | `dataCommunicationCapDefId` | VARCHAR | - |
| `end_date` | `endDate` | TIMESTAMPTZ | - |
| `id` | `id` | VARCHAR | - |
| `limits` | `limits` | BIGINT | - |
| `source` | `source` | VARCHAR | - |
| `start_date` | `startDate` | TIMESTAMPTZ | - |

**Paging:** `limit`, `offset`.

**Notes:** The response has only `rules`, with no total or next-page field, so a short page is the only end signal in the schema. The [reference's sample](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Communication-Capping) shows `source` as `API`; no source lists the other values.

## communication_capping_activation_target_metadata_get

`GET /ssot/communication-capping/activation-target-capping-metadata/{activationTargetId}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Communication-Capping/paths/~1ssot~1communication-capping~1activation-target-capping-metadata~1%7BactivationTargetId%7D/get) · evidence O · read-only

Returns the dimensions and dimension values mapped to one activation target. Use it to check a mapping against the rule it should match.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `activation_target_id` | `activationTargetId` | path | string | yes | - |

```sql
CALL cdp.communication_capping_activation_target_metadata_get (activation_target_id => 'TARGET_ID');
```

**Result**

One row per item of `/activationTargets` in the response. Schema `CommunicationCappingActivationTargetRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `activation_target_id` | `activationTargetId` | VARCHAR | - |
| `actv_target_name` | `actvTargetName` | VARCHAR | - |
| `data_comm_cap_dim` | `dataCommCapDim` | JSON (CommunicationCappingDimRepresentation) | - |
| `data_comm_cap_dim_value` | `dataCommCapDimValue` | JSON (CommunicationCappingDimValueRepresentation) | - |
| `id` | `id` | VARCHAR | - |

## communication_capping_dimension_list

`GET /ssot/communication-capping/dimensions` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Communication-Capping/paths/~1ssot~1communication-capping~1dimensions/get) · evidence O · read-only

Lists capping dimensions with their values and hierarchy order. Use it to find the dimension and value ids that rules and target mappings need.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `cc_id` | `ccId` | query | string |  | - |
| `dataspace_id` | `dataSpaceId` | query | string |  | - |

```sql
CALL cdp.communication_capping_dimension_list ();
```

**Result**

One row per item of `/dimensions` in the response. Schema `CommunicationCappingDimRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `api_name` | `apiName` | VARCHAR | - |
| `dimension_name` | `dimensionName` | VARCHAR | - |
| `dimension_values` | `dimensionValues` | JSON (array of CommunicationCappingDimValueRepresentation) | - |
| `function_type` | `functionType` | VARCHAR | - |
| `hierarchy_order` | `hierarchyOrder` | BIGINT | - |
| `id` | `id` | VARCHAR | - |
| `name` | `name` | VARCHAR | - |

**Notes:** The spec has no paging options for this call. Rules and target mappings need the ids in `dimension_values`, which this column returns as JSON.

## communication_capping_configuration_update

`PATCH /ssot/communication-capping/{id}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Communication-Capping/paths/~1ssot~1communication-capping~1%7Bid%7D/patch) · evidence O · changes org state

Changes a configuration's name, description, data spaces or related dimensions.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `id` | `id` | path | string | yes | Configuration id, the `id` that `communication_capping_configuration_create` returns. |
| `data_comm_cap_dataspaces` | `dataCommCapDataSpaces` | body | array of [CommunicationCappingDataSpaceInput](#communicationcappingdataspaceinputrepresentation) |  | Data spaces associated with the configuration. |
| `data_comm_cap_related_dims` | `dataCommCapRelatedDims` | body | array of [CommunicationCappingRelatedDimInput](#communicationcappingrelateddiminputrepresentation) |  | Dimensions related to the configuration. |
| `data_communication_cap_def_id` | `dataCommunicationCapDefId` | body | string |  | Capping definition id. Per the [reference](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Communication-Capping), it's null on create and set only on update. |
| `description` | `description` | body | string |  | - |
| `body_id` | `id` | body | string |  | Instance id of the configuration, per the [reference](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Communication-Capping). It's the body field `id`, renamed because the path also has `id`. |
| `name` | `name` | body | string |  | - |

```sql
CALL cdp.communication_capping_configuration_update (id => 'CONFIGURATION_ID', description => 'Caps for all marketing sends');
```

**Result**

One row. Schema `CommunicationCappingEntityRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `data_comm_cap_dataspaces` | `dataCommCapDataSpaces` | JSON (array of CommunicationCappingDataSpaceRepresentation) | - |
| `data_comm_cap_related_dims` | `dataCommCapRelatedDims` | JSON (array of CommunicationCappingRelatedDimRepresentation) | - |
| `data_communication_cap_def_id` | `dataCommunicationCapDefId` | VARCHAR | - |
| `data_communication_cap_status` | `dataCommunicationCapStatus` | VARCHAR | - |
| `description` | `description` | VARCHAR | - |
| `id` | `id` | VARCHAR | - |
| `last_status_date_time` | `lastStatusDateTime` | TIMESTAMPTZ | - |
| `last_status_error_code` | `lastStatusErrorCode` | VARCHAR | - |
| `name` | `name` | VARCHAR | - |

**Notes:** The body has its own `id`, so this function has both `id` (path) and `body_id`. The sources don't say whether the arrays replace the existing entries or add to them. See [`communication_capping_configuration_create`](#communication_capping_configuration_create) for the status a write can return.

## communication_capping_rule_update

`PATCH /ssot/communication-capping/{id}/rules/{ruleIdOrName}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Communication-Capping/paths/~1ssot~1communication-capping~1%7Bid%7D~1rules~1%7BruleIdOrName%7D/patch) · evidence O · changes org state

Changes a rule's limit, date window or dimension values. Use it to adjust a cap without recreating the rule.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `id` | `id` | path | string | yes | Configuration id, the `id` that `communication_capping_configuration_create` returns. |
| `rule_id_or_name` | `ruleIdOrName` | path | string | yes | Rule `id`, or a name. The sources don't say which name; `api_name` is the only name in the rule schema. |
| `api_name` | `apiName` | body | string |  | - |
| `data_comm_cap_rule_dim` | `dataCommCapRuleDim` | body | array of [CommunicationCappingRuleDimInput](#communicationcappingrulediminputrepresentation) |  | Dimension associations for the rule. |
| `end_date` | `endDate` | body | string (date-time) |  | End of the window when the rule is valid. |
| `limits` | `limits` | body | integer |  | Capping limit value: the [maximum number of messages](https://trailhead.salesforce.com/content/learn/modules/communication-capping-in-data-cloud-quick-look/get-to-know-communication-capping). |
| `start_date` | `startDate` | body | string (date-time) |  | Start of the window when the rule is valid. |

```sql
CALL cdp.communication_capping_rule_update (id => 'CONFIGURATION_ID', rule_id_or_name => 'Email_daily', limits => 5);
```

**Result**

One row. Schema `CommunicationCappingRuleRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `api_name` | `apiName` | VARCHAR | - |
| `data_comm_cap_rule_dim` | `dataCommCapRuleDim` | JSON (array of CommunicationCappingRuleDimRepresentation) | - |
| `data_communication_cap_def_id` | `dataCommunicationCapDefId` | VARCHAR | - |
| `end_date` | `endDate` | TIMESTAMPTZ | - |
| `id` | `id` | VARCHAR | - |
| `limits` | `limits` | BIGINT | - |
| `source` | `source` | VARCHAR | - |
| `start_date` | `startDate` | TIMESTAMPTZ | - |

**Notes:** See [`communication_capping_rule_create`](#communication_capping_rule_create) for how the fields work.

## communication_capping_dimension_update

`PATCH /ssot/communication-capping/dimensions/{dimensionId}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Communication-Capping/paths/~1ssot~1communication-capping~1dimensions~1%7BdimensionId%7D/patch) · evidence O · changes org state

Changes a dimension or its values. Use it when the possible values change, for example when a channel is added.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `dimension_id` | `dimensionId` | path | string | yes | Dimension `id` from `communication_capping_dimension_list`. |
| `api_name` | `apiName` | body | string |  | - |
| `dimension_name` | `dimensionName` | body | string |  | API name of the dimension object, such as `ssot__CommunicationChannel__dlm` in the [reference's sample](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Communication-Capping). |
| `dimension_values` | `dimensionValues` | body | array of [CommunicationCappingDimValueInput](#communicationcappingdimvalueinputrepresentation) |  | Values of the dimension. |
| `function_type` | `functionType` | body | string |  | Function type. The [reference's samples](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Communication-Capping) show `FUNCTIONAL_TYPE` and `NON_FUNCTIONAL_TYPE`. |
| `hierarchy_order` | `hierarchyOrder` | body | integer |  | Position in the hierarchy. The reference's samples use 1 for Channel and 2 for Brand. |
| `id` | `id` | body | string |  | - |
| `name` | `name` | body | string |  | - |

```sql
CALL cdp.communication_capping_dimension_update (dimension_id => '1CDxx0000000001GAA', dimension_values => [(value = 'WhatsApp')]);
```

**Result**

One row. Schema `CommunicationCappingDimRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `api_name` | `apiName` | VARCHAR | - |
| `dimension_name` | `dimensionName` | VARCHAR | - |
| `dimension_values` | `dimensionValues` | JSON (array of CommunicationCappingDimValueRepresentation) | - |
| `function_type` | `functionType` | VARCHAR | - |
| `hierarchy_order` | `hierarchyOrder` | BIGINT | - |
| `id` | `id` | VARCHAR | - |
| `name` | `name` | VARCHAR | - |

**Notes:** Trailhead calls parameters [master data](https://trailhead.salesforce.com/content/learn/modules/communication-capping-in-data-cloud-quick-look/get-to-know-communication-capping): the values might change, but the parameters themselves don't. The sources don't say whether `dimension_values` replaces the existing values or adds to them. Rules and mappings refer to value ids, so check them before removing a value.

## communication_capping_dimension_priority_update

`PATCH /ssot/communication-capping/dimensions/actions/swap-priority` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Communication-Capping/paths/~1ssot~1communication-capping~1dimensions~1actions~1swap-priority/patch) · evidence O · changes org state

Changes the hierarchy order of dimensions. Use it to swap which dimension comes first.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `dimensions` | `dimensions` | body | array of [CommunicationCappingDimInput](#communicationcappingdiminputrepresentation) |  | Dimensions whose priority changes, each with `id` and its new `hierarchy_order`. |

```sql
CALL cdp.communication_capping_dimension_priority_update (dimensions => [(id = '1CDxx0000000002GAA', hierarchy_order = 1), (id = '1CDxx0000000001GAA', hierarchy_order = 2)]);
```

**Result**

One row per item of `/dimensions` in the response. Schema `CommunicationCappingDimRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `api_name` | `apiName` | VARCHAR | - |
| `dimension_name` | `dimensionName` | VARCHAR | - |
| `dimension_values` | `dimensionValues` | JSON (array of CommunicationCappingDimValueRepresentation) | - |
| `function_type` | `functionType` | VARCHAR | - |
| `hierarchy_order` | `hierarchyOrder` | BIGINT | - |
| `id` | `id` | VARCHAR | - |
| `name` | `name` | VARCHAR | - |

**Notes:** The HTTP path is `swap-priority`. The [reference's sample](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Communication-Capping) sends only `id` and `hierarchy_order` per dimension, and the reference marks `dimensions` required, while the spec doesn't. The response returns the full dimensions. The sources don't explain how the order affects evaluation.

## communication_capping_configuration_create

`POST /ssot/communication-capping` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Communication-Capping/paths/~1ssot~1communication-capping/post) · evidence O · changes org state

Creates a capping configuration, which ties dimensions to data spaces and holds the rules. Create the dimensions first, because the configuration refers to their ids.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `data_comm_cap_dataspaces` | `dataCommCapDataSpaces` | body | array of [CommunicationCappingDataSpaceInput](#communicationcappingdataspaceinputrepresentation) |  | Data spaces to associate with the configuration. |
| `data_comm_cap_related_dims` | `dataCommCapRelatedDims` | body | array of [CommunicationCappingRelatedDimInput](#communicationcappingrelateddiminputrepresentation) |  | Dimensions related to the configuration. |
| `data_communication_cap_def_id` | `dataCommunicationCapDefId` | body | string |  | Capping definition id. Per the [reference](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Communication-Capping), it's null on create and set only on update. |
| `description` | `description` | body | string |  | - |
| `id` | `id` | body | string |  | Instance id of the configuration. |
| `name` | `name` | body | string |  | - |

```sql
CALL cdp.communication_capping_configuration_create (name => 'Marketing caps', description => 'Caps for marketing sends', data_comm_cap_dataspaces => [(dataspace_id = 'DATA_SPACE_ID')], data_comm_cap_related_dims => [(api_name = 'Channel', data_comm_cap_dim_id = 'DIMENSION_ID')]);
```

**Result**

One row. Schema `CommunicationCappingEntityRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `data_comm_cap_dataspaces` | `dataCommCapDataSpaces` | JSON (array of CommunicationCappingDataSpaceRepresentation) | - |
| `data_comm_cap_related_dims` | `dataCommCapRelatedDims` | JSON (array of CommunicationCappingRelatedDimRepresentation) | - |
| `data_communication_cap_def_id` | `dataCommunicationCapDefId` | VARCHAR | - |
| `data_communication_cap_status` | `dataCommunicationCapStatus` | VARCHAR | - |
| `description` | `description` | VARCHAR | - |
| `id` | `id` | VARCHAR | - |
| `last_status_date_time` | `lastStatusDateTime` | TIMESTAMPTZ | - |
| `last_status_error_code` | `lastStatusErrorCode` | VARCHAR | - |
| `name` | `name` | VARCHAR | - |

**Done when:** No source documents the lifecycle, but the [reference's sample](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Communication-Capping) returns `data_communication_cap_status` = `PROCESSING`. Poll `communication_capping_configuration_get.status` until it changes. The reference's samples also show `ACTIVE`; no source gives the full list. `last_status_error_code` is the field for failures.

**Notes:** Keep the returned `id`: the spec has no call that lists configurations. The reference appears to mark `data_comm_cap_dataspaces` required, while the spec marks nothing required. Salesforce documents no idempotency for this POST, so don't retry it blindly. Trailhead says [Channels is a required parameter](https://trailhead.salesforce.com/content/learn/modules/communication-capping-in-data-cloud-quick-look/get-to-know-communication-capping), and up to two user-defined parameters can be added. A vendor blog reports a limit of [3 hierarchical dimensions](https://deselect.com/blog/smart-communication-capping/) when it was written (community, from a competing product).

## communication_capping_disable

`POST /ssot/communication-capping/{id}/actions/disable` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Communication-Capping/paths/~1ssot~1communication-capping~1%7Bid%7D~1actions~1disable/post) · evidence O · changes org state

Turns off a capping configuration.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `id` | `id` | path | string | yes | Configuration id, the `id` that `communication_capping_configuration_create` returns. |

```sql
CALL cdp.communication_capping_disable (id => 'CONFIGURATION_ID');
```

**Result**

One row. Schema `CommunicationCappingActionResponseRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `errors` | `errors` | JSON | - |
| `success` | `success` | BOOLEAN | - |

**Notes:** The response has its own `success` and `errors`, so check `success`, not only the HTTP status. The sources don't say what happens to segments activated through its targets while it's off.

## communication_capping_enable

`POST /ssot/communication-capping/{id}/actions/enable` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Communication-Capping/paths/~1ssot~1communication-capping~1%7Bid%7D~1actions~1enable/post) · evidence O · changes org state

Turns on a capping configuration.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `id` | `id` | path | string | yes | Configuration id, the `id` that `communication_capping_configuration_create` returns. |

```sql
CALL cdp.communication_capping_enable (id => 'CONFIGURATION_ID');
```

**Result**

One row. Schema `CommunicationCappingActionResponseRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `errors` | `errors` | JSON | - |
| `success` | `success` | BOOLEAN | - |

**Notes:** The response has its own `success` and `errors`, so check `success`, not only the HTTP status. This is separate from `is_capping_enabled` on [`activation_target_update`](activation_targets.md#activation_target_update), which is per target. No source says at which step to call it. Trailhead only requires [parameters, rule and target](https://trailhead.salesforce.com/content/learn/modules/communication-capping-in-data-cloud-quick-look/get-to-know-communication-capping) before activating segments.

## communication_capping_rule_create

`POST /ssot/communication-capping/{id}/rules` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Communication-Capping/paths/~1ssot~1communication-capping~1%7Bid%7D~1rules/post) · evidence O · changes org state

Adds a rule to a configuration: a maximum message count for a combination of dimension values, valid over a date window.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `id` | `id` | path | string | yes | Configuration id, the `id` that `communication_capping_configuration_create` returns. |
| `api_name` | `apiName` | body | string |  | - |
| `data_comm_cap_rule_dim` | `dataCommCapRuleDim` | body | array of [CommunicationCappingRuleDimInput](#communicationcappingrulediminputrepresentation) |  | Dimension associations for the rule. |
| `end_date` | `endDate` | body | string (date-time) |  | End of the window when the rule is valid. |
| `limits` | `limits` | body | integer |  | Capping limit value: the [maximum number of messages](https://trailhead.salesforce.com/content/learn/modules/communication-capping-in-data-cloud-quick-look/get-to-know-communication-capping). |
| `start_date` | `startDate` | body | string (date-time) |  | Start of the window when the rule is valid. |

```sql
CALL cdp.communication_capping_rule_create (id => 'CONFIGURATION_ID', api_name => 'Sms_daily_hnw', limits => 10, start_date => '2027-05-01T00:00:00Z', end_date => '2027-05-31T00:00:00Z', data_comm_cap_rule_dim => [(dim_id = 'DIMENSION_ID', dim_value_ids = ['DIMENSION_VALUE_ID'])]);
```

**Result**

One row. Schema `CommunicationCappingRuleRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `api_name` | `apiName` | VARCHAR | - |
| `data_comm_cap_rule_dim` | `dataCommCapRuleDim` | JSON (array of CommunicationCappingRuleDimRepresentation) | - |
| `data_communication_cap_def_id` | `dataCommunicationCapDefId` | VARCHAR | - |
| `end_date` | `endDate` | TIMESTAMPTZ | - |
| `id` | `id` | VARCHAR | - |
| `limits` | `limits` | BIGINT | - |
| `source` | `source` | VARCHAR | - |
| `start_date` | `startDate` | TIMESTAMPTZ | - |

**Notes:** The rule schema has no frequency, limit type or channel field, though [Trailhead](https://trailhead.salesforce.com/content/learn/modules/communication-capping-in-data-cloud-quick-look/get-to-know-communication-capping) lists all three as rule settings: frequency is `Daily` or `Monthly`, and limit type is profile or dimension. No source says how the API sets them; Trailhead treats them as parameters, so they presumably go in `data_comm_cap_rule_dim`. Profile limits apply per person, and dimension limits apply across everyone matching the values. A [vendor blog](https://deselect.com/blog/smart-communication-capping/) says rules apply at activation, first come, first served, so a low-value send can use up a cap before a high-value one (community, from a competing product). The [reference](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Communication-Capping) marks `api_name` and `data_comm_cap_rule_dim` required, while the spec doesn't. [Help](https://help.salesforce.com/s/articleView?id=sf.c360_a_create_communication_capping_rules.htm&language=en_US&type=5) requires the Data Cloud Architect or Data Cloud Activation Manager permission set to create rules. No idempotency is documented, so don't retry this POST blindly.

## communication_capping_activation_target_metadata_map

`POST /ssot/communication-capping/activation-target-capping-metadata/{activationTargetId}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Communication-Capping/paths/~1ssot~1communication-capping~1activation-target-capping-metadata~1%7BactivationTargetId%7D/post) · evidence O · changes org state

Maps a capping activation target to dimension values. Segments activated through the target are then evaluated against the rules, so choose values that match the rule, such as Channel = SMS.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `activation_target_id` | `activationTargetId` | path | string | yes | Capping activation target, from `activation_target_create`. |
| `activation_target_name` | `activationTargetName` | body | string |  | Name of the activation target. |
| `data_comm_cap_dim_info` | `dataCommCapDimInfo` | body | array of [CommunicationCappingActivationTargetDimInput](#communicationcappingactivationtargetdiminputrepresentation) |  | Dimension and dimension value pairs for the target. |

```sql
CALL cdp.communication_capping_activation_target_metadata_map (activation_target_id => 'TARGET_ID', activation_target_name => 'Email_capped', data_comm_cap_dim_info => [(data_comm_cap_dim_id = 'DIMENSION_ID', data_comm_cap_dim_value_id = 'DIMENSION_VALUE_ID')]);
```

**Result**

One row per item of `/activationTargets` in the response. Schema `CommunicationCappingActivationTargetRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `activation_target_id` | `activationTargetId` | VARCHAR | - |
| `actv_target_name` | `actvTargetName` | VARCHAR | - |
| `data_comm_cap_dim` | `dataCommCapDim` | JSON (CommunicationCappingDimRepresentation) | - |
| `data_comm_cap_dim_value` | `dataCommCapDimValue` | JSON (CommunicationCappingDimValueRepresentation) | - |
| `id` | `id` | VARCHAR | - |

**Notes:** This needs a target of the capping type first. [Help](https://help.salesforce.com/apex/HTViewHelpDoc?id=data.c360_a_create_communication_capping_target.htm) says it can only be defined on data spaces already associated with the capping instance. The [reference](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Communication-Capping) marks `activation_target_name` required, while the spec doesn't. [Capping-enabled targets](https://help.salesforce.com/s/articleView?id=data.c360_a_data_cloud_sandbox.htm&language=en_US&type=5) work in a sandbox but can't be deployed from it to production. Capping-enabled targets for Marketing Cloud, SFTP and Microsoft Azure [aren't supported in data kits](https://developer.salesforce.com/docs/data/data-cloud-dmo-mapping/guide/c360a-api-isv-readiness-data.html).

## communication_capping_dimension_create

`POST /ssot/communication-capping/dimensions` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Communication-Capping/paths/~1ssot~1communication-capping~1dimensions/post) · evidence O · changes org state

Creates a dimension and its possible values, such as Channel with Email and SMS. Dimensions come first, because configurations, rules and target mappings refer to their ids.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `api_name` | `apiName` | body | string |  | - |
| `dimension_name` | `dimensionName` | body | string |  | API name of the dimension object, such as `ssot__CommunicationChannel__dlm` in the [reference's sample](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Communication-Capping). |
| `dimension_values` | `dimensionValues` | body | array of [CommunicationCappingDimValueInput](#communicationcappingdimvalueinputrepresentation) |  | Values of the dimension. |
| `function_type` | `functionType` | body | string |  | Function type. The [reference's samples](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Communication-Capping) show `FUNCTIONAL_TYPE` and `NON_FUNCTIONAL_TYPE`. |
| `hierarchy_order` | `hierarchyOrder` | body | integer |  | Position in the hierarchy. The reference's samples use 1 for Channel and 2 for Brand. |
| `id` | `id` | body | string |  | - |
| `name` | `name` | body | string |  | - |

```sql
CALL cdp.communication_capping_dimension_create (api_name => 'Channel', dimension_name => 'ssot__CommunicationChannel__dlm', function_type => 'NON_FUNCTIONAL_TYPE', hierarchy_order => 1, dimension_values => [(value = 'Email'), (value = 'SMS')]);
```

**Result**

One row. Schema `CommunicationCappingDimRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `api_name` | `apiName` | VARCHAR | - |
| `dimension_name` | `dimensionName` | VARCHAR | - |
| `dimension_values` | `dimensionValues` | JSON (array of CommunicationCappingDimValueRepresentation) | - |
| `function_type` | `functionType` | VARCHAR | - |
| `hierarchy_order` | `hierarchyOrder` | BIGINT | - |
| `id` | `id` | VARCHAR | - |
| `name` | `name` | VARCHAR | - |

**Notes:** Trailhead calls these parameters. It splits them into [enterprise and functional](https://trailhead.salesforce.com/content/learn/modules/communication-capping-in-data-cloud-quick-look/get-to-know-communication-capping): Channels and up to two user-defined ones are enterprise, and Frequency and Limit Type are preset functional ones. The `FUNCTIONAL_TYPE` and `NON_FUNCTIONAL_TYPE` values suggest the same split, but no source says so. No idempotency is documented, so don't retry this POST blindly.

## Schemas

Attribute names are keywords inside the object they belong to, so completion offers exactly these.

### CommunicationCappingActivationTargetDimInputRepresentation

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `data_comm_cap_dim_id` | `dataCommCapDimId` | string |  | Dimension of the pair, such as Channel. |
| `data_comm_cap_dim_value_id` | `dataCommCapDimValueId` | string |  | Value of the pair, such as Email. |

### CommunicationCappingDataSpaceInputRepresentation

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `data_communication_cap_def_id` | `dataCommunicationCapDefId` | string |  | Capping definition this data space links to. |
| `dataspace_id` | `dataSpaceId` | string |  | Data space to associate with the configuration. |

### CommunicationCappingDimInputRepresentation

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `api_name` | `apiName` | string |  | - |
| `dimension_name` | `dimensionName` | string |  | API name of the dimension object, such as `ssot__CommunicationChannel__dlm`. |
| `dimension_values` | `dimensionValues` | array of [CommunicationCappingDimValueInput](#communicationcappingdimvalueinputrepresentation) |  | Values of the dimension. |
| `function_type` | `functionType` | string |  | Function type. The reference's samples show `FUNCTIONAL_TYPE` and `NON_FUNCTIONAL_TYPE`. |
| `hierarchy_order` | `hierarchyOrder` | integer |  | Position in the hierarchy. The reference's samples use 1 for Channel and 2 for Brand. |
| `id` | `id` | string |  | - |
| `name` | `name` | string |  | - |

### CommunicationCappingDimValueInputRepresentation

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `api_name` | `apiName` | string |  | - |
| `data_comm_cap_dim_id` | `dataCommCapDimId` | string |  | Parent dimension, per the reference's response samples. |
| `id` | `id` | string |  | - |
| `value` | `value` | string |  | The value, such as `Email` for a Channel dimension. |

### CommunicationCappingRelatedDimInputRepresentation

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `api_name` | `apiName` | string |  | - |
| `data_comm_cap_dim_id` | `dataCommCapDimId` | string |  | Dimension to relate to the configuration. |
| `data_communication_cap_def_id` | `dataCommunicationCapDefId` | string |  | - |

### CommunicationCappingRuleDimInputRepresentation

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `dim_id` | `dimId` | string |  | - |
| `dim_value_ids` | `dimValueIds` | array of string |  | - |
