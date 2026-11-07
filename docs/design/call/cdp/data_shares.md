# Data Shares

Part of the [CDP function reference](functions.md). Nothing here is implemented or tested against an org. Every result also has the [standard columns](functions.md#result-schema).

Data shares publish Data 360 objects to another platform without copying them there. This is the outbound direction of zero copy. Reading external data into Data 360 is federation, and it uses connections and data streams instead. A share is a list of objects in one data space. A target is the connection to one external account or org. A [link](https://trailhead.salesforce.com/content/learn/modules/data-cloud-with-zero-copy/get-started-with-zero-copy-data-sharing) between them exposes the objects on the other side.

The order is: create the share, wait until it is `Active`, create the target, then link them. The consumer then takes one more step on its own platform, such as subscribing to the listing in BigQuery or accepting the request in another Data 360 org.

The gotchas that matter most:

- The Help and blog walkthroughs authenticate Snowflake and BigQuery targets in a browser. The spec has no option for that step.
- `data_share_target_create` takes different attributes per `target_type`. Its notes list them.
- The spec's schemas and its request examples disagree on `dataspace_name` and `data_share_objects`.
- `data_share_get` doesn't show which targets a share is linked to.

Salesforce Help pages linked here could only be read as search excerpts, so check them before relying on a detail.

```sql
CALL cdp.data_share_create (name => 'Sales_Data_Share', label => 'Sales Data Share', dataspace_name => 'default', data_share_objects => ['Sales_Order__dlm', 'Account_Home__dll']);
CALL cdp.data_share_get (name_or_id => 'Sales_Data_Share'); /* repeat until status is Active */
CALL cdp.data_share_target_create (target_type => 'BigQuery', name => 'BigQuery_Analytics_Target', label => 'BigQuery Analytics', target_email_id => 'analytics-team@example.com', target_email_type => 'Group');
CALL cdp.data_share_link (name_or_id => 'Sales_Data_Share', data_share_target_names => ['BigQuery_Analytics_Target']);
```

**Functions:** [`data_share_target_delete`](#data_share_target_delete), [`data_share_delete`](#data_share_delete), [`data_share_target_get`](#data_share_target_get), [`data_share_target_list`](#data_share_target_list), [`data_share_get`](#data_share_get), [`data_share_list`](#data_share_list), [`data_share_update`](#data_share_update), [`data_share_create`](#data_share_create), [`data_share_target_create`](#data_share_target_create), [`data_share_link`](#data_share_link), [`data_share_unlink`](#data_share_unlink)

## data_share_target_delete

`DELETE /ssot/data-share-target/{nameOrId}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Shares/paths/~1ssot~1data-share-target~1%7BnameOrId%7D/delete) · evidence O · changes org state

Deletes a data share target. Since v63.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `name_or_id` | `nameOrId` | path | string | yes | API name or record ID of the data share target. Since v63.0. |

```sql
CALL cdp.data_share_target_delete (name_or_id => 'BigQuery_Analytics_Target');
```

**Result**

No response body (HTTP 200). One row with only the standard columns.

**Notes:** [Manage Data Shares](https://help.salesforce.com/s/articleView?id=data.c360_a_manage_data_shares.htm&language=en_US&type=5) describes deleting unlinked shares and treats targets the same way, so unlink first with `data_share_unlink`. The spec doesn't state this rule or what the error looks like. Its status enum has `Deleting`, and it doesn't say whether the call returns before the target is gone.

## data_share_delete

`DELETE /ssot/data-share/{nameOrId}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Shares/paths/~1ssot~1data-share~1%7BnameOrId%7D/delete) · evidence O · changes org state

Deletes a data share. Since v63.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `name_or_id` | `nameOrId` | path | string | yes | API name or record ID of the data share. Since v63.0. |

```sql
CALL cdp.data_share_delete (name_or_id => 'Sales_Data_Share');
```

**Result**

No response body (HTTP 200). One row with only the standard columns.

**Notes:** [Manage Data Shares](https://help.salesforce.com/s/articleView?id=data.c360_a_manage_data_shares.htm&language=en_US&type=5) says you can delete a share that is unlinked and no longer needed, so unlink it first. The spec doesn't state this rule. Its status enum has `Deleting`, and it doesn't say whether the call returns before the share is gone.

## data_share_target_get

`GET /ssot/data-share-target/{nameOrId}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Shares/paths/~1ssot~1data-share-target~1%7BnameOrId%7D/get) · evidence O · read-only

Returns a data share target. Since v63.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `name_or_id` | `nameOrId` | path | string | yes | API name or record ID of the data share target. Since v63.0. |

```sql
CALL cdp.data_share_target_get (name_or_id => 'Snowflake_Prod_Target');
```

**Result**

One row. Schema `DataShareTargetRepresentation`.

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
| `target_email_id` | `targetEmailId` | VARCHAR | - |
| `target_email_type` | `targetEmailType` | VARCHAR | - |
| `sub_type` | `subType` | VARCHAR | - |
| `target_org_id` | `targetOrgId` | VARCHAR | - |
| `account_url` | `accountUrl` | VARCHAR | - |
| `service_account_id` | `serviceAccountId` | VARCHAR | - |
| `is_public_key_provided` | `isPublicKeyProvided` | BOOLEAN | - |
| `issuer` | `issuer` | VARCHAR | - |
| `public_key` | `publicKey` | VARCHAR | - |
| `public_cert` | `publicCert` | VARCHAR | - |
| `status` | `status` | VARCHAR | Status of the data share target. Since v63.0. |
| `target_type` | `targetType` | VARCHAR | Type of data share target. The endpoint returns the output object that corresponds to the target type. For example, the Aws Data Share Target Output is returned for the `Aws` target type. Since v63.0. |
| `account_id` | `accountId` | VARCHAR | - |
| `aws_role_arn` | `awsRoleArn` | VARCHAR | - |

**Notes:** `status` values in the spec are `Active`, `Deleting`, `Error`, `GrantRevokeAccess`, `InActive` and `Processing`. The spec doesn't define them.

The type-specific fields, such as `account_url`, `sub_type` and `target_email_id`, are in the spec's output schemas but aren't columns in the table above. Expect them in `_raw`. The [Snowflake](https://developer.salesforce.com/blogs/2024/08/share-your-data-from-salesforce-data-cloud-to-snowflake) and [BigQuery](https://developer.salesforce.com/blogs/2024/10/bring-your-google-bigquery-data-lake-to-data-cloud-part-2-data-out) blogs check an authentication status of `Successful` in the UI. The spec has no such field.

## data_share_target_list

`GET /ssot/data-share-targets/{targetType}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Shares/paths/~1ssot~1data-share-targets~1%7BtargetType%7D/get) · evidence O · read-only

Returns all data share targets of a given target type. Since v63.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `target_type` | `targetType` | path | string | yes | Type of data share target. Possible values are `Aws`, `BigQuery`, `Databricks`, `Datacloud`, `Ibm`, `Other`, `Snowflake`, and `SnowflakeOpenFlow`. Since v63.0. |

```sql
CALL cdp.data_share_target_list (target_type => 'Snowflake');
```

**Result**

One row per item of `/dataShareTargets` in the response. Other response fields go to `_meta`: `currentPageUrl`, `nextPageUrl`, `totalSize`. Schema `DataShareTargetRepresentation`.

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
| `target_email_id` | `targetEmailId` | VARCHAR | - |
| `target_email_type` | `targetEmailType` | VARCHAR | - |
| `sub_type` | `subType` | VARCHAR | - |
| `target_org_id` | `targetOrgId` | VARCHAR | - |
| `account_url` | `accountUrl` | VARCHAR | - |
| `service_account_id` | `serviceAccountId` | VARCHAR | - |
| `is_public_key_provided` | `isPublicKeyProvided` | BOOLEAN | - |
| `issuer` | `issuer` | VARCHAR | - |
| `public_key` | `publicKey` | VARCHAR | - |
| `public_cert` | `publicCert` | VARCHAR | - |
| `status` | `status` | VARCHAR | Status of the data share target. Since v63.0. |
| `target_type` | `targetType` | VARCHAR | Type of data share target. The endpoint returns the output object that corresponds to the target type. For example, the Aws Data Share Target Output is returned for the `Aws` target type. Since v63.0. |
| `account_id` | `accountId` | VARCHAR | - |
| `aws_role_arn` | `awsRoleArn` | VARCHAR | - |

**Paging:** `next_page_url`.

**Notes:** `target_type` is required, and the spec has no call that returns targets of every type. To see all targets, call this once per type. The spec lists no `limit` or `offset` here, unlike `data_share_list`. Type-specific fields aren't columns in the table above, so expect them in `_raw`.

## data_share_get

`GET /ssot/data-share/{nameOrId}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Shares/paths/~1ssot~1data-share~1%7BnameOrId%7D/get) · evidence O · read-only

Returns a data share with its object names. Since v63.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `name_or_id` | `nameOrId` | path | string | yes | API name or record ID of the data share. Since v63.0. |

```sql
CALL cdp.data_share_get (name_or_id => 'Sales_Data_Share');
```

**Result**

One row. Schema `DataShareRepresentation`.

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
| `data_share_objects` | `dataShareObjects` | JSON (DataShareObjectRepresentation) | Data share objects included in the data share. Since v63.0. |
| `dataspace_name` | `dataspaceName` | VARCHAR | Name of the data space that the data share belongs to. Since v63.0. |
| `status` | `status` | VARCHAR | Status of the data share. Since v63.0. |

**Notes:** This is the call to poll after create or update. `status` values in the spec are `Active`, `Deleting`, `Error`, `InActive` and `Processing`. The response example uses `PROCESSING` in capitals, so compare without regard to case.

`data_share_objects` holds a JSON object whose `names` array has the object names. The spec's output schema has no field for linked targets, so this call doesn't show where a share is exposed.

## data_share_list

`GET /ssot/data-shares` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Shares/paths/~1ssot~1data-shares/get) · evidence O · read-only

Returns all data shares in the org, ordered by developer name. Since v63.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `limit` | `limit` | query | integer |  | Maximum number of data shares to return. Since v63.0. |
| `offset` | `offset` | query | integer |  | Number of rows to skip before returning results. If unspecified, no rows are skipped. Since v63.0. |

```sql
CALL cdp.data_share_list ();
```

**Result**

One row per item of `/dataShares` in the response. Other response fields go to `_meta`: `currentPageUrl`, `nextPageUrl`, `totalSize`. Schema `DataShareRepresentation`.

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
| `data_share_objects` | `dataShareObjects` | JSON (DataShareObjectRepresentation) | Data share objects included in the data share. Since v63.0. |
| `dataspace_name` | `dataspaceName` | VARCHAR | Name of the data space that the data share belongs to. Since v63.0. |
| `status` | `status` | VARCHAR | Status of the data share. Since v63.0. |

**Paging:** `next_page_url`.

## data_share_update

`PATCH /ssot/data-share/{nameOrId}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Shares/paths/~1ssot~1data-share~1%7BnameOrId%7D/patch) · evidence O · changes org state

Updates a data share's label, description or objects. Use it to add objects to a share or remove them from it. Since v63.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `name_or_id` | `nameOrId` | path | string | yes | API name or record ID of the data share. Since v63.0. |
| `dataspace_name` | `dataSpaceName` | body | string |  | Name of the data space. If unspecified, the `default` data space is used. This property is required for data graph resources. Since v59.0. |
| `description` | `description` | body | string |  | Description of the object to create. Since v59.0. |
| `label` | `label` | body | string |  | Label of the object to create. This property is required for data graph resources. Since v59.0. |
| `name` | `name` | body | string |  | API name of the object to create. This property is required for data graph resources. Since v59.0. |
| `data_share_objects` | `dataShareObjects` | body | array of string |  | List of data share object names to include in the data share. Since v63.0. |

```sql
CALL cdp.data_share_update (name_or_id => 'Sales_Data_Share', label => 'Sales Data Share (Updated)', description => 'Added order-line DMO', data_share_objects => ['Account_Home__dll', 'Sales_Order__dlm', 'Sales_Order_Line__dlm', 'Contact_Point_Email__cio']);
```

**Result**

One row. Schema `DataShareRepresentation`.

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
| `data_share_objects` | `dataShareObjects` | JSON (DataShareObjectRepresentation) | Data share objects included in the data share. Since v63.0. |
| `dataspace_name` | `dataspaceName` | VARCHAR | Name of the data space that the data share belongs to. Since v63.0. |
| `status` | `status` | VARCHAR | Status of the data share. Since v63.0. |

**Done when:** `data_share_get.status` is `Active`. `Error` means it failed. The spec reuses one response example with `PROCESSING` and doesn't say how long an update takes.

**Notes:** This changes what consumers can see. Per [Manage Data Shares](https://help.salesforce.com/s/articleView?id=data.c360_a_manage_data_shares.htm&language=en_US&type=5), added objects become reachable through the linked target and removed objects stop being reachable.

The spec doesn't say whether `data_share_objects` replaces the list or adds to it. Its request example sends the three existing names plus one new one, which reads as a full replacement. Send the whole list. `data_share_objects` has the same conflict as in [`data_share_create`](#data_share_create).

The options come from the spec's shared input schema. The spec doesn't say whether `name` or `dataspace_name` can change, and its example sends neither.

## data_share_create

`POST /ssot/data-share` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Shares/paths/~1ssot~1data-share/post) · evidence O · changes org state

Creates a data share and adds the data model object (DMO), data lake object (DLO), and calculated insight object (CIO) to it. Since v63.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `dataspace_name` | `dataSpaceName` | body | string |  | Name of the data space. If unspecified, the `default` data space is used. This property is required for data graph resources. Since v59.0. Sources also spell it `dataspaceName`: quote that name to send that spelling. |
| `description` | `description` | body | string |  | Description of the object to create. Since v59.0. |
| `label` | `label` | body | string |  | Label of the object to create. This property is required for data graph resources. Since v59.0. |
| `name` | `name` | body | string |  | API name of the object to create. This property is required for data graph resources. Since v59.0. |
| `data_share_objects` | `dataShareObjects` | body | array of string |  | List of data share object names to include in the data share. Since v63.0. |

```sql
CALL cdp.data_share_create (name => 'Sales_Data_Share', label => 'Sales Data Share', dataspace_name => 'default', description => 'Shares sales DMOs and DLOs with external partners', data_share_objects => ['Account_Home__dll', 'Sales_Order__dlm', 'Contact_Point_Email__cio']);
```

**Result**

One row. Schema `DataShareRepresentation`.

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
| `data_share_objects` | `dataShareObjects` | JSON (DataShareObjectRepresentation) | Data share objects included in the data share. Since v63.0. |
| `dataspace_name` | `dataspaceName` | VARCHAR | Name of the data space that the data share belongs to. Since v63.0. |
| `status` | `status` | VARCHAR | Status of the data share. Since v63.0. |

**Done when:** `data_share_get.status` is `Active`. `Error` means it failed. The spec's response example returns `PROCESSING`, and [Trailhead](https://trailhead.salesforce.com/content/learn/modules/data-cloud-with-zero-copy/get-started-with-zero-copy-data-sharing) says a saved share moves to active and must be active before linking.

**Notes:** **The spec disagrees with itself.** The schema has `dataspace_name` and `data_share_objects` as an array of strings. The spec's request example and the [Postman catalog](https://github.com/supanmaniar/salesforce-mcn-d360-agent/blob/main/catalog/endpoints.json) (community copy) send `dataspace_name` and `dataShareObjects: {names: [...]}`, which is the response's shape. This reference follows the schema. Nothing has been tested, so the example form may turn out to be the working one.

The spec marks nothing required, though every example sends `name` and `label`. The "required for data graph resources" text comes from a shared input schema and doesn't concern shares.

Object names carry their type suffix: `__dll` for a DLO, `__dlm` for a DMO, `__cio` for a calculated insight object. Per [Create a Data Share](https://help.salesforce.com/s/articleView?language=en_US&id=data.c360_a_create_data_shares.htm&type=5), you can't share an external DLO or a DMO mapped to one with an external data lake.

Limits per org differ by page. [Data 360 Limits](https://help.salesforce.com/s/articleView?language=en_US&id=sf.c360_a_limits_and_guidelines.htm) says 100 shares. [Customer Data Platform Limits](https://help.salesforce.com/s/articleView?language=en_US&id=sf.c360_a_limits_and_guidelines_cdp.htm&type=5) says 20. Both say 250 objects per share. The [change log](https://help.salesforce.com/s/articleView?id=data.c360_a_changelog_usage_and_access.htm&language=en_US&type=5) has conflicting entries too.

## data_share_target_create

`POST /ssot/data-share-target` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Shares/paths/~1ssot~1data-share-target/post) · evidence O · changes org state

Creates a data share target of a particular target type. Since v63.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `dataspace_name` | `dataSpaceName` | body | string |  | Name of the data space. If unspecified, the `default` data space is used. This property is required for data graph resources. Since v59.0. Sources also spell it `dataspaceName`: quote that name to send that spelling. |
| `description` | `description` | body | string |  | Description of the object to create. Since v59.0. |
| `label` | `label` | body | string |  | Label of the object to create. This property is required for data graph resources. Since v59.0. |
| `name` | `name` | body | string |  | API name of the object to create. This property is required for data graph resources. Since v59.0. |
| `target_email_id` | `targetEmailId` | body | string |  | - |
| `target_email_type` | `targetEmailType` | body | enum(Group, ServiceAccount, User) |  | - |
| `sub_type` | `subType` | body | enum(Aws, CleanRoom) |  | - |
| `target_org_id` | `targetOrgId` | body | string (Id) |  | - |
| `target_url` | `targetUrl` | body | string |  | - |
| `account_url` | `accountUrl` | body | string |  | - |
| `service_account_id` | `serviceAccountId` | body | string |  | - |
| `is_public_key_provided` | `isPublicKeyProvided` | body | boolean |  | - |
| `issuer` | `issuer` | body | string |  | - |
| `public_key` | `publicKey` | body | string |  | - |
| `public_cert` | `publicCert` | body | string |  | - |
| `target_type` | `targetType` | body | enum(Aws, BigQuery, Databricks, Datacloud, Ibm, Other, Snowflake, SnowflakeOpenFlow) |  | Type of data share target. Use the input object that correspongs to the target type. For example, use the AWS Data Share Target Input for the `Aws` target type. Since v63.0. |
| `account_id` | `accountId` | body | string |  | - |
| `aws_role_arn` | `awsRoleArn` | body | string |  | - |

```sql
CALL cdp.data_share_target_create (target_type => 'BigQuery', name => 'BigQuery_Analytics_Target', label => 'BigQuery Analytics', dataspace_name => 'default', description => 'BigQuery target for analytics team', target_email_id => 'analytics-team@example.com', target_email_type => 'Group');
```

**Result**

One row. Schema `DataShareTargetRepresentation`.

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
| `target_email_id` | `targetEmailId` | VARCHAR | - |
| `target_email_type` | `targetEmailType` | VARCHAR | - |
| `sub_type` | `subType` | VARCHAR | - |
| `target_org_id` | `targetOrgId` | VARCHAR | - |
| `account_url` | `accountUrl` | VARCHAR | - |
| `service_account_id` | `serviceAccountId` | VARCHAR | - |
| `is_public_key_provided` | `isPublicKeyProvided` | BOOLEAN | - |
| `issuer` | `issuer` | VARCHAR | - |
| `public_key` | `publicKey` | VARCHAR | - |
| `public_cert` | `publicCert` | VARCHAR | - |
| `status` | `status` | VARCHAR | Status of the data share target. Since v63.0. |
| `target_type` | `targetType` | VARCHAR | Type of data share target. The endpoint returns the output object that corresponds to the target type. For example, the Aws Data Share Target Output is returned for the `Aws` target type. Since v63.0. |
| `account_id` | `accountId` | VARCHAR | - |
| `aws_role_arn` | `awsRoleArn` | VARCHAR | - |

**Done when:** `data_share_target_get.status` is `Active`. The spec's response examples return `Active` at once, but its enum also has `Processing` and `Error`.

**Notes:** **The table above is incomplete.** The spec adds attributes per `target_type` through a `oneOf`, and each is a top-level option. None is marked required.

| `target_type` | Attributes |
|---|---|
| `Aws` | `account_id`: AWS account ID. `aws_role_arn`: AWS role ARN. `sub_type`: `Aws` or `CleanRoom`. |
| `BigQuery` | `target_email_id`: email address of the Google principal. `target_email_type`: `Group`, `ServiceAccount` or `User`. |
| `Databricks` | `account_url`: service account URL for the connection created in Databricks. `service_account_id`: service account ID for that connection. |
| `Datacloud` | `target_org_id`: org ID of the target. `target_url`: Data Cloud URL of the target. `sub_type`: `CleanRoom` or `DatacloudToDatacloud`. |
| `Ibm` | `account_url`: IBM account URL. `service_account_id`: service account ID from the connection created in IBM. |
| `Other` | `issuer`: issuer URL of the external system. `is_public_key_provided`: if `true`, `public_key` is used, and if `false`, the issuer URL hosts the key. `public_key`: required when `is_public_key_provided` is `true`. `service_account_id`: service account ID from the connection created there. |
| `Snowflake` | `account_url`: Snowflake account URL. `sub_type`: the only value is `CleanRoom`. |
| `SnowflakeOpenFlow` | `account_url`: Snowflake account URL. `public_cert`: public certificate from the connection created in Snowflake. `service_account_id`: service account ID from that connection. |

**Authentication isn't covered by the spec.** The UI walkthroughs need steps with no matching option. A [2024 Snowflake blog](https://developer.salesforce.com/blogs/2024/08/share-your-data-from-salesforce-data-cloud-to-snowflake) asks for a client ID and secret from a security integration, then a browser login and consent. [BigQuery](https://help.salesforce.com/s/articleView?id=005101362&language=en_US&type=1) redirects to Google sign-in, and the target turns `Active` after that. No source says how a target created through the API gets authenticated, so a target may not work until someone finishes this in the UI.

Per target type:

- BigQuery: the [same article](https://help.salesforce.com/s/articleView?id=005101362&language=en_US&type=1) offers User or Group, says the principal must belong to a valid Google Workspace domain and limits the label to 20 characters. It lists the IAM roles to grant, among them Analytics Hub Subscriber and BigQuery Data Viewer. The spec also allows `ServiceAccount`.
- Datacloud: the [overview](https://help.salesforce.com/s/articleView?language=en_US&id=data.c360_a_share_data_between_dc_orgs.htm&type=5) says the sending org must be allowlisted and the receiving org must accept the request. Shared objects arrive there as DLOs. [Billing](https://help.salesforce.com/s/articleView?id=data.c360_a_billing_considerations_for_data_sharing_with_data_cloud.htm&language=en_US&type=5) has its own page.

Limits per org differ by page: [Data 360 Limits](https://help.salesforce.com/s/articleView?language=en_US&id=sf.c360_a_limits_and_guidelines.htm) says 20 targets, and [Customer Data Platform Limits](https://help.salesforce.com/s/articleView?language=en_US&id=sf.c360_a_limits_and_guidelines_cdp.htm&type=5) says 5. The spec's request examples send `dataspaceName`, while the schema has `dataSpaceName`, as in [`data_share_create`](#data_share_create).

## data_share_link

`POST /ssot/data-share/{nameOrId}/actions/link` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Shares/paths/~1ssot~1data-share~1%7BnameOrId%7D~1actions~1link/post) · evidence O · changes org state

Links a data share with a data share target. If the target is already linked, the operation is idempotent and no changes are made. Since v63.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `name_or_id` | `nameOrId` | path | string | yes | API name or ID of the data share. Since v63.0. |
| `data_share_target_names` | `dataShareTargetNames` | body | array of string |  | List of developer names for the data share targets to link. Since v63.0. |

```sql
CALL cdp.data_share_link (name_or_id => 'Sales_Data_Share', data_share_target_names => ['Snowflake_Prod_Target', 'BigQuery_Analytics_Target']);
```

**Result**

One row. Schema `DataShareRepresentation`.

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
| `data_share_objects` | `dataShareObjects` | JSON (DataShareObjectRepresentation) | Data share objects included in the data share. Since v63.0. |
| `dataspace_name` | `dataspaceName` | VARCHAR | Name of the data space that the data share belongs to. Since v63.0. |
| `status` | `status` | VARCHAR | Status of the data share. Since v63.0. |

**Done when:** `data_share_get.status` is `Active`. The spec doesn't say whether linking is asynchronous, but its response example has `PROCESSING`.

**Notes:** The share must be [active before linking](https://trailhead.salesforce.com/content/learn/modules/data-cloud-with-zero-copy/get-started-with-zero-copy-data-sharing). `name_or_id` identifies the share and takes a name or ID, while `data_share_target_names` takes developer names only. Since the call is idempotent per the spec, a retry is safe.

Linking isn't the last step. In [Snowflake](https://developer.salesforce.com/blogs/2024/08/share-your-data-from-salesforce-data-cloud-to-snowflake), the consumer gets the data from Private Sharing, under Direct Shares. In [BigQuery](https://help.salesforce.com/s/articleView?id=005101362&language=en_US&type=1), they search listings in Analytics Hub by the label and subscribe. A [receiving Data 360 org](https://help.salesforce.com/s/articleView?language=en_US&id=data.c360_a_share_data_between_dc_orgs.htm&type=5) accepts the request.

The response has no field for linked targets, so it can't confirm the link.

## data_share_unlink

`POST /ssot/data-share/{nameOrId}/actions/unlink` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Shares/paths/~1ssot~1data-share~1%7BnameOrId%7D~1actions~1unlink/post) · evidence O · changes org state

Unlinks a data share from a data share target. If the target is already unlinked, the operation is idempotent and no changes are made. Since v63.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `name_or_id` | `nameOrId` | path | string | yes | API name or ID of the data share. Since v63.0. |
| `data_share_target_names` | `dataShareTargetNames` | body | array of string |  | List of developer names for the data share targets to unlink. Since v63.0. |

```sql
CALL cdp.data_share_unlink (name_or_id => 'Sales_Data_Share', data_share_target_names => ['BigQuery_Analytics_Target']);
```

**Result**

One row. Schema `DataShareRepresentation`.

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
| `data_share_objects` | `dataShareObjects` | JSON (DataShareObjectRepresentation) | Data share objects included in the data share. Since v63.0. |
| `dataspace_name` | `dataspaceName` | VARCHAR | Name of the data space that the data share belongs to. Since v63.0. |
| `status` | `status` | VARCHAR | Status of the data share. Since v63.0. |

**Done when:** `data_share_get.status` is `Active`. The spec doesn't say whether unlinking is asynchronous, but its response example has `PROCESSING`.

**Notes:** [Salesforce's legacy Snowflake page](https://help.salesforce.com/s/articleView?language=en_US&id=data.c360_a_access_data_from_snowflake.htm&type=5) warns not to unlink a share from a legacy target until the new V2 connection is verified, because downstream Snowflake processes can refer to the database created through the legacy target. That page also says legacy targets can't be created anymore.

Unlink before calling `data_share_delete` or `data_share_target_delete`. Since the call is idempotent per the spec, a retry is safe.

