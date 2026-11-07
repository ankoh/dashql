<!-- Generated from overlay/d360/api/calculated_insights.yaml, edit that and run: bazel run //overlay/d360:update -->

# Calculated Insights

Part of the [CDP function reference](functions.md). Nothing here is implemented or tested against an org. Every result also has the [standard columns](functions.md#result-schema).

A calculated insight is a SQL aggregate over data model objects. Data 360 keeps the result as its own object, named `<name>__cio`, and recomputes it on a schedule or on demand. Segments can filter on insights, so insights come [after identity resolution and before segments](https://github.com/salesforce-misc/Data360AgentforceSolutionKitRetail/blob/main/.claude/skills/refresh-data-cloud-components/SKILL.md).

You create an insight, wait for it to compile, run it, wait for the run, then read rows with [`insights_query`](profiles_and_metadata.md#insights_query).

The gotchas that matter most:

- **Two statuses.** `calculated_insight_status` = `ACTIVE` means the definition is usable, and [segments require it](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/SegmentTools.java). `last_run_status` = `SUCCESS` means a run finished. An `ACTIVE` insight with a null `last_run_status` is normal before the first run.
- **Restricted SQL.** The [tool rules](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/CalculatedInsightTools.java) ban `COUNT(DISTINCT)`, subqueries and date arithmetic, and Salesforce's own [payload example](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/resources/metadata/payload-examples.json) breaks them. See [`ci_create`](#ci_create).
- **One run at a time.** A [Salesforce kit](https://github.com/salesforce-misc/Data360AgentforceSolutionKitRetail/blob/main/.claude/skills/refresh-data-cloud-components/SKILL.md) never runs insights in parallel and waits for each to succeed.
- **Listing.** [`ci_list`](#ci_list) needs `definition_type` to return anything (community, one org).
- **Spec gaps.** `ci_enable`, `ci_disable`, `ci_run_status` and `ci_validate` aren't in the spec. Poll with `ci_get`.

```sql
CALL cdp.ci_create (
    api_name => 'Customer_Order_Summary__cio',
    display_name => 'Customer Order Summary',
    definition_type => 'CALCULATED_METRIC',
    publish_schedule_interval => 'Six',
    publish_schedule_start_date_time => '2027-01-01T06:00',
    expression => $$
        SELECT Order__dlm.CustomerId__c AS customer_id__c, SUM(Order__dlm.Total__c) AS total__c
        FROM Order__dlm
        GROUP BY Order__dlm.CustomerId__c
    $$
);
/* Repeat until calculated_insight_status = 'ACTIVE'. */
CALL cdp.ci_get (api_name => 'Customer_Order_Summary__cio');
CALL cdp.ci_run (api_name => 'Customer_Order_Summary__cio');
/* Repeat until last_run_status = 'SUCCESS', then start the next insight. */
CALL cdp.ci_get (api_name => 'Customer_Order_Summary__cio');
CALL cdp.insights_query (ci_name => 'Customer_Order_Summary__cio', batch_size => 10);
```

**Functions:** [`ci_delete`](#ci_delete), [`ci_list`](#ci_list), [`ci_get`](#ci_get), [`ci_update`](#ci_update), [`ci_create`](#ci_create), [`ci_run`](#ci_run), [`ci_enable`](#ci_enable), [`ci_disable`](#ci_disable), [`ci_run_status`](#ci_run_status), [`ci_validate`](#ci_validate)

## ci_delete

`DELETE /ssot/calculated-insights/{apiName}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Calculated-Insights/paths/~1ssot~1calculated-insights~1%7BapiName%7D/delete) · tool `d360_ci_delete` · evidence O · changes org state

Delete a calculated insight in Data 360. Since v57.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `api_name` | `apiName` | path | string | yes | API name of the insight, ending in `__cio`. |

```sql
CALL cdp.ci_delete (api_name => 'Customer_Order_Summary__cio');
```

**Result**

No response body (HTTP 204). One row with only the standard columns.

**Done when:** `ci_get` returns `ITEM_NOT_FOUND`. `ci_get.calculated_insight_status` = `DELETING` means the delete is still running.

**Notes:** Deletion is asynchronous. The 204 comes back at once, then `ci_get` shows `calculated_insight_status` = `DELETING` before it returns `ITEM_NOT_FOUND`. [sf-pi](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/references/data-shapes.md) says that takes a moment. [data-360-sdk](https://github.com/javrrr/data-360-sdk/blob/main/src/resources/calculated-insights.ts) says several minutes (community).

- While it's `DELETING`, creating the same name fails with `DUPLICATES_DETECTED` ([community](https://github.com/javrrr/data-360-sdk/blob/main/src/resources/calculated-insights.ts)).
- The catalog says deleting ["breaks dependent segments"](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/runtime/FamilyCatalog.java).
- A semantic model that references the insight blocks the delete with 412 or `DELETE_FAILED`. The block can last a few seconds after the model is gone ([community](https://github.com/javrrr/afd360/blob/main/src/resources/calculated-insight.ts)).
- The [tool source](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/CalculatedInsightTools.java) says this stops future runs and doesn't delete historical data.

## ci_list

`GET /ssot/calculated-insights` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Calculated-Insights/paths/~1ssot~1calculated-insights/get) · tool `d360_ci_list` · evidence O · read-only

Get calculated insights in Data 360. Since v57.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `batch_size` | `batchSize` | query | integer |  | Number of items to return. Values are from `1` through `200`. If unspecified, the default value is `25`. Since v57.0. |
| `dataspace` | `dataspace` | query | string |  | Name of the data space. Since v57.0. |
| `definition_type` | `definitionType` | query | string |  | Definition type of the calculated insight. Values are: - `CALCULATED_METRIC` - `EXTERNAL_METRIC` - `STREAMING_METRIC` Since v57.0. |
| `offset` | `offset` | query | integer | yes | Number of rows to skip before returning results. If unspecified, no rows are skipped. Since v57.0. |
| `order_by` | `orderby` | query | string |  | Sort order for the result set, such as `GenderId__c.ASC, Occupation__c.DESC`. If unspecified, items are returned in the order they are retrieved. Since v57.0. |
| `page_token` | `pageToken` | query | string |  | Specifies the page token to use to view a page of information. Page tokens are returned as part of the response, such as `currentPageToken` or `nextPageToken`. If unspecified, the first page is returned. Since v57.0. |

```sql
CALL cdp.ci_list (offset => 0, definition_type => 'CALCULATED_METRIC', batch_size => 100);
```

**Result**

One row per item of `/collection/items` in the response. Schema `CdpCalculatedInsightRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `api_name` | `apiName` | VARCHAR | API name of the calculated insight. Since v57.0. |
| `calculated_insight_status` | `calculatedInsightStatus` | VARCHAR | Status of the calculated insight. Since v57.0. |
| `creation_type` | `creationType` | VARCHAR | Creation type of the calculated insight. Since v57.0. |
| `dataspace` | `dataSpace` | VARCHAR | Data space of the calculated insight. Since v57.0. |
| `definition_status` | `definitionStatus` | VARCHAR | Definition status of the calculated insight. Since v57.0. |
| `definition_type` | `definitionType` | VARCHAR | Definition type of the calculated insight. Since v57.0. |
| `description` | `description` | VARCHAR | Description of the calculated insight. Since v57.0. |
| `dimensions` | `dimensions` | JSON (array of CdpCalculatedInsightDimensionRepresentation) | Dimensions of the calculated insight. Since v57.0. |
| `display_name` | `displayName` | VARCHAR | Display name of the calculated insight. Since v57.0. |
| `expression` | `expression` | VARCHAR | Expression of the calculated insight. Since v57.0. |
| `is_enabled` | `isEnabled` | BOOLEAN | Specifies whether the calculated insight is enabled (`true`) or not (`false`). Since v57.0. |
| `last_calc_insight_status_date_time` | `lastCalcInsightStatusDateTime` | VARCHAR | Last calculated insight status date and time. Since v57.0. |
| `last_calc_insight_status_error_code` | `lastCalcInsightStatusErrorCode` | VARCHAR | Last calculated insight status error code. Since v57.0. |
| `last_run_date_time` | `lastRunDateTime` | VARCHAR | Last run date and time of the calculated insight. Since v57.0. |
| `last_run_status` | `lastRunStatus` | VARCHAR | Last run status of the calculated insight. Since v57.0. |
| `last_run_status_date_time` | `lastRunStatusDateTime` | VARCHAR | Last run status date and time of the calculated insight. Since v57.0. |
| `last_run_status_error_code` | `lastRunStatusErrorCode` | VARCHAR | Last run status error code of the calculated insight. Since v57.0. |
| `measures` | `measures` | JSON (array of CdpCalculatedInsightMeasureRepresentation) | Measures of the calculated insight. Since v57.0. |
| `publish_schedule_end_date` | `publishScheduleEndDate` | JSON | Not in the spec schema: from the spec's examples. |
| `publish_schedule_interval` | `publishScheduleInterval` | VARCHAR | Not in the spec schema: from the spec's examples. |
| `publish_schedule_start_date_time` | `publishScheduleStartDateTime` | JSON | Not in the spec schema: from the spec's examples. |

**Paging:** `page_token`, taken from `collection.nextPageToken`, which is null on the last page. `offset` is still required.

**Notes:** - Without `definition_type` the list returned 0 items although insights existed, so one project [calls once per type](https://github.com/szymonlewandowski/config-snapshot-data360/blob/main/docs/api-quirks.md) (community, one org). The spec doesn't mention this.
- The spec requires `offset`, while the [tool source](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/CalculatedInsightTools.java) treats it as optional. A community project [found it still required](https://github.com/szymonlewandowski/config-snapshot-data360/blob/main/docs/api-quirks.md) alongside `page_token`. Pass `0`.
- Items are under `collection.items`, each with the full definition including `expression`, `dimensions` and `measures`. You don't need a `ci_get` per item.
- Field data types are only in [`metadata`](profiles_and_metadata.md#metadata) with `entity_type => 'CalculatedInsight'` ([community](https://github.com/szymonlewandowski/config-snapshot-data360/blob/main/docs/api-quirks.md)).
- Spelling varies: the filter is `dataspace`, the response field `dataSpace`, the create option `dataspace_name`.

## ci_get

`GET /ssot/calculated-insights/{apiName}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Calculated-Insights/paths/~1ssot~1calculated-insights~1%7BapiName%7D/get) · tool `d360_ci_get` · evidence O · read-only

Get a calculated insight in Data 360. Since v57.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `api_name` | `apiName` | path | string | yes | API name of the insight, ending in `__cio`. |

```sql
CALL cdp.ci_get (api_name => 'Customer_Order_Summary__cio');
```

**Result**

One row. Schema `CdpCalculatedInsightRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `api_name` | `apiName` | VARCHAR | API name of the calculated insight. Since v57.0. |
| `calculated_insight_status` | `calculatedInsightStatus` | VARCHAR | Status of the calculated insight. Since v57.0. |
| `creation_type` | `creationType` | VARCHAR | Creation type of the calculated insight. Since v57.0. |
| `dataspace` | `dataSpace` | VARCHAR | Data space of the calculated insight. Since v57.0. |
| `definition_status` | `definitionStatus` | VARCHAR | Definition status of the calculated insight. Since v57.0. |
| `definition_type` | `definitionType` | VARCHAR | Definition type of the calculated insight. Since v57.0. |
| `description` | `description` | VARCHAR | Description of the calculated insight. Since v57.0. |
| `dimensions` | `dimensions` | JSON (array of CdpCalculatedInsightDimensionRepresentation) | Dimensions of the calculated insight. Since v57.0. |
| `display_name` | `displayName` | VARCHAR | Display name of the calculated insight. Since v57.0. |
| `expression` | `expression` | VARCHAR | Expression of the calculated insight. Since v57.0. |
| `is_enabled` | `isEnabled` | BOOLEAN | Specifies whether the calculated insight is enabled (`true`) or not (`false`). Since v57.0. |
| `last_calc_insight_status_date_time` | `lastCalcInsightStatusDateTime` | VARCHAR | Last calculated insight status date and time. Since v57.0. |
| `last_calc_insight_status_error_code` | `lastCalcInsightStatusErrorCode` | VARCHAR | Last calculated insight status error code. Since v57.0. |
| `last_run_date_time` | `lastRunDateTime` | VARCHAR | Last run date and time of the calculated insight. Since v57.0. |
| `last_run_status` | `lastRunStatus` | VARCHAR | Last run status of the calculated insight. Since v57.0. |
| `last_run_status_date_time` | `lastRunStatusDateTime` | VARCHAR | Last run status date and time of the calculated insight. Since v57.0. |
| `last_run_status_error_code` | `lastRunStatusErrorCode` | VARCHAR | Last run status error code of the calculated insight. Since v57.0. |
| `measures` | `measures` | JSON (array of CdpCalculatedInsightMeasureRepresentation) | Measures of the calculated insight. Since v57.0. |
| `publish_schedule_end_date` | `publishScheduleEndDate` | JSON | Not in the spec schema: from the spec's examples. |
| `publish_schedule_interval` | `publishScheduleInterval` | VARCHAR | Not in the spec schema: from the spec's examples. |
| `publish_schedule_start_date_time` | `publishScheduleStartDateTime` | JSON | Not in the spec schema: from the spec's examples. |

**Notes:** The two statuses answer different questions:

- `calculated_insight_status` says whether the definition is usable. Values seen: `PROCESSING`, `ACTIVE`, `DELETING` ([sf-pi](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/references/data-shapes.md)), and `FAILED` when the SQL doesn't compile ([community](https://github.com/javrrr/afd360/blob/main/src/resources/calculated-insight.ts)). The spec lists no values. [Segments need `ACTIVE`](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/SegmentTools.java).
- `last_run_status` says how the last run went. Values: `PENDING`, `PROCESSING`, `SUCCESS`, `FAILED` ([kit](https://github.com/salesforce-misc/Data360AgentforceSolutionKitRetail/blob/main/.claude/skills/refresh-data-cloud-components/SKILL.md), one org), and null before the first run (spec example). The kit warns that Title Case comparisons never match in that org.

Also:

- `ACTIVE` doesn't mean data exists. A semantic model created on a just-`ACTIVE` insight failed with `SEMANTIC_ENTITY_NOT_EXIST` until the first compute finished ([community](https://github.com/javrrr/afd360/blob/main/src/client/retry.ts)).
- `last_calc_insight_status_error_code` holds the reason for a `FAILED` definition ([community](https://github.com/javrrr/afd360/blob/main/src/resources/calculated-insight.ts)).
- A name without the suffix fails with [`api_name must end in __cio`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/references/troubleshooting.md).
- The spec's schema has no schedule fields, yet its list example returns `publish_schedule_interval`, `publish_schedule_start_date_time` and `publish_schedule_end_date`. There the interval reads `SIX` or `NOT_SCHEDULED`, not the input spelling. The same example shows `definition_status` = `IN_USE` and `creation_type` = `Custom`.

## ci_update

`PATCH /ssot/calculated-insights/{apiName}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Calculated-Insights/paths/~1ssot~1calculated-insights~1%7BapiName%7D/patch) · tool `d360_ci_update` · evidence O · changes org state

Update a calculated insight in Data 360. Since v57.0. **Root XML tag:** `<cdpCalculatedInsightInput>`

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `api_name` | `apiName` | path | string | yes | API name of the insight, ending in `__cio`. |
| `body_api_name` | `apiName` | body | string |  | API name of the calculated insight with suffix __cio. Required for POST. Optional for PATCH. Since v57.0. |
| `created_from_package` | `createdFromPackage` | body | boolean |  | Specifies whether the calculated insight was created from an installed package (`true`) or not (`false`). Since v57.0. |
| `dataspace_name` | `dataSpaceName` | body | string |  | Name of the data space. Since v57.0. |
| `definition_type` | `definitionType` | body | enum(CALCULATED_METRIC, EXTERNAL_METRIC, STREAMING_METRIC) |  | Definition type of the calculated insight. Required for POST. Optional for PATCH. Since v57.0. |
| `description` | `description` | body | string |  | Calculated insight description. Since v57.0. |
| `display_name` | `displayName` | body | string |  | Calculated insight display name. Required for POST. Optional for PATCH. **Available Version:*** 57.0 |
| `draft` | `draft` | body | boolean |  | Specifies whether to save the calculated insight as draft (`true`) or not (`false`). Since v57.0. |
| `expression` | `expression` | body | string |  | Calculated insight ANSI SQL expression. Required for POST. Optional for PATCH. Since v57.0. |
| `packaged_calculated_insight_api_name` | `packagedCalculatedInsightApiName` | body | string |  | API name of the packaged calculated insight. Since v57.0. |
| `publish_schedule_end_date` | `publishScheduleEndDate` | body | string |  | The date and time after which the calculated insight is no longer run. - Use the format `yyyy-mm-dd`. - Must be a date later than `publish_schedule_start_date_time`. - Don't use with streaming insights. - Don't use if the `publish_schedule_interval` is `No Schedule`. Since v62.0. |
| `publish_schedule_interval` | `publishScheduleInterval` | body | enum(ExternallyManaged, NotScheduled, One, Six, Streaming, SystemManaged, Twelve, TwentyFour) | yes | Indicates how frequently the calculated insight is processed. Required for calculated insights. Don't use with streaming insights. Since v62.0. |
| `publish_schedule_start_date_time` | `publishScheduleStartDateTime` | body | string | yes | The date and time when the calculated insight is evaluated to be run. - Use the format `yyyy-mm-dd`. - The specified date and time must be in the future. - Required if `publish_schedule_interval` is any value other than `No Schedule`. - Don't use with streaming insights. Since v62.0. |
| `history_publish_schedule_interval` | `historyPublishScheduleInterval` | body | string |  | Not in the spec schema: from the MCP server's request class. |
| `history_publish_time` | `historyPublishTime` | body | string |  | Not in the spec schema: from the MCP server's request class. |
| `source_developer_name` | `sourceDeveloperName` | body | string |  | Not in the spec schema: from the MCP server's request class. |

```sql
CALL cdp.ci_update (
    api_name => 'Customer_Order_Summary__cio',
    description => 'Total order amount per customer, refreshed twice a day.',
    publish_schedule_interval => 'Twelve',
    publish_schedule_start_date_time => '2027-01-01T06:00'
);
```

**Result**

One row. Schema `CdpCalculatedInsightRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `api_name` | `apiName` | VARCHAR | API name of the calculated insight. Since v57.0. |
| `calculated_insight_status` | `calculatedInsightStatus` | VARCHAR | Status of the calculated insight. Since v57.0. |
| `creation_type` | `creationType` | VARCHAR | Creation type of the calculated insight. Since v57.0. |
| `dataspace` | `dataSpace` | VARCHAR | Data space of the calculated insight. Since v57.0. |
| `definition_status` | `definitionStatus` | VARCHAR | Definition status of the calculated insight. Since v57.0. |
| `definition_type` | `definitionType` | VARCHAR | Definition type of the calculated insight. Since v57.0. |
| `description` | `description` | VARCHAR | Description of the calculated insight. Since v57.0. |
| `dimensions` | `dimensions` | JSON (array of CdpCalculatedInsightDimensionRepresentation) | Dimensions of the calculated insight. Since v57.0. |
| `display_name` | `displayName` | VARCHAR | Display name of the calculated insight. Since v57.0. |
| `expression` | `expression` | VARCHAR | Expression of the calculated insight. Since v57.0. |
| `is_enabled` | `isEnabled` | BOOLEAN | Specifies whether the calculated insight is enabled (`true`) or not (`false`). Since v57.0. |
| `last_calc_insight_status_date_time` | `lastCalcInsightStatusDateTime` | VARCHAR | Last calculated insight status date and time. Since v57.0. |
| `last_calc_insight_status_error_code` | `lastCalcInsightStatusErrorCode` | VARCHAR | Last calculated insight status error code. Since v57.0. |
| `last_run_date_time` | `lastRunDateTime` | VARCHAR | Last run date and time of the calculated insight. Since v57.0. |
| `last_run_status` | `lastRunStatus` | VARCHAR | Last run status of the calculated insight. Since v57.0. |
| `last_run_status_date_time` | `lastRunStatusDateTime` | VARCHAR | Last run status date and time of the calculated insight. Since v57.0. |
| `last_run_status_error_code` | `lastRunStatusErrorCode` | VARCHAR | Last run status error code of the calculated insight. Since v57.0. |
| `measures` | `measures` | JSON (array of CdpCalculatedInsightMeasureRepresentation) | Measures of the calculated insight. Since v57.0. |
| `publish_schedule_end_date` | `publishScheduleEndDate` | VARCHAR | Not in the spec schema: from the spec's examples. |
| `publish_schedule_interval` | `publishScheduleInterval` | VARCHAR | Not in the spec schema: from the spec's examples. |
| `publish_schedule_start_date_time` | `publishScheduleStartDateTime` | VARCHAR | Not in the spec schema: from the spec's examples. |

**Notes:** Expression, name and schedule rules are the same as for [`ci_create`](#ci_create).

- The catalog says an update ["triggers recompilation"](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/runtime/FamilyCatalog.java). No source gives a duration or status sequence.
- The spec shares one input schema with create, so it marks `publish_schedule_interval` and `publish_schedule_start_date_time` as required here. The [tool source](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/CalculatedInsightTools.java) calls PATCH partial ("Only include fields you want to change"), and its [request class](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/model/request/calculatedinsight/CalculatedInsightUpdateRequest.java) makes every field optional.
- `body_api_name` is the `api_name` body field. No source says whether changing it renames the insight.
- [afd360](https://github.com/javrrr/afd360/blob/main/src/resources/calculated-insight.ts) doesn't use PATCH and deletes and recreates on any change, because `expression` and `definition_type` are coupled (community).

## ci_create

`POST /ssot/calculated-insights` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Calculated-Insights/paths/~1ssot~1calculated-insights/post) · tool `d360_ci_create` · evidence O · changes org state

Create a calculated insight in Data 360. Since v57.0. **Root XML tag:** `<cdpCalculatedInsightInput>`

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `api_name` | `apiName` | body | string |  | API name of the calculated insight with suffix __cio. Required for POST. Optional for PATCH. Since v57.0. |
| `created_from_package` | `createdFromPackage` | body | boolean |  | Specifies whether the calculated insight was created from an installed package (`true`) or not (`false`). Since v57.0. |
| `dataspace_name` | `dataSpaceName` | body | string |  | Name of the data space. Since v57.0. |
| `definition_type` | `definitionType` | body | enum(CALCULATED_METRIC, EXTERNAL_METRIC, STREAMING_METRIC) |  | Definition type of the calculated insight. Required for POST. Optional for PATCH. Since v57.0. |
| `description` | `description` | body | string |  | Calculated insight description. Since v57.0. |
| `display_name` | `displayName` | body | string |  | Calculated insight display name. Required for POST. Optional for PATCH. **Available Version:*** 57.0 |
| `draft` | `draft` | body | boolean |  | Specifies whether to save the calculated insight as draft (`true`) or not (`false`). Since v57.0. |
| `expression` | `expression` | body | string |  | Calculated insight ANSI SQL expression. Required for POST. Optional for PATCH. Since v57.0. |
| `packaged_calculated_insight_api_name` | `packagedCalculatedInsightApiName` | body | string |  | API name of the packaged calculated insight. Since v57.0. |
| `publish_schedule_end_date` | `publishScheduleEndDate` | body | string |  | The date and time after which the calculated insight is no longer run. - Use the format `yyyy-mm-dd`. - Must be a date later than `publish_schedule_start_date_time`. - Don't use with streaming insights. - Don't use if the `publish_schedule_interval` is `No Schedule`. Since v62.0. |
| `publish_schedule_interval` | `publishScheduleInterval` | body | enum(ExternallyManaged, NotScheduled, One, Six, Streaming, SystemManaged, Twelve, TwentyFour) | yes | Indicates how frequently the calculated insight is processed. Required for calculated insights. Don't use with streaming insights. Since v62.0. |
| `publish_schedule_start_date_time` | `publishScheduleStartDateTime` | body | string | yes | The date and time when the calculated insight is evaluated to be run. - Use the format `yyyy-mm-dd`. - The specified date and time must be in the future. - Required if `publish_schedule_interval` is any value other than `No Schedule`. - Don't use with streaming insights. Since v62.0. |
| `history_publish_schedule_interval` | `historyPublishScheduleInterval` | body | string |  | Not in the spec schema: from the MCP server's request class. |
| `history_publish_time` | `historyPublishTime` | body | string |  | Not in the spec schema: from the MCP server's request class. |
| `source_developer_name` | `sourceDeveloperName` | body | string |  | Not in the spec schema: from the MCP server's request class. |

```sql
CALL cdp.ci_create (
    api_name => 'Customer_Order_Summary__cio',
    display_name => 'Customer Order Summary',
    description => 'Total order amount per customer.',
    definition_type => 'CALCULATED_METRIC',
    dataspace_name => 'default',
    publish_schedule_interval => 'Six',
    publish_schedule_start_date_time => '2027-01-01T06:00',
    expression => $$
        SELECT Order__dlm.CustomerId__c AS customer_id__c, SUM(Order__dlm.Total__c) AS total__c
        FROM Order__dlm
        GROUP BY Order__dlm.CustomerId__c
    $$
);
```

**Result**

One row. Schema `CdpCalculatedInsightRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `api_name` | `apiName` | VARCHAR | API name of the calculated insight. Since v57.0. |
| `calculated_insight_status` | `calculatedInsightStatus` | VARCHAR | Status of the calculated insight. Since v57.0. |
| `creation_type` | `creationType` | VARCHAR | Creation type of the calculated insight. Since v57.0. |
| `dataspace` | `dataSpace` | VARCHAR | Data space of the calculated insight. Since v57.0. |
| `definition_status` | `definitionStatus` | VARCHAR | Definition status of the calculated insight. Since v57.0. |
| `definition_type` | `definitionType` | VARCHAR | Definition type of the calculated insight. Since v57.0. |
| `description` | `description` | VARCHAR | Description of the calculated insight. Since v57.0. |
| `dimensions` | `dimensions` | JSON (array of CdpCalculatedInsightDimensionRepresentation) | Dimensions of the calculated insight. Since v57.0. |
| `display_name` | `displayName` | VARCHAR | Display name of the calculated insight. Since v57.0. |
| `expression` | `expression` | VARCHAR | Expression of the calculated insight. Since v57.0. |
| `is_enabled` | `isEnabled` | BOOLEAN | Specifies whether the calculated insight is enabled (`true`) or not (`false`). Since v57.0. |
| `last_calc_insight_status_date_time` | `lastCalcInsightStatusDateTime` | VARCHAR | Last calculated insight status date and time. Since v57.0. |
| `last_calc_insight_status_error_code` | `lastCalcInsightStatusErrorCode` | VARCHAR | Last calculated insight status error code. Since v57.0. |
| `last_run_date_time` | `lastRunDateTime` | VARCHAR | Last run date and time of the calculated insight. Since v57.0. |
| `last_run_status` | `lastRunStatus` | VARCHAR | Last run status of the calculated insight. Since v57.0. |
| `last_run_status_date_time` | `lastRunStatusDateTime` | VARCHAR | Last run status date and time of the calculated insight. Since v57.0. |
| `last_run_status_error_code` | `lastRunStatusErrorCode` | VARCHAR | Last run status error code of the calculated insight. Since v57.0. |
| `measures` | `measures` | JSON (array of CdpCalculatedInsightMeasureRepresentation) | Measures of the calculated insight. Since v57.0. |
| `publish_schedule_end_date` | `publishScheduleEndDate` | JSON | Not in the spec schema: from the spec's examples. |
| `publish_schedule_interval` | `publishScheduleInterval` | VARCHAR | Not in the spec schema: from the spec's examples. |
| `publish_schedule_start_date_time` | `publishScheduleStartDateTime` | VARCHAR | Not in the spec schema: from the spec's examples. |

**Done when:** `ci_get.calculated_insight_status` = `ACTIVE`. `PROCESSING` means wait ([sf-pi](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/references/data-shapes.md)). `FAILED` is terminal ([community](https://github.com/javrrr/afd360/blob/main/src/resources/calculated-insight.ts)).

**Notes:** **Insight SQL.** The [tool rules](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/CalculatedInsightTools.java):

- Columns use `table.column`, such as `ssot__Individual__dlm.ssot__Id__c`.
- `GROUP BY` uses fully qualified names, not aliases.
- No `COUNT(DISTINCT ...)`. Use `APPROX_COUNT_DISTINCT()`.
- No subqueries or subquery aliases.
- No `CAST(... AS FLOAT)`. Compute raw counts and divide downstream.
- No `CURRENT_DATE - INTERVAL`, or any other date arithmetic.
- No `dimensions` or `measures` arrays. The API derives them from the expression.

**Salesforce's sources disagree on these rules:**

- The [payload example](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/resources/metadata/payload-examples.json) for the same tool uses `COUNT(DISTINCT ...)` and `CURRENT_DATE - INTERVAL 365 DAY`.
- The spec's own examples use `GROUP BY unified_individual__c`, an alias.
- The spec and [sf-pi](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/references/data-shapes.md) end every alias in `__c`, and the spec's response uses those aliases as dimension and measure `api_name`s. The payload example uses `region` and `total_revenue`.

Nothing here is tested. A query that qualifies `GROUP BY`, uses `APPROX_COUNT_DISTINCT`, avoids date arithmetic and aliases to `__c` matches every source above.

**Other traps:**

- **Name.** The spec's text and the [tool](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/CalculatedInsightTools.java) need the `__cio` suffix. Yet the spec's create example sends `unified_individual_case_counts_test`, and its list example shows that insight with `__cio`. [afd360's skill](https://github.com/javrrr/afd360/blob/main/skills/afd360/SKILL.md) says the platform appends it (community), though [its code](https://github.com/javrrr/afd360/blob/main/src/resources/calculated-insight.ts) sends it. Always send it.
- **Required.** The spec's text says `api_name`, `display_name`, `definition_type` and `expression` are required for POST, but its flags don't mark them.
- **Start date.** The spec's flags always require `publish_schedule_start_date_time`. Its text requires it unless the interval is `No Schedule`, which is `NotScheduled` in the enum. [sf-pi](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/references/data-shapes.md) omits it with `SYSTEM_MANAGED`, and [afd360](https://github.com/javrrr/afd360/blob/main/src/resources/calculated-insight.ts) omits it for `NotScheduled` and `SystemManaged` (community). The start must be in the future.
- **Interval spelling.** The spec and the [request class](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/model/request/calculatedinsight/CalculatedInsightCreateRequest.java) say `SystemManaged`. The tool text, payload example and sf-pi say `SYSTEM_MANAGED`. `Six` is every 6 hours ([community](https://github.com/javrrr/afd360/blob/main/src/resources/calculated-insight.ts)). The spec says not to use the interval with streaming insights, though the enum has `Streaming`.
- **Date format.** The spec's text says `yyyy-mm-dd` for both dates. Its create example sends `2025-12-11T12:00` and its update example `2025-10-20T22:00:00.000Z`. The [request class](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/model/request/calculatedinsight/CalculatedInsightCreateRequest.java) says `yyyy-MM-ddTHH:mm` for the start and `yyyy-MM-dd` for the end.
- **Not in the spec.** The [request class](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/model/request/calculatedinsight/CalculatedInsightCreateRequest.java) adds `history_publish_schedule_interval`, `history_publish_time`, `source_developer_name` and the `definition_type` values `GRAPH_METRIC` and `HISTORY_METRIC`. The [tool](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/CalculatedInsightTools.java) adds a `shouldCommitTransaction` query parameter on create, update and delete. They aren't options here.
- **Timing.** The POST runs SQL validation and schedule setup synchronously and commonly takes 30 to 60 s ([community](https://github.com/javrrr/data-360-sdk/blob/main/src/resources/calculated-insights.ts)). After a 30 s client timeout, a retry can hit the partially created insight ([community](https://github.com/javrrr/afd360/blob/main/src/resources/calculated-insight.ts)).
- **Mappings first.** The SQL is checked against each DMO's fact table, which appears after its mapping has processed data. Until then the call fails with `ENTITY_SAVE_ERROR` and `Error getting FactTable`. The same call succeeded about 90 s later ([community, one org](https://github.com/javrrr/afd360/blob/main/src/client/retry.ts)).
- **Existing names.** The [tool](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/CalculatedInsightTools.java) does a GET first and returns the existing insight with `_alreadyExisted`. That is wrapper behavior, not the API's.

## ci_run

`POST /ssot/calculated-insights/{apiName}/actions/run` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Calculated-Insights/paths/~1ssot~1calculated-insights~1%7BapiName%7D~1actions~1run/post) · tool `d360_ci_run` · evidence O · changes org state

Trigger a run on a calculated insight in Data 360. This `POST` endpoint doesn't accept request parameters or a request body. Since v57.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `api_name` | `apiName` | path | string | yes | API name of the insight, ending in `__cio`. |

```sql
CALL cdp.ci_run (api_name => 'Customer_Order_Summary__cio');
```

**Result**

One row. Schema `CdpCalculatedInsightStandardActionResponseRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `errors` | `errors` | JSON (array of CdpErrorRepresentation) | List of errors that resulted from the action. Since v57.0. |
| `success` | `success` | BOOLEAN | Indicates whether the action was initiated successfully (`true`) or not (`false`). Since v57.0. |

**Done when:** `ci_get.last_run_status` = `SUCCESS`. `PENDING` and `PROCESSING` mean wait, and `FAILED` means the run failed ([kit](https://github.com/salesforce-misc/Data360AgentforceSolutionKitRetail/blob/main/.claude/skills/refresh-data-cloud-components/SKILL.md), one org).

**Notes:** `success = true` only means the run was initiated. Poll [`ci_get`](#ci_get), not this result. The [tool source](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/CalculatedInsightTools.java) comment says the call returns a job or run id, but the spec and the [kit](https://github.com/salesforce-misc/Data360AgentforceSolutionKitRetail/blob/main/.claude/skills/refresh-data-cloud-components/SKILL.md) show only `success` and `errors`.

- **One at a time.** The [kit](https://github.com/salesforce-misc/Data360AgentforceSolutionKitRetail/blob/main/.claude/skills/refresh-data-cloud-components/SKILL.md) says "NEVER trigger multiple CIs in parallel" and waits for `SUCCESS` before the next insight, after identity resolution has finished. Its stated reason is that "downstream depends on this one". No source says the server rejects parallel runs.
- **Polling.** The [kit](https://github.com/salesforce-misc/Data360AgentforceSolutionKitRetail/blob/main/.claude/skills/refresh-data-cloud-components/SKILL.md) waits 30 s, because a run stays `PENDING` about that long, then polls every 30 s for up to 10 min (one org). No source says whether `last_run_status` still holds the previous value right after the POST.
- **Retries.** On `FAILED` the kit sends the POST again, up to 3 attempts in total with 30 s between them. It doesn't retry a timeout.
- **Cost.** [sf-plugin-data360](https://github.com/dsouza-anush/sf-plugin-data360/blob/main/src/resources/calculatedInsight.ts) marks runs as billable (community).
- **Body.** The spec says the call takes no body. The tool and the kit send `{}`.

## ci_enable

`POST /ssot/calculated-insights/{ciName}/actions/enable` · tool `d360_ci_enable` · evidence S · changes org state

Enable a calculated insight. Per sf-pi, this can make it available to downstream segments and activations.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `ci_name` | `ciName` | path | string | yes | The calculated insight API name |

```sql
CALL cdp.ci_enable (ci_name => 'Customer_Order_Summary__cio');
```

**Result**

The public sources don't document this response. One row, with the response in `_raw`.

**Notes:** It isn't in the v68 spec. The path comes from [Salesforce's MCP server](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/CalculatedInsightTools.java), whose [tests](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/test/java/com/salesforce/data360/mcp/tools/CalculatedInsightToolsTest.java) mock HTTP, and [sf-pi's registry](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/registry/operations.json) copies it from there. [sf-pi's parity report](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/references/connect-openapi-parity.md) lists it as outside the OpenAPI contract. The docs index and the [Postman catalog](https://github.com/supanmaniar/salesforce-mcn-d360-agent/blob/main/catalog/endpoints.json) (community) don't list it, and no source shows a live call. [sf-plugin-data360](https://github.com/dsouza-anush/sf-plugin-data360/blob/main/docs/API_COVERAGE.md) leaves it out of its supported commands (community).

No source says whether the change is immediate or how this relates to `calculated_insight_status`. `ci_get.is_enabled` is the spec's field for the enabled state.

## ci_disable

`POST /ssot/calculated-insights/{ciName}/actions/disable` · tool `d360_ci_disable` · evidence S · changes org state

Disable a calculated insight. Per sf-pi, this can affect dependent segments and activations.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `ci_name` | `ciName` | path | string | yes | The calculated insight API name |

```sql
CALL cdp.ci_disable (ci_name => 'Customer_Order_Summary__cio');
```

**Result**

The public sources don't document this response. One row, with the response in `_raw`.

**Notes:** Same evidence as [`ci_enable`](#ci_enable): not in the v68 spec, and no source shows a live call. No source says what happens to a segment that filters on a disabled insight.

## ci_run_status

`POST /ssot/calculated-insights/{ciName}/actions/refresh-status` · tool `d360_ci_run_status` · evidence S · read-only

Ask Data 360 to refresh and report a calculated insight's run status after `ci_run`.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `ci_name` | `ciName` | path | string | yes | The calculated insight API name |

```sql
CALL cdp.ci_run_status (ci_name => 'Customer_Order_Summary__cio');
```

**Result**

The public sources don't document this response. One row, with the response in `_raw`.

**Notes:** It isn't in the v68 spec. The path comes from [Salesforce's MCP server](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/CalculatedInsightTools.java), whose [tests](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/test/java/com/salesforce/data360/mcp/tools/CalculatedInsightToolsTest.java) mock HTTP, and [sf-pi's registry](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/registry/operations.json) copies it from there. [sf-pi's parity report](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/references/connect-openapi-parity.md) lists it as outside the OpenAPI contract. The docs index and the [Postman catalog](https://github.com/supanmaniar/salesforce-mcn-d360-agent/blob/main/catalog/endpoints.json) (community) don't list it, and no source shows a live call.

Prefer [`ci_get`](#ci_get) and `last_run_status`, the polling path the [kit](https://github.com/salesforce-misc/Data360AgentforceSolutionKitRetail/blob/main/.claude/skills/refresh-data-cloud-components/SKILL.md) uses.

[sf-pi](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/registry/operations.json) says this call "refreshes and returns" the run status and rates it as a safe POST, but shows no response. The spec's only sibling, `POST /ssot/data-transforms/{dataTransformNameOrId}/actions/refresh-status`, is described as refreshing the status, and [sf-pi](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/references/data-shapes.md) records `{ "success": true, "errors": [] }` for it. If this endpoint matches, it returns no status at all, though no source confirms that.

## ci_validate

`POST /ssot/calculated-insights/actions/validate` · tool `d360_ci_validate` · evidence S · read-only

Check an insight expression before creating or updating an insight.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `expression` | `expression` | body | string | yes | Insight SQL to validate. |
| `definition_type` | `definitionType` | body | enum(CALCULATED_METRIC, EXTERNAL_METRIC, STREAMING_METRIC, GRAPH_METRIC, HISTORY_METRIC) |  | Definition type of the insight. |
| `dataspace_name` | `dataSpaceName` | body | string |  | Name of the data space. |
| `created_from_package` | `createdFromPackage` | body | boolean |  | Whether the insight is created from an installed package (`true`). |

```sql
CALL cdp.ci_validate (
    definition_type => 'CALCULATED_METRIC',
    dataspace_name => 'default',
    expression => $$
        SELECT Order__dlm.CustomerId__c AS customer_id__c, SUM(Order__dlm.Total__c) AS total__c
        FROM Order__dlm
        GROUP BY Order__dlm.CustomerId__c
    $$
);
```

**Result**

The public sources don't document this response. One row, with the response in `_raw`.

**Notes:** It isn't in the v68 spec. The path comes from [Salesforce's MCP server](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/CalculatedInsightTools.java), whose [tests](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/test/java/com/salesforce/data360/mcp/tools/CalculatedInsightToolsTest.java) mock HTTP, and [sf-pi's registry](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/registry/operations.json) copies it from there. [sf-pi's parity report](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/references/connect-openapi-parity.md) lists it as outside the OpenAPI contract. The docs index and the [Postman catalog](https://github.com/supanmaniar/salesforce-mcn-d360-agent/blob/main/catalog/endpoints.json) (community) don't list it, and no source shows a live call. [sf-plugin-data360](https://github.com/dsouza-anush/sf-plugin-data360/blob/main/docs/API_COVERAGE.md) leaves it out of its supported commands (community).

- Attributes come from the [request class](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/model/request/calculatedinsight/CalculatedInsightValidateRequest.java). Only `expression` is required, so an insight doesn't need to exist yet.
- [sf-pi](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/registry/operations.json) rates this a safe POST, to use "before creating or updating". No source says which [insight SQL rules](#ci_create) it enforces, or how it reports a failure.
