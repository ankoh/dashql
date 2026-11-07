<!-- Generated from extensions/d360-api/clfn/spec/data_custom_code.yaml, edit that and run: bazel run //extensions/d360-api:update -->

# Data Custom Code

Part of the [CDP function reference](functions.md). Nothing here is implemented or tested against an org. Every result also has the [standard columns](functions.md#result-schema).

Code extension runs your own Python in Data 360. A deployment holds a zipped package. A script runs inside a data transform, and a function runs in a search index's chunking step ([docs](https://developer.salesforce.com/docs/data/data-cloud-code-ext/guide/use-custom-code.md)). These calls manage deployments and read their run history. None of them starts a run.

A deployment takes three steps, as in the [SDK](https://github.com/forcedotcom/datacloud-customcode-python-sdk/blob/main/src/datacustomcode/deploy.py):

1. `custom_code_deployment_create` returns a `file_upload_url`.
2. You PUT the zip to that URL. This isn't a Connect API call, so no `CALL cdp.` function does it.
3. You poll `deployment_status` until it is `Deployed`.

A script then needs a transform that names it, and `transform_run` starts it. Runs show up in `custom_code_execution_list`.

The main traps:

- The spec's create options lack `version`, `invokeOptions` and `functionInvokeOptions`, which the SDK sends. See [`custom_code_deployment_create`](#custom_code_deployment_create).
- Compute names differ between tools. API `CPU_L` is the largest size, and CLI `CPU_L` is the smallest.
- Code Extension must be enabled in Feature Manager, and [orgs with Bring Your Own Key aren't supported](https://developer.salesforce.com/docs/data/data-cloud-code-ext/guide/use-custom-code.md).
- The docs deploy to a sandbox and [move to production with a DevOps data kit](https://developer.salesforce.com/docs/data/data-cloud-code-ext/guide/migrate-code-to-prod.md).

```sql
CALL cdp.custom_code_deployment_create (name => 'account_rollup', label => 'Account rollup', code_type => 'Script', compute_type => 'CPU_XS');
/* PUT deployment.zip to file_upload_url, outside DashQL */
CALL cdp.custom_code_deployment_get (custom_code_name_or_id => 'account_rollup'); /* until deployment_status = 'Deployed' */
CALL cdp.transform_create (name => 'account_rollup', label => 'account_rollup', type => 'BATCH', dataspace_name => 'default', definition => $$
  {"type": "DCSQL", "version": "56.0", "manifest": {
    "nodes": {"node1": {"relation_name": "Account_std_copy__dll", "config": {"materialized": "table"}, "compiled_code": ""}},
    "sources": {"source1": {"relation_name": "Account_std__dll"}},
    "macros": {"macro.byoc": {"arguments": [{"name": "account_rollup", "type": "BYOC_SCRIPT"}]}}
  }}
$$);
CALL cdp.transform_run (data_transform_name_or_id => 'account_rollup');
CALL cdp.custom_code_execution_list (custom_code_name_or_id => 'account_rollup', limit => 10);
```

**Functions:** [`custom_code_deployment_delete`](#custom_code_deployment_delete), [`custom_code_deployment_list`](#custom_code_deployment_list), [`custom_code_deployment_get`](#custom_code_deployment_get), [`custom_code_execution_list`](#custom_code_execution_list), [`custom_code_execution_get`](#custom_code_execution_get), [`custom_code_deployment_update`](#custom_code_deployment_update), [`custom_code_deployment_create`](#custom_code_deployment_create)

## custom_code_deployment_delete

`DELETE /ssot/data-custom-code/{customCodeNameOrId}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Custom-Code/paths/~1ssot~1data-custom-code~1%7BcustomCodeNameOrId%7D/delete) · evidence O · changes org state

Permanently delete a deployment. Use it to remove code that nothing depends on any more.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `custom_code_name_or_id` | `customCodeNameOrId` | path | string | yes | Deployment `name` or `id`. The [SDK](https://github.com/forcedotcom/datacloud-customcode-python-sdk/blob/main/src/datacustomcode/deploy.py) reads by `name`. |

```sql
CALL cdp.custom_code_deployment_delete (custom_code_name_or_id => 'account_rollup');
```

**Result**

No response body (HTTP 200). One row with only the standard columns.

**Done when:** The deployment is gone from `custom_code_deployment_list`. The [docs](https://developer.salesforce.com/docs/data/data-cloud-code-ext/guide/delete-deployed-code.md) say this takes a few minutes. The spec's `status` enum has `Deleting`, but no source ties it to this call.

**Notes:** [You can't undo this, and you must first remove or disable everything that references the code](https://developer.salesforce.com/docs/data/data-cloud-code-ext/guide/delete-deployed-code.md), such as transforms and search indexes. The docs don't say what happens if you skip that step.

## custom_code_deployment_list

`GET /ssot/data-custom-code` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Custom-Code/paths/~1ssot~1data-custom-code/get) · evidence O · read-only

List the deployments in the org, with optional filters on type, status and label. Use it to find a deployment name or spot failed deployments.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `code_type` | `codeType` | query | enum(Function, Script) |  | `Script` runs in a data transform. `Function` runs in a search index. |
| `deployment_status` | `deploymentStatus` | query | enum(Deployed, Disabled, Error, Initializing, Pending, Scanning) |  | Only deployments in this state. `Deployed` means ready and `Error` means failed. |
| `label` | `label` | query | string |  | - |
| `limit` | `limit` | query | integer |  | - |
| `offset` | `offset` | query | integer |  | - |
| `order_by` | `orderBy` | query | enum(CodeTypeAsc, CodeTypeDesc, DeployedByAsc, DeployedByDesc, DeployedOnAsc, DeployedOnDesc, DeploymentStatusAsc, DeploymentStatusDesc, NameAsc, NameDesc, VersionDesc) |  | - |

```sql
CALL cdp.custom_code_deployment_list (code_type => 'Script', deployment_status => 'Error', order_by => 'DeployedOnDesc', limit => 50);
```

**Result**

One row per item of `/customCodeDeployments` in the response. Other response fields go to `_meta`: `currentPageUrl`, `nextPageUrl`, `totalSize`. Schema `CustomCodeDeploymentRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `created_by` | `createdBy` | JSON (CdpUserRepresentation) | - |
| `created_date` | `createdDate` | VARCHAR | - |
| `id` | `id` | VARCHAR | - |
| `label` | `label` | VARCHAR | - |
| `last_modified_by` | `lastModifiedBy` | JSON (CdpUserRepresentation) | - |
| `last_modified_date` | `lastModifiedDate` | VARCHAR | - |
| `name` | `name` | VARCHAR | - |
| `namespace` | `namespace` | VARCHAR | - |
| `url` | `url` | VARCHAR | - |
| `code_type` | `codeType` | VARCHAR | - |
| `compute_type` | `computeType` | VARCHAR | - |
| `deployment_failure_code` | `deploymentFailureCode` | BIGINT | - |
| `deployment_failure_reason` | `deploymentFailureReason` | VARCHAR | - |
| `deployment_status` | `deploymentStatus` | VARCHAR | - |
| `description` | `description` | VARCHAR | - |
| `file_upload_url` | `fileUploadUrl` | VARCHAR | - |
| `is_remote` | `isRemote` | BOOLEAN | - |
| `owned_by` | `ownedBy` | VARCHAR | - |
| `status` | `status` | VARCHAR | - |

**Paging:** `next_page_url`.

**Notes:** See [`custom_code_deployment_get`](#custom_code_deployment_get) for what `deployment_status` means.

## custom_code_deployment_get

`GET /ssot/data-custom-code/{customCodeNameOrId}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Custom-Code/paths/~1ssot~1data-custom-code~1%7BcustomCodeNameOrId%7D/get) · evidence O · read-only

Read one deployment by name or id. Poll it after uploading a package to see whether the deployment finished.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `custom_code_name_or_id` | `customCodeNameOrId` | path | string | yes | Deployment `name` or `id`. The [SDK](https://github.com/forcedotcom/datacloud-customcode-python-sdk/blob/main/src/datacustomcode/deploy.py) reads by `name`. |

```sql
CALL cdp.custom_code_deployment_get (custom_code_name_or_id => 'account_rollup');
```

**Result**

One row. Schema `CustomCodeDeploymentRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `created_by` | `createdBy` | JSON (CdpUserRepresentation) | - |
| `created_date` | `createdDate` | VARCHAR | - |
| `id` | `id` | VARCHAR | - |
| `label` | `label` | VARCHAR | - |
| `last_modified_by` | `lastModifiedBy` | JSON (CdpUserRepresentation) | - |
| `last_modified_date` | `lastModifiedDate` | VARCHAR | - |
| `name` | `name` | VARCHAR | - |
| `namespace` | `namespace` | VARCHAR | - |
| `url` | `url` | VARCHAR | - |
| `code_type` | `codeType` | VARCHAR | - |
| `compute_type` | `computeType` | VARCHAR | - |
| `deployment_failure_code` | `deploymentFailureCode` | BIGINT | - |
| `deployment_failure_reason` | `deploymentFailureReason` | VARCHAR | - |
| `deployment_status` | `deploymentStatus` | VARCHAR | - |
| `description` | `description` | VARCHAR | - |
| `file_upload_url` | `fileUploadUrl` | VARCHAR | - |
| `is_remote` | `isRemote` | BOOLEAN | - |
| `owned_by` | `ownedBy` | VARCHAR | - |
| `status` | `status` | VARCHAR | - |

**Notes:** Poll `deployment_status`. It's the field the [SDK](https://github.com/forcedotcom/datacloud-customcode-python-sdk/blob/main/src/datacustomcode/deploy.py) reads, and `status` is a separate field (spec values `Active`, `Deleting`, `Error`, `Processing`) that no source explains.

Only two `deployment_status` values have a documented meaning: `Deployed` means ready, and `Error` means failed. No source gives the order of `Pending`, `Scanning` and `Initializing`, or says what sets `Disabled`. The SDK's only exit is `Deployed`, so it keeps polling through `Error` until its 3000-second timeout. Stop on `Error` yourself and read `deployment_failure_code` and `deployment_failure_reason`.

`file_upload_url` is in this schema, but the SDK only takes it from the create response. No source says whether a GET returns it.

## custom_code_execution_list

`GET /ssot/data-custom-code/{customCodeNameOrId}/executions` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Custom-Code/paths/~1ssot~1data-custom-code~1%7BcustomCodeNameOrId%7D~1executions/get) · evidence O · read-only

List the runs of one deployment, with status, row counts and timings. Use it as the run history after running a transform.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `custom_code_name_or_id` | `customCodeNameOrId` | path | string | yes | Deployment `name` or `id`. The [SDK](https://github.com/forcedotcom/datacloud-customcode-python-sdk/blob/main/src/datacustomcode/deploy.py) reads by `name`. |
| `limit` | `limit` | query | integer |  | - |
| `offset` | `offset` | query | integer |  | - |

```sql
CALL cdp.custom_code_execution_list (custom_code_name_or_id => 'account_rollup', limit => 20);
```

**Result**

One row per item of `/executions` in the response. Other response fields go to `_meta`: `currentPageUrl`, `nextPageUrl`, `totalSize`. Schema `CustomCodeExecutionBaseRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `compute_type` | `computeType` | VARCHAR | - |
| `duration_in_seconds` | `durationInSeconds` | BIGINT | - |
| `end_time` | `endTime` | TIMESTAMPTZ | - |
| `error_code` | `errorCode` | BIGINT | - |
| `error_message` | `errorMessage` | VARCHAR | - |
| `id` | `id` | VARCHAR | - |
| `rows_read` | `rowsRead` | DOUBLE | - |
| `rows_written` | `rowsWritten` | DOUBLE | - |
| `start_time` | `startTime` | TIMESTAMPTZ | - |
| `status` | `status` | VARCHAR | - |
| `submitted_time` | `submittedTime` | TIMESTAMPTZ | - |

**Paging:** `next_page_url`.

**Notes:** Rows appear only after something runs the code, such as `transform_run`. A new deployment has no runs yet. The [Run History docs](https://developer.salesforce.com/docs/data/data-cloud-code-ext/guide/view-deployment-details.md) cover scripts. For functions, the docs [point to search index job status](https://developer.salesforce.com/docs/data/data-cloud-code-ext/guide/monitor-custom-function-deployments.md) instead, and no source says whether those runs are listed here.

## custom_code_execution_get

`GET /ssot/data-custom-code/{customCodeNameOrId}/executions/{customCodeExecutionId}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Custom-Code/paths/~1ssot~1data-custom-code~1%7BcustomCodeNameOrId%7D~1executions~1%7BcustomCodeExecutionId%7D/get) · evidence O · read-only

Read one run of a deployment. Use it to check a run's status or error once you have its id.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `custom_code_execution_id` | `customCodeExecutionId` | path | string | yes | `id` from `custom_code_execution_list`. |
| `custom_code_name_or_id` | `customCodeNameOrId` | path | string | yes | Deployment `name` or `id`. The [SDK](https://github.com/forcedotcom/datacloud-customcode-python-sdk/blob/main/src/datacustomcode/deploy.py) reads by `name`. |

```sql
CALL cdp.custom_code_execution_get (custom_code_name_or_id => 'account_rollup', custom_code_execution_id => :execution_id);
```

**Result**

One row. Schema `CustomCodeExecutionBaseRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `compute_type` | `computeType` | VARCHAR | - |
| `duration_in_seconds` | `durationInSeconds` | BIGINT | - |
| `end_time` | `endTime` | TIMESTAMPTZ | - |
| `error_code` | `errorCode` | BIGINT | - |
| `error_message` | `errorMessage` | VARCHAR | - |
| `id` | `id` | VARCHAR | - |
| `rows_read` | `rowsRead` | DOUBLE | - |
| `rows_written` | `rowsWritten` | DOUBLE | - |
| `start_time` | `startTime` | TIMESTAMPTZ | - |
| `status` | `status` | VARCHAR | - |
| `submitted_time` | `submittedTime` | TIMESTAMPTZ | - |

**Notes:** A run has ended when `status` is `Success`, `Failure` or `Cancelled`. The [docs](https://developer.salesforce.com/docs/data/data-cloud-code-ext/guide/view-deployment-details.md) list `Running`, `Success` and `Failure`, and the spec adds `Cancelled`.

The script's own log lines aren't in this result. They are in the `DataCustomCodeLogs__dll` DLO, which you read with a `SELECT` over the connection. They can [take about 10 minutes to appear, and messages are cut at 31,072 characters](https://developer.salesforce.com/docs/data/data-cloud-code-ext/guide/query-logs-api.md). The docs filter that DLO by `ExecutionId__c`, and don't say that it equals this call's `id`. The spec defines `CustomCodeExecutionLogRepresentation` with a `downloadUrl`, but no operation in the spec returns it.

## custom_code_deployment_update

`PATCH /ssot/data-custom-code/{customCodeNameOrId}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Custom-Code/paths/~1ssot~1data-custom-code~1%7BcustomCodeNameOrId%7D/patch) · evidence O · changes org state

Change a deployment's label, description, compute size or version. Use it to resize a deployment or fix its metadata.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `custom_code_name_or_id` | `customCodeNameOrId` | path | string | yes | Deployment `name` or `id`. The [SDK](https://github.com/forcedotcom/datacloud-customcode-python-sdk/blob/main/src/datacustomcode/deploy.py) reads by `name`. |
| `compute_type` | `computeType` | body | enum(Cpu_l, Cpu_m, Cpu_s, Cpu_xs) |  | Size of the compute the code runs on. Spelled differently from create. |
| `description` | `description` | body | string |  | Summary of what the code does and its use case. |
| `label` | `label` | body | string |  | Display name in the UI, called Deployment Name there. |
| `version` | `version` | body | string |  | - |

```sql
CALL cdp.custom_code_deployment_update (custom_code_name_or_id => 'account_rollup', compute_type => 'Cpu_s', description => 'Nightly account rollup');
```

**Result**

One row. Schema `CustomCodeDeploymentRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `created_by` | `createdBy` | JSON (CdpUserRepresentation) | - |
| `created_date` | `createdDate` | VARCHAR | - |
| `id` | `id` | VARCHAR | - |
| `label` | `label` | VARCHAR | - |
| `last_modified_by` | `lastModifiedBy` | JSON (CdpUserRepresentation) | - |
| `last_modified_date` | `lastModifiedDate` | VARCHAR | - |
| `name` | `name` | VARCHAR | - |
| `namespace` | `namespace` | VARCHAR | - |
| `url` | `url` | VARCHAR | - |
| `code_type` | `codeType` | VARCHAR | - |
| `compute_type` | `computeType` | VARCHAR | - |
| `deployment_failure_code` | `deploymentFailureCode` | BIGINT | - |
| `deployment_failure_reason` | `deploymentFailureReason` | VARCHAR | - |
| `deployment_status` | `deploymentStatus` | VARCHAR | - |
| `description` | `description` | VARCHAR | - |
| `file_upload_url` | `fileUploadUrl` | VARCHAR | - |
| `is_remote` | `isRemote` | BOOLEAN | - |
| `owned_by` | `ownedBy` | VARCHAR | - |
| `status` | `status` | VARCHAR | - |

**Notes:** No source shows this call replacing the uploaded code. The [SDK](https://github.com/forcedotcom/datacloud-customcode-python-sdk/blob/main/src/datacustomcode/deploy.py) never calls PATCH, and answers an existing name with "use a different name". The docs say ["modify and redeploy"](https://developer.salesforce.com/docs/data/data-cloud-code-ext/guide/use-custom-script.md) without giving an API path. Whether a new `version` returns a fresh `file_upload_url` is undocumented.

`compute_type` is spelled `Cpu_xs` to `Cpu_l` here and in results, and `CPU_XS` to `CPU_L` on create. See the [size table](#custom_code_deployment_create). Larger sizes [consume more credits](https://developer.salesforce.com/docs/data/data-cloud-code-ext/guide/deploy-custom-code.md).

## custom_code_deployment_create

`POST /ssot/data-custom-code` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Custom-Code/paths/~1ssot~1data-custom-code/post) · evidence O · changes org state

Register a new deployment and get the URL to upload its zip package to. Deployment finishes only after that upload.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `id` | `id` | body | string |  | - |
| `name` | `name` | body | string |  | API name. Letters, digits and underscores, starting with a letter, [at most 40 characters and unique](https://developer.salesforce.com/docs/data/data-cloud-code-ext/guide/deploy-custom-code.md). No trailing or double underscore. |
| `namespace` | `namespace` | body | string |  | - |
| `code_type` | `codeType` | body | enum(Function, Script) |  | `Script` runs in a data transform. `Function` runs in a search index chunking step. |
| `compute_type` | `computeType` | body | enum(CPU_XS, CPU_S, CPU_M, CPU_L) |  | Compute size. API `CPU_L` is the largest. See the table in the notes. |
| `description` | `description` | body | string |  | Summary of what the code does and its use case. |
| `label` | `label` | body | string |  | Display name in the UI, called Deployment Name there. The SDK sends the API name. |

```sql
CALL cdp.custom_code_deployment_create (name => 'account_rollup', label => 'Account rollup', code_type => 'Script', compute_type => 'CPU_XS', description => 'Rolls accounts up by region');
```

**Result**

One row. Schema `CustomCodeDeploymentRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `created_by` | `createdBy` | JSON (CdpUserRepresentation) | - |
| `created_date` | `createdDate` | VARCHAR | - |
| `id` | `id` | VARCHAR | - |
| `label` | `label` | VARCHAR | - |
| `last_modified_by` | `lastModifiedBy` | JSON (CdpUserRepresentation) | - |
| `last_modified_date` | `lastModifiedDate` | VARCHAR | - |
| `name` | `name` | VARCHAR | - |
| `namespace` | `namespace` | VARCHAR | - |
| `url` | `url` | VARCHAR | - |
| `code_type` | `codeType` | VARCHAR | - |
| `compute_type` | `computeType` | VARCHAR | - |
| `deployment_failure_code` | `deploymentFailureCode` | BIGINT | - |
| `deployment_failure_reason` | `deploymentFailureReason` | VARCHAR | - |
| `deployment_status` | `deploymentStatus` | VARCHAR | - |
| `description` | `description` | VARCHAR | - |
| `file_upload_url` | `fileUploadUrl` | VARCHAR | - |
| `is_remote` | `isRemote` | BOOLEAN | - |
| `owned_by` | `ownedBy` | VARCHAR | - |
| `status` | `status` | VARCHAR | - |

**Done when:** After the PUT, `custom_code_deployment_get.deployment_status` is `Deployed`, or `Error` on failure. The [docs](https://developer.salesforce.com/docs/data/data-cloud-code-ext/guide/deploy-custom-code.md) say a few minutes. The [SDK](https://github.com/forcedotcom/datacloud-customcode-python-sdk/blob/main/src/datacustomcode/deploy.py) polls every second and gives up after 3000 seconds.

**Notes:** **This call only registers the deployment.** Nothing runs until the package is uploaded.

**Upload.** The [SDK](https://github.com/forcedotcom/datacloud-customcode-python-sdk/blob/main/src/datacustomcode/deploy.py) sends the PUT below. It isn't a Connect API call, so no `CALL cdp.` function does it.

- Pass the `file_upload_url` through an HTML unescape first. The SDK does this, so the value can contain entities such as `&amp;`.
- Send `Content-Type: application/zip` with the raw zip as the body, and no `Authorization` header. Any status under 400 counts as success.
- The SDK zips the contents of the `payload` folder, so `entrypoint.py` and `config.json` sit at the zip root. A non-empty `requirements.txt` adds native dependencies built in Docker for `linux/amd64`.
- The zip must be [under 5 GB](https://developer.salesforce.com/docs/data/data-cloud-code-ext/guide/deploy-custom-code.md), per the docs for the UI upload.
- No source documents the upload host, how long the URL lives, or whether it allows browser (CORS) uploads.

**Not retryable.** The SDK treats a 409 as "name already exists" and has no update path. The docs say a [failed upload leaves the deployment in `Error`](https://developer.salesforce.com/docs/data/data-cloud-code-ext/guide/deploy-custom-function.md), for the UI flow. No source documents uploading again to a failed deployment.

**Options the spec lacks.** The SDK's create body has three more fields. The spec's input schema has none of them, so they can't be set here yet:

- `version`: always sent. The SDK [CLI](https://github.com/forcedotcom/datacloud-customcode-python-sdk/blob/main/README.md) defaults to `0.0.1`, and [`sf data-code-extension script deploy`](https://developer.salesforce.com/docs/data/data-cloud-code-ext-cli-reference/guide/data-code-extension-script-deploy.md) requires it.
- `functionInvokeOptions`: sent for functions, as `['UnstructuredChunking']`.
- `invokeOptions`: `BatchTransform` or `StreamingTransform` ([constants](https://github.com/forcedotcom/datacloud-customcode-python-sdk/blob/main/src/datacustomcode/constants.py)). The SDK sets it to `StreamingTransform` for streaming scripts. Its comment says this only binds at v67.0, and it uses v63.0 otherwise.

The SDK also sends `code_type` in lowercase (`script`, `function`), while the spec's enum is capitalized.

**Compute sizes.** Each tool has its own names. This table joins the [SDK's mapping](https://github.com/forcedotcom/datacloud-customcode-python-sdk/blob/main/src/datacustomcode/deploy.py) with the [UI sizes](https://developer.salesforce.com/docs/data/data-cloud-code-ext/guide/deploy-custom-code.md). The SDK defaults to `CPU_M`. No source gives the API's default.

| API `compute_type` | SDK and `sf` CLI | UI | Compute units per hour |
|---|---|---|---|
| `CPU_XS` | `CPU_L` | Standard - Large | 4 |
| `CPU_S` | `CPU_XL` | Standard - X-Large | 8 |
| `CPU_M` | `CPU_2XL` | Standard - 2X-Large | 16 |
| `CPU_L` | `CPU_4XL` | Standard - 4X-Large | 32 |

**After `Deployed`.** A script does nothing until a transform uses it, and the SDK creates one right away. Its `definition` is the `DCSQL` manifest in the [intro example](#data-custom-code), with one `nodes` entry per output object and one `sources` entry per input. Output objects [must exist, in the same data space](https://github.com/forcedotcom/datacloud-customcode-python-sdk/blob/main/README.md), for the DLO case. DMO outputs also need `output_data_objects` in the definition. A function is [chosen in a search index](https://developer.salesforce.com/docs/data/data-cloud-code-ext/guide/use-custom-code.md) instead.
