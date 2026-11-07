<!-- Generated from extensions/d360/clfn/spec/data_transforms.yaml, edit that and run: bazel run //extensions/d360:update -->

# Data Transforms

Part of the [CDP function reference](functions.md). Nothing here is implemented or tested against an org. Every result also has the [standard columns](functions.md#result-schema).

A data transform reads data lake objects (DLOs) or data model objects (DMOs) and writes the result to another object. It sits after ingestion and before anything that reads the output, such as mappings or segments.

There are two kinds, with different SQL rules. **Batch** runs a DCSQL manifest, a graph of SQL nodes, on a schedule or on demand. **Streaming** is one SQL statement that runs continually, and it has [no aggregates, window functions or subqueries](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/resources/metadata/payload-examples.json). [`transform_create`](#transform_create) compares them.

You validate, create, wait for `Active`, then schedule or run. Run history shows only finished jobs.

The gotchas that matter most:

- **Validation failures come back as 200.** Read `issues`, not the HTTP status.
- **`transform_update` is a `PUT`.** The spec requires the full body. Read the transform first and resend everything.
- **Run returns before the work is done.** `success` = `true` means the run started. Poll `transform_get`.
- **Status spellings vary.** The spec says `Success`, its examples say `SUCCESS`. Compare case-insensitively.

Links to `help.salesforce.com` were read only as search excerpts, because those pages render with script.

```sql
/* Same body for validate and create */
CALL cdp.transform_validate (name => 'account_summary', label => 'Account Summary', type => 'BATCH', definition => (...));
CALL cdp.transform_create (name => 'account_summary', label => 'Account Summary', type => 'BATCH', definition => (...));
/* Once status is Active */
CALL cdp.transform_schedule_set (data_transform_name_or_id => 'account_summary', frequency => 'Daily', time => (hour = 2, minute = 0, time_zone = 'America/Los_Angeles'));
CALL cdp.transform_run (data_transform_name_or_id => 'account_summary');
CALL cdp.transform_get (data_transform_name_or_id => 'account_summary');
```

**Functions:** [`transform_delete`](#transform_delete), [`transform_list`](#transform_list), [`transform_get`](#transform_get), [`transform_run_history_list`](#transform_run_history_list), [`transform_schedule_get`](#transform_schedule_get), [`transform_create`](#transform_create), [`transform_validate`](#transform_validate), [`transform_cancel`](#transform_cancel), [`transform_rebuild`](#transform_rebuild), [`transform_status_refresh`](#transform_status_refresh), [`transform_retry`](#transform_retry), [`transform_run`](#transform_run), [`transform_update`](#transform_update), [`transform_schedule_set`](#transform_schedule_set)

## transform_delete

`DELETE /ssot/data-transforms/{dataTransformNameOrId}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Transforms/paths/~1ssot~1data-transforms~1%7BdataTransformNameOrId%7D/delete) · tool `d360_transform_delete` · evidence O · changes org state

Initiate the deletion of a data transform. Since v60.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `data_transform_name_or_id` | `dataTransformNameOrId` | path | string | yes | Name or ID of the data transform to delete. |

```sql
CALL cdp.transform_delete (data_transform_name_or_id => 'account_summary');
```

**Result**

No response body (HTTP 200). One row with only the standard columns.

**Done when:** `transform_get.status` is `Deleting` while it runs (in the spec's enum). Afterwards `transform_get` fails with [`ITEM_NOT_FOUND`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/references/data-shapes.md).

**Notes:** The spec says 200 with no body. [sf-pi](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/references/data-shapes.md) reports 204.

- The [tool source](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/DataTransformTools.java) says deleting "stops any scheduled runs".
- No source says what happens to the target object or its rows.

## transform_list

`GET /ssot/data-transforms` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Transforms/paths/~1ssot~1data-transforms/get) · tool `d360_transform_list` · evidence O · read-only

Get a list of data transforms. Since v60.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `filter_group` | `filterGroup` | query | string |  | Group on which to filter response results. Valid values are `Big`, `Medium`, and `Small`. - `Big` provides comprehensive results by returning properties whose filter group is `Big`, `Medium`, or `Small`. - `Medium` provides moderate results by returning properties whose filter group is `Medium` or `Small`. - `Small` provides essential results by returning only properties whose filter group is `Small`. The default is `Big`. Since v60.0. |
| `limit` | `limit` | query | integer |  | Maximum number of rows to return from `1` through `20`. If unspecified, the default number of rows is `20`. Since v60.0. |
| `offset` | `offset` | query | integer |  | Number of rows to skip before returning results. Must be an integer greater than zero. If unspecified, no rows are skipped. Since v60.0. |
| `order_by` | `orderBy` | query | enum(DataTransformStatusAsc, DataTransformStatusDesc, LabelAsc, LabelDesc, LastRunStatusAsc, LastRunStatusDesc, LastRunTimeAsc, LastRunTimeDesc, MruAsc, MruDesc, NameAsc, NameDesc, TypeAsc, TypeDesc) |  | Sort order for the result set. If unspecified, items are returned in the order they are retrieved. Since v60.0. |

```sql
CALL cdp.transform_list ();
```

**Result**

One row. Schema `DataTransformCollectionRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `current_page_url` | `currentPageUrl` | VARCHAR | Current page URL. Since v60.0. |
| `next_page_url` | `nextPageUrl` | VARCHAR | Next page URL, if it exists. Since v60.0. |
| `total_size` | `totalSize` | BIGINT | Total size of the collection. Since v60.0. |
| `data_transforms` | `dataTransforms` | JSON (array of DataTransformRepresentation) | List of data transforms returned for the current page. Since v60.0. |
| `errors` | `errors` | JSON (array of FailedResourceCollectionRepresentation) | Error collection of resources that failed to be retrieved. Since v60.0. |

**Paging:** `limit`, `offset`.

**Notes:** `limit` stops at 20, so page with `offset`.

- `errors` lists transforms that couldn't be read, in a 200 response. Check it as well as `data_transforms`.
- Among the transform's own fields, the spec puts only `last_run_error_code` outside `Small`. `filter_group => 'Small'` doesn't drop `definition`, so it won't shrink the response much.
- The spec's enums are Title Case (`Active`, `Success`), its examples are upper case (`ACTIVE`, `SUCCESS`, `NONE`), and [sf-pi](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/registry/connect-openapi-overrides.json) records live responses with `status`, `last_run_status`, `creation_type` and `full_run_frequency` values outside the enums, and `definition` shapes outside the schema. Compare case-insensitively and don't reject unknown values.

## transform_get

`GET /ssot/data-transforms/{dataTransformNameOrId}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Transforms/paths/~1ssot~1data-transforms~1%7BdataTransformNameOrId%7D/get) · tool `d360_transform_get` · evidence O · read-only

Get a data transform. Since v60.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `data_transform_name_or_id` | `dataTransformNameOrId` | path | string | yes | Name or ID of the data transform. In a non-default data space, the [not-found message](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/references/data-shapes.md) says to use `<dataspace prefix>_<API name>`. |
| `filter_group` | `filterGroup` | query | string |  | Group on which to filter response results. Valid values are `Big`, `Medium`, and `Small`. - `Big` provides comprehensive results by returning properties whose filter group is `Big`, `Medium`, or `Small`. - `Medium` provides moderate results by returning properties whose filter group is `Medium` or `Small`. - `Small` provides essential results by returning only properties whose filter group is `Small`. The default is `Big`. Since v60.0. |

```sql
CALL cdp.transform_get (data_transform_name_or_id => 'account_summary');
```

**Result**

One row. Schema `DataTransformRepresentation`.

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
| `action_urls` | `actionUrls` | JSON (BatchActionRepresentation) | Actions available for the data transform. Since v60.0. |
| `creation_type` | `creationType` | VARCHAR | Creation type of the data transform. Since v60.0. |
| `dataspace_name` | `dataSpaceName` | VARCHAR | Data space for the data transform. Since v60.0. |
| `definition` | `definition` | JSON | Base definition for the data transform. The endpoint returns the definition output object that corresponds to the type of data transform. For example, the Stl Data Transform Definition Output is returned for the `Stl` and `StlHidden` types. Since v60.0. |
| `definitions` | `definitions` | JSON (array of DataTransformDefinitionRepresentation) | List of definitions for batch data transforms. Since v63.0. |
| `description` | `description` | VARCHAR | Description of the data transform. Since v60.0. |
| `full_run_frequency` | `fullRunFrequency` | VARCHAR | Full run frequency of the data transform. Since v63.0. |
| `last_run_date` | `lastRunDate` | VARCHAR | Last date the data transform was run. Since v60.0. |
| `last_run_error_code` | `lastRunErrorCode` | JSON (CdpErrorRepresentation) | Error code of the last run. Since v60.0. |
| `last_run_status` | `lastRunStatus` | VARCHAR | Status of the last run. Since v60.0. |
| `schedule` | `schedule` | JSON (ScheduleRepresentation) | The schedule for the data transform. Since v60.0. |
| `status` | `status` | VARCHAR | The status of the data transform. Since v60.0. |
| `type` | `type` | VARCHAR | Type of data transform. Since v60.0. |
| `version` | `version` | BIGINT | Version of the data transform. Since v60.0. |

**Notes:** Two statuses answer different questions:

- `status` is the definition: `Active`, `Processing`, `Deleting`, `Error`.
- `last_run_status` is the last run: `None`, `Pending`, `InProgress`, `Success`, `Failure`, `PartialFailure`, `Canceled`, `PartiallyCanceled`.

The spec's enums are Title Case (`Active`, `Success`), its examples are upper case (`ACTIVE`, `SUCCESS`, `NONE`), and [sf-pi](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/registry/connect-openapi-overrides.json) records live responses with `status`, `last_run_status`, `creation_type` and `full_run_frequency` values outside the enums, and `definition` shapes outside the schema. Compare case-insensitively and don't reject unknown values.

`action_urls` shows what a transform supports. The spec's batch example has `runAction`, `cancelAction`, `retryAction` and `refreshStatusAction`. Its streaming example has only `retryAction` and `refreshStatusAction`, and that `refreshStatusAction` points at `/actions/rebuild`. Don't follow it expecting a harmless status refresh.

Multi-definition batch transforms (v63 and later) carry their definitions in `definitions`.

The spec documents 404 as "User does not have read access", so a 404 doesn't prove the transform is gone.

## transform_run_history_list

`GET /ssot/data-transforms/{dataTransformNameOrId}/run-history` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Transforms/paths/~1ssot~1data-transforms~1%7BdataTransformNameOrId%7D~1run-history/get) · evidence O · read-only

Get information about all the jobs that the batch or streaming data transform has run. Only information about completed jobs is returned. Return the history of each job, such as the job's duration and end time. For batch data transforms, return information about the output node such as the node's name and type. For more information about data transforms, see [Data Cleansing and Preparation](https://help.salesforce.com/s/articleView?id=data.c360_a_cleansing_data.htm&type=5). Since v62.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `data_transform_name_or_id` | `dataTransformNameOrId` | path | string | yes | Developer name or ID of the data transform. |
| `limit` | `limit` | query | integer |  | Maximum number of run jobs to return. Since v62.0. |
| `offset` | `offset` | query | integer |  | Number of run history records to skip before returning results. Must be an integer greater than zero. If unspecified, no rows are skipped. Since v62.0. |

```sql
CALL cdp.transform_run_history_list (data_transform_name_or_id => 'account_summary', limit => 20);
```

**Result**

One row. Schema `DataTransformRunHistoryCollectionRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `current_page_url` | `currentPageUrl` | VARCHAR | Current page URL. Since v60.0. |
| `next_page_url` | `nextPageUrl` | VARCHAR | Next page URL, if it exists. Since v60.0. |
| `total_size` | `totalSize` | BIGINT | Total size of the collection. Since v60.0. |
| `histories` | `histories` | JSON | List of information about the jobs that the data transform has run. Each data transform run is one entry in the array. The endpoint returns the run history output object that corresponds to the type of data transform. For example, the Batch Data Transform Run History Output is returned for the `Batch` data transform type. Since v62.0. |

**Paging:** `limit`, `offset`.

**Notes:** `histories` is JSON and its fields depend on the transform type.

- **Both:** `request_id` (v67), `definition_name`, `status`, `start_time`, `end_time`, `duration` (seconds), `processedRows`, `isVersionChanged`, `error_message`, `type`.
- **Batch:** `runMode`, `runModeReason`, `runModeParameters`, and `outputStatus[]` with `name`, `data_object_name`, `data_object_type`, `status`, `totalRows`, `completed_date`.
- **Streaming:** `addedRows`, `updatedRows`, `deletedRows`, `failedRows`.

`status` values: `Success`, `Failure`, `PartialFailure`, `Canceled`, `PartiallyCanceled`, `SkippedNoChanges`, `RebuildSuccess`, `RebuildFailure`, `Rebuilding`, `RebuildPending`, `InProgress`, `Pending`, `None`.

Traps:

- The description says only completed jobs appear, yet the enum has `InProgress` and `Pending`. Use `transform_get` to watch a running job.
- [sf-pi](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/references/data-shapes.md) says to expect an empty list until ingestion completes.
- A run with nothing to do is `SkippedNoChanges`, not `Success`.
- The spec's example returns `runMode` = `full` and `status` = `SUCCESS`, against the enums `Full` and `Success`.
- The same example has a `next_page_url` with `total_size` = 2 and `limit` = 50. Stop on `total_size` or a short page, not only on a missing `next_page_url`.

## transform_schedule_get

`GET /ssot/data-transforms/{dataTransformNameOrId}/schedule` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Transforms/paths/~1ssot~1data-transforms~1%7BdataTransformNameOrId%7D~1schedule/get) · tool `d360_transform_schedule_get` · evidence O · read-only

Get a data transform's schedule. The response contains different fields depending on its frequency. Since v60.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `data_transform_name_or_id` | `dataTransformNameOrId` | path | string | yes | Name or ID of the data transform. |

```sql
CALL cdp.transform_schedule_get (data_transform_name_or_id => 'account_summary');
```

**Result**

One row. Schema `CdpScheduleBaseRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `frequency` | `frequency` | VARCHAR | - |
| `next_scheduled_date` | `nextScheduledDate` | VARCHAR | - |
| `time_info` | `timeInfo` | JSON (TimeOutputRepresentation) | - |
| `days_of_week` | `daysOfWeek` | JSON | - |
| `interval` | `interval` | BIGINT | - |
| `run_from` | `runFrom` | JSON (TimeOutputRepresentation) | - |
| `run_to` | `runTo` | JSON (TimeOutputRepresentation) | - |
| `type` | `type` | VARCHAR | Type of schedule frequency. The endpoint returns the schedule output object that corresponds to the type of schedule frequency. Only `Daily`, `Hourly`, or `None` are supported for data transforms. For example, the Daily Schedule Output is returned for the `Daily` publish frequency. Since v58.0. |
| `time` | `time` | JSON (CdpTimeRepresentation) | - |

**Notes:** The spec returns 400 when a multi-definition transform has no definition name, yet this call declares no option to pass one. [`transform_run`](#transform_run) has the same gap.

- `type` is the only declared column. Other fields, such as `interval`, `daysOfWeek` and `time`, depend on the frequency, so read them from `_raw`.
- [sf-pi](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/registry/connect-openapi-overrides.json) records a live response outside the spec's schema, and [says](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/references/data-shapes.md) the response has lowercase `time.timezone` with `gmtOffset` and `name`. Don't send that shape back: `transform_schedule_set` rejects `time_zone`.
- Streaming transforms [run continually](https://trailhead.salesforce.com/content/learn/modules/batch-data-transforms-in-data-cloud-quick-look/get-started-with-batch-data-transforms-in-data-360) rather than on a schedule.

## transform_create

`POST /ssot/data-transforms` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Transforms/paths/~1ssot~1data-transforms/post) · tool `d360_transform_create` · evidence O · changes org state

Create a data transform. Since v60.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `filter_group` | `filterGroup` | query | string |  | Group on which to filter response results. Valid values are `Big`, `Medium`, and `Small`. - `Big` provides comprehensive results by returning properties whose filter group is `Big`, `Medium`, or `Small`. - `Medium` provides moderate results by returning properties whose filter group is `Medium` or `Small`. - `Small` provides essential results by returning only properties whose filter group is `Small`. The default is `Big`. Since v60.0. |
| `currency_iso_code` | `currencyIsoCode` | body | string |  | Currency ISO code of the data transform. Since v62.0. |
| `dataspace_name` | `dataSpaceName` | body | string |  | Data space that the data transform belongs to. Required for DMO-based data transforms. Since v60.0. |
| `definition` | `definition` | body | one of [DcSqlDataTransformDefinitionInput](#dcsqldatatransformdefinitioninputrepresentation), [StlDataTransformDefinitionInput](#stldatatransformdefinitioninputrepresentation), [SqlDataTransformDefinitionInput](#sqldatatransformdefinitioninputrepresentation) | yes | Single definition. Its shape depends on the definition type: [DCSQL](#dcsqldatatransformdefinitioninputrepresentation), [SQL](#sqldatatransformdefinitioninputrepresentation) or [STL](#stldatatransformdefinitioninputrepresentation). The spec marks it required, yet its multi-definition examples send `definitions` without it. Since v60.0. |
| `definitions` | `definitions` | body | array of [DataTransformDefinitionInput](#datatransformdefinitioninputrepresentation) |  | List of definitions for batch transforms. Since v63.0. |
| `description` | `description` | body | string |  | Description of the data transform. Since v60.0. |
| `full_run_frequency` | `fullRunFrequency` | body | enum(Daily, Monthly, Weekly) |  | Full run frequency of the data transform. Since v60.0. |
| `label` | `label` | body | string | yes | Label of the data transform. Since v60.0. |
| `name` | `name` | body | string | yes | Name of the data transform. Since v60.0. |
| `primary_source` | `primarySource` | body | string |  | In cases where the transformation contains table joins, describes the primary source. Since v60.0. |
| `type` | `type` | body | enum(BATCH, STREAMING) | yes | Type of data transform. Since v60.0. |
| `creation_type` | `creationType` | body | string |  | Not in the spec schema: from the MCP server's request class. |

```sql
CALL cdp.transform_create (
  name => 'account_summary',
  label => 'Account Summary',
  description => 'Accounts over one million in revenue',
  type => 'BATCH',
  definition => (
    type = 'DCSQL',
    version = '1.0',
    manifest = (nodes = (
      account_summary_output = (
        name = 'account_summary_output',
        relation_name = 'Account_Summary__dll',
        config = (materialized = 'table', writeMode = 'OVERWRITE'),
        compiled_code = $$SELECT "Id__c", "Name__c" FROM "Account__dlm" WHERE "AnnualRevenue__c" > 1000000$$
      )
    )),
    output_data_objects = [(
      name = 'Account_Summary__dll',
      label = 'Account Summary',
      category = 'Profile',
      type = 'dataLakeObject',
      fields = [
        (name = 'Id__c', label = 'Account ID', type = 'Text', is_primary_key = true),
        (name = 'Name__c', label = 'Account Name', type = 'Text', is_primary_key = false)
      ]
    )]
  )
);
```

**Result**

One row. Schema `DataTransformRepresentation`.

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
| `action_urls` | `actionUrls` | JSON (BatchActionRepresentation) | Actions available for the data transform. Since v60.0. |
| `creation_type` | `creationType` | VARCHAR | Creation type of the data transform. Since v60.0. |
| `dataspace_name` | `dataSpaceName` | VARCHAR | Data space for the data transform. Since v60.0. |
| `definition` | `definition` | JSON | Base definition for the data transform. The endpoint returns the definition output object that corresponds to the type of data transform. For example, the Stl Data Transform Definition Output is returned for the `Stl` and `StlHidden` types. Since v60.0. |
| `definitions` | `definitions` | JSON (array of DataTransformDefinitionRepresentation) | List of definitions for batch data transforms. Since v63.0. |
| `description` | `description` | VARCHAR | Description of the data transform. Since v60.0. |
| `full_run_frequency` | `fullRunFrequency` | VARCHAR | Full run frequency of the data transform. Since v63.0. |
| `last_run_date` | `lastRunDate` | VARCHAR | Last date the data transform was run. Since v60.0. |
| `last_run_error_code` | `lastRunErrorCode` | JSON (CdpErrorRepresentation) | Error code of the last run. Since v60.0. |
| `last_run_status` | `lastRunStatus` | VARCHAR | Status of the last run. Since v60.0. |
| `schedule` | `schedule` | JSON (ScheduleRepresentation) | The schedule for the data transform. Since v60.0. |
| `status` | `status` | VARCHAR | The status of the data transform. Since v60.0. |
| `type` | `type` | VARCHAR | Type of data transform. Since v60.0. |
| `version` | `version` | BIGINT | Version of the data transform. Since v60.0. |

**Done when:** `transform_get.status` goes from `Processing` to [`Active`](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/references/data-shapes.md), or `Error`. Streaming transforms [activate on save](https://help.salesforce.com/s/articleView?id=data.c360_a_streaming_transform_considerations.htm&language=en_US&type=5).

**Notes:** Run [`transform_validate`](#transform_validate) first. Batch and streaming differ:

| | Batch | Streaming |
|---|---|---|
| `type` | `BATCH` | `STREAMING` |
| Definition | [DCSQL](#dcsqldatatransformdefinitioninputrepresentation) manifest of nodes, or [STL](#stldatatransformdefinitioninputrepresentation) graph | [SQL](#sqldatatransformdefinitioninputrepresentation): `expression` and `target_dlo` or `target_dmo` |
| `definition.version` in examples | `1.0` for DCSQL, `56.0` for STL | `63.0` |
| Aggregates, window functions | [Yes](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/resources/metadata/payload-examples.json) | [No](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/resources/metadata/payload-examples.json) |
| Subqueries | Chain ephemeral nodes in the examples | [No](https://help.salesforce.com/s/articleView?id=data.c360_a_streaming_transform_considerations.htm&language=en_US&type=5) |
| Joins | `LEFT JOIN` in the examples | Sources disagree, below |
| Runs | On a schedule or on demand | [Continually](https://trailhead.salesforce.com/content/learn/modules/batch-data-transforms-in-data-cloud-quick-look/get-started-with-batch-data-transforms-in-data-360) |
| Definitions per transform | [Up to 5](https://help.salesforce.com/s/articleView?id=sf.c360_a_batch_transform_limitations.htm&language=en_US&type=5) | One (the spec's 400 on update) |
| Per org | [1,000](https://help.salesforce.com/s/articleView?language=en_US&id=sf.c360_a_limits_and_guidelines.htm) | [25](https://help.salesforce.com/s/articleView?language=en_US&id=sf.c360_a_limits_and_guidelines.htm), raised through your Account Executive |
| Other limits | [24 hours](https://help.salesforce.com/s/articleView?language=en_US&id=sf.c360_a_limits_and_guidelines.htm) of runtime before the system cancels | [20,000 characters](https://help.salesforce.com/s/articleView?language=en_US&id=sf.c360_a_limits_and_guidelines.htm) of SQL |

**Streaming joins:** the [payload example's note](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/resources/metadata/payload-examples.json) allows `INNER JOIN` and rejects `LEFT`, `RIGHT` and `FULL OUTER`. [Help](https://help.salesforce.com/s/articleView?id=data.c360_a_streaming_transform_considerations.htm&language=en_US&type=5) says `INNER JOIN` and `LEFT JOIN` both work, with one object triggering the transform and the other only evaluating the join. Validate rather than assume.

**Spellings disagree.** The spec's definition enum has `DcSql`, `Sql` and `Stl`, while its examples and the [MCP examples](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/resources/metadata/payload-examples.json) send `DCSQL`, `SQL` and `STL`. `type` is `BATCH` in the spec, `batch` in the MCP examples and `Streaming` in the spec's validate example. `write_mode` is `Overwrite` in the output schema and `OVERWRITE` in examples, and an output object's `type` is `DataLakeObject` in the schema and `dataLakeObject` in examples. This reference uses what the spec's examples send.

**Output object:**

- The [tool source](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/DataTransformTools.java) says create expects `output_data_objects` to be populated and auto-creates DLOs from it. [sf-pi](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/references/data-shapes.md) says targets must exist or be auto-creatable, and to pre-create one when validation reports `TARGET_DLO_NOT_FOUND`. The spec's streaming example sends no `output_data_objects`.
- Mark a primary key field. [Streaming SQL requires one](https://help.salesforce.com/s/articleView?id=data.c360_a_streaming_transform_considerations.htm&language=en_US&type=5), and an Engagement target also needs the event date and time field mapped, through `event_date_time_field_name` in the spec.
- Streaming: source and target must differ, and key qualifier fields [fail validation](https://help.salesforce.com/s/articleView?id=data.c360_a_streaming_transform_considerations.htm&language=en_US&type=5). The target DLO must be `Active` and [created through the UI, not by a data stream](https://help.salesforce.com/s/articleView?id=data.c360_a_streaming_transform_considerations.htm&language=en_US&type=5), which sits badly with auto-creation above. Several transforms can write to one target, but if they write the same fields the result is indeterminate.
- Batch: [the same object can't be input and output, and DLO inputs can't feed a DMO output](https://help.salesforce.com/s/articleView?id=sf.c360_a_batch_transform_limitations.htm&language=en_US&type=5), or the reverse. Separate transforms can't write to the same object.
- `dataspace_name` is required when the transform is DMO-based.

**Other:**

- [API name rules](https://developer.salesforce.com/docs/data/data-cloud-code-ext/guide/create-batch-transform.md): alphanumerics and underscores, starts with a letter, 40 characters or fewer, no trailing or consecutive underscores, unique. That page covers code extension transforms in the UI.
- This `POST` isn't safe to retry blindly, because a name that exists is an error. Check `transform_get` after a lost response.
- The [catalog](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/runtime/FamilyCatalog.java) says "Schedule runs separately". The spec also allows `schedule` inside each `definitions` item since v67.
- `full_run_frequency` takes `Daily`, `Weekly` or `Monthly`. [Help](https://help.salesforce.com/s/articleView?id=sf.c360_a_batch_transform_data_drift.htm&language=en_US&type=5) describes a full run every 24 hours to correct drift in incremental runs, No source explains how the two relate.
- The [tool source](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/DataTransformTools.java) also sends `requested_by` as a query parameter and accepts `creation_type` in the body. The spec has neither here.

## transform_validate

`POST /ssot/data-transforms-validation` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Transforms/paths/~1ssot~1data-transforms-validation/post) · tool `d360_transform_prepare`, `d360_transform_validate` · evidence O · read-only

Validate your data transform before you create it. - If the data transform is valid, this request returns an example of the data structure of the target object's output. - If the data transform is invalid, this request returns a list of issues that contain information about errors and possible resolutions. Since v62.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `currency_iso_code` | `currencyIsoCode` | body | string |  | Currency ISO code of the data transform. Since v62.0. |
| `dataspace_name` | `dataSpaceName` | body | string |  | Data space that the data transform belongs to. Required for DMO-based data transforms. Since v60.0. |
| `definition` | `definition` | body | one of [DcSqlDataTransformDefinitionInput](#dcsqldatatransformdefinitioninputrepresentation), [StlDataTransformDefinitionInput](#stldatatransformdefinitioninputrepresentation), [SqlDataTransformDefinitionInput](#sqldatatransformdefinitioninputrepresentation) | yes | Single definition. Its shape depends on the definition type: [DCSQL](#dcsqldatatransformdefinitioninputrepresentation), [SQL](#sqldatatransformdefinitioninputrepresentation) or [STL](#stldatatransformdefinitioninputrepresentation). The spec marks it required, yet its multi-definition examples send `definitions` without it. Since v60.0. |
| `definitions` | `definitions` | body | array of [DataTransformDefinitionInput](#datatransformdefinitioninputrepresentation) |  | List of definitions for batch transforms. Since v63.0. |
| `description` | `description` | body | string |  | Description of the data transform. Since v60.0. |
| `full_run_frequency` | `fullRunFrequency` | body | enum(Daily, Monthly, Weekly) |  | Full run frequency of the data transform. Since v60.0. |
| `label` | `label` | body | string | yes | Label of the data transform. Since v60.0. |
| `name` | `name` | body | string | yes | Name of the data transform. Since v60.0. |
| `primary_source` | `primarySource` | body | string |  | In cases where the transformation contains table joins, describes the primary source. Since v60.0. |
| `type` | `type` | body | enum(BATCH, STREAMING) | yes | Type of data transform. Since v60.0. |

```sql
CALL cdp.transform_validate (
  name => 'AccountAnon',
  label => 'Account Anon',
  type => 'STREAMING',
  definition => (
    type = 'SQL',
    version = '63.0',
    expression = $$SELECT Account_Home__dll.Id__c AS Id__c, '***' AS Name__c FROM Account_Home__dll$$,
    target_dlo = 'Account_Home_Anon__dll'
  )
);
```

**Result**

One row. Schema `DataTransformValidationRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `issues` | `issues` | JSON (array of TransformValidationIssueRepresentation) | List of validation issues, if any. Since v62.0. |
| `output_data_objects` | `outputDataObjects` | JSON (array of DataObjectRepresentation) | Output representation of the target object. Since v62.0. |

**Notes:** A read that uses `POST`. It takes the same body as create and [doesn't start a run](https://github.com/dsouza-anush/sf-plugin-data360/blob/main/messages/data360.transform.validate.md) (community).

- **Read `issues`.** The spec's example is a 200 with two errors and an empty `output_data_objects`. Each issue has `error_code`, `error_message`, `errorSeverity` (`Warning`, `Error`, `Fatal`), and since v65 `type` and `definition_name`.
- **`Warning` exists**, so a non-empty `issues` isn't always a failure. The [tool source](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/DataTransformTools.java) still treats any issue as invalid.
- **Spelling:** `error_code` is `InvalidTargetDLO` in the enum and `INVALID_TARGET_DLO` in the example. [sf-pi](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/references/data-shapes.md) saw `TARGET_DLO_NOT_FOUND` and `DLO_NAME_DOES_NOT_EXIST`.
- **Name collisions count.** The example reports "The Data Transform API name already exists" and "Another streaming data transform is using these input and output sources". So validating an edit under the existing name may report a false problem. No source covers this case.
- **`output_data_objects` shape:** an array in the spec. The [tool source](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/DataTransformTools.java) casts it to a map of transform name to array of objects, and its tests mock that. Keep the column as raw JSON.

**This isn't `d360_transform_prepare`.** That MCP tool calls this endpoint, then guesses on the client. The primary key is `Id__c`, else `*_id__c`, else the first field. The category comes from name patterns. The output type is DMO only if all sources are `__dlm`. This function does none of that, so set `is_primary_key`, `category` and `type` yourself before `transform_create`.

## transform_cancel

`POST /ssot/data-transforms/{dataTransformNameOrId}/actions/cancel` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Transforms/paths/~1ssot~1data-transforms~1%7BdataTransformNameOrId%7D~1actions~1cancel/post) · evidence O · changes org state

Cancel a data transform. Since v60.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `data_transform_name_or_id` | `dataTransformNameOrId` | path | string | yes | Name or ID of the data transform to cancel. |

```sql
CALL cdp.transform_cancel (data_transform_name_or_id => 'account_summary');
```

**Result**

One row. Schema `CdpDataTransformActionResponseRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `errors` | `errors` | JSON (array of CdpErrorRepresentation) | List of errors that resulted from the action. Since v57.0. |
| `success` | `success` | BOOLEAN | Indicates whether the action was initiated successfully (`true`) or not (`false`). Since v57.0. |
| `request_id` | `requestId` | VARCHAR | Request ID assigned to this data transform run request for tracking. Since v67.0. |
| `should_force_full_run` | `shouldForceFullRun` | BOOLEAN | Indicates whether to force the transform to run in full mode (`true`) or not (`false`). Since v60.0. |

**Done when:** `transform_get.last_run_status` is `Canceled` or `PartiallyCanceled`.

**Notes:** It [requests cancellation of a running transform and leaves the definition](https://github.com/dsouza-anush/sf-plugin-data360/blob/main/messages/data360.transform.cancel.md) (community).

- `success` means the action started, per the spec.
- The spec's streaming example has no `cancelAction`, so expect this for batch. No source states that outright.

## transform_rebuild

`POST /ssot/data-transforms/{dataTransformNameOrId}/actions/rebuild` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Transforms/paths/~1ssot~1data-transforms~1%7BdataTransformNameOrId%7D~1actions~1rebuild/post) · evidence O · changes org state

Rebuild a streaming data transform. Since v61.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `data_transform_name_or_id` | `dataTransformNameOrId` | path | string | yes | Record ID or API name of the data transform. Since v61.0. |
| `requested_by` | `requestedBy` | query | string |  | ID of the user requesting the rebuild. Since v61.0. |
| `transforms` | `transforms` | body | array of string |  | Data transform API names or record IDs to rebuild. No source explains how this list relates to the transform in the path. Since v61.0. |

```sql
CALL cdp.transform_rebuild (data_transform_name_or_id => 'AccountAnon');
```

**Result**

One row. Schema `CdpDataTransformActionResponseRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `errors` | `errors` | JSON (array of CdpErrorRepresentation) | List of errors that resulted from the action. Since v57.0. |
| `success` | `success` | BOOLEAN | Indicates whether the action was initiated successfully (`true`) or not (`false`). Since v57.0. |
| `request_id` | `requestId` | VARCHAR | Request ID assigned to this data transform run request for tracking. Since v67.0. |
| `should_force_full_run` | `shouldForceFullRun` | BOOLEAN | Indicates whether to force the transform to run in full mode (`true`) or not (`false`). Since v60.0. |

**Done when:** `transform_run_history_list.histories[].status` is `RebuildSuccess` or `RebuildFailure`. `Rebuilding` and `RebuildPending` come before them.

**Notes:** Streaming only, per the spec. A [release note](https://help.salesforce.com/s/articleView?id=release-notes.rn_c360_truth.htm&language=en_US&release=250&type=5) says an edit to a streaming transform takes effect on incoming data at save, and rebuilding the target DLO applies it to existing data too. [Help](https://help.salesforce.com/s/articleView?id=data.c360_a_streaming_transform_overview.htm&language=en_US&type=5) also recommends a rebuild to keep target data consistent.

- While it runs, validation can report `TargetDLOIsRebuilding` (in the spec's enum).
- `transform_status_refresh` is a different action, though the spec's streaming example labels this path `refreshStatusAction`.
- No source gives the duration or credit cost.

## transform_status_refresh

`POST /ssot/data-transforms/{dataTransformNameOrId}/actions/refresh-status` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Transforms/paths/~1ssot~1data-transforms~1%7BdataTransformNameOrId%7D~1actions~1refresh-status/post) · evidence O · changes org state

Refresh the status of a data transform. Since v60.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `data_transform_name_or_id` | `dataTransformNameOrId` | path | string | yes | Name or ID of the data transform to refresh. |

```sql
CALL cdp.transform_status_refresh (data_transform_name_or_id => 'account_summary');
```

**Result**

One row. Schema `CdpDataTransformActionResponseRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `errors` | `errors` | JSON (array of CdpErrorRepresentation) | List of errors that resulted from the action. Since v57.0. |
| `success` | `success` | BOOLEAN | Indicates whether the action was initiated successfully (`true`) or not (`false`). Since v57.0. |
| `request_id` | `requestId` | VARCHAR | Request ID assigned to this data transform run request for tracking. Since v67.0. |
| `should_force_full_run` | `shouldForceFullRun` | BOOLEAN | Indicates whether to force the transform to run in full mode (`true`) or not (`false`). Since v60.0. |

**Notes:** The response has only `success` and `errors` ([sf-pi](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/references/data-shapes.md)), not the status. Read it with `transform_get` afterwards.

- [sf-pi](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/registry/connect-openapi-overrides.json) saw 201 from a live org, where the spec says 200. Accept either.
- For a streaming transform, don't use `action_urls.refreshStatusAction`. The spec's example points it at `/actions/rebuild`.

## transform_retry

`POST /ssot/data-transforms/{dataTransformNameOrId}/actions/retry` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Transforms/paths/~1ssot~1data-transforms~1%7BdataTransformNameOrId%7D~1actions~1retry/post) · evidence O · changes org state

Retry a data transform. Since v60.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `data_transform_name_or_id` | `dataTransformNameOrId` | path | string | yes | Name or ID of the data transform to retry. |

```sql
CALL cdp.transform_retry (data_transform_name_or_id => 'account_summary');
```

**Result**

One row. Schema `CdpDataTransformActionResponseRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `errors` | `errors` | JSON (array of CdpErrorRepresentation) | List of errors that resulted from the action. Since v57.0. |
| `success` | `success` | BOOLEAN | Indicates whether the action was initiated successfully (`true`) or not (`false`). Since v57.0. |
| `request_id` | `requestId` | VARCHAR | Request ID assigned to this data transform run request for tracking. Since v67.0. |
| `should_force_full_run` | `shouldForceFullRun` | BOOLEAN | Indicates whether to force the transform to run in full mode (`true`) or not (`false`). Since v60.0. |

**Done when:** `transform_get.last_run_status` leaves `Pending` and `InProgress`.

**Notes:** It [retries the most recent eligible failed execution](https://github.com/dsouza-anush/sf-plugin-data360/blob/main/messages/data360.transform.retry.md) (community). The spec doesn't say which runs are eligible. Its examples show `retryAction` on both batch and streaming.

## transform_run

`POST /ssot/data-transforms/{dataTransformNameOrId}/actions/run` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Transforms/paths/~1ssot~1data-transforms~1%7BdataTransformNameOrId%7D~1actions~1run/post) · tool `d360_transform_run` · evidence O · changes org state

Run a data transform. Since v60.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `data_transform_name_or_id` | `dataTransformNameOrId` | path | string | yes | Name or ID of the data transform to run. |
| `definition_name` | `definitionName` | body | string |  | Not in the spec schema (MCP server). |
| `should_force_full_run` | `shouldForceFullRun` | body | boolean |  | Not in the spec schema (MCP server). |

```sql
CALL cdp.transform_run (data_transform_name_or_id => 'account_summary');
```

**Result**

One row. Schema `CdpDataTransformActionResponseRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `errors` | `errors` | JSON (array of CdpErrorRepresentation) | List of errors that resulted from the action. Since v57.0. |
| `success` | `success` | BOOLEAN | Indicates whether the action was initiated successfully (`true`) or not (`false`). Since v57.0. |
| `request_id` | `requestId` | VARCHAR | Request ID assigned to this data transform run request for tracking. Since v67.0. |
| `should_force_full_run` | `shouldForceFullRun` | BOOLEAN | Indicates whether to force the transform to run in full mode (`true`) or not (`false`). Since v60.0. |

**Done when:** `transform_get.last_run_status` leaves `Pending` and `InProgress`. Then `transform_run_history_list` has the job. Since v67, `request_id` here and `histories[].requestId` both identify the run, though no source says they match.

**Notes:** Batch only. The spec lists these 400s: "Unable to run streaming transform", "Unable to run inactive transform" and "Definition name is required for multi-definition transforms". So wait for `status` = `Active`.

**Missing options.** The spec declares no body, yet that last 400 needs a definition name. The [MCP request class](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/model/request/datatransform/DataTransformRunRequest.java) sends `definition_name` and `should_force_full_run` in the body, and [sf-pi](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/references/data-shapes.md) sees `should_force_full_run` in the response. Neither is an option here yet.

**Full or incremental.** [Help](https://help.salesforce.com/apex/HTViewHelpDoc?id=data.c360_a_batch_transform_run_types.htm) says the run type is chosen automatically and can't be configured, which `should_force_full_run` seems to contradict. It says manual runs, joins, aggregations and multi-row formulas force a full run, and an unchanged run is skipped (`SkippedNoChanges`). [Help](https://help.salesforce.com/s/articleView?id=sf.c360_a_batch_transform_data_drift.htm&language=en_US&type=5) adds that incremental runs can drift, so a full run happens every 24 hours. In the UI, [the `Replace` write mode attempts incremental runs and `Upsert` loads all input every run](https://help.salesforce.com/s/articleView?id=sf.c360_a_batch_transform_create.htm&language=en_US&type=5).

**Cost and retries.**

- Runs [consume Data Services credits](https://github.com/dsouza-anush/sf-plugin-data360/blob/main/messages/data360.transform.run.md) (community).
- That CLI [checks status before retrying](https://github.com/dsouza-anush/sf-plugin-data360/blob/main/src/commands/data360/transform/run.ts) after a timeout, since the outcome is unknown (community).
- Concurrent batch runs are [50 on one limits page](https://help.salesforce.com/s/articleView?language=en_US&id=sf.c360_a_limits_and_guidelines.htm) and [5 on another](https://help.salesforce.com/s/articleView?language=en_US&id=sf.c360_a_limits_and_guidelines_cdp.htm&type=5).

## transform_update

`PUT /ssot/data-transforms/{dataTransformNameOrId}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Transforms/paths/~1ssot~1data-transforms~1%7BdataTransformNameOrId%7D/put) · tool `d360_transform_update` · evidence O · changes org state

Update a data transform. Since v60.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `data_transform_name_or_id` | `dataTransformNameOrId` | path | string | yes | Name or ID of the data transform to update. |
| `filter_group` | `filterGroup` | query | string |  | Group on which to filter response results. Valid values are `Big`, `Medium`, and `Small`. - `Big` provides comprehensive results by returning properties whose filter group is `Big`, `Medium`, or `Small`. - `Medium` provides moderate results by returning properties whose filter group is `Medium` or `Small`. - `Small` provides essential results by returning only properties whose filter group is `Small`. The default is `Big`. Since v60.0. |
| `currency_iso_code` | `currencyIsoCode` | body | string |  | Currency ISO code of the data transform. Since v62.0. |
| `dataspace_name` | `dataSpaceName` | body | string |  | Data space that the data transform belongs to. Required for DMO-based data transforms. Since v60.0. |
| `definition` | `definition` | body | one of [DcSqlDataTransformDefinitionInput](#dcsqldatatransformdefinitioninputrepresentation), [StlDataTransformDefinitionInput](#stldatatransformdefinitioninputrepresentation), [SqlDataTransformDefinitionInput](#sqldatatransformdefinitioninputrepresentation) | yes | Single definition. Its shape depends on the definition type: [DCSQL](#dcsqldatatransformdefinitioninputrepresentation), [SQL](#sqldatatransformdefinitioninputrepresentation) or [STL](#stldatatransformdefinitioninputrepresentation). The spec marks it required, yet its multi-definition examples send `definitions` without it. Since v60.0. |
| `definitions` | `definitions` | body | array of [DataTransformDefinitionInput](#datatransformdefinitioninputrepresentation) |  | List of definitions for batch transforms. Since v63.0. |
| `description` | `description` | body | string |  | Description of the data transform. Since v60.0. |
| `full_run_frequency` | `fullRunFrequency` | body | enum(Daily, Monthly, Weekly) |  | Full run frequency of the data transform. Since v60.0. |
| `label` | `label` | body | string | yes | Label of the data transform. Since v60.0. |
| `name` | `name` | body | string | yes | Name of the data transform. Since v60.0. |
| `primary_source` | `primarySource` | body | string |  | In cases where the transformation contains table joins, describes the primary source. Since v60.0. |
| `type` | `type` | body | enum(BATCH, STREAMING) | yes | Type of data transform. Since v60.0. |
| `creation_type` | `creationType` | body | string |  | Not in the spec schema: from the MCP server's request class. |

```sql
CALL cdp.transform_update (
  data_transform_name_or_id => 'account_summary',
  name => 'account_summary',
  label => 'Account Summary',
  type => 'BATCH',
  definition => (
    type = 'DCSQL',
    version = '1.0',
    manifest = (nodes = (
      account_summary_output = (
        name = 'account_summary_output',
        relation_name = 'Account_Summary__dll',
        config = (materialized = 'table', writeMode = 'OVERWRITE'),
        compiled_code = $$SELECT "Id__c", "Name__c" FROM "Account__dlm" WHERE "AnnualRevenue__c" > 1000000$$
      )
    )),
    output_data_objects = [(
      name = 'Account_Summary__dll',
      label = 'Account Summary',
      category = 'Profile',
      type = 'dataLakeObject',
      fields = [
        (name = 'Id__c', label = 'Account ID', type = 'Text', is_primary_key = true),
        (name = 'Name__c', label = 'Account Name', type = 'Text', is_primary_key = false)
      ]
    )]
  )
);
```

**Result**

One row. Schema `DataTransformRepresentation`.

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
| `action_urls` | `actionUrls` | JSON (BatchActionRepresentation) | Actions available for the data transform. Since v60.0. |
| `creation_type` | `creationType` | VARCHAR | Creation type of the data transform. Since v60.0. |
| `dataspace_name` | `dataSpaceName` | VARCHAR | Data space for the data transform. Since v60.0. |
| `definition` | `definition` | JSON | Base definition for the data transform. The endpoint returns the definition output object that corresponds to the type of data transform. For example, the Stl Data Transform Definition Output is returned for the `Stl` and `StlHidden` types. Since v60.0. |
| `definitions` | `definitions` | JSON (array of DataTransformDefinitionRepresentation) | List of definitions for batch data transforms. Since v63.0. |
| `description` | `description` | VARCHAR | Description of the data transform. Since v60.0. |
| `full_run_frequency` | `fullRunFrequency` | VARCHAR | Full run frequency of the data transform. Since v63.0. |
| `last_run_date` | `lastRunDate` | VARCHAR | Last date the data transform was run. Since v60.0. |
| `last_run_error_code` | `lastRunErrorCode` | JSON (CdpErrorRepresentation) | Error code of the last run. Since v60.0. |
| `last_run_status` | `lastRunStatus` | VARCHAR | Status of the last run. Since v60.0. |
| `schedule` | `schedule` | JSON (ScheduleRepresentation) | The schedule for the data transform. Since v60.0. |
| `status` | `status` | VARCHAR | The status of the data transform. Since v60.0. |
| `type` | `type` | VARCHAR | Type of data transform. Since v60.0. |
| `version` | `version` | BIGINT | Version of the data transform. Since v60.0. |

**Notes:** **Send the whole transform.** The spec shares its input schema with create, so `definition`, `label`, `name` and `type` are required on this `PUT`. The [MCP request class](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/model/request/datatransform/DataTransformUpdateRequest.java) says the opposite: all fields optional "to support partial updates", and it mentions `PATCH`, though the tool sends `PUT`. Neither has been tested here, so read with `transform_get` and resend everything. What a `PUT` does to omitted optional fields isn't documented.

**Multi-definition rules.** The spec's 400s: "Streaming data transform cannot have multiple definitions", "Batch data transform definition limit exceeded" ([5 in Help](https://help.salesforce.com/s/articleView?id=sf.c360_a_batch_transform_limitations.htm&language=en_US&type=5)) and "Multi-definition transform cannot be moved to single definition".

**Can a streaming transform change?** Sources disagree. [Help](https://help.salesforce.com/s/articleView?id=data.c360_a_streaming_transform_considerations.htm&language=en_US&type=5) says you can't change one after saving, and to delete and recreate it. A [release note](https://help.salesforce.com/s/articleView?id=release-notes.rn_c360_truth.htm&language=en_US&release=250&type=5) says the name and SQL expression can change, effective on incoming data at save, with a [rebuild](#transform_rebuild) for existing data.

**Spec example.** It uses `key_qualifier_field`, while the schema has `key_qualifier_field_name`. Follow the schema. It also shows `schedule` with `interval` and `days_of_week` inside a definition, which the [schedule schema](segments.md#cdphourlyscheduleinputrepresentation) covers.

## transform_schedule_set

`PUT /ssot/data-transforms/{dataTransformNameOrId}/schedule` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Transforms/paths/~1ssot~1data-transforms~1%7BdataTransformNameOrId%7D~1schedule/put) · tool `d360_transform_schedule_set` · evidence O · changes org state

Update a data transform's schedule. Since v60.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `data_transform_name_or_id` | `dataTransformNameOrId` | path | string | yes | Name or ID of the data transform. |
| `definition_name` | `definitionName` | body | string |  | Name of the schedule definition. Since v63.0. |
| `frequency` | `frequency` | body | enum(Daily, Hourly, None) | yes | Frequency on which the schedule is run. `None` removes the schedule and is the default. Since v58.0. |
| `should_force_specified_minutes` | `shouldForceSpecifiedMinutes` | body | boolean |  | Only applicable to data transforms. If `true`, the consumer's schedule is used. If `false`, the transform is distributed over an hour to avoid hourly hotspots. Set to `true` only when the schedule is critical. If unspecified, the default value is `false`. Since v64.0. |
| `time` | `time` | body | [CdpTimeInput](#cdptimeinputrepresentation) | yes | When to run the schedule. Since v58.0. |
| `interval` | `interval` | body | string |  | Not in the spec schema: sf-pi records it as required by the platform. |
| `days_of_week` | `daysOfWeek` | body | array |  | Not in the spec schema (sf-pi). |
| `day_of_week` | `dayOfWeek` | body | string |  | Not in the spec schema: from the MCP server's request class. |
| `week_of_month` | `weekOfMonth` | body | string |  | Not in the spec schema: from the MCP server's request class. |
| `days_of_month` | `daysOfMonth` | body | array |  | Not in the spec schema: from the MCP server's request class. |

```sql
CALL cdp.transform_schedule_set (data_transform_name_or_id => 'account_summary', frequency => 'Daily', time => (hour = 2, minute = 0, time_zone = 'America/Los_Angeles'));
```

**Result**

One row. Schema `CdpScheduleBaseRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `frequency` | `frequency` | VARCHAR | - |
| `next_scheduled_date` | `nextScheduledDate` | VARCHAR | - |
| `time_info` | `timeInfo` | JSON (TimeOutputRepresentation) | - |
| `days_of_week` | `daysOfWeek` | JSON | - |
| `interval` | `interval` | BIGINT | - |
| `run_from` | `runFrom` | JSON (TimeOutputRepresentation) | - |
| `run_to` | `runTo` | JSON (TimeOutputRepresentation) | - |
| `type` | `type` | VARCHAR | Type of schedule frequency. The endpoint returns the schedule output object that corresponds to the type of schedule frequency. Only `Daily`, `Hourly`, or `None` are supported for data transforms. For example, the Daily Schedule Output is returned for the `Daily` publish frequency. Since v58.0. |
| `time` | `time` | JSON (CdpTimeRepresentation) | - |

**Notes:** **`interval` is missing from the table.** [sf-pi](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/references/data-shapes.md) says the platform requires it, from 1 to 31, although the spec lists only `frequency` and `time`. So this example may be rejected until the option exists. The spec has `interval` and `days_of_week` on the [hourly input](segments.md#cdphourlyscheduleinputrepresentation), and its example uses `Hourly`, `interval` = 8 and `days_of_week` = `Wednesday`, `Thursday`, `Friday`. sf-pi's daily example sends `interval` = 1.

**Frequencies disagree.** The spec's response text says only `Daily`, `Hourly` and `None` apply to transforms. The [MCP request class](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/model/request/datatransform/DataTransformScheduleRequest.java) also lists `Monthly`, `MonthlyRelative` and `Weekly`, and spells days `MONDAY` where the spec has `Monday`.

**Other rules:**

- `frequency` = `None` [clears the schedule](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/references/data-shapes.md). The spec still marks `time` required, so send it.
- `time.minute` isn't exact by default: with `should_force_specified_minutes` = `false`, the run is spread over the hour. The [MCP class](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/model/request/datatransform/DataTransformScheduleRequest.java) calls that field hidden from REST and leaves it out, while the spec documents it since v64.
- `time_zone` is camelCase. [`time_zone` is rejected](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/references/data-shapes.md) with `JSON_PARSER_ERROR`.
- Multi-definition transforms: set `definition_name`.
- [A run due while the previous one is still going is skipped](https://help.salesforce.com/s/articleView?id=sf.c360_a_batch_transform_schedule.htm&language=en_US&type=5). Runs never overlap.
- This is a batch feature. Streaming transforms [run continually](https://trailhead.salesforce.com/content/learn/modules/batch-data-transforms-in-data-cloud-quick-look/get-started-with-batch-data-transforms-in-data-360).

## Schemas

Attribute names are keywords inside the object they belong to, so completion offers exactly these.

### AggregateInputRepresentation

Represents the input for an aggregation.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `action` | `action` | enum(Avg, Count, Maximum, Median, Minimum, StdDev, StdDevP, Sum, Unique, Var, VarP) | yes | Action to execute on the aggregation. Since v60.0. |
| `label` | `label` | string | yes | Label of field that is created after the aggregation. Since v60.0. |
| `name` | `name` | string | yes | Name of the field that is created after the aggregation. Since v60.0. |
| `source` | `source` | string | yes | Name of the field that is the source of the aggregation. Since v60.0. |

### AggregateParametersInputRepresentation

Represents the aggregate node parameters input.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `aggregations` | `aggregations` | array of [AggregateInput](#aggregateinputrepresentation) | yes | Aggregations. Since v60.0. |
| `groupings` | `groupings` | array of string | yes | Groupings. Since v60.0. |
| `node_type` | `nodeType` | enum(Hierarchical, Standard) | yes | Determines which fields are required. Hierarchical requires: `parent_field` and `self_field`. `percentage_field` is optional. Standard requires `aggregations`. Since v60.0. |
| `parent_field` | `parentField` | string | yes | Defines the parent field in the hierarchical aggregate mode. Since v60.0. |
| `percentage_field` | `percentageField` | string | yes | Percentage field. Since v60.0. |
| `pivot_v2` | `pivot_v2` | [PivotV2Input](#pivotv2inputrepresentation) | yes | Pivot v2. Since v60.0. |
| `self_field` | `selfField` | string | yes | Defines the self field in the hierarchical aggregate mode. Since v60.0. |

### CdpScheduleInputRepresentation

Base schedule input representation.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `definition_name` | `definitionName` | string |  | Name of the schedule definition. Since v63.0. |
| `frequency` | `frequency` | enum(Daily, Hourly, None) | yes | Frequency on which the schedule is run. `None` removes the schedule and is the default. Since v58.0. |
| `should_force_specified_minutes` | `shouldForceSpecifiedMinutes` | boolean |  | Only applicable to data transforms. If `true`, the consumer's schedule is used. If `false`, the transform is distributed over an hour to avoid hourly hotspots. Set to `true` only when the schedule is critical. If unspecified, the default value is `false`. Since v64.0. |
| `time` | `time` | [CdpTimeInput](#cdptimeinputrepresentation) | yes | When to run the schedule. Since v58.0. |
| `days_of_week` | `daysOfWeek` | array |  | Not in the spec schema: from the spec's examples. |
| `interval` | `interval` | integer |  | Not in the spec schema: from the spec's examples. |

### CdpTimeInputRepresentation

Time input source for when to run the schedule.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `hour` | `hour` | integer | yes | Hour when the schedule should run, [0 to 23](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/model/request/datatransform/DataTransformTimeInput.java). Since v60.0. |
| `minute` | `minute` | integer | yes | Minute in the hour when the schedule should run, [0 to 59](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/model/request/datatransform/DataTransformTimeInput.java). Exact only with `should_force_specified_minutes`. Since v60.0. |
| `time_zone` | `timeZone` | string | yes | Time zone of the schedule, such as `America/Los_Angeles`. Since v60.0. |

### DataObjectFieldInputRepresentation

Represents the input fields in the data object.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `is_primary_key` | `isPrimaryKey` | boolean | yes | Indicates whether this field is a primary key (`true`) or not (`false`). A create needs at least one `true` (tool text). Since v60.0. |
| `key_qualifier_field_name` | `keyQualifierFieldName` | string |  | Key qualifier field name. The MCP request class calls this `key_qualifier_field`. The spec's example omits it and gets a generated `KQ_<field>` back. Since v60.0. |
| `label` | `label` | string | yes | Label of the field. Since v60.0. |
| `name` | `name` | string | yes | Name of the field. The spec's example omits `__c` and gets it back with the suffix, while a community example passes `event_id__c`. Since v60.0. |
| `type` | `type` | enum(Boolean, Date, DateOnly, DateTime, Email, Number, Percent, Phone, Text, Url) |  | Data type of the field. **Conflict:** the spec's schema says `type`, while its examples, the [MCP request class](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/model/request/dmo/DataObjectFieldInput.java) and two community clients send `data_type`, and a community template uses `type`. The MCP class takes `type` only as an input alias and sends `data_type`. The spec's 400 text rejects fields with no data type. |
| `description` | `description` | string |  | Not in the spec schema: from the spec's examples. |
| `is_dynamic_lookup` | `isDynamicLookup` | boolean |  | Not in the spec schema: from the spec's examples. |
| `data_type` | `dataType` | string |  | Not in the spec schema: from the spec's examples. |
| `key_qualifier_field` | `keyQualifierField` | string |  | Not in the spec schema: from the spec's examples. |

### DataObjectInputRepresentation

Input representation for a data object in Data 360.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `dataspace_name` | `dataSpaceName` | string |  | Name of the data space. If unspecified, the `default` data space is used. This property is required for data graph resources. Since v59.0. |
| `description` | `description` | string |  | Description of the object to create. Since v59.0. |
| `label` | `label` | string |  | Label of the object to create. This property is required for data graph resources. Since v59.0. |
| `name` | `name` | string |  | API name of the object to create. This property is required for data graph resources. Since v59.0. |
| `category` | `category` | enum(Engagement, Other, Profile) |  | Category of the data object. Since v60.0. |
| `event_date_time_field_name` | `eventDateTimeFieldName` | string |  | Name of the event date and time field. This property is required when the value of the category property is `Engagement`. Since v60.0. |
| `fields` | `fields` | array of [DataObjectFieldInput](#dataobjectfieldinputrepresentation) |  | Fields in the data object. Since v60.0. |
| `record_modified_field_name` | `recordModifiedFieldName` | string |  | Record modified field name. Since v60.0. |
| `type` | `type` | enum(DataLakeObject, DataModelObject) |  | Type of data object. Since v60.0. |

### DataTransformDefinitionInputRepresentation

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `label` | `label` | string |  | Label of the transform definition. Since v63.0. |
| `name` | `name` | string |  | Name of the transform definition. Since v63.0. |
| `output_data_objects` | `outputDataObjects` | array of [DataObjectInput](#dataobjectinputrepresentation) |  | Information about the objects into which the data transform writes the transformed data. Since v60.0. |
| `schedule` | `schedule` | [CdpScheduleInput](#cdpscheduleinputrepresentation) |  | Schedule for running the transform. Applies to transforms that use the definitions array structure (which can contain one or more definitions). Does not apply to legacy transforms with a single definition field. Since v67.0. |
| `type` | `type` | enum(DbtHidden, DcSql, Sql, SqlHidden, Stl, StlHidden) | yes | Type of definition. Since v60.0. |
| `version` | `version` | string | yes | Version of the transform. Since v60.0. |
| `nodes` | `nodes` | [DataTransformDefinitionInput_nodes](#datatransformdefinitioninput_nodes) |  | Not in the spec schema: from the spec's examples. |
| `ui` | `ui` | [DataTransformDefinitionInput_ui](#datatransformdefinitioninput_ui) |  | Not in the spec schema: from the spec's examples. |

### DataTransformDefinitionInput_nodes

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `load_dataset0` | `LOAD_DATASET0` | [DataTransformDefinitionInput_nodes_LOAD_DATASET0](#datatransformdefinitioninput_nodes_load_dataset0) |  | Seen in examples: the spec types the parent as a free-form object. |
| `output0` | `OUTPUT0` | [DataTransformDefinitionInput_nodes_OUTPUT0](#datatransformdefinitioninput_nodes_output0) |  | Seen in examples: the spec types the parent as a free-form object. |

### DataTransformDefinitionInput_nodes_LOAD_DATASET0

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `action` | `action` | string |  | Seen in examples: the spec types the parent as a free-form object. |
| `parameters` | `parameters` | [DataTransformDefinitionInput_nodes_LOAD_DATASET0_parameters](#datatransformdefinitioninput_nodes_load_dataset0_parameters) |  | Seen in examples: the spec types the parent as a free-form object. |
| `sources` | `sources` | array |  | Seen in examples: the spec types the parent as a free-form object. |

### DataTransformDefinitionInput_nodes_LOAD_DATASET0_parameters

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `dataset` | `dataset` | [DataTransformDefinitionInput_nodes_LOAD_DATASET0_parameters_dataset](#datatransformdefinitioninput_nodes_load_dataset0_parameters_dataset) |  | Seen in examples: the spec types the parent as a free-form object. |
| `fields` | `fields` | array |  | Seen in examples: the spec types the parent as a free-form object. |
| `sample_details` | `sampleDetails` | [DataTransformDefinitionInput_nodes_LOAD_DATASET0_parameters_sampleDetails](#datatransformdefinitioninput_nodes_load_dataset0_parameters_sampledetails) |  | Seen in examples: the spec types the parent as a free-form object. |

### DataTransformDefinitionInput_nodes_LOAD_DATASET0_parameters_dataset

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `name` | `name` | string |  | Seen in examples: the spec types the parent as a free-form object. |
| `type` | `type` | string |  | Seen in examples: the spec types the parent as a free-form object. |

### DataTransformDefinitionInput_nodes_LOAD_DATASET0_parameters_sampleDetails

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `sort_by` | `sortBy` | array |  | Seen in examples: the spec types the parent as a free-form object. |
| `type` | `type` | string |  | Seen in examples: the spec types the parent as a free-form object. |

### DataTransformDefinitionInput_nodes_OUTPUT0

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `action` | `action` | string |  | Seen in examples: the spec types the parent as a free-form object. |
| `parameters` | `parameters` | [DataTransformDefinitionInput_nodes_OUTPUT0_parameters](#datatransformdefinitioninput_nodes_output0_parameters) |  | Seen in examples: the spec types the parent as a free-form object. |
| `sources` | `sources` | array |  | Seen in examples: the spec types the parent as a free-form object. |

### DataTransformDefinitionInput_nodes_OUTPUT0_parameters

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `dedup_order` | `dedupOrder` | array |  | Seen in examples: the spec types the parent as a free-form object. |
| `fields_mappings` | `fieldsMappings` | array of [DataTransformDefinitionInput_nodes_OUTPUT0_parameters_fieldsMappings](#datatransformdefinitioninput_nodes_output0_parameters_fieldsmappings) |  | Seen in examples: the spec types the parent as a free-form object. |
| `name` | `name` | string |  | Seen in examples: the spec types the parent as a free-form object. |
| `type` | `type` | string |  | Seen in examples: the spec types the parent as a free-form object. |
| `write_mode` | `writeMode` | string |  | Seen in examples: the spec types the parent as a free-form object. |

### DataTransformDefinitionInput_nodes_OUTPUT0_parameters_fieldsMappings

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `source_field` | `sourceField` | string |  | Seen in examples: the spec types the parent as a free-form object. |
| `target_field` | `targetField` | string |  | Seen in examples: the spec types the parent as a free-form object. |

### DataTransformDefinitionInput_ui

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `nodes` | `nodes` | [DataTransformDefinitionInput_ui_nodes](#datatransformdefinitioninput_ui_nodes) |  | Seen in examples: the spec types the parent as a free-form object. |
| `connectors` | `connectors` | array of [DataTransformDefinitionInput_ui_connectors](#datatransformdefinitioninput_ui_connectors) |  | Seen in examples: the spec types the parent as a free-form object. |
| `hidden_columns` | `hiddenColumns` | array |  | Seen in examples: the spec types the parent as a free-form object. |

### DataTransformDefinitionInput_ui_connectors

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `source` | `source` | string |  | Seen in examples: the spec types the parent as a free-form object. |
| `target` | `target` | string |  | Seen in examples: the spec types the parent as a free-form object. |

### DataTransformDefinitionInput_ui_nodes

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `load_dataset0` | `LOAD_DATASET0` | [DataTransformDefinitionInput_ui_nodes_LOAD_DATASET0](#datatransformdefinitioninput_ui_nodes_load_dataset0) |  | Seen in examples: the spec types the parent as a free-form object. |
| `output0` | `OUTPUT0` | [DataTransformDefinitionInput_ui_nodes_OUTPUT0](#datatransformdefinitioninput_ui_nodes_output0) |  | Seen in examples: the spec types the parent as a free-form object. |

### DataTransformDefinitionInput_ui_nodes_LOAD_DATASET0

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `label` | `label` | string |  | Seen in examples: the spec types the parent as a free-form object. |
| `type` | `type` | string |  | Seen in examples: the spec types the parent as a free-form object. |
| `top` | `top` | integer |  | Seen in examples: the spec types the parent as a free-form object. |
| `left` | `left` | integer |  | Seen in examples: the spec types the parent as a free-form object. |
| `parameters` | `parameters` | [DataTransformDefinitionInput_ui_nodes_LOAD_DATASET0_parameters](#datatransformdefinitioninput_ui_nodes_load_dataset0_parameters) |  | Seen in examples: the spec types the parent as a free-form object. |

### DataTransformDefinitionInput_ui_nodes_LOAD_DATASET0_parameters

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `sample_size` | `sampleSize` | integer |  | Seen in examples: the spec types the parent as a free-form object. |
| `sample_details` | `sampleDetails` | [DataTransformDefinitionInput_ui_nodes_LOAD_DATASET0_parameters_sampleDetails](#datatransformdefinitioninput_ui_nodes_load_dataset0_parameters_sampledetails) |  | Seen in examples: the spec types the parent as a free-form object. |

### DataTransformDefinitionInput_ui_nodes_LOAD_DATASET0_parameters_sampleDetails

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `type` | `type` | string |  | Seen in examples: the spec types the parent as a free-form object. |
| `dataspace` | `dataspace` | string |  | Seen in examples: the spec types the parent as a free-form object. |

### DataTransformDefinitionInput_ui_nodes_OUTPUT0

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `label` | `label` | string |  | Seen in examples: the spec types the parent as a free-form object. |
| `type` | `type` | string |  | Seen in examples: the spec types the parent as a free-form object. |
| `top` | `top` | integer |  | Seen in examples: the spec types the parent as a free-form object. |
| `left` | `left` | integer |  | Seen in examples: the spec types the parent as a free-form object. |

### DataTransformNodeInputRepresentation

Represents a single node in a series of nodes that make up a batch data transform.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `parameters` | `parameters` | [AggregateParametersInput](#aggregateparametersinputrepresentation) |  | - |
| `action` | `action` | enum(Aggregate, Append_V2, Bucket, ComputeRelative, DateFormatConversion, Extension, Extract, Filter, Formula, Join, Load, OutputD360, Recommendation, Save, Schema, Split, SqlFilter, TypeCast, Update) | yes | Action that determines the type of node. Use the node input object that corresponds to the type of action. For example, use the Aggregate Node Input for the `Aggregate` action. Since v60.0. |
| `schema` | `schema` | [SchemaParametersInput](#schemaparametersinputrepresentation) |  | Schema changes for the node. Since v60.0. |
| `sources` | `sources` | array of string | yes | Source node IDs. Since v60.0. |

### DcSqlDataTransformDefinitionInputRepresentation

Represents the input definition for Dc Sql data transforms.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `label` | `label` | string |  | Label of the transform definition. Since v63.0. |
| `name` | `name` | string |  | Name of the transform definition. Since v63.0. |
| `output_data_objects` | `outputDataObjects` | array of [DataObjectInput](#dataobjectinputrepresentation) |  | Information about the objects into which the data transform writes the transformed data. Since v60.0. |
| `schedule` | `schedule` | [CdpScheduleInput](#cdpscheduleinputrepresentation) |  | Schedule for running the transform. Applies to transforms that use the definitions array structure (which can contain one or more definitions). Does not apply to legacy transforms with a single definition field. Since v67.0. |
| `type` | `type` | enum(DbtHidden, DcSql, Sql, SqlHidden, Stl, StlHidden) | yes | Type of definition. Definition type. `DCSQL` in the MCP examples, `DcSql` in the spec enum. Since v60.0. |
| `version` | `version` | string | yes | Version of the transform. `1.0` in the MCP examples. Since v60.0. |
| `manifest` | `manifest` | [DcSqlDataTransformManifestInput](#dcsqldatatransformmanifestinputrepresentation) |  | Manifest of the DC SQL data transform. Since v63.0. |

### DcSqlDataTransformDependsOn

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `nodes` | `nodes` | array of string |  | Names of the nodes this node depends on. |

### DcSqlDataTransformManifestInputRepresentation

Input representation of the DCSQL transform manifest format

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `macros` | `macros` | map to object |  | Manifest macros. Since v63.0. |
| `nodes` | `nodes` | map to object |  | SQL nodes, keyed by node name. The spec types input nodes as plain objects, so the node attributes come from its output form. Since v63.0. Each is a [DcSqlDataTransformNode](#dcsqldatatransformnode). |
| `sources` | `sources` | map to object |  | Manifest sources. Each has `relation_name`, the table read, in the output form. Since v63.0. |

### DcSqlDataTransformNode

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `name` | `name` | string |  | Node name. Other nodes refer to it in `depends_on` and in `FROM`. |
| `compiled_code` | `compiled_code` | string |  | The node's SQL. |
| `relation_name` | `relation_name` | string |  | Table this node writes to. Set on output nodes in the MCP examples. |
| `config` | `config` | [DcSqlDataTransformNodeConfiguration](#dcsqldatatransformnodeconfiguration) |  | Materialization and write mode. |
| `depends_on` | `depends_on` | [DcSqlDataTransformDependsOn](#dcsqldatatransformdependson) |  | Nodes this node reads. |
| `resource_type` | `resource_type` | enum(macro, model, source) |  | Type of node resource. Not used in the MCP examples. |

### DcSqlDataTransformNodeConfiguration

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `materialized` | `materialized` | enum(ephemeral, table) |  | `ephemeral` for intermediate nodes and `table` for outputs in the MCP examples. |
| `write_mode` | `writeMode` | enum(Append, DeleteOnly, Merge, MergeUpsertDelete, Overwrite) |  | Write mode for the node. The examples send `OVERWRITE`. |

### PivotV2InputRepresentation

Pivot v2 input representation.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `pivot_fields_info` | `pivotFieldsInfo` | string | yes | Pivot fields info. Since v60.0. |
| `source_fields` | `sourceFields` | array of string | yes | Source fields. Since v60.0. |
| `value_combinations` | `valueCombinations` | array of array of string | yes | Value combinations. Since v60.0. |

### SchemaFieldParametersInputRepresentation

Represents a schema node field.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `error_value` | `errorValue` | string | yes | Value to output on error. Since v60.0. |
| `name` | `name` | string | yes | Schema field name. Since v60.0. |
| `new_properties` | `newProperties` | [SchemaFieldPropertiesInput](#schemafieldpropertiesinputrepresentation) | yes | Field properties. Since v60.0. |

### SchemaFieldPropertiesInputRepresentation

Represents common field properties.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `label` | `label` | string | yes | Field label. Since v60.0. |
| `name` | `name` | string | yes | Field name. Since v60.0. |
| `type_properties` | `typeProperties` | [SchemaTypePropertiesCastInput](#schematypepropertiescastinputrepresentation) | yes | Field type properties. Since v60.0. |

### SchemaFormatSymbolsInputRepresentation

Represents the format for symbols.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `currency_symbol` | `currencySymbol` | string | yes | Currency symbol format. Since v60.0. |
| `decimal_symbol` | `decimalSymbol` | string | yes | Decimal symbol format. Since v60.0. |
| `grouping_symbol` | `groupingSymbol` | string | yes | Grouping symbol format. Since v60.0. |

### SchemaParametersInputRepresentation

Represents a schema node in Batch Data Transforms.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `fields` | `fields` | array of [SchemaFieldParametersInput](#schemafieldparametersinputrepresentation) | yes | Schema fields. Since v60.0. |
| `slice` | `slice` | [SchemaSliceInput](#schemasliceinputrepresentation) | yes | Schema slice definition. Since v60.0. |

### SchemaSliceInputRepresentation

Represents slice definition.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `fields` | `fields` | array of string | yes | List of fields for `Select` or `Drop`. Since v60.0. |
| `ignore_missing_fields` | `ignoreMissingFields` | boolean | yes | Indicates whether to ignore missing fields (`true`) or not (`false`). Since v60.0. |
| `mode` | `mode` | enum(Drop, Select) | yes | Slice mode. Since v60.0. |

### SchemaTypePropertiesCastInputRepresentation

Represents casting for types.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `format` | `format` | string | yes | DateTime format. Since v60.0. |
| `length` | `length` | integer | yes | Total length of text. Since v60.0. |
| `precision` | `precision` | integer | yes | Length of arbitrary precision value. Since v60.0. |
| `scale` | `scale` | integer | yes | Number of digits to right of decimal point. Since v60.0. |
| `symbols` | `symbols` | [SchemaFormatSymbolsInput](#schemaformatsymbolsinputrepresentation) | yes | Number format. Since v60.0. |
| `type` | `type` | enum(Boolean, DateOnly, DateTime, Number, Text) | yes | DataType to Convert to |

### SqlDataTransformDefinitionInputRepresentation

Defines a streaming data transform during a creation (post) request.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `label` | `label` | string |  | Label of the transform definition. Since v63.0. |
| `name` | `name` | string |  | Name of the transform definition. Since v63.0. |
| `output_data_objects` | `outputDataObjects` | array of [DataObjectInput](#dataobjectinputrepresentation) |  | Information about the objects into which the data transform writes the transformed data. Since v60.0. |
| `schedule` | `schedule` | [CdpScheduleInput](#cdpscheduleinputrepresentation) |  | Schedule for running the transform. Applies to transforms that use the definitions array structure (which can contain one or more definitions). Does not apply to legacy transforms with a single definition field. Since v67.0. |
| `type` | `type` | enum(DbtHidden, DcSql, Sql, SqlHidden, Stl, StlHidden) | yes | Type of definition. Definition type. `SQL` in the examples, `Sql` in the spec enum. Since v60.0. |
| `version` | `version` | string | yes | Version of the transform. `63.0` in the examples. The spec's validate example leaves it out. Since v60.0. |
| `expression` | `expression` | string |  | SQL expression for the streaming transform. Since v60.0. |
| `target_dlo` | `targetDlo` | string |  | Target data lake object (DLO) for the streaming transform. Since v60.0. |
| `target_dmo` | `targetDmo` | string |  | Target data model object (DMO) for the streaming transform. Since v60.0. |

### StlDataTransformDefinitionInputRepresentation

Defines a batch data transform during a creation (post) request.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `label` | `label` | string |  | Label of the transform definition. Since v63.0. |
| `name` | `name` | string |  | Name of the transform definition. Since v63.0. |
| `output_data_objects` | `outputDataObjects` | array of [DataObjectInput](#dataobjectinputrepresentation) |  | Information about the objects into which the data transform writes the transformed data. Since v60.0. |
| `schedule` | `schedule` | [CdpScheduleInput](#cdpscheduleinputrepresentation) |  | Schedule for running the transform. Applies to transforms that use the definitions array structure (which can contain one or more definitions). Does not apply to legacy transforms with a single definition field. Since v67.0. |
| `type` | `type` | enum(DbtHidden, DcSql, Sql, SqlHidden, Stl, StlHidden) | yes | Type of definition. Definition type. `STL` in the examples, `Stl` in the spec enum. Since v60.0. |
| `version` | `version` | string | yes | Version of the transform. `56.0` in the examples. Since v60.0. |
| `nodes` | `nodes` | [DataTransformNodeInput](#datatransformnodeinputrepresentation) |  | Transform nodes for the batch transform, each with `action`, `parameters` and `sources`. Since v62.0. |
| `ui` | `ui` | object |  | UI object info required for rendering in the interactive data transform editor. Since v62.0. |
