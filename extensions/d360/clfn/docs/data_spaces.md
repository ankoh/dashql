<!-- Generated from extensions/d360/clfn/spec/data_spaces.yaml, edit that and run: bazel run //extensions/d360:update -->

# Data Spaces

Part of the [CDP function reference](functions.md). Nothing here is implemented or tested against an org. Every result also has the [standard columns](functions.md#result-schema).

A data space is an [isolated workspace](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/runtime/FamilyCatalog.java) inside one org. Create a space, add data lake objects (DLOs) as members, wait for member `status`, then name the space on later calls. Most calls that accept a space fall back to `default` when you omit it.

**Members are DLOs, not users.** User access comes from `dataspaceScopes` on a permission set, [deployed as metadata](https://github.com/forcedotcom/sf-skills/blob/main/skills/platform-dataspace-access-configure/SKILL.md). No function here grants it.

**Scoping has no single rule.** The option's name and position vary per call in the spec:

| Where | Calls |
|---|---|
| `dataspace` query | `metadata`, mappings, DMO relationships, `segment_list`, `segment_create`, the calculated insight list, data graphs, data actions |
| `dataspace` query | Activation and target enable, disable and metadata lookups |
| `dataspace_name` or `dataspace_id` query | Object access grants; capping dimensions |
| Body field | `dataspace_name` on `dmo_create`, `activation_create`; `dataspace_info` on `dlo_create`, `datastream_create` |
| None | `dlo_list`, `dmo_list`, `datastream_list`, `activation_list`, target and identity resolution lists |

For the last row, [filter the response yourself (community, one org with one space)](https://github.com/szymonlewandowski/config-snapshot-data360/blob/main/docs/api-quirks.md). That source also found `dlo_list` filters by space after paging, so short pages don't mean the end.

This family's own calls take `id_or_name`. Salesforce's [MCP tools](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/DataSpaceTools.java) call it `dataSpaceNameOrId`, and `dataSpaceNameOrID` on the member list only. Those are Java parameter names, not API names.

```sql
CALL cdp.dataspace_create (label => 'nonDefault', prefix => 'ndf', description => 'Custom data space.');
CALL cdp.dataspace_member_add (id_or_name => 'nonDefault', members => (members = [(member_name = 'Orders__dll', filter = (conjunctive_operator = 'NoneOperator', conditions = (conditions = [])))]));
CALL cdp.dataspace_member_get (id_or_name => 'nonDefault', dataspace_member_object_name => 'Orders__dll'); /* repeat until status is ACTIVE */
CALL cdp.segment_list (dataspace => 'nonDefault');
```

**Functions:** [`dataspace_delete`](#dataspace_delete), [`dataspace_member_remove`](#dataspace_member_remove), [`dataspace_list`](#dataspace_list), [`dataspace_get`](#dataspace_get), [`dataspace_member_list`](#dataspace_member_list), [`dataspace_member_get`](#dataspace_member_get), [`dataspace_update`](#dataspace_update), [`dataspace_create`](#dataspace_create), [`dataspace_sync`](#dataspace_sync), [`dataspace_member_sync`](#dataspace_member_sync), [`dataspace_member_add`](#dataspace_member_add)

## dataspace_delete

`DELETE /ssot/data-spaces/{idOrName}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Spaces/paths/~1ssot~1data-spaces~1%7BidOrName%7D/delete) · evidence O · changes org state

Deletes a data space by ID or API name.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `id_or_name` | `idOrName` | path | string | yes | ID (`0vhSB000001bqwjYAA`) or API name (`nonDefault`) of the data space. |

```sql
CALL cdp.dataspace_delete (id_or_name => 'nonDefault');
```

**Result**

No response body (HTTP 204). One row with only the standard columns.

**Notes:** Only the newer spec has this call. It's absent from the older v68 copy, from the MCP tools and from the [community CLI](https://github.com/dsouza-anush/sf-plugin-data360/blob/main/src/resources/dataSpace.ts). The spec lists 204, 403, 404 and 412 with no explanation of 412. No source says what happens to the members, or whether `default` can be deleted.

## dataspace_member_remove

`DELETE /ssot/data-spaces/{idOrName}/members` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Spaces/paths/~1ssot~1data-spaces~1%7BidOrName%7D~1members/delete) · tool `d360_dataspace_member_remove` · evidence O · changes org state

Delete the specified data lake objects (DLOs) from a data space. Since v66.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `id_or_name` | `idOrName` | path | string | yes | ID or API name of the data space. Since v66.0. |
| `member_names` | `memberNames` | query | string | yes | DLO names separated by commas, for example, `DataSpaceMember1__dll,DataSpaceMember2__dll`. Maximum 10 members per request. Since v66.0. |

```sql
CALL cdp.dataspace_member_remove (id_or_name => 'nonDefault', member_names => 'Orders__dll,Returns__dll');
```

**Result**

No response body (HTTP 200). One row with only the standard columns.

**Notes:** A 200 doesn't mean the members were removed. The older spec copy says individual items may fail, each with a `success` boolean and an `errors` object holding `REFERENTIAL_INTEGRITY_VIOLATION` (dependencies found), `NOT_FOUND` or `NO_ACCESS`. Neither copy has a response schema, so the entries have no columns here. Confirm with `dataspace_member_list`.

## dataspace_list

`GET /ssot/data-spaces` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Spaces/paths/~1ssot~1data-spaces/get) · tool `d360_dataspace_list` · evidence O · read-only

Get a collection of all data spaces that a user is assigned to. Since v62.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `limit` | `limit` | query | integer |  | The maximum number of items to return in each response. Values are from `1` through `4999`. The default value is `50` if unspecified. Since v62.0. |
| `offset` | `offset` | query | integer |  | Number of rows to skip before returning results. Must be an integer greater than zero. If unspecified, no rows are skipped. Since v62.0. |
| `order_by` | `orderBy` | query | string |  | Sort order for the result set: `ASC` for ascending or `DESC` for descending. If unspecified, results are returned in ascending order. Since v62.0. |

```sql
CALL cdp.dataspace_list ();
```

**Result**

One row per item of `/dataSpaces` in the response. Other response fields go to `_meta`: `currentPageUrl`, `nextPageUrl`, `totalSize`. Schema `DataSpaceInfoRepresentation`.

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
| `description` | `description` | VARCHAR | Description of the data space. Since v62.0. |
| `prefix` | `prefix` | VARCHAR | Three-character prefix of the data space. Since v62.0. |
| `status` | `status` | VARCHAR | Status of the data space. Since v62.0. |

**Paging:** `next_page_url`.

**Notes:** This returns only the spaces the caller is assigned to, so a missing space may still exist. The [MCP tool](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/DataSpaceTools.java) sends `batch_size` and describes `order_by` as a field name. The spec says `limit`, and `ASC` or `DESC`. A [community skill](https://github.com/Jaganpro/sf-skills/blob/main/skills/sf-datacloud/references/feature-readiness.md) ties this call to the `CdpDataSpace` feature being provisioned (community).

## dataspace_get

`GET /ssot/data-spaces/{idOrName}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Spaces/paths/~1ssot~1data-spaces~1%7BidOrName%7D/get) · tool `d360_dataspace_get` · evidence O · read-only

Get a data space by ID or API name. Since v62.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `id_or_name` | `idOrName` | path | string | yes | ID (`0vhSB000001bqwjYAA`) or API name (`default`) of the data space. |

```sql
CALL cdp.dataspace_get (id_or_name => 'default');
```

**Result**

One row. Schema `DataSpaceInfoRepresentation`.

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
| `description` | `description` | VARCHAR | Description of the data space. Since v62.0. |
| `prefix` | `prefix` | VARCHAR | Three-character prefix of the data space. Since v62.0. |
| `status` | `status` | VARCHAR | Status of the data space. Since v62.0. |

**Notes:** The spec gives `status` the values `Active`, `Error` and `Processing`.

## dataspace_member_list

`GET /ssot/data-spaces/{idOrName}/members` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Spaces/paths/~1ssot~1data-spaces~1%7BidOrName%7D~1members/get) · tool `d360_dataspace_member_list` · evidence O · read-only

Get information about the objects that can access a data space. Currently, only data lake objects (DLOs) are supported. Since v61.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `id_or_name` | `idOrName` | path | string | yes | ID or API name of the data space. |
| `batch_size` | `batchSize` | query | integer |  | The maximum number of items to return in each response. Values are from `1` through `2000`. The default value is `50` if unspecified. Since v61.0. |
| `continuation_token` | `continuationToken` | query | string |  | Token used to retrieve the next set of data space members. Returned when more results are available than can be returned in a single request. - **First request:** Omit the parameter or pass `null` to retrieve the first page. - **Subsequent requests:** Pass the token from the previous response to retrieve the next page. - **Expired tokens:** Tokens can expire after a period of time. If a token expires, restart pagination from the firstpage. - **Last page:** When the response returns no `continuation_token`, you've reached the last page. Since v67.0. |
| `offset` | `offset` | query | integer |  | Number of rows to skip before returning results. Values are from `1` through '2000' If unspecified, no rows are skipped. Since v61.0. |
| `order_by` | `orderBy` | query | string |  | Sort order for the result set: `ASC` for ascending or `DESC` for descending. If unspecified, results are returned in ascending order. Since v61.0. |

```sql
CALL cdp.dataspace_member_list (id_or_name => 'default', batch_size => 200);
```

**Result**

One row per item of `/members` in the response. Other response fields go to `_meta`: `currentPageUrl`, `nextPageUrl`, `totalSize`, `continuationToken`. Schema `DataSpaceMemberRepresentation`.

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
| `filter` | `filter` | JSON (DataSpaceFilterRepresentation) | Filter on the object used for creating the data space member. Since v61.0. |
| `member_name` | `memberName` | VARCHAR | Developer name of the data space member. Since v62.0. |
| `status` | `status` | VARCHAR | Status of the off-core sync of the data space member. Since v62.0. |

**Paging:** `continuationToken` in `_meta`, since v67. No token means the last page. Tokens can expire, then restart from the first page. The schema also has `next_page_url`, but the spec's example response doesn't return it.

**Notes:** Rows are DLOs. The [MCP tool](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/DataSpaceTools.java) comments say "who has access", and its test uses users with roles, which contradicts the spec. That tool also doesn't send `continuation_token`. `offset` stops at 2000 in the spec, so use the token beyond that.

`status` is `Active`, `Error` or `Processing` in the spec's enum, but its examples show `ACTIVE`. [sf-pi](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/registry/connect-openapi-overrides.json) records uppercase from a live response, so compare without case.

## dataspace_member_get

`GET /ssot/data-spaces/{idOrName}/members/{dataSpaceMemberObjectName}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Spaces/paths/~1ssot~1data-spaces~1%7BidOrName%7D~1members~1%7BdataSpaceMemberObjectName%7D/get) · evidence O · read-only

Get details about a data space member for a given data lake object (DLO). Since v62.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `dataspace_member_object_name` | `dataSpaceMemberObjectName` | path | string | yes | Developer name of the DLO that is the member, as in `member_name`. |
| `id_or_name` | `idOrName` | path | string | yes | ID or API name of the data space. |

```sql
CALL cdp.dataspace_member_get (dataspace_member_object_name => 'Orders__dll', id_or_name => 'default');
```

**Result**

One row. Schema `DataSpaceMemberRepresentation`.

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
| `filter` | `filter` | JSON (DataSpaceFilterRepresentation) | Filter on the object used for creating the data space member. Since v61.0. |
| `member_name` | `memberName` | VARCHAR | Developer name of the data space member. Since v62.0. |
| `status` | `status` | VARCHAR | Status of the off-core sync of the data space member. Since v62.0. |

**Notes:** The older spec copy gives `DLO_DloDeveloperName` as the name's form, while every member example uses `DeveloperName1__dll`. In the result, `filter.conditions` is a flat array and operators look like `EqualsOperator`, which differs from the input shape. `status` has the same [case mismatch](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/registry/connect-openapi-overrides.json) as `dataspace_member_list`.

## dataspace_update

`PATCH /ssot/data-spaces/{idOrName}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Spaces/paths/~1ssot~1data-spaces~1%7BidOrName%7D/patch) · tool `d360_dataspace_update` · evidence O · changes org state

Update an existing data space. Since v62.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `id_or_name` | `idOrName` | path | string | yes | ID or API name of the data space. |
| `description` | `description` | body | string | yes | Description of the data space. Since v62.0. |
| `label` | `label` | body | string | yes | Label of the data space. Since v62.0. |

```sql
CALL cdp.dataspace_update (id_or_name => 'nonDefault', label => 'nonDefault', description => 'Custom data space.');
```

**Result**

One row. Schema `DataSpaceInfoRepresentation`.

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
| `description` | `description` | VARCHAR | Description of the data space. Since v62.0. |
| `prefix` | `prefix` | VARCHAR | Three-character prefix of the data space. Since v62.0. |
| `status` | `status` | VARCHAR | Status of the data space. Since v62.0. |

**Notes:** The spec requires both `label` and `description`, so resend the one you aren't changing. `name`, `prefix` and `filter` aren't in the input, so this call can't change them.

## dataspace_create

`POST /ssot/data-spaces` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Spaces/paths/~1ssot~1data-spaces/post) · tool `d360_dataspace_create` · evidence O · changes org state

Create a new data space based on the input details provided. Since v62.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `id` | `id` | body | string |  | ID of the asset. Since v58.0. |
| `name` | `name` | body | string |  | Name of the asset. Since v58.0. |
| `namespace` | `namespace` | body | string |  | Namespace of the asset. Since v58.0. |
| `filter` | `filter` | body | [DataSpaceFilterInput](#dataspacefilterinputrepresentation) |  | Filter for the data space. Since v60.0. |
| `label` | `label` | body | string |  | Not in the spec schema: from the spec's examples. |
| `prefix` | `prefix` | body | string |  | Not in the spec schema: from the spec's examples. |
| `description` | `description` | body | string |  | Not in the spec schema: from the spec's examples. |

```sql
CALL cdp.dataspace_create (label => 'nonDefault', prefix => 'ndf', description => 'Custom data space.');
```

**Result**

One row. Schema `DataSpaceInfoRepresentation`.

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
| `description` | `description` | VARCHAR | Description of the data space. Since v62.0. |
| `prefix` | `prefix` | VARCHAR | Three-character prefix of the data space. Since v62.0. |
| `status` | `status` | VARCHAR | Status of the data space. Since v62.0. |

**Done when:** `dataspace_get.status` is `Active`. `Processing` means still running, `Error` means failed. The spec's example returns `Active` from the create itself.

**Notes:** The spec contradicts itself on the body. Its schema lists `id`, `name`, `namespace` and `filter`, which is what the table shows. Its example and the [Postman collection](https://github.com/supanmaniar/salesforce-mcn-d360-agent/blob/main/catalog/endpoints.json) send `label`, `prefix` and `description`, so the example above uses options the table lacks. The [MCP request class](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/model/request/dataspace/DataSpaceCreateRequest.java) sends `name`, `label` and `description`.

In the spec's example no `name` is sent, and the response's `name` equals `label`. The response schema calls `prefix` three characters. The spec also lists a 409 without describing it.

## dataspace_sync

`POST /ssot/data-spaces/{idOrName}/actions/retry` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Spaces/paths/~1ssot~1data-spaces~1%7BidOrName%7D~1actions~1retry/post) · evidence O · changes org state

Retries the sync of a data space. The spec gives only the summary "Sync data space" and the path `actions/retry`.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `id_or_name` | `idOrName` | path | string | yes | ID or API name of the data space. |

```sql
CALL cdp.dataspace_sync (id_or_name => 'nonDefault');
```

**Result**

No response body (HTTP 204). One row with only the standard columns.

**Done when:** No source documents this. `dataspace_get.status` is the only progress field in the spec.

**Notes:** Only the newer spec has this call. It's absent from the older v68 copy and the MCP tools, and no source says when to call it. The spec lists 204 and 404.

## dataspace_member_sync

`POST /ssot/data-spaces/{idOrName}/members/{dataSpaceMemberObjectName}/actions/retry` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Spaces/paths/~1ssot~1data-spaces~1%7BidOrName%7D~1members~1%7BdataSpaceMemberObjectName%7D~1actions~1retry/post) · evidence O · changes org state

Retries the sync of one data space member. The spec gives only the summary "Sync data space member" and the path `actions/retry`.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `dataspace_member_object_name` | `dataSpaceMemberObjectName` | path | string | yes | Developer name of the DLO that is the member, as in `member_name`. |
| `id_or_name` | `idOrName` | path | string | yes | ID or API name of the data space. |

```sql
CALL cdp.dataspace_member_sync (dataspace_member_object_name => 'Orders__dll', id_or_name => 'nonDefault');
```

**Result**

No response body (HTTP 204). One row with only the standard columns.

**Done when:** No source documents this. The member's `status`, from `dataspace_member_get`, is described as the status of its off-core sync.

**Notes:** Only the newer spec has this call. It's absent from the older v68 copy and the MCP tools, and no source says when to call it. The spec lists 204 and 404.

## dataspace_member_add

`PUT /ssot/data-spaces/{idOrName}/members` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Spaces/paths/~1ssot~1data-spaces~1%7BidOrName%7D~1members/put) · tool `d360_dataspace_member_add` · evidence O · changes org state

Add members to a data space or update existing data space filters. Currently, only data lake objects (DLOs) are supported. Both create and update are acceptable methods. Since v61.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `id_or_name` | `idOrName` | path | string | yes | ID or API name of the data space. |
| `members` | `members` | body | array of [DataSpaceMemberInputList](#dataspacememberinputlistrepresentation) | yes | A list of members to either create or update in the data space. Since v62.0. |

```sql
CALL cdp.dataspace_member_add (id_or_name => 'nonDefault', members => (members = [(member_name = 'Orders__dll', filter = (conjunctive_operator = 'OrOperator', condition_groups = [], conditions = (conditions = [(field_name = 'Region__c', filter_value = 'EMEA', operator = 'EqualsOperator', table_name = 'Orders__dll')])))]));
```

**Result**

One row. Schema `DataSpaceMemberPutCollectionRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `dataspace_members` | `dataSpaceMembers` | JSON (DataSpaceMemberCollectionRepresentation) | Details of the data space members that have been successfully created or updated. Since v62.0. |
| `errors` | `errors` | JSON (array of DataSpaceMemberErrorRepresentation) | Details of the data space members that have been ignored or failed during the operation. Since v62.0. |
| `success` | `success` | VARCHAR | Status of the operation (`true` or `false`). Value is `true` if some or all members have been created or updated. Value is `false` only if all members have failed to be created or updated. Since v62.0. |

**Done when:** `dataspace_member_get.status` or `dataspace_member_list.status` is `ACTIVE`. `PROCESSING` means still running, `ERROR` means failed. The spec's example returns `PROCESSING` from this call. Compare without case.

**Notes:** The sources give three body shapes:

- **Spec schema, shown in the tables:** `members` is an array of `(members = [...])`, `filter` is an array, and `conditions` is an array of `(conditions = [...])`.
- **Spec example, [Postman collection](https://github.com/supanmaniar/salesforce-mcn-d360-agent/blob/main/catalog/endpoints.json) and [community CLI](https://github.com/dsouza-anush/sf-plugin-data360/blob/main/src/commands/data360/data-space/member/set.ts):** `members`, `filter` and `conditions` are each a single object. The example above uses this. The CLI's [coverage doc](https://github.com/dsouza-anush/sf-plugin-data360/blob/main/docs/API_COVERAGE.md) claims live evidence for it (community).
- **[MCP classes](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/model/request/dataspace/DataSpaceMemberRequest.java):** `members` is a flat array of members, and `filter` is an array.

The input enum says `Equals`, while the output enum and every example say `EqualsOperator`. `filter` is required. For no filter, the community CLI sends `conjunctive_operator = 'NoneOperator'` with empty conditions (community).

The MCP tool comments describe granting access to a user with a role, and its test passes `user-456`. The spec allows only DLOs. Sending an existing `member_name` updates its filter. `DataLakeObjectInput` also has `dataspace_info`, so `dlo_create` and `datastream_create` can name spaces at creation.

## Schemas

Attribute names are keywords inside the object they belong to, so completion offers exactly these.

### DataSpaceFilterConditionCollectionRepresentation

Represents a data space input filter on a data lake object (DLO).

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `conditions` | `conditions` | array of [DataSpaceFilterConditionInput](#dataspacefilterconditioninputrepresentation) | yes | Conditions for the filter. Since v62.0. |

### DataSpaceFilterConditionInputRepresentation

Represents the input for a data space filter condition.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `field_name` | `fieldName` | string | yes | Name of the field. Since v62.0. |
| `filter_value` | `filterValue` | string | yes | Value of the filter. Since v62.0. |
| `operator` | `operator` | enum(ContainsAny, Equals, GreaterThan, In, LastNumberOfDays, LessThan, NotEquals, NotIn) | yes | Operator of the filter condition. These are compatible with the following data types: - `ContainsAny`: text - `Equals`: text, number, date, dateTime, boolean - `GreaterThan`: number, date, dateTime - `In`: text, number - `LastNumberOfDays`: date, dateTime - `LessThan`: number, date, dateTime - `NotEquals`: text, number, date, dateTime, boolean - `NotIn`: text, number Since v62.0. |
| `table_name` | `tableName` | string | yes | Name of the table to apply the filter. Since v62.0. |

### DataSpaceFilterInputRepresentation

Represents the input filter for a data space on a data lake object (DLO).

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `condition_groups` | `conditionGroups` | array of [DataSpaceFilterInput](#dataspacefilterinputrepresentation) |  | List of filter groups. Since v67.0. |
| `conditions` | `conditions` | array of [DataSpaceFilterConditionCollection](#dataspacefilterconditioncollectionrepresentation) | yes | Conditions for the filter. Since v62.0. |
| `conjunctive_operator` | `conjunctiveOperator` | enum(AndOperator, NoneOperator, OrOperator) | yes | Operator of the filter. Since v62.0. |
| `filter_creation_type` | `filterCreationType` | string |  | Type of filter creation type, such as `CUSTOM` or `SYSTEM`. Since v66.0. |

### DataSpaceMemberInputListRepresentation

Represents a list of data space members.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `members` | `members` | array of [DataSpaceMemberInput](#dataspacememberinputrepresentation) | yes | Members of a data space. Since v62.0. |

### DataSpaceMemberInputRepresentation

Represents the member details for updating a data space.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `filter` | `filter` | array of [DataSpaceFilterInput](#dataspacefilterinputrepresentation) | yes | Filter applied on the data space member. Since v62.0. |
| `member_name` | `memberName` | string | yes | Developer name of the data space member. Since v62.0. |
