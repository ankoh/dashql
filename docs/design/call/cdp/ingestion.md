# Ingestion

Part of the [CDP function reference](functions.md). Nothing here is implemented or tested against an org. Every result also has the [standard columns](functions.md#result-schema).

Ingestion pushes records from an outside system into a Data 360 data lake object. There are [two patterns](https://developer.salesforce.com/docs/data/data-cloud-int/guide/c360-a-ingestion-api.md), and one connector can serve both. Streaming takes small JSON micro-batches through `ingest_insert` and `ingest_delete`. Bulk takes CSV through a job: create it, upload, close it, then poll `ingest_job_get`.

Nothing here works until three things exist, in this order: an Ingestion API connector, its uploaded schema, and a data stream for each object. The [official guide](https://developer.salesforce.com/docs/data/data-cloud-int/guide/c360-a-ingestion-api.md) does this in the UI. The API calls are [`connection_create`](connections.md#connection_create), [`connection_schema_upsert`](connections.md#connection_schema_upsert) and [`datastream_create`](data_streams.md#datastream_create), though a [community guide](https://github.com/Jaganpro/sf-skills/blob/main/skills/sf-datacloud-prepare/examples/ingestion-api/README.md) still creates the stream in the UI where the org requires it. All calls here use the tenant host and the Data 360 token, with the `cdp_ingest_api` scope.

What matters most:

- A 202 means accepted, not queryable. [Streaming runs about every 3 minutes, and the docs say to allow at least 30 seconds more](https://developer.salesforce.com/docs/data/data-cloud-int/references/data-cloud-ingestionapi-ref/c360-a-api-get-started.md) before querying.
- Records use the schema's field names. [API names like `Foo__c` produce one blank row](https://developer.salesforce.com/docs/data/data-cloud-int/guide/c360-a-ingestion-api-schema-req.md).
- [Schemas only grow](https://developer.salesforce.com/docs/data/data-cloud-int/guide/c360-a-ingestion-api-schema-req.md). You can't remove fields or objects, or change a field's type.
- [Bulk allows 20 requests or jobs per hour and 5 at once](https://developer.salesforce.com/docs/data/data-cloud-int/references/data-cloud-ingestionapi-ref/c360-a-api-get-started.md).
- Abandoned jobs in `Open` or `UploadComplete` are deleted after 7 days.

```sql
/* Streaming: validate, then send */
CALL cdp.ingest_test (name => 'ecomm', object_name => 'Orders', data => [(id = 'o-1', total = 77506)]);
CALL cdp.ingest_insert (name => 'ecomm', object_name => 'Orders', data => [(id = 'o-1', total = 77506)]);

/* Bulk: create, upload, close */
CALL cdp.ingest_job_create (object => 'Orders', source_name => 'ecomm', operation => 'upsert');
CALL cdp.ingest_job_upload (id => '913a8b00-7a9e-4331-aaf6-a019ae5021ab', csv => $$id,total
o-1,77506
$$);
CALL cdp.ingest_job_update (id => '913a8b00-7a9e-4331-aaf6-a019ae5021ab', state => 'UploadComplete');
```

**Functions:** [`ingest_insert`](#ingest_insert), [`ingest_delete`](#ingest_delete), [`ingest_test`](#ingest_test), [`ingest_job_create`](#ingest_job_create), [`ingest_job_list`](#ingest_job_list), [`ingest_job_get`](#ingest_job_get), [`ingest_job_upload`](#ingest_job_upload), [`ingest_job_update`](#ingest_job_update), [`ingest_job_delete`](#ingest_job_delete)

## ingest_insert

`POST /api/v1/ingest/sources/{name}/{object-name}` · [reference](https://developer.salesforce.com/docs/data/data-cloud-int/references/data-cloud-ingestionapi-ref/c360-a-api-insert-records.md) · evidence D · host tenant · changes org state

Streaming upsert: inserts new records and updates existing ones in the object's data lake table. Use it for small micro-batches in near-real time. Use a bulk job for large loads.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `name` | `name` | path | string | yes | Name of the Ingestion API connector, the same value as `source_name` on [`ingest_job_create`](#ingest_job_create). [The server may rewrite it on creation](connections.md#connection_create) (community). |
| `object_name` | `object-name` | path | string | yes | Object from the connector's uploaded schema. Fills the `{object-name}` path segment. |
| `data` | `data` | body | array of map to any | yes | Records to send, each a flat map of the schema's field names to values. Keys depend on the uploaded schema, so any key is valid here and completion can't offer them. |

```sql
CALL cdp.ingest_insert (
  name => 'ecomm',
  object_name => 'Orders',
  data => [
    (
      id = 'f19cae7e-5cdb-41ce-92ba-539afea04f9d',
      contact_name = 'Joe Smith',
      created_date = '2021-07-22T08:57:08.118Z',
      tax_exempt = false,
      total = 77506
    )
  ]
);
```

**Result**

One row.

| Column | API name | Type | Description |
|---|---|---|---|
| `accepted` | `accepted` | BOOLEAN | `true` when the request was accepted for asynchronous processing. |

**Done when:** The docs name no status call for streaming requests. Query the object: processing runs [about every 3 minutes, and allow at least 30 seconds more for caches](https://developer.salesforce.com/docs/data/data-cloud-int/references/data-cloud-ingestionapi-ref/c360-a-api-get-started.md).

**Notes:** **Limits.** [The body can be at most 200 KB, and all object endpoints together take 250 requests per second](https://developer.salesforce.com/docs/data/data-cloud-int/references/data-cloud-ingestionapi-ref/c360-a-api-get-started.md). A 429 means slow down.

**Failures.** The 202 comes before processing, so it says nothing about individual records. Run [`ingest_test`](#ingest_test) first. Validation failures [often surface in the Problem Records DLOs](https://github.com/Jaganpro/sf-skills/blob/main/skills/sf-datacloud-prepare/examples/ingestion-api/README.md) (community).

**Field names.** Use the names in the schema. [A payload with field API names isn't recognized](https://developer.salesforce.com/docs/data/data-cloud-int/guide/c360-a-ingestion-api-schema-req.md): the stream shows a single row with blank columns, because each call upserts the same empty record. The [streaming page](https://developer.salesforce.com/docs/data/data-cloud-int/references/data-cloud-ingestionapi-ref/c360-a-api-streaming-ingestion.md) says to get the object endpoints from the connector, which [`connection_endpoint_list`](connections.md#connection_endpoint_list) returns as YAML. [Objects can't nest](https://developer.salesforce.com/docs/data/data-cloud-int/guide/c360-a-ingestion-api-schema-req.md), so values are never maps.

**Formats.** [Dates are `yyyy-MM-dd`, and datetimes are `yyyy-MM-dd'T'HH:mm:ss.SSS'Z'`](https://developer.salesforce.com/docs/data/data-cloud-int/guide/c360-a-ingestion-api-schema-req.md).

**Partial updates.** [Send the primary key, the Record Modified field and the changed fields](https://developer.salesforce.com/docs/data/data-cloud-int/references/data-cloud-ingestionapi-ref/c360-a-api-insert-records.md). The update applies only if the Record Modified value is newer. The stream needs Refresh Mode `Partial`, which is limited to Profile and Other categories and [can't change after the stream is created](https://developer.salesforce.com/docs/data/data-cloud-int/guide/c360-a-create-ingestion-data-stream.md). Otherwise, the [validation page](https://developer.salesforce.com/docs/data/data-cloud-int/references/data-cloud-ingestionapi-ref/c360-a-api-synchronous-record-validation.md) requires every schema field in the payload, blank if there's no value.

**Values.** `data => (SELECT ...)` sends the SQL text as a string, not the query's rows.

**Cost.** [Events ingested in real time are charged to the Data 360 Services card](https://developer.salesforce.com/docs/data/data-cloud-int/references/data-cloud-ingestionapi-ref/c360-a-real-time-ingestion-api.md), which applies when the object maps to a real-time data graph. [Community plugin text](https://github.com/dsouza-anush/sf-plugin-data360/blob/main/messages/data360.ingest.bulk.md) says bulk upserts bill rows-processed credits (community).

## ingest_delete

`DELETE /api/v1/ingest/sources/{name}/{object-name}` · [reference](https://developer.salesforce.com/docs/data/data-cloud-int/references/data-cloud-ingestionapi-ref/c360-a-api-delete-records.md) · evidence D · host tenant · changes org state

Streaming delete of up to 200 records by primary key. Use a bulk job with `operation => 'delete'` for more.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `name` | `name` | path | string | yes | Name of the Ingestion API connector, the same value as `source_name` on [`ingest_job_create`](#ingest_job_create). [The server may rewrite it on creation](connections.md#connection_create) (community). |
| `object_name` | `object-name` | path | string | yes | Object from the connector's uploaded schema. Fills the `{object-name}` path segment. |
| `ids` | `ids` | query | string |  | Comma-separated primary keys. Send this or `body_ids`. |
| `body_ids` | `ids` | body | array of string |  | The same primary keys as a list, sent as the body field `ids`. Send this or `ids`. |

```sql
CALL cdp.ingest_delete (
  name => 'ecomm',
  object_name => 'Orders',
  ids => '001xx000003DGb2AAG,003xx000004TmiQAAS'
);
```

**Result**

One row.

| Column | API name | Type | Description |
|---|---|---|---|
| `accepted` | `accepted` | BOOLEAN | `true` when the request was accepted for asynchronous processing. |

**Done when:** The docs name no status call. Query the object after processing, as for [`ingest_insert`](#ingest_insert).

**Notes:** The [reference](https://developer.salesforce.com/docs/data/data-cloud-int/references/data-cloud-ingestionapi-ref/c360-a-api-delete-records.md) accepts the keys in the query or the body, and doesn't say what happens if you send both. Its example uses the query, and a [community client](https://github.com/dsouza-anush/sf-plugin-data360/blob/main/src/ingest/client.ts) uses the body.

If the stream has a Record Modified field, a record is deleted only if that field's value is earlier than the current timestamp. [Deletes never run in the real-time layer](https://developer.salesforce.com/docs/data/data-cloud-int/references/data-cloud-ingestionapi-ref/c360-a-real-time-ingestion-api.md), only through the standard pipeline.

## ingest_test

`POST /api/v1/ingest/sources/{name}/{object-name}/actions/test` · [reference](https://developer.salesforce.com/docs/data/data-cloud-int/references/data-cloud-ingestionapi-ref/c360-a-api-synchronous-record-validation.md) · evidence D · host tenant · read-only

Validates records against the object's schema and reports failures right away, without loading anything. For development only.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `name` | `name` | path | string | yes | Name of the Ingestion API connector, the same value as `source_name` on [`ingest_job_create`](#ingest_job_create). [The server may rewrite it on creation](connections.md#connection_create) (community). |
| `object_name` | `object-name` | path | string | yes | Object from the connector's uploaded schema. Fills the `{object-name}` path segment. |
| `data` | `data` | body | array of map to any | yes | Records to send, each a flat map of the schema's field names to values. Keys depend on the uploaded schema, so any key is valid here and completion can't offer them. |

```sql
CALL cdp.ingest_test (
  name => 'ecomm',
  object_name => 'Orders',
  data => [
    (
      id = 'f19cae7e-5cdb-41ce-92ba-539afea04f9d',
      contact_name = 'Joe Smith',
      created_date = '2021-07-22T08:57:08.118Z',
      tax_exempt = false,
      total = 77506
    )
  ]
);
```

**Result**

The public sources don't document this response. One row, with the response in `_raw`.

**Notes:** This call changes nothing: [payloads that pass aren't persisted](https://developer.salesforce.com/docs/data/data-cloud-int/references/data-cloud-ingestionapi-ref/c360-a-api-synchronous-record-validation.md). The docs show only the failure body, and say to [repeat until the status is in the 200s](https://developer.salesforce.com/docs/data/data-cloud-int/references/data-cloud-ingestionapi-ref/c360-a-api-streaming-insert-example.md).

A failure is an HTTP 400. Its useful part is `details.validationReport`, a list of `(record, causingExceptions)`, such as `#/id: expected type: Number, found: String`. The top-level `message` only says the JSON mismatches the schema. Under the general rule, a non-2xx response fails the statement with its status and message, which would hide the report, so this function needs its own rule.

Every field in the schema must be in the payload, even when Value Required is off. Send a blank value if there's no data. No source says whether this accepts partial records for a stream in `Partial` mode.

## ingest_job_create

`POST /api/v1/ingest/jobs` · [reference](https://developer.salesforce.com/docs/data/data-cloud-int/references/data-cloud-ingestionapi-ref/c360-a-api-create-a-job.md) · evidence D · host tenant · changes org state

Creates a bulk job for one object and one operation. The job starts in `Open`, ready for uploads.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `object` | `object` | body | string | yes | Object the job loads. A job handles only one object. |
| `source_name` | `sourceName` | body | string | yes | Name of the Ingestion API connector. [The server may rewrite it on creation](connections.md#connection_create) (community). |
| `operation` | `operation` | body | enum(upsert, delete) | yes | What the job does with the uploaded records. It also sets the [CSV layout](#ingest_job_upload). |

```sql
CALL cdp.ingest_job_create (
  object => 'Orders',
  source_name => 'ecomm',
  operation => 'upsert'
);
```

**Result**

One row.

| Column | API name | Type | Description |
|---|---|---|---|
| `id` | `id` | VARCHAR | Job id. Keep it for the later calls. |
| `operation` | `operation` | VARCHAR | `upsert` or `delete`. |
| `object` | `object` | VARCHAR | Object the job loads. |
| `source_name` | `sourceName` | VARCHAR | Ingestion API connector name. |
| `created_by_id` | `createdById` | VARCHAR | Id of the user who created the job. |
| `created_date` | `createdDate` | TIMESTAMPTZ | When the job was created. |
| `system_modstamp` | `systemModstamp` | TIMESTAMPTZ | When the job last changed. |
| `state` | `state` | VARCHAR | `Open`, `UploadComplete`, `InProgress`, `JobComplete`, `Failed` or `Aborted`. |
| `content_type` | `contentType` | VARCHAR | Always `CSV` in the examples. |
| `api_version` | `apiVersion` | VARCHAR | Shown as `v1` and as `1` in different examples. |
| `content_url` | `contentUrl` | VARCHAR | Path to upload to. Shown with and without a leading `/`. |

**Notes:** [The data stream must already exist](https://developer.salesforce.com/docs/data/data-cloud-int/references/data-cloud-ingestionapi-ref/c360-a-api-create-a-job.md).

**Limits.** [20 requests or jobs per hour, and 5 at once](https://developer.salesforce.com/docs/data/data-cloud-int/references/data-cloud-ingestionapi-ref/c360-a-api-get-started.md). The table doesn't say whether uploads count as requests, which matters because a job can hold 100 files. A 429 means slow down.

Each successful call creates a job, and an unused one stays `Open` for [up to 7 days](https://developer.salesforce.com/docs/data/data-cloud-int/references/data-cloud-ingestionapi-ref/c360-a-api-close-or-abort-a-job.md). Before retrying, check [`ingest_job_list`](#ingest_job_list) with `states => 'Open'`.

## ingest_job_list

`GET /api/v1/ingest/jobs` · [reference](https://developer.salesforce.com/docs/data/data-cloud-int/references/data-cloud-ingestionapi-ref/c360-a-api-get-all-jobs.md) · evidence D · host tenant · read-only

Lists bulk jobs, optionally filtered by state.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `limit` | `limit` | query | integer |  | Records to return. Defaults to 20, maximum 100. |
| `offset` | `offset` | query | integer |  | Rows to skip before returning. |
| `order_by` | `orderBy` | query | string |  | Field to order by. Defaults to `system_modstamp`. The docs don't give a syntax for direction. |
| `states` | `states` | query | string |  | Comma-separated states. The docs list `Open`, `UploadComplete`, `Failed`, `Aborted` and `JobComplete`. |

```sql
CALL cdp.ingest_job_list (states => 'Open,UploadComplete', limit => 100);
```

**Result**

One row per item of `/data` in the response. Other response fields go to `_meta`.

| Column | API name | Type | Description |
|---|---|---|---|
| `id` | `id` | VARCHAR | Job id. |
| `operation` | `operation` | VARCHAR | `upsert` or `delete`. |
| `object` | `object` | VARCHAR | Object the job loads. |
| `created_by_id` | `createdById` | VARCHAR | Id of the user who created the job. |
| `created_date` | `createdDate` | TIMESTAMPTZ | When the job was created. |
| `system_modstamp` | `systemModstamp` | TIMESTAMPTZ | When the job last changed. |
| `state` | `state` | VARCHAR | Job state, under the name every other example uses. |
| `states` | `states` | VARCHAR | Job state, under the name this call's example uses. |
| `content_type` | `contentType` | VARCHAR | `CSV` in the example. |
| `api_version` | `apiVersion` | VARCHAR | `v1` in the example. |
| `content_url` | `contentUrl` | VARCHAR | Path to upload to. |

**Paging:** `limit`, `offset`. The example response has no total or next link.

**Notes:** The [reference's example](https://developer.salesforce.com/docs/data/data-cloud-int/references/data-cloud-ingestionapi-ref/c360-a-api-get-all-jobs.md) spells the state field `states`, while every other job response has `state`. Both are columns until an org settles it. The example also shows no `sourceName`, so if present it lands in `_raw`.

The `states` filter's list leaves out `InProgress`, which the [status table](https://developer.salesforce.com/docs/data/data-cloud-int/references/data-cloud-ingestionapi-ref/c360-a-api-bulk-ingestion.md) has. No source says whether filtering on it works.

## ingest_job_get

`GET /api/v1/ingest/jobs/{id}` · [reference](https://developer.salesforce.com/docs/data/data-cloud-int/references/data-cloud-ingestionapi-ref/c360-a-api-get-job-info.md) · evidence D · host tenant · read-only

Returns one bulk job. Poll it after closing the job to see whether processing finished.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `id` | `id` | path | string | yes | Job id from [`ingest_job_create`](#ingest_job_create). |

```sql
CALL cdp.ingest_job_get (id => '913a8b00-7a9e-4331-aaf6-a019ae5021ab');
```

**Result**

One row.

| Column | API name | Type | Description |
|---|---|---|---|
| `id` | `id` | VARCHAR | Job id. Keep it for the later calls. |
| `operation` | `operation` | VARCHAR | `upsert` or `delete`. |
| `object` | `object` | VARCHAR | Object the job loads. |
| `source_name` | `sourceName` | VARCHAR | Ingestion API connector name. |
| `created_by_id` | `createdById` | VARCHAR | Id of the user who created the job. |
| `created_date` | `createdDate` | TIMESTAMPTZ | When the job was created. |
| `system_modstamp` | `systemModstamp` | TIMESTAMPTZ | When the job last changed. |
| `state` | `state` | VARCHAR | `Open`, `UploadComplete`, `InProgress`, `JobComplete`, `Failed` or `Aborted`. |
| `content_type` | `contentType` | VARCHAR | Always `CSV` in the examples. |
| `api_version` | `apiVersion` | VARCHAR | Shown as `v1` and as `1` in different examples. |
| `content_url` | `contentUrl` | VARCHAR | Path to upload to. Shown with and without a leading `/`. |
| `retries` | `retries` | INTEGER | Retry count. The docs give only the example value `0`. |
| `total_processing_time` | `totalProcessingTime` | BIGINT | Processing time. The docs give no unit, and only the example value `0`. |

**Notes:** [States](https://developer.salesforce.com/docs/data/data-cloud-int/references/data-cloud-ingestionapi-ref/c360-a-api-bulk-ingestion.md):

| State | Meaning |
|---|---|
| `Open` | Created and accepting uploads |
| `UploadComplete` | Closed and ready for processing |
| `InProgress` | Being processed |
| `JobComplete` | Processed successfully, and the data is available |
| `Failed` | Processing failed |
| `Aborted` | Aborted by a user |

The [Create a Job page](https://developer.salesforce.com/docs/data/data-cloud-int/references/data-cloud-ingestionapi-ref/c360-a-api-create-a-job.md) writes `open` in its text and `Open` in its example, and a [community client](https://github.com/dsouza-anush/sf-plugin-data360/blob/main/src/ingest/client.ts) compares states case-insensitively.

**Failed records.** The [walkthrough](https://developer.salesforce.com/docs/data/data-cloud-int/references/data-cloud-ingestionapi-ref/c360-a-api-bulk-insert-example.md) says this call reports records processed, but no official example has such a field. The community client reads `recordsProcessed` and `recordsFailed`, and [treats `JobComplete` with failures as a partial result](https://github.com/dsouza-anush/sf-plugin-data360/blob/main/messages/data360.runtime.ingest.errors.md) (community). Those fields would land in `_raw`. The [docs](https://developer.salesforce.com/docs/data/data-cloud-int/references/data-cloud-ingestionapi-ref/c360-a-api-bulk-ingestion.md) say to act on failed records but name no call to read them. [Problem Records DLOs](https://github.com/Jaganpro/sf-skills/blob/main/skills/sf-datacloud-prepare/examples/ingestion-api/README.md) are the community's answer.

## ingest_job_upload

`PUT /api/v1/ingest/jobs/{id}/batches` · [reference](https://developer.salesforce.com/docs/data/data-cloud-int/references/data-cloud-ingestionapi-ref/c360-a-api-upload-job-data.md) · evidence D · host tenant · changes org state

Uploads one CSV file to an `Open` job. Call it once per file, then close the job with `ingest_job_update`.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `id` | `id` | path | string | yes | Job id from [`ingest_job_create`](#ingest_job_create). |
| `csv` | `csv` | body | string (text/csv) | yes | The CSV text, normally as `$$ ... $$`. It's the whole request body, sent with `Content-Type: text/csv`, not a JSON field. |

```sql
CALL cdp.ingest_job_upload (
  id => '913a8b00-7a9e-4331-aaf6-a019ae5021ab',
  csv => $$id,contact_name,created_date,tax_exempt,total
f19cae7e-5cdb-41ce-92ba-539afea04f9d,Jadyn Kozey,2021-07-22T08:57:08.118Z,false,77506
48c8b6a6-8179-4a15-ba19-ec5c8206ce28,Kristina Jakubowski,2021-07-08T22:57:02.008Z,false,16986
$$
);
```

**Result**

No response body (HTTP 202). One row with only the standard columns.

**Notes:** A 202 means the file is stored. Nothing is processed until the job is closed.

**Status.** The [reference](https://developer.salesforce.com/docs/data/data-cloud-int/references/data-cloud-ingestionapi-ref/c360-a-api-upload-job-data.md) says 202, while the [walkthrough](https://developer.salesforce.com/docs/data/data-cloud-int/references/data-cloud-ingestionapi-ref/c360-a-api-bulk-insert-example.md) shows `201 Created`.

**Limits.** [One file at a time per job, up to 100 files, each at most 150 MB](https://developer.salesforce.com/docs/data/data-cloud-int/references/data-cloud-ingestionapi-ref/c360-a-api-get-started.md). Split larger data across files. Here a file is script text, so sizes near the limit aren't practical.

**Passing the text.** The first line after the opening `$$` is the header row or, for deletes, the first record, so start the data right after `$$`. `:param` works too. `(SELECT ...)` sends the SQL text, not the query's rows.

**[Format](https://developer.salesforce.com/docs/data/data-cloud-int/references/data-cloud-ingestionapi-ref/c360-a-api-bulk-ingestion.md).** UTF-8, RFC 4180, comma delimiters only. Empty fields become null. Dates follow the same formats as streaming.

**Upsert files.** A header row must match the stream's field names, and [only matching columns are kept](https://developer.salesforce.com/docs/data/data-cloud-int/references/data-cloud-ingestionapi-ref/c360-a-api-bulk-ingestion.md). An update [replaces the whole record, with no patch semantics](https://developer.salesforce.com/docs/data/data-cloud-int/references/data-cloud-ingestionapi-ref/c360-a-api-bulk-ingestion.md). Sources disagree on what's required: the bulk page says all required fields, and the [Create a Job note](https://developer.salesforce.com/docs/data/data-cloud-int/references/data-cloud-ingestionapi-ref/c360-a-api-create-a-job.md) says all fields in the schema, blank if empty.

**Delete files.** [No header, and at most two columns](https://developer.salesforce.com/docs/data/data-cloud-int/references/data-cloud-ingestionapi-ref/c360-a-api-upload-job-data.md). The first is the primary key. The second is needed only for Profile or Other category streams with a record version column, and must be a datetime later than the original record's:

```
"f3f7b60d-d8c3-423b-8ee2-4b4d79cfb449","2023-10-26T02:51:28.939Z"
```

## ingest_job_update

`PATCH /api/v1/ingest/jobs/{id}` · [reference](https://developer.salesforce.com/docs/data/data-cloud-int/references/data-cloud-ingestionapi-ref/c360-a-api-close-or-abort-a-job.md) · evidence D · host tenant · changes org state

Closes a job with `UploadComplete`, which queues its data for processing, or aborts it with `Aborted`, which deletes its uploaded data.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `id` | `id` | path | string | yes | Job id from [`ingest_job_create`](#ingest_job_create). |
| `state` | `state` | body | enum(UploadComplete, Aborted) | yes | State to move the job to. |

```sql
CALL cdp.ingest_job_update (
  id => '913a8b00-7a9e-4331-aaf6-a019ae5021ab',
  state => 'UploadComplete'
);
```

**Result**

One row.

| Column | API name | Type | Description |
|---|---|---|---|
| `id` | `id` | VARCHAR | Job id. Keep it for the later calls. |
| `operation` | `operation` | VARCHAR | `upsert` or `delete`. |
| `object` | `object` | VARCHAR | Object the job loads. |
| `source_name` | `sourceName` | VARCHAR | Ingestion API connector name. |
| `created_by_id` | `createdById` | VARCHAR | Id of the user who created the job. |
| `created_date` | `createdDate` | TIMESTAMPTZ | When the job was created. |
| `system_modstamp` | `systemModstamp` | TIMESTAMPTZ | When the job last changed. |
| `state` | `state` | VARCHAR | `Open`, `UploadComplete`, `InProgress`, `JobComplete`, `Failed` or `Aborted`. |
| `content_type` | `contentType` | VARCHAR | Always `CSV` in the examples. |
| `api_version` | `apiVersion` | VARCHAR | Shown as `v1` and as `1` in different examples. |
| `content_url` | `contentUrl` | VARCHAR | Path to upload to. Shown with and without a leading `/`. |

**Done when:** [`ingest_job_get`](#ingest_job_get)`.state` moves from `UploadComplete` to `JobComplete` or `Failed`, then allow [at least 30 seconds](https://developer.salesforce.com/docs/data/data-cloud-int/references/data-cloud-ingestionapi-ref/c360-a-api-get-started.md) before querying.

**Notes:** Once a job is closed or aborted, [you can't add data](https://developer.salesforce.com/docs/data/data-cloud-int/references/data-cloud-ingestionapi-ref/c360-a-api-close-or-abort-a-job.md). An aborted job is never processed.

Jobs older than [7 days that are still `Open` or `UploadComplete` are deleted from the queue](https://developer.salesforce.com/docs/data/data-cloud-int/references/data-cloud-ingestionapi-ref/c360-a-api-get-started.md).

A [409 means the job's state doesn't allow the change](https://developer.salesforce.com/docs/data/data-cloud-int/references/data-cloud-ingestionapi-ref/c360-a-api-get-started.md). Aborting can race with completion: a [community client](https://github.com/dsouza-anush/sf-plugin-data360/blob/main/src/ingest/client.ts) catches the 409 and re-reads the job (community).

## ingest_job_delete

`DELETE /api/v1/ingest/jobs/{id}` · [reference](https://developer.salesforce.com/docs/data/data-cloud-int/references/data-cloud-ingestionapi-ref/c360-a-api-delete-a-job.md) · evidence D · host tenant · changes org state

Deletes a closed job, along with its stored job data and metadata. The job then no longer appears in the get or list calls.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `id` | `id` | path | string | yes | Job id from [`ingest_job_create`](#ingest_job_create). |

```sql
CALL cdp.ingest_job_delete (id => '913a8b00-7a9e-4331-aaf6-a019ae5021ab');
```

**Result**

No response body (HTTP 204). One row with only the standard columns.

**Notes:** [The job must be in `UploadComplete`, `JobComplete`, `Aborted` or `Failed`](https://developer.salesforce.com/docs/data/data-cloud-int/references/data-cloud-ingestionapi-ref/c360-a-api-delete-a-job.md). The list leaves out `Open` and `InProgress`, so abort an open job first. The page doesn't say what happens to processing when an `UploadComplete` job is deleted, or say anything about records already loaded.

