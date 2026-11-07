# Segments

Part of the [CDP function reference](functions.md). Nothing here is implemented or tested against an org. Every result also has the [standard columns](functions.md#result-schema).

A segment is a named audience built on a data model object (DMO), such as every individual with an order over 5000. Activations then send it to external systems. It depends on the DMO, its relationships, and any calculated insights it filters on, which [must be `ACTIVE`](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/SegmentTools.java) first.

The usual order is create, wait for `segment_status`, publish, then read members. Publishing is what [calculates membership](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/runtime/FamilyCatalog.java).

What matters most:

- **Name or id.** Update, delete, count and members take `api_name`. `segment_publish` takes `market_segment_id` (`1sg...`). Get and deactivate take either, so each has a `_by_id` form.
- **Double nesting.** SQL goes in `include_dbt => (models = (models = [...]))`, not the flat array the spec's schema shows. See [`segment_create`](#segment_create).
- **Segment SQL is its own dialect.** Aliases, `EXISTS` and most other shapes are rejected. Read [Segment SQL](api_notes.md#segment-sql) before writing any.
- **Spelling depends on direction.** You send `Dbt` and `NoRefresh`, and read back `DBT` and `NO_REFRESH`.
- **Publishing is asynchronous.** Sources disagree on the finished `publish_status`. See [`segment_publish`](#segment_publish).

```sql
CALL cdp.segment_create (
  developer_name => 'Robots', display_name => 'Robots', description => 'Individuals named Robot',
  segment_on_api_name => 'Individuals__dlm', segment_type => 'Dbt', publish_schedule => 'NoRefresh',
  include_dbt => (models = (models = [(name = 'robots', sql = (
    SELECT Individuals__dlm.IndividualId__c, Individuals__dlm.KQ_IndividualId__c
    FROM Individuals__dlm
    WHERE Individuals__dlm.FirstName__c = 'Robot'
      AND trim(cast(Individuals__dlm.IndividualId__c as varchar(255))) <> ''
  ))])));
/* Wait for segment_status = 'ACTIVE' and copy market_segment_id */
CALL cdp.segment_get (segment_api_name => 'Robots');
CALL cdp.segment_publish (segment_id => '1sgxx00000000PpAAI');
/* After publishing finishes */
CALL cdp.segment_member_list (segment_api_name => 'Robots', limit => 100);
```

**Functions:** [`segment_delete`](#segment_delete), [`segment_list`](#segment_list), [`segment_get`](#segment_get), [`segment_get_by_id`](#segment_get_by_id), [`segment_member_list`](#segment_member_list), [`segment_update`](#segment_update), [`segment_create`](#segment_create), [`segment_count`](#segment_count), [`segment_deactivate`](#segment_deactivate), [`segment_deactivate_by_id`](#segment_deactivate_by_id), [`segment_publish`](#segment_publish)

## segment_delete

`DELETE /ssot/segments/{segmentApiName}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Segments/paths/~1ssot~1segments~1%7BsegmentApiName%7D/delete) · tool `d360_segment_delete` · evidence O · changes org state

Delete a segment in Data 360. Since v56.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `segment_api_name` | `segmentApiName` | path | string | yes | The segment's `api_name`, not its `1sg` id. |

```sql
CALL cdp.segment_delete (segment_api_name => 'High_Value_Order_Buyers');
```

**Result**

No response body (HTTP 204). One row with only the standard columns.

**Notes:** Takes `api_name`, not the id. [Irreversible](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/SegmentTools.java). It [returns 204 even while the segment is `PROCESSING`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/references/data-shapes.md). The [MCP tool](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/SegmentTools.java) also sends a `dataspace` query parameter, which the spec doesn't list for this call.

## segment_list

`GET /ssot/segments` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Segments/paths/~1ssot~1segments/get) · tool `d360_segment_list` · evidence O · host core · read-only

Get the segments of a data space, one row each. Use it to find API names and check status. Since v55.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `batch_size` | `batchSize` | query | integer |  | Number of segments to return at one time. Values are from `1` through `200`. If unspecified, the default value is `20`. Since v56.0. |
| `dataspace` | `dataspace` | query | string |  | Name of the data space in which to perform the action. User must have permission to this data space. Valid when bulk-listing segments. If unspecified, the `default` data space is used. Since v58.0. |
| `filters` | `filters` | query | string |  | Filter the result set to a more narrow scope based on segment attributes. Specify a maximum of 10 filters. Separate each filter by an AND logical operator. If unspecified, no filters are applied. These values are supported: - `LastPublishedEndDateTime` - Not present in the output type. Indicates the end date and time when the segment was last published. Use only the `!=` operator with this value. - `MarketSegmentType` - Matches field `segment_type`. - `Name` - Matches field `display_name`. - `SegmentOn` - Matches field `segment_on_api_name`. - `SegmentStatus` - Matches field `segment_status`. These operators are supported: - `contains` - Search operator for identifying strings or substrings within a field. - `eq` - Equality operator for identifying values that match exactly. - `in` - Comparison operator for determining whether a field matches one or more specified values. - `!=` - Inequality operator for determining values that don't match. These are examples of filter parameter specifications: - `filters=Name != NULL AND Name In Seg 01,seg 02 AND Name contains seg AND Name eq seg 01` - `filters=SegmentStatus != NULL AND SegmentStatus In Processing,Active AND SegmentStatus contains ive AND SegmentStatus eq active` - `filters=MarketSegmentType != NULL AND MarketSegmentType In UI,Dbt AND MarketSegmentType contains i AND MarketSegmentType eq UI` - `filters=SegmentOn != NULL AND SegmentOn In individual,account AND SegmentOn contains ual AND SegmentOn eq Account` - `filters=SegmentOn != NULL AND SegmentOn In individual,account AND SegmentOn contains nt AND SegmentOn eq Account` - `filters=LastPublishedEndDateTime != NULL` Since v65.0. |
| `offset` | `offset` | query | integer |  | Number of segments to skip before returning results. If unspecified, no segments are skipped. Since v56.0. |
| `order_by` | `orderby` | query | string |  | Sort order for the result set. Specify a field value followed by an optional sort order, `ASC` or `DESC`. For example, `Name ASC` sorts results by `Name` in ascending order, and `MarketSegmentType DESC` sorts results by `MarketSegmentType` in descending order. If unspecified, items are returned by ID in ascending order. Since v56.0. |
| `segment_creation_flow` | `segmentCreationFlow` | query | string |  | - |

```sql
CALL cdp.segment_list (dataspace => 'default', batch_size => 100, offset => 0, filters => 'SegmentStatus eq Active AND MarketSegmentType eq Dbt', order_by => 'Name ASC');
```

**Result**

One row per item of `/segments` in the response. Other response fields go to `_meta`: `batchSize`, `offset`, `orderByExpression`. Schema `CdpSegmentOutputRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `api_name` | `apiName` | VARCHAR | API name of the segment. Since v56.0. |
| `dataspace` | `dataSpace` | VARCHAR | Segment data space. In API version 59.0 and later, this property is not available. Use the `dataspace` request parameter instead. Since v57.0. |
| `description` | `description` | VARCHAR | Segment description. Since v55.0. |
| `developer_name` | `developerName` | VARCHAR | Segment developer name. Since v55.0. |
| `display_name` | `displayName` | VARCHAR | Segment display name. Since v57.0. |
| `exclude_criteria` | `excludeCriteria` | VARCHAR | Segment exclude criteria. Since v57.0. |
| `include_criteria` | `includeCriteria` | VARCHAR | Segment include criteria. Since v57.0. |
| `include_dbt` | `includeDbt` | JSON (CdpSegmentDbtPipelineOutputRepresentation) | Segment DBT pipeline. Since v55.0. |
| `last_published_end_date_time` | `lastPublishedEndDateTime` | VARCHAR | Segment last published end-date time. Since v63.0. |
| `last_segment_member_count` | `lastSegmentMemberCount` | BIGINT | Last segment member count. Since v63.0. |
| `lookalike_criteria` | `lookalikeCriteria` | JSON (CdpSegmentLookalikeOutputRepresentation) | Lookalike criteria for the segment. Since v56.0. |
| `lookback_period` | `lookbackPeriod` | VARCHAR | Lookback period of the segment. Since v62.0. |
| `market_segment_definition_id` | `marketSegmentDefinitionId` | VARCHAR | ID of the market segment definition. Since v55.0. |
| `market_segment_id` | `marketSegmentId` | VARCHAR | ID of the market segment. Since v56.0. |
| `next_publish_date_time` | `nextPublishDateTime` | VARCHAR | Date and time of the next segment publish. Since v57.0. |
| `parameters` | `parameters` | JSON (array of ParameterRepresentation) | Metadata for dynamic segment parameters. Since v63.0. |
| `publish_interval` | `publishInterval` | VARCHAR | Segment publish interval. Since v55.0. |
| `publish_schedule_end_date` | `publishScheduleEndDate` | VARCHAR | Publish schedule end date. Since v55.0. |
| `publish_schedule_end_date_time` | `publishScheduleEndDateTime` | VARCHAR | Publish schedule end-date time. Since v62.0. |
| `publish_schedule_info` | `publishScheduleInfo` | JSON | Additional information about the publish schedule. The endpoint returns the schedule output object that corresponds to the publish frequency: `Daily`, `Hourly`, `Minutely`, `Monthly`, `Monthly Relative`, `Weekly`, or `None`. For example, the Daily Schedule Output is returned for the `Daily` publish frequency. Since v63.0. |
| `publish_schedule_start_date_time` | `publishScheduleStartDateTime` | VARCHAR | Publish schedule start date time. Since v55.0. |
| `publish_status` | `publishStatus` | VARCHAR | Segment publish status. Since v55.0. |
| `segment_membership_dmo` | `segmentMembershipDmo` | JSON (CdpSegmentMembershipTableOutputRepresentation) | Segment membership tables. Since v58.0. |
| `segment_membership_table` | `segmentMembershipTable` | VARCHAR | Name of the segment membership table. Since v56.0. |
| `segment_on_api_name` | `segmentOnApiName` | VARCHAR | API name of the SegmentOn entity. Since v56.0. |
| `segment_on_data_graph` | `segmentOnDataGraph` | VARCHAR | Data graph ID of the SegmentOn entity. Since v58.0. |
| `segment_on_id` | `segmentOnId` | VARCHAR | ID of the DMO segment. Since v55.0. |
| `segment_status` | `segmentStatus` | VARCHAR | Segment status. Since v55.0. |
| `segment_type` | `segmentType` | VARCHAR | Type of segment. Since v56.0. |

**Paging:** `batch_size`, `offset` from 0 ([community](https://github.com/szymonlewandowski/config-snapshot-data360/blob/main/docs/api-quirks.md)).

**Token:** Core Salesforce token, not the Data 360 token. The spec says so for this call and `segment_create` only. See [Hosts and tokens](api_notes.md#hosts-and-tokens) for the wider source conflict.

**Notes:** **Ids:** rows have `api_name` for name-keyed calls. The [Retail kit](https://github.com/salesforce-misc/Data360AgentforceSolutionKitRetail/blob/main/.claude/skills/refresh-data-cloud-components/SKILL.md) warns that a row's `id` is null and that only the single GET has `market_segment_id` (one org), yet the spec's list example and the [hosted docs](https://developer.salesforce.com/docs/platform/hosted-mcp-servers/references/reference/data360-mcp.md) show `market_segment_id` on list rows.

**Filter and sort names aren't column names.** They use names such as `Name` and `MarketSegmentType`. Filter values in the spec are mixed-case (`Processing,Active`), while the column returns `PROCESSING` and `ACTIVE`.

**Spelling:** the spec's option is `orderby`, and the [MCP tool](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/SegmentTools.java) sends `orderBy`.

**Result:** the spec's list example, the [hosted docs](https://developer.salesforce.com/docs/platform/hosted-mcp-servers/references/reference/data360-mcp.md) and a [community note](https://github.com/szymonlewandowski/config-snapshot-data360/blob/main/docs/api-quirks.md) all show a `total_size` field that the spec's schema lacks. The schema says `dataspace` is gone from v59, yet the hosted docs' sample still returns it. `segment_status` values seen in the spec's examples are `ACTIVE`, `PROCESSING` and `COUNTING`. A [community note](https://github.com/szymonlewandowski/config-snapshot-data360/blob/main/docs/api-quirks.md) says page sizes aren't always honored across this API, so detect repeats.

## segment_get

`GET /ssot/segments/{segmentApiName}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Segments/paths/~1ssot~1segments~1%7BsegmentApiName%7D/get) · tool `d360_segment_get` · evidence O · read-only

Get one segment by its API name. Use it to check `segment_status` and `publish_status`, and to find `market_segment_id`. Since v56.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `segment_api_name` | `segmentApiName` | path | string | yes | The segment's `api_name`, not its `1sg` id. |
| `batch_size` | `batchSize` | query | integer |  | Maximum records to return. [Only applies with an API name](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/SegmentTools.java). |
| `dataspace` | `dataspace` | query | string |  | Data space name. [Only applies with an API name](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/SegmentTools.java). |
| `filters` | `filters` | query | string |  | Filter expression. [Only applies with an API name](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/SegmentTools.java). |
| `offset` | `offset` | query | integer |  | Records to skip. [Only applies with an API name](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/SegmentTools.java). |
| `order_by` | `orderby` | query | string |  | Field to order by. [Only applies with an API name](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/SegmentTools.java). |
| `segment_creation_flow` | `segmentCreationFlow` | query | string |  | - |

```sql
CALL cdp.segment_get (segment_api_name => 'High_Value_Order_Buyers', dataspace => 'default');
```

**Result**

One row per item of `/segments` in the response. Other response fields go to `_meta`: `batchSize`, `offset`, `orderByExpression`. Schema `CdpSegmentOutputRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `api_name` | `apiName` | VARCHAR | API name of the segment. Since v56.0. |
| `dataspace` | `dataSpace` | VARCHAR | Segment data space. In API version 59.0 and later, this property is not available. Use the `dataspace` request parameter instead. Since v57.0. |
| `description` | `description` | VARCHAR | Segment description. Since v55.0. |
| `developer_name` | `developerName` | VARCHAR | Segment developer name. Since v55.0. |
| `display_name` | `displayName` | VARCHAR | Segment display name. Since v57.0. |
| `exclude_criteria` | `excludeCriteria` | VARCHAR | Segment exclude criteria. Since v57.0. |
| `include_criteria` | `includeCriteria` | VARCHAR | Segment include criteria. Since v57.0. |
| `include_dbt` | `includeDbt` | JSON (CdpSegmentDbtPipelineOutputRepresentation) | Segment DBT pipeline. Since v55.0. |
| `last_published_end_date_time` | `lastPublishedEndDateTime` | VARCHAR | Segment last published end-date time. Since v63.0. |
| `last_segment_member_count` | `lastSegmentMemberCount` | BIGINT | Last segment member count. Since v63.0. |
| `lookalike_criteria` | `lookalikeCriteria` | JSON (CdpSegmentLookalikeOutputRepresentation) | Lookalike criteria for the segment. Since v56.0. |
| `lookback_period` | `lookbackPeriod` | VARCHAR | Lookback period of the segment. Since v62.0. |
| `market_segment_definition_id` | `marketSegmentDefinitionId` | VARCHAR | ID of the market segment definition. Since v55.0. |
| `market_segment_id` | `marketSegmentId` | VARCHAR | ID of the market segment. Since v56.0. |
| `next_publish_date_time` | `nextPublishDateTime` | VARCHAR | Date and time of the next segment publish. Since v57.0. |
| `parameters` | `parameters` | JSON (array of ParameterRepresentation) | Metadata for dynamic segment parameters. Since v63.0. |
| `publish_interval` | `publishInterval` | VARCHAR | Segment publish interval. Since v55.0. |
| `publish_schedule_end_date` | `publishScheduleEndDate` | VARCHAR | Publish schedule end date. Since v55.0. |
| `publish_schedule_end_date_time` | `publishScheduleEndDateTime` | VARCHAR | Publish schedule end-date time. Since v62.0. |
| `publish_schedule_info` | `publishScheduleInfo` | JSON | Additional information about the publish schedule. The endpoint returns the schedule output object that corresponds to the publish frequency: `Daily`, `Hourly`, `Minutely`, `Monthly`, `Monthly Relative`, `Weekly`, or `None`. For example, the Daily Schedule Output is returned for the `Daily` publish frequency. Since v63.0. |
| `publish_schedule_start_date_time` | `publishScheduleStartDateTime` | VARCHAR | Publish schedule start date time. Since v55.0. |
| `publish_status` | `publishStatus` | VARCHAR | Segment publish status. Since v55.0. |
| `segment_membership_dmo` | `segmentMembershipDmo` | JSON (CdpSegmentMembershipTableOutputRepresentation) | Segment membership tables. Since v58.0. |
| `segment_membership_table` | `segmentMembershipTable` | VARCHAR | Name of the segment membership table. Since v56.0. |
| `segment_on_api_name` | `segmentOnApiName` | VARCHAR | API name of the SegmentOn entity. Since v56.0. |
| `segment_on_data_graph` | `segmentOnDataGraph` | VARCHAR | Data graph ID of the SegmentOn entity. Since v58.0. |
| `segment_on_id` | `segmentOnId` | VARCHAR | ID of the DMO segment. Since v55.0. |
| `segment_status` | `segmentStatus` | VARCHAR | Segment status. Since v55.0. |
| `segment_type` | `segmentType` | VARCHAR | Type of segment. Since v56.0. |

**Paging:** `batch_size`, `offset`.

**Notes:** Same URL as [`segment_get_by_id`](#segment_get_by_id). The server tells a name from an id. The older spec copy has one path, `{segmentApiNameOrId}`, whose id form it dates to v65.0. Use this call to find `market_segment_id` for [`segment_publish`](#segment_publish).

The single segment still comes back [wrapped in `segments[]`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/references/data-shapes.md), which is why this has the same shape as the list. A missing segment [may be an empty array](https://github.com/salesforce-misc/Data360MedTechSolutionKit/blob/main/.claude/skills/refresh-data-cloud-components/SKILL.md). The spec's example also has `segment_membership_dmo`, with the `latestTable` and `historyTable` you can query. The paging and filter options come from the spec, whose descriptions are empty, and the [MCP tool](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/SegmentTools.java) says they apply only with an API name.

## segment_get_by_id

`GET /ssot/segments/{segmentId}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Segments/paths/~1ssot~1segments~1%7BsegmentId%7D/get) · tool `d360_segment_get` · evidence O · read-only

Get one segment by its `1sg` record id. Use it when you hold the id rather than the name. Since v56.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `segment_id` | `segmentId` | path | string | yes | The segment's `market_segment_id`, 18 characters starting with `1sg`. Not `market_segment_definition_id` (`3HX`) or `segment_on_id` (`0gj`). |
| `segment_creation_flow` | `segmentCreationFlow` | query | string |  | - |

```sql
CALL cdp.segment_get_by_id (segment_id => '1sgxx00000000PpAAI');
```

**Result**

One row per item of `/segments` in the response. Other response fields go to `_meta`: `batchSize`, `offset`, `orderByExpression`. Schema `CdpSegmentOutputRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `api_name` | `apiName` | VARCHAR | API name of the segment. Since v56.0. |
| `dataspace` | `dataSpace` | VARCHAR | Segment data space. In API version 59.0 and later, this property is not available. Use the `dataspace` request parameter instead. Since v57.0. |
| `description` | `description` | VARCHAR | Segment description. Since v55.0. |
| `developer_name` | `developerName` | VARCHAR | Segment developer name. Since v55.0. |
| `display_name` | `displayName` | VARCHAR | Segment display name. Since v57.0. |
| `exclude_criteria` | `excludeCriteria` | VARCHAR | Segment exclude criteria. Since v57.0. |
| `include_criteria` | `includeCriteria` | VARCHAR | Segment include criteria. Since v57.0. |
| `include_dbt` | `includeDbt` | JSON (CdpSegmentDbtPipelineOutputRepresentation) | Segment DBT pipeline. Since v55.0. |
| `last_published_end_date_time` | `lastPublishedEndDateTime` | VARCHAR | Segment last published end-date time. Since v63.0. |
| `last_segment_member_count` | `lastSegmentMemberCount` | BIGINT | Last segment member count. Since v63.0. |
| `lookalike_criteria` | `lookalikeCriteria` | JSON (CdpSegmentLookalikeOutputRepresentation) | Lookalike criteria for the segment. Since v56.0. |
| `lookback_period` | `lookbackPeriod` | VARCHAR | Lookback period of the segment. Since v62.0. |
| `market_segment_definition_id` | `marketSegmentDefinitionId` | VARCHAR | ID of the market segment definition. Since v55.0. |
| `market_segment_id` | `marketSegmentId` | VARCHAR | ID of the market segment. Since v56.0. |
| `next_publish_date_time` | `nextPublishDateTime` | VARCHAR | Date and time of the next segment publish. Since v57.0. |
| `parameters` | `parameters` | JSON (array of ParameterRepresentation) | Metadata for dynamic segment parameters. Since v63.0. |
| `publish_interval` | `publishInterval` | VARCHAR | Segment publish interval. Since v55.0. |
| `publish_schedule_end_date` | `publishScheduleEndDate` | VARCHAR | Publish schedule end date. Since v55.0. |
| `publish_schedule_end_date_time` | `publishScheduleEndDateTime` | VARCHAR | Publish schedule end-date time. Since v62.0. |
| `publish_schedule_info` | `publishScheduleInfo` | JSON | Additional information about the publish schedule. The endpoint returns the schedule output object that corresponds to the publish frequency: `Daily`, `Hourly`, `Minutely`, `Monthly`, `Monthly Relative`, `Weekly`, or `None`. For example, the Daily Schedule Output is returned for the `Daily` publish frequency. Since v63.0. |
| `publish_schedule_start_date_time` | `publishScheduleStartDateTime` | VARCHAR | Publish schedule start date time. Since v55.0. |
| `publish_status` | `publishStatus` | VARCHAR | Segment publish status. Since v55.0. |
| `segment_membership_dmo` | `segmentMembershipDmo` | JSON (CdpSegmentMembershipTableOutputRepresentation) | Segment membership tables. Since v58.0. |
| `segment_membership_table` | `segmentMembershipTable` | VARCHAR | Name of the segment membership table. Since v56.0. |
| `segment_on_api_name` | `segmentOnApiName` | VARCHAR | API name of the SegmentOn entity. Since v56.0. |
| `segment_on_data_graph` | `segmentOnDataGraph` | VARCHAR | Data graph ID of the SegmentOn entity. Since v58.0. |
| `segment_on_id` | `segmentOnId` | VARCHAR | ID of the DMO segment. Since v55.0. |
| `segment_status` | `segmentStatus` | VARCHAR | Segment status. Since v55.0. |
| `segment_type` | `segmentType` | VARCHAR | Type of segment. Since v56.0. |

**Notes:** Same URL as [`segment_get`](#segment_get). It differs only in what you pass. The [MCP tool](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/SegmentTools.java) says filter parameters have no effect with an id, which matches the spec listing none here. The result is still [wrapped in `segments[]`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/references/data-shapes.md).

The [hosted server](https://developer.salesforce.com/docs/platform/hosted-mcp-servers/references/reference/data360-mcp.md) has a tool `d360_segment_get_by_id`. The open-source server has one `d360_segment_get` for both.

## segment_member_list

`GET /ssot/segments/{segmentApiName}/members` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Segments/paths/~1ssot~1segments~1%7BsegmentApiName%7D~1members/get) · evidence O · read-only

Get segment members in Data 360. Since v58.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `segment_api_name` | `segmentApiName` | path | string | yes | The segment's `api_name`, not its `1sg` id. |
| `fields` | `fields` | query | array of string |  | Comma-separated list of field names that you want to include in the result. If unspecified, `Id__c` is returned. Supported fields are: - `Delta_Type__c` - `Id__c` - `KQ_Id__c` - `Parent_Segment_Id__c` - `Segment_Id__c` - `Snapshot_Type__c` - `Timestamp__c` - `Version_Stamp__c` Since v58.0. |
| `filters` | `filters` | query | string |  | Filter the result set to a more narrow scope or specific type, for example, `Delta_Type__c IN ('New','Existing')`. When you filter for `Delta_Type__c`, we recommend that you also filter for `Timestamp__c`, for example, `Delta_Type__c IN ('New','Existing') AND Timestamp__c IN 2025-04-09T14:12:41.111Z`. Otherwise, the getSegmentMembers record is returned for the latest publish date; if the segment is not published, an empty result is returned. Since v58.0. |
| `limit` | `limit` | query | integer |  | Maximum number of rows to return from `1` through `1000`. If unspecified, the default number of rows is `100`. Since v58.0. |
| `offset` | `offset` | query | integer |  | Number of rows to skip before returning results. If unspecified, no rows are skipped. Since v58.0. |
| `order_by` | `orderBy` | query | string |  | Sort order for the result set, such as `Segment_Id__c ASC` or `Timestamp__c DESC`. If unspecified, items are returned by ID in ascending order. Supported fields for sorting are: - `Delta_Type__c` - `Id__c` - `KQ_Id__c` - `Parent_Segment_Id__c` - `Segment_Id__c` - `Snapshot_Type__c` - `Timestamp__c` - `Version_Stamp__c` Since v58.0. |

```sql
CALL cdp.segment_member_list (segment_api_name => 'High_Value_Order_Buyers', fields => ['Id__c', 'KQ_Id__c', 'Timestamp__c'], limit => 100, offset => 0);
```

**Result**

One row per item of `/data` in the response. Other response fields go to `_meta`: `endTime`, `filter`, `limit`, `nextPageUrl`, `offSet`, `orderBy`, `rowCount`, `startTime`, `totalCount`. Schema `CdpSegmentMemberRowOutputRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `delta_type` | `deltaType` | VARCHAR | Delta type, for example, `new`, `existing`, or `removed`. Since v58.0. |
| `id` | `id` | VARCHAR | Segment member ID. Since v58.0. |
| `kq_id` | `kqId` | VARCHAR | Fully qualified key ID. Since v58.0. |
| `snapshot_type` | `snapshotType` | VARCHAR | Type of snapshot. Valid value: `full`. Since v58.0. |
| `timestamp` | `timestamp` | VARCHAR | Timestamp. Since v58.0. |
| `version_stamp` | `versionStamp` | VARCHAR | Version timestamp. Since v58.0. |

**Paging:** `next_page_url`.

**Notes:** **Key:** `api_name`, as in the [kit's Apex class](https://github.com/salesforce-misc/Data360AgentforceSolutionKitRetail/blob/main/diy-pd-pack/main/default/classes/GetCustomersFromSegment.cls).

**Result:** members are in the `data` JSON column, not one row each. Their keys are `delta_type`, `id`, `kq_id`, `snapshot_type`, `timestamp` and `version_stamp`, although `fields`, `filters` and `order_by` use names like `Delta_Type__c` and `Id__c`.

**Unpublished segments:** per the spec, an unpublished segment returns an empty result, so empty doesn't mean no members.

**Readable details:** a community skill notes that [members are opaque ids and recommends SQL joins](https://github.com/Jaganpro/sf-skills/blob/main/skills/sf-datacloud-segment/SKILL.md) (community). `segment_get` gives the membership table in `segment_membership_dmo.latestTable`.

## segment_update

`PATCH /ssot/segments/{segmentApiName}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Segments/paths/~1ssot~1segments~1%7BsegmentApiName%7D/patch) · tool `d360_segment_update` · evidence O · changes org state

Update a segment by API name. The spec subjects `sql` to the [DBT validations](https://developer.salesforce.com/docs/data/connectapi/guide/features_cdp_dbt_validations.md), but sources disagree on whether SQL can change. Since v56.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `segment_api_name` | `segmentApiName` | path | string | yes | The segment's `api_name`, not its `1sg` id. |
| `additional_metadata` | `additionalMetadata` | body | map to string |  | Map of additional metadata. Optional for POST. Not supported for PATCH. Since v55.0. |
| `component_template_name` | `componentTemplateName` | body | string |  | Component template mame for the segment. Since v63.0. |
| `data_kit_dev_name` | `dataKitDevName` | body | string |  | Data kit name for the segment. Since v63.0. |
| `dataspace` | `dataSpace` | body | string |  | Segment data space. In API version 59.0 and later, this property is not available. Use the `dataspace` request parameter instead. Since v57.0. |
| `description` | `description` | body | string | yes | Segment description. Since v55.0. |
| `developer_name` | `developerName` | body | string |  | Segment developer name. Required for POST. Not supported for PATCH. Since v55.0. |
| `display_name` | `displayName` | body | string | yes | Segment display name. Since v57.0. |
| `einstein_gpt_segments_ui_criteria` | `einsteinGptSegmentsUICriteria` | body | [CdpSegmentEinsteinGptSegmentsUIInput](#cdpsegmenteinsteingptsegmentsuiinputrepresentation) |  | Einstein Gpt Segments UI segment criteria. Since v58.0. |
| `exclude_criteria` | `excludeCriteria` | body | string |  | Exclude criteria for the segment. Since v60.0. |
| `group_sort_limit_filter_criteria` | `groupSortLimitFilterCriteria` | body | string |  | Group sort limit criteria. Since v64.0. |
| `include_criteria` | `includeCriteria` | body | string |  | Include criteria for the segment. Since v60.0. |
| `include_dbt` | `includeDbt` | body | [CdpSegmentDbtInput](#cdpsegmentdbtinputrepresentation) |  | Segment data build tool (DBT). Since v55.0. |
| `lookalike_criteria` | `lookalikeCriteria` | body | [CdpSegmentLookalikeInput](#cdpsegmentlookalikeinputrepresentation) |  | Lookalike criteria for the segment. Since v56.0. |
| `lookback_period` | `lookbackPeriod` | body | string |  | Lookback period for the segment. Since v62.0. |
| `publish_schedule` | `publishSchedule` | body | enum(NoRefresh, One, Two, Four, Six, Twelve, TwentyFour) |  | Publish refresh schedule (in hours). `One` and `Four` are used to rapidly publish UI and DBT-based segments. Since v55.0. |
| `publish_schedule_end_date` | `publishScheduleEndDate` | body | string |  | Date indicating the end of the publish schedule. Optional if `publish_schedule` is unspecified. Since v55.0. |
| `publish_schedule_end_date_time` | `publishScheduleEndDateTime` | body | string |  | Datetime indicating the end of the publish schedule. **Availble Version:** 55.0 |
| `publish_schedule_info` | `publishScheduleInfo` | body | one of [DailyScheduleInput](#dailyscheduleinputrepresentation), [CdpHourlyScheduleInput](#cdphourlyscheduleinputrepresentation), [CdpMinutelyScheduleInput](#cdpminutelyscheduleinputrepresentation), [MonthlySpecificScheduleInput](#monthlyspecificscheduleinputrepresentation), [CdpMonthlyRelativeScheduleInput](#cdpmonthlyrelativescheduleinputrepresentation), [WeeklyScheduleInput](#weeklyscheduleinputrepresentation), [CdpNoneScheduleInput](#cdpnonescheduleinputrepresentation) |  | Additional information about the publish schedule. Use the schedule input object that corresponds to the publish frequency: `Daily`, `Hourly`, `Minutely`, `Monthly`, `Monthly Relative`, `Weekly`, or `None`. For example, use the Daily Schedule Input for the `Daily` publish frequency. Since v63.0. |
| `publish_schedule_start_date_time` | `publishScheduleStartDateTime` | body | string |  | Datetime indicating the start of the publish schedule. Optional if `publish_schedule` is unspecified. Since v55.0. |
| `segment_creation_flow` | `segmentCreationFlow` | body | enum(Datakit, EinsteinGpt, Headless, Visual) |  | Creation flow for the segment. Since v61.0. |
| `segment_on_api_name` | `segmentOnApiName` | body | string | yes | API name of the SegmentOn entity. Since v57.0. |
| `segment_on_data_graph` | `segmentOnDataGraph` | body | string |  | Data graph of the SegmentOn entity for real-time segments. Since v60.0. |
| `segment_type` | `segmentType` | body | enum(Dbt, Dynamic, EinsteinGptSegmentsUI, Lookalike, Realtimez, Waterfall) | yes | Type of segment. `Dbt` is data build tool. Required for POST. Not supported for PATCH. After a segment is created, the segment type can't be changed. Since v55.0. |

```sql
CALL cdp.segment_update (segment_api_name => 'High_Value_Order_Buyers', display_name => 'High Value Order Buyers', description => 'Refreshed every 24 hours', segment_on_api_name => 'Individuals__dlm', segment_type => 'Dbt', publish_schedule => 'TwentyFour');
```

**Result**

One row. Schema `CdpSegmentOutputRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `api_name` | `apiName` | VARCHAR | API name of the segment. Since v56.0. |
| `dataspace` | `dataSpace` | VARCHAR | Segment data space. In API version 59.0 and later, this property is not available. Use the `dataspace` request parameter instead. Since v57.0. |
| `description` | `description` | VARCHAR | Segment description. Since v55.0. |
| `developer_name` | `developerName` | VARCHAR | Segment developer name. Since v55.0. |
| `display_name` | `displayName` | VARCHAR | Segment display name. Since v57.0. |
| `exclude_criteria` | `excludeCriteria` | VARCHAR | Segment exclude criteria. Since v57.0. |
| `include_criteria` | `includeCriteria` | VARCHAR | Segment include criteria. Since v57.0. |
| `include_dbt` | `includeDbt` | JSON (CdpSegmentDbtPipelineOutputRepresentation) | Segment DBT pipeline. Since v55.0. |
| `last_published_end_date_time` | `lastPublishedEndDateTime` | VARCHAR | Segment last published end-date time. Since v63.0. |
| `last_segment_member_count` | `lastSegmentMemberCount` | BIGINT | Last segment member count. Since v63.0. |
| `lookalike_criteria` | `lookalikeCriteria` | JSON (CdpSegmentLookalikeOutputRepresentation) | Lookalike criteria for the segment. Since v56.0. |
| `lookback_period` | `lookbackPeriod` | VARCHAR | Lookback period of the segment. Since v62.0. |
| `market_segment_definition_id` | `marketSegmentDefinitionId` | VARCHAR | ID of the market segment definition. Since v55.0. |
| `market_segment_id` | `marketSegmentId` | VARCHAR | ID of the market segment. Since v56.0. |
| `next_publish_date_time` | `nextPublishDateTime` | VARCHAR | Date and time of the next segment publish. Since v57.0. |
| `parameters` | `parameters` | JSON (array of ParameterRepresentation) | Metadata for dynamic segment parameters. Since v63.0. |
| `publish_interval` | `publishInterval` | VARCHAR | Segment publish interval. Since v55.0. |
| `publish_schedule_end_date` | `publishScheduleEndDate` | VARCHAR | Publish schedule end date. Since v55.0. |
| `publish_schedule_end_date_time` | `publishScheduleEndDateTime` | VARCHAR | Publish schedule end-date time. Since v62.0. |
| `publish_schedule_info` | `publishScheduleInfo` | JSON | Additional information about the publish schedule. The endpoint returns the schedule output object that corresponds to the publish frequency: `Daily`, `Hourly`, `Minutely`, `Monthly`, `Monthly Relative`, `Weekly`, or `None`. For example, the Daily Schedule Output is returned for the `Daily` publish frequency. Since v63.0. |
| `publish_schedule_start_date_time` | `publishScheduleStartDateTime` | VARCHAR | Publish schedule start date time. Since v55.0. |
| `publish_status` | `publishStatus` | VARCHAR | Segment publish status. Since v55.0. |
| `segment_membership_dmo` | `segmentMembershipDmo` | JSON (CdpSegmentMembershipTableOutputRepresentation) | Segment membership tables. Since v58.0. |
| `segment_membership_table` | `segmentMembershipTable` | VARCHAR | Name of the segment membership table. Since v56.0. |
| `segment_on_api_name` | `segmentOnApiName` | VARCHAR | API name of the SegmentOn entity. Since v56.0. |
| `segment_on_data_graph` | `segmentOnDataGraph` | VARCHAR | Data graph ID of the SegmentOn entity. Since v58.0. |
| `segment_on_id` | `segmentOnId` | VARCHAR | ID of the DMO segment. Since v55.0. |
| `segment_status` | `segmentStatus` | VARCHAR | Segment status. Since v55.0. |
| `segment_type` | `segmentType` | VARCHAR | Type of segment. Since v56.0. |

**Notes:** **Key:** `api_name` only, not the id.

**Required options:** these flags come from the input schema it shares with create, and they contradict its text. The spec marks `segment_type` required and also says "Not supported for PATCH", while its own example still sends it. The [MCP class](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/model/request/segment/SegmentUpdateRequest.java) makes every field optional. The example follows the spec. `developer_name` and `additional_metadata` are also "Not supported for PATCH".

**SQL:** sources disagree on whether `include_dbt` can change. The spec says `sql` is validated on update, and its example sends one. The [catalog](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/runtime/FamilyCatalog.java) says "Cannot change SQL via PATCH".

**Data space:** the spec has no `dataspace` query option here, and its `dataSpace` body field points to a parameter this call doesn't list. The [MCP tool](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/SegmentTools.java) sends `dataspace` as a query parameter.

## segment_create

`POST /ssot/segments` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Segments/paths/~1ssot~1segments/post) · tool `d360_segment_create` · evidence O · host core · changes org state

Create a segment. The `sql` of a `Dbt` segment is subject to the [DBT validations](https://developer.salesforce.com/docs/data/connectapi/guide/features_cdp_dbt_validations.md). Since v55.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `dataspace` | `dataspace` | query | string |  | Name of the data space in which to perform the action. User must have permission to this data space. If unspecified, the `default` data space is used. - In API version 58.0, if specified, this parameter overrides the `dataspace` request body property. If this parameter is unspecified, the `dataspace` request body parameter is used. - In API version 58.0, if neither this parameter nor the `dataspace` request body property is specified, the `default` data space is used. - In API version 59.0 and later, use this parameter. The `dataspace` request body property is not available. Since v58.0. |
| `additional_metadata` | `additionalMetadata` | body | map to string |  | Map of additional metadata. Optional for POST. Not supported for PATCH. Since v55.0. |
| `component_template_name` | `componentTemplateName` | body | string |  | Component template mame for the segment. Since v63.0. |
| `data_kit_dev_name` | `dataKitDevName` | body | string |  | Data kit name for the segment. Since v63.0. |
| `body_dataspace` | `dataSpace` | body | string |  | Segment data space. In API version 59.0 and later, this property is not available. Use the `dataspace` request parameter instead. Since v57.0. |
| `description` | `description` | body | string | yes | Segment description. Since v55.0. |
| `developer_name` | `developerName` | body | string |  | Segment developer name. Required for POST. Not supported for PATCH. Since v55.0. |
| `display_name` | `displayName` | body | string | yes | Segment display name. Since v57.0. |
| `einstein_gpt_segments_ui_criteria` | `einsteinGptSegmentsUICriteria` | body | [CdpSegmentEinsteinGptSegmentsUIInput](#cdpsegmenteinsteingptsegmentsuiinputrepresentation) |  | Einstein Gpt Segments UI segment criteria. Since v58.0. |
| `exclude_criteria` | `excludeCriteria` | body | string |  | Exclude criteria for the segment. Since v60.0. |
| `group_sort_limit_filter_criteria` | `groupSortLimitFilterCriteria` | body | string |  | Group sort limit criteria. Since v64.0. |
| `include_criteria` | `includeCriteria` | body | string |  | Include criteria for the segment. Since v60.0. |
| `include_dbt` | `includeDbt` | body | [CdpSegmentDbtInput](#cdpsegmentdbtinputrepresentation) |  | Segment data build tool (DBT). Since v55.0. |
| `lookalike_criteria` | `lookalikeCriteria` | body | [CdpSegmentLookalikeInput](#cdpsegmentlookalikeinputrepresentation) |  | Lookalike criteria for the segment. Since v56.0. |
| `lookback_period` | `lookbackPeriod` | body | string |  | Lookback period for the segment. Since v62.0. |
| `publish_schedule` | `publishSchedule` | body | enum(NoRefresh, One, Two, Four, Six, Twelve, TwentyFour) |  | Publish refresh schedule (in hours). `One` and `Four` are used to rapidly publish UI and DBT-based segments. Since v55.0. |
| `publish_schedule_end_date` | `publishScheduleEndDate` | body | string |  | Date indicating the end of the publish schedule. Optional if `publish_schedule` is unspecified. Since v55.0. |
| `publish_schedule_end_date_time` | `publishScheduleEndDateTime` | body | string |  | Datetime indicating the end of the publish schedule. **Availble Version:** 55.0 |
| `publish_schedule_info` | `publishScheduleInfo` | body | one of [DailyScheduleInput](#dailyscheduleinputrepresentation), [CdpHourlyScheduleInput](#cdphourlyscheduleinputrepresentation), [CdpMinutelyScheduleInput](#cdpminutelyscheduleinputrepresentation), [MonthlySpecificScheduleInput](#monthlyspecificscheduleinputrepresentation), [CdpMonthlyRelativeScheduleInput](#cdpmonthlyrelativescheduleinputrepresentation), [WeeklyScheduleInput](#weeklyscheduleinputrepresentation), [CdpNoneScheduleInput](#cdpnonescheduleinputrepresentation) |  | Additional information about the publish schedule. Use the schedule input object that corresponds to the publish frequency: `Daily`, `Hourly`, `Minutely`, `Monthly`, `Monthly Relative`, `Weekly`, or `None`. For example, use the Daily Schedule Input for the `Daily` publish frequency. Since v63.0. |
| `publish_schedule_start_date_time` | `publishScheduleStartDateTime` | body | string |  | Datetime indicating the start of the publish schedule. Optional if `publish_schedule` is unspecified. Since v55.0. |
| `segment_creation_flow` | `segmentCreationFlow` | body | enum(Datakit, EinsteinGpt, Headless, Visual) |  | Creation flow for the segment. Since v61.0. |
| `segment_on_api_name` | `segmentOnApiName` | body | string | yes | API name of the SegmentOn entity. Since v57.0. |
| `segment_on_data_graph` | `segmentOnDataGraph` | body | string |  | Data graph of the SegmentOn entity for real-time segments. Since v60.0. |
| `segment_type` | `segmentType` | body | enum(Dbt, Dynamic, EinsteinGptSegmentsUI, Lookalike, Realtimez, Waterfall) | yes | Type of segment. `Dbt` is data build tool. Required for POST. Not supported for PATCH. After a segment is created, the segment type can't be changed. Since v55.0. |

```sql
CALL cdp.segment_create (
  dataspace => 'default',
  developer_name => 'High_Value_Order_Buyers',
  display_name => 'High Value Order Buyers',
  description => 'Individuals with at least one order over 5000',
  segment_on_api_name => 'Individuals__dlm',
  segment_type => 'Dbt',
  publish_schedule => 'NoRefresh',
  include_dbt => (models = (models = [(
    name = 'high_value_order_buyers',
    sql = (
      SELECT DISTINCT Individuals__dlm.IndividualId__c, Individuals__dlm.KQ_IndividualId__c
      FROM Individuals__dlm
      JOIN SalesOrders__dlm ON Individuals__dlm.IndividualId__c = SalesOrders__dlm.IndividualId__c
      WHERE (Individuals__dlm.KQ_IndividualId__c = SalesOrders__dlm.KQ_IndividualId__c
             OR (Individuals__dlm.KQ_IndividualId__c IS NULL AND SalesOrders__dlm.KQ_IndividualId__c IS NULL))
        AND trim(cast(Individuals__dlm.IndividualId__c as varchar(255))) <> ''
        AND SalesOrders__dlm.TotalAmount__c IS NOT NULL
        AND SalesOrders__dlm.TotalAmount__c > 5000
    )
  )]))
);
```

**Result**

One row. Schema `CdpSegmentOutputRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `api_name` | `apiName` | VARCHAR | API name of the segment. Since v56.0. |
| `dataspace` | `dataSpace` | VARCHAR | Segment data space. In API version 59.0 and later, this property is not available. Use the `dataspace` request parameter instead. Since v57.0. |
| `description` | `description` | VARCHAR | Segment description. Since v55.0. |
| `developer_name` | `developerName` | VARCHAR | Segment developer name. Since v55.0. |
| `display_name` | `displayName` | VARCHAR | Segment display name. Since v57.0. |
| `exclude_criteria` | `excludeCriteria` | VARCHAR | Segment exclude criteria. Since v57.0. |
| `include_criteria` | `includeCriteria` | VARCHAR | Segment include criteria. Since v57.0. |
| `include_dbt` | `includeDbt` | JSON (CdpSegmentDbtPipelineOutputRepresentation) | Segment DBT pipeline. Since v55.0. |
| `last_published_end_date_time` | `lastPublishedEndDateTime` | VARCHAR | Segment last published end-date time. Since v63.0. |
| `last_segment_member_count` | `lastSegmentMemberCount` | BIGINT | Last segment member count. Since v63.0. |
| `lookalike_criteria` | `lookalikeCriteria` | JSON (CdpSegmentLookalikeOutputRepresentation) | Lookalike criteria for the segment. Since v56.0. |
| `lookback_period` | `lookbackPeriod` | VARCHAR | Lookback period of the segment. Since v62.0. |
| `market_segment_definition_id` | `marketSegmentDefinitionId` | VARCHAR | ID of the market segment definition. Since v55.0. |
| `market_segment_id` | `marketSegmentId` | VARCHAR | ID of the market segment. Since v56.0. |
| `next_publish_date_time` | `nextPublishDateTime` | VARCHAR | Date and time of the next segment publish. Since v57.0. |
| `parameters` | `parameters` | JSON (array of ParameterRepresentation) | Metadata for dynamic segment parameters. Since v63.0. |
| `publish_interval` | `publishInterval` | VARCHAR | Segment publish interval. Since v55.0. |
| `publish_schedule_end_date` | `publishScheduleEndDate` | VARCHAR | Publish schedule end date. Since v55.0. |
| `publish_schedule_end_date_time` | `publishScheduleEndDateTime` | VARCHAR | Publish schedule end-date time. Since v62.0. |
| `publish_schedule_info` | `publishScheduleInfo` | JSON | Additional information about the publish schedule. The endpoint returns the schedule output object that corresponds to the publish frequency: `Daily`, `Hourly`, `Minutely`, `Monthly`, `Monthly Relative`, `Weekly`, or `None`. For example, the Daily Schedule Output is returned for the `Daily` publish frequency. Since v63.0. |
| `publish_schedule_start_date_time` | `publishScheduleStartDateTime` | VARCHAR | Publish schedule start date time. Since v55.0. |
| `publish_status` | `publishStatus` | VARCHAR | Segment publish status. Since v55.0. |
| `segment_membership_dmo` | `segmentMembershipDmo` | JSON (CdpSegmentMembershipTableOutputRepresentation) | Segment membership tables. Since v58.0. |
| `segment_membership_table` | `segmentMembershipTable` | VARCHAR | Name of the segment membership table. Since v56.0. |
| `segment_on_api_name` | `segmentOnApiName` | VARCHAR | API name of the SegmentOn entity. Since v56.0. |
| `segment_on_data_graph` | `segmentOnDataGraph` | VARCHAR | Data graph ID of the SegmentOn entity. Since v58.0. |
| `segment_on_id` | `segmentOnId` | VARCHAR | ID of the DMO segment. Since v55.0. |
| `segment_status` | `segmentStatus` | VARCHAR | Segment status. Since v55.0. |
| `segment_type` | `segmentType` | VARCHAR | Type of segment. Since v56.0. |
| `last_modified_date` | `lastModifiedDate` | VARCHAR | Not in the spec schema: from the spec's examples. |

**Done when:** `segment_get.segment_status` is `ACTIVE`, which the [catalog](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/runtime/FamilyCatalog.java) says to check. Create returns [`PROCESSING`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/references/data-shapes.md). The sources read give no timing or failure value.

**Token:** Core Salesforce token, not the Data 360 token. The spec says so for this call and `segment_list` only. See [Hosts and tokens](api_notes.md#hosts-and-tokens) for the wider source conflict.

**Notes:** **SQL:** the validation rules, rejection messages and canonical shapes are in [Segment SQL](api_notes.md#segment-sql). The [DBT validation guide](https://developer.salesforce.com/docs/data/connectapi/guide/features_cdp_dbt_validations.md) and the [tool text](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/SegmentTools.java) disagree on several rules, listed under [Source conflicts](api_notes.md#source-conflicts). `sql = (SELECT ...)` is parsed by DashQL and sent as written. Use `sql = $$ ... $$` for SQL DashQL's grammar can't parse.

**Nesting:** the spec's schema types `include_dbt.models` as an array, but the spec's own request examples, the [tool text](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/SegmentTools.java), the [request class](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/model/request/segment/SegmentDbtInput.java) and [sf-pi](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/references/data-shapes.md) all use `models = (models = [...])`. sf-pi says a flat array fails with `Can not deserialize: unexpected array`. The response uses the flat form.

**Required options:** the spec's required list omits `developer_name`, yet its description says "Required for POST", and an empty one is a 400. The [request class](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/model/request/segment/SegmentCreateRequest.java) and [sf-pi](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/references/data-shapes.md) require it, while the spec's Waterfall request examples leave it out. Send it. The [tool text](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/SegmentTools.java) treats it as the API name. `description` is required by the spec and sf-pi but missing from the tool text's shape, so send that too.

**Prerequisites:** calculated insights the segment filters on [must be `ACTIVE`](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/SegmentTools.java). `segment_on_api_name` must be a DMO with [`is_segmentable: true`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/references/data-shapes.md).

**Data space:** use `dataspace`. It's a [query parameter, "NOT a body field"](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/SegmentTools.java). `body_dataspace` only matters on v58 or earlier: on v58 the query parameter overrides it, and the spec removes it from v59.

**`segment_creation_flow`:** the [tool text](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/SegmentTools.java) says not to set it for `Dbt` segments, while [sf-pi](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/references/data-shapes.md) sends `Visual` for SQL-only segments. The spec lists `Headless`, which the older spec copy, the [request class](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/model/request/segment/SegmentCreateRequest.java) and sf-pi don't. The example follows the tool text.

**Segment types:** the tool text says other types "use their own criteria fields" without naming them. This table is read from the spec's field descriptions:

| `segment_type` | Definition option | What's known |
|---|---|---|
| `Dbt` | `include_dbt` | Fully covered above |
| `Lookalike` | `lookalike_criteria = (seed_segment_name = ..., additional_population = ...)` | The spec's schema. The seed is a segment name |
| `EinsteinGptSegmentsUI` | `einstein_gpt_segments_ui_criteria = (include_criteria = ...)` | The spec's schema. No format documented |
| `Realtimez` | `segment_on_data_graph`, with criteria unknown | The spec describes that field as "for real-time segments" |
| `Dynamic`, `Waterfall` | `include_criteria`, `exclude_criteria` | No public source documents the input format. The spec's Waterfall examples send no criteria |

`Realtimez` is the spelling in the spec and sf-pi. The [request class](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/model/request/segment/SegmentCreateRequest.java) says `Realtime` and `Ui`. The spec has a request example with `UI`, and [sf-pi](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/references/data-shapes.md) says `Ui` is rejected on current versions. On read-back, a DBT `include_criteria` is HTML-escaped `DbtPipeline` XML in the spec's examples, and other segments have [HTML-escaped JSON](https://github.com/szymonlewandowski/config-snapshot-data360/blob/main/docs/api-quirks.md) (community, one org).

**Publish schedule:** `publish_schedule` is the refresh interval in hours, or `NoRefresh`. `publish_schedule_info` is the finer form (since v63), and the spec's examples use it without `publish_schedule`:

```sql
CALL cdp.segment_create (
  developer_name => 'Daily_Refresh', display_name => 'Daily Refresh', description => 'Every 12 hours on three weekdays',
  segment_on_api_name => 'ssot__Account__dlm', segment_type => 'Waterfall',
  publish_schedule_start_date_time => '2026-03-10T23:59:59.999Z',
  publish_schedule_end_date_time => '2026-03-20T23:59:59.999Z',
  publish_schedule_info => (interval = 12, frequency = 'Daily',
    days_of_week = (daysOfWeek = ['Monday', 'Tuesday', 'Wednesday'])));
```

Those examples wrap the list twice, `days_of_week = (days_of_week = [...])` and `days_of_month = (days_of_month = [-1])`. The older spec copy's Daily schedule schema shows a flat array, and responses are flat. A rapid publish adds `run_from = (hour = 9, minute = 0, time_zone = 'UTC')` and `run_to`. The [MCP class](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/model/request/segment/SegmentScheduleInput.java) models something else again: `definition_name`, `frequency` and `time_info`. On read-back, `publish_interval` is `NO_REFRESH`, `ONE`, `TWELVE`, and the spec's examples show both `TWENTY_FOUR` and `TWENTYFOUR`.

**Retries:** don't retry blindly. The older spec copy documents 409 "Segment already exists".

**API version:** a community skill says to [use v64.0 when creation is unstable on newer defaults](https://github.com/Jaganpro/sf-skills/blob/main/skills/sf-datacloud-segment/SKILL.md) (community).

## segment_count

`POST /ssot/segments/{segmentApiName}/actions/count` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Segments/paths/~1ssot~1segments~1%7BsegmentApiName%7D~1actions~1count/post) · evidence O · changes org state

Trigger a segment count on demand. Since v61.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `segment_api_name` | `segmentApiName` | path | string | yes | The segment's `api_name`, not its `1sg` id. |
| `prefer_approx_count` | `preferApproxCount` | body | boolean | yes | Indicates whether to use approximate count (`true`) or not (`false`). Approximate Segment Population feature must be enabled to set the value as (`true`). Since v61.0. |

```sql
CALL cdp.segment_count (segment_api_name => 'High_Value_Order_Buyers', prefer_approx_count => false);
```

**Result**

One row. Schema `CdpSegmentActionOutputRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `errors` | `errors` | JSON (array of CdpErrorRepresentation) | List of errors that resulted from the action. Since v57.0. |
| `success` | `success` | BOOLEAN | Indicates whether the action was initiated successfully (`true`) or not (`false`). Since v57.0. |
| `job_id` | `jobId` | VARCHAR | Job ID for the publish job. Returned only for publishSegment resource. Since v56.0. |
| `partition_id` | `partitionId` | VARCHAR | ID of the partition. Returned only for publishSegment resource. Since v56.0. |
| `publish_status` | `publishStatus` | VARCHAR | Publish status of the segment. Returned only for publishSegment resource. Since v57.0. |
| `segment_api_name` | `segmentApiName` | VARCHAR | API name of the segment. Returned only for deactivateSegmentByName and deactivateSegmentById resources. Since v56.0. |
| `segment_id` | `segmentId` | VARCHAR | ID of the segment. Since v56.0. |

**Done when:** Not documented. The spec's list example shows `segment_status` `COUNTING`, so polling `segment_get` until it changes is an inference.

**Notes:** **The result has no count.** The spec's example returns only `errors`, `segment_id` and `success`. `last_segment_member_count` on [`segment_get`](#segment_get) is the only count column, and no source says this call updates it.

**Read-only:** the header says read-only, but it starts a job. [sf-pi](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/references/phases/segment.md) classes it as a safe POST.

**Timing:** [sf-pi](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/references/data-shapes.md) says count and deactivate fail on a new segment with `INTERNAL_ERROR: We couldn't trigger async count` or `We couldn't publish your segment`, so poll `segment_status` first.

**Approximate counts:** `prefer_approx_count => true` needs the Approximate Segment Population feature, so the example sends `false`.

## segment_deactivate

`POST /ssot/segments/{segmentApiName}/actions/deactivate` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Segments/paths/~1ssot~1segments~1%7BsegmentApiName%7D~1actions~1deactivate/post) · tool `d360_segment_deactivate` · evidence O · changes org state

Deactivate a segment by its API name. Since v59.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `segment_api_name` | `segmentApiName` | path | string | yes | The segment's `api_name`, not its `1sg` id. |

```sql
CALL cdp.segment_deactivate (segment_api_name => 'High_Value_Order_Buyers');
```

**Result**

One row. Schema `CdpSegmentActionOutputRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `errors` | `errors` | JSON (array of CdpErrorRepresentation) | List of errors that resulted from the action. Since v57.0. |
| `success` | `success` | BOOLEAN | Indicates whether the action was initiated successfully (`true`) or not (`false`). Since v57.0. |
| `job_id` | `jobId` | VARCHAR | Job ID for the publish job. Returned only for publishSegment resource. Since v56.0. |
| `partition_id` | `partitionId` | VARCHAR | ID of the partition. Returned only for publishSegment resource. Since v56.0. |
| `publish_status` | `publishStatus` | VARCHAR | Publish status of the segment. Returned only for publishSegment resource. Since v57.0. |
| `segment_api_name` | `segmentApiName` | VARCHAR | API name of the segment. Returned only for deactivateSegmentByName and deactivateSegmentById resources. Since v56.0. |
| `segment_id` | `segmentId` | VARCHAR | ID of the segment. Since v56.0. |

**Notes:** The [MCP tool](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/SegmentTools.java) calls this the inverse of publish. Same URL as [`segment_deactivate_by_id`](#segment_deactivate_by_id), and its one tool takes either value. The spec's description for this path says "by ID" too, while its older copy's summary says "by name". [sf-pi](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/references/data-shapes.md) says it can fail on a new segment with `INTERNAL_ERROR`, so poll `segment_status` first. `errors` holds `[{}]` on success in the spec's example, so check `success`.

## segment_deactivate_by_id

`POST /ssot/segments/{segmentId}/actions/deactivate` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Segments/paths/~1ssot~1segments~1%7BsegmentId%7D~1actions~1deactivate/post) · tool `d360_segment_deactivate` · evidence O · changes org state

Deactivate a segment on demand by ID. Since v59.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `segment_id` | `segmentId` | path | string | yes | The segment's `market_segment_id`, 18 characters starting with `1sg`. Not `market_segment_definition_id` (`3HX`) or `segment_on_id` (`0gj`). |

```sql
CALL cdp.segment_deactivate_by_id (segment_id => '1sgxx00000000PpAAI');
```

**Result**

One row. Schema `CdpSegmentActionOutputRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `errors` | `errors` | JSON (array of CdpErrorRepresentation) | List of errors that resulted from the action. Since v57.0. |
| `success` | `success` | BOOLEAN | Indicates whether the action was initiated successfully (`true`) or not (`false`). Since v57.0. |
| `job_id` | `jobId` | VARCHAR | Job ID for the publish job. Returned only for publishSegment resource. Since v56.0. |
| `partition_id` | `partitionId` | VARCHAR | ID of the partition. Returned only for publishSegment resource. Since v56.0. |
| `publish_status` | `publishStatus` | VARCHAR | Publish status of the segment. Returned only for publishSegment resource. Since v57.0. |
| `segment_api_name` | `segmentApiName` | VARCHAR | API name of the segment. Returned only for deactivateSegmentByName and deactivateSegmentById resources. Since v56.0. |
| `segment_id` | `segmentId` | VARCHAR | ID of the segment. Since v56.0. |

**Notes:** Same URL as [`segment_deactivate`](#segment_deactivate), with the same behavior and early-call failure. Unlike `segment_get_by_id`, the [hosted server](https://developer.salesforce.com/docs/platform/hosted-mcp-servers/references/reference/data360-mcp.md) lists no separate tool for this.

## segment_publish

`POST /ssot/segments/{segmentId}/actions/publish` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Segments/paths/~1ssot~1segments~1%7BsegmentId%7D~1actions~1publish/post) · tool `d360_segment_publish` · evidence O · changes org state

Publish a segment in Data 360. This `POST` endpoint doesn't accept request parameters or a request body. Since v58.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `segment_id` | `segmentId` | path | string | yes | The segment's `market_segment_id`, 18 characters starting with `1sg`. Not `market_segment_definition_id` (`3HX`) or `segment_on_id` (`0gj`). |

```sql
CALL cdp.segment_publish (segment_id => '1sgxx00000000PpAAI');
```

**Result**

One row. Schema `CdpSegmentActionOutputRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `errors` | `errors` | JSON (array of CdpErrorRepresentation) | List of errors that resulted from the action. Since v57.0. |
| `success` | `success` | BOOLEAN | Indicates whether the action was initiated successfully (`true`) or not (`false`). Since v57.0. |
| `job_id` | `jobId` | VARCHAR | Job ID for the publish job. Returned only for publishSegment resource. Since v56.0. |
| `partition_id` | `partitionId` | VARCHAR | ID of the partition. Returned only for publishSegment resource. Since v56.0. |
| `publish_status` | `publishStatus` | VARCHAR | Publish status of the segment. Returned only for publishSegment resource. Since v57.0. |
| `segment_api_name` | `segmentApiName` | VARCHAR | API name of the segment. Returned only for deactivateSegmentByName and deactivateSegmentById resources. Since v56.0. |
| `segment_id` | `segmentId` | VARCHAR | ID of the segment. Since v56.0. |

**Done when:** Poll `segment_get.publish_status`. The trigger returns `PUBLISHING`. Finished is `PUBLISHED` in the [kit](https://github.com/salesforce-misc/Data360AgentforceSolutionKitRetail/blob/main/.claude/skills/refresh-data-cloud-components/SKILL.md) (one org) and `SUCCESS` in the [hosted docs](https://developer.salesforce.com/docs/platform/hosted-mcp-servers/references/reference/data360-mcp.md), so accept both until tested. The kit lists `FAILED` for failure.

**Notes:** **Key:** only `market_segment_id`. [`segment_get`](#segment_get) has it. The [kit](https://github.com/salesforce-misc/Data360AgentforceSolutionKitRetail/blob/main/.claude/skills/refresh-data-cloud-components/SKILL.md) warns against `api_name` and the null `id` of list rows.

**Trigger response:** `publish_status` is `PUBLISHING`, with a `job_id`. `errors` holds `[{}]` [even on success](https://github.com/salesforce-misc/Data360AgentforceSolutionKitRetail/blob/main/.claude/skills/refresh-data-cloud-components/SKILL.md), so check `success`. The spec documents HTTP 200, and the kit saw 201 (one org). Compare statuses in upper case, since [Title Case comparisons never match](https://github.com/salesforce-misc/Data360AgentforceSolutionKitRetail/blob/main/.claude/skills/refresh-data-cloud-components/SKILL.md).

**Waiting:** both kits treat this as fire and forget and don't poll. A community run [exceeded a five-minute wait](https://github.com/dsouza-anush/sf-plugin-data360/blob/main/docs/API_COVERAGE.md) (community).

**Retries:** the [kit](https://github.com/salesforce-misc/Data360AgentforceSolutionKitRetail/blob/main/.claude/skills/refresh-data-cloud-components/SKILL.md) retries a failed trigger up to three times, 30 seconds apart. No source covers retrying an accepted publish.

**Token:** the [kit](https://github.com/salesforce-misc/Data360AgentforceSolutionKitRetail/blob/main/.claude/skills/refresh-data-cloud-components/SKILL.md) calls list, get and publish on the instance URL with the token from `sf org display` (one org). So the core token worked on more than the two calls the spec names. See [Hosts and tokens](api_notes.md#hosts-and-tokens).

## Schemas

Attribute names are keywords inside the object they belong to, so completion offers exactly these.

### CdpHourlyScheduleInputRepresentation

Input representation for creating an hourly schedule.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `definition_name` | `definitionName` | string |  | Name of the schedule definition. Since v63.0. |
| `frequency` | `frequency` | enum(Daily, Hourly, None) | yes | Frequency on which the schedule is run. `None` removes the schedule and is the default. Since v58.0. |
| `should_force_specified_minutes` | `shouldForceSpecifiedMinutes` | boolean |  | Only applicable to data transforms. If `true`, the consumer's schedule is used. If `false`, the transform is distributed over an hour to avoid hourly hotspots. Set to `true` only when the schedule is critical. If unspecified, the default value is `false`. Since v64.0. |
| `time` | `time` | [CdpTimeInput](#cdptimeinputrepresentation) | yes | When to run the schedule. Since v58.0. |
| `days_of_week` | `daysOfWeek` | array of enum(Friday, Monday, Saturday, Sunday, Thursday, Tuesday, Wednesday) |  | Day of the week on which the schedule will run. Since v60.0. |
| `interval` | `interval` | integer |  | Number of hours between runs. Since v60.0. |

### CdpMinutelyScheduleInputRepresentation

Represents the input for creating a minutely schedule.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `definition_name` | `definitionName` | string |  | Name of the schedule definition. Since v63.0. |
| `frequency` | `frequency` | enum(Daily, Hourly, None) | yes | Frequency on which the schedule is run. `None` removes the schedule and is the default. Since v58.0. |
| `should_force_specified_minutes` | `shouldForceSpecifiedMinutes` | boolean |  | Only applicable to data transforms. If `true`, the consumer's schedule is used. If `false`, the transform is distributed over an hour to avoid hourly hotspots. Set to `true` only when the schedule is critical. If unspecified, the default value is `false`. Since v64.0. |
| `time` | `time` | [CdpTimeInput](#cdptimeinputrepresentation) | yes | When to run the schedule. Since v58.0. |
| `days_of_week` | `daysOfWeek` | array of enum(Friday, Monday, Saturday, Sunday, Thursday, Tuesday, Wednesday) |  | Day of the week on which the schedule will run. Since v58.0. |
| `interval` | `interval` | integer |  | Number of minutes between runs. Since v58.0. |

### CdpMonthlyRelativeScheduleInputRepresentation

Represents the input for creating a monthly relative schedule.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `definition_name` | `definitionName` | string |  | Name of the schedule definition. Since v63.0. |
| `frequency` | `frequency` | enum(Daily, Hourly, None) | yes | Frequency on which the schedule is run. `None` removes the schedule and is the default. Since v58.0. |
| `should_force_specified_minutes` | `shouldForceSpecifiedMinutes` | boolean |  | Only applicable to data transforms. If `true`, the consumer's schedule is used. If `false`, the transform is distributed over an hour to avoid hourly hotspots. Set to `true` only when the schedule is critical. If unspecified, the default value is `false`. Since v64.0. |
| `time` | `time` | [CdpTimeInput](#cdptimeinputrepresentation) | yes | When to run the schedule. Since v58.0. |
| `day_of_week` | `dayOfWeek` | enum(Friday, Monday, Saturday, Sunday, Thursday, Tuesday, Wednesday) |  | Day of the week on which the schedule will run. Since v58.0. |
| `week_of_month` | `weekOfMonth` | enum(First, Fourth, Last, Second, Third) |  | Relative week of the month when the schedule should be run. Since v58.0. |

### CdpNoneScheduleInputRepresentation

Input representation when not creating a schedule.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `definition_name` | `definitionName` | string |  | Name of the schedule definition. Since v63.0. |
| `frequency` | `frequency` | enum(Daily, Hourly, None) | yes | Frequency on which the schedule is run. `None` removes the schedule and is the default. Since v58.0. |
| `should_force_specified_minutes` | `shouldForceSpecifiedMinutes` | boolean |  | Only applicable to data transforms. If `true`, the consumer's schedule is used. If `false`, the transform is distributed over an hour to avoid hourly hotspots. Set to `true` only when the schedule is critical. If unspecified, the default value is `false`. Since v64.0. |
| `time` | `time` | [CdpTimeInput](#cdptimeinputrepresentation) | yes | When to run the schedule. Since v58.0. |

### CdpSegmentDbtInputRepresentation

Represents the input for a DBT segment.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `models` | `models` | array of [CdpSegmentDbtModelInput](#cdpsegmentdbtmodelinputrepresentation) |  | List of models. The spec types this as an array, but the API needs a wrapper: `models = (models = [...])`. See [`segment_create`](#segment_create). |

### CdpSegmentDbtModelInputRepresentation

Represents the input for a single DBT model.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `name` | `name` | string |  | Name of the DBT model. Since v55.0. |
| `sql` | `sql` | string |  | SQL for the DBT model. Since v55.0. |
| `models` | `models` | array of [CdpSegmentDbtModelInput](#cdpsegmentdbtmodelinputrepresentation) |  | The API nests models as `models = (models = [...])` (tool source). |

### CdpSegmentEinsteinGptSegmentsUIInputRepresentation

Represents the input for an Einstein Gpt Segments UI segment.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `include_criteria` | `includeCriteria` | string |  | Inlcude criteria for an Einstein Gpt Segments UI segment. Since v58.0. |

### CdpSegmentLookalikeInputRepresentation

Represents the input for segment lookalike criteria.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `additional_population` | `additionalPopulation` | integer |  | Additional lookalike population criteria. Since v56.0. |
| `seed_segment_name` | `seedSegmentName` | string |  | Name of the seed segment. Since v56.0. |

### CdpTimeInputRepresentation

Time input source for when to run the schedule.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `hour` | `hour` | integer | yes | Hour when the schedule should run. Since v60.0. |
| `minute` | `minute` | integer | yes | Minute in the hour when the schedule should run. Since v60.0. |
| `time_zone` | `timeZone` | string | yes | Time zone of the schedule. Since v60.0. |

### DailyScheduleInputRepresentation

Represents the input for creating a daily schedule.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `definition_name` | `definitionName` | string |  | Name of the schedule definition. Since v63.0. |
| `frequency` | `frequency` | enum(Daily, Hourly, Minutely, Monthly, MonthlyRelative, Weekly, None, Transform) | yes | Frequency on which the schedule is run. `None` removes the schedule and is the default. Since v58.0. |
| `time_info` | `timeInfo` | [CdpTimeInput](#cdptimeinputrepresentation) |  | When to run the schedule. Since v58.0. |
| `days_of_week` | `daysOfWeek` | array of string |  | Days of the week on which the schedule will run. You can specify multiple days. Since v61.0. |
| `interval` | `interval` | integer |  | Hourly interval at which segments can be published, from `1` through `24`. Since v61.0. |
| `run_from` | `runFrom` | [CdpTimeInput](#cdptimeinputrepresentation) |  | Start time for a rapid publish. Since v61.0. |
| `run_to` | `runTo` | [CdpTimeInput](#cdptimeinputrepresentation) |  | End time for a rapid publish. Since v61.0. |

### MonthlySpecificScheduleInputRepresentation

Represents the input for creating a monthly schedule where the days are fixed by numerical date.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `definition_name` | `definitionName` | string |  | Name of the schedule definition. Since v63.0. |
| `frequency` | `frequency` | enum(Daily, Hourly, Minutely, Monthly, MonthlyRelative, Weekly, None, Transform) | yes | Frequency on which the schedule is run. `None` removes the schedule and is the default. Since v58.0. |
| `time_info` | `timeInfo` | [CdpTimeInput](#cdptimeinputrepresentation) |  | When to run the schedule. Since v58.0. |
| `days_of_month` | `daysOfMonth` | array of integer |  | Days of the month on which the schedule is to run, specified as a list of numbers from `1` through `31`. Use `-1` to indicate the last day of the month; you can't combine `-1` with other days. Since v58.0. |

### WeeklyScheduleInputRepresentation

Represents the input for creating a weekly schedule.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `definition_name` | `definitionName` | string |  | Name of the schedule definition. Since v63.0. |
| `frequency` | `frequency` | enum(Daily, Hourly, Minutely, Monthly, MonthlyRelative, Weekly, None, Transform) | yes | Frequency on which the schedule is run. `None` removes the schedule and is the default. Since v58.0. |
| `time_info` | `timeInfo` | [CdpTimeInput](#cdptimeinputrepresentation) |  | When to run the schedule. Since v58.0. |
| `days_of_week` | `daysOfWeek` | array of enum(Friday, Monday, Saturday, Sunday, Thursday, Tuesday, Wednesday) |  | Days of the week on which the schedule is to run. You can specify one day. Since v58.0. |
