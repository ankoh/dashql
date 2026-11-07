# Data Lake Objects

Part of the [CDP function reference](functions.md). Nothing here is implemented or tested against an org. Every result also has the [standard columns](functions.md#result-schema).

A data lake object (DLO) is a table of raw ingested data, named `<Name>__dll`. It sits between a data stream and a data model object (DMO): stream, then DLO, then mapping, then DMO. Salesforce's server describes DLOs as ["usually auto-created by data streams"](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/runtime/FamilyCatalog.java), so `datastream_create` is the normal way to get one, and `dlo_create` is for custom cases. Most people use this family to read: `dlo_list` to find names, then `dlo_get` to get the exact field names a mapping needs.

Three things matter most:

- **Paging.** To get every DLO, follow `next_page_url`. A short page isn't the end, and `limit` above 20 doesn't help (community). See [`dlo_list`](#dlo_list).
- **Names.** You create `Foo` and read back `Foo__dll`. A field `Bar` comes back as `Bar__c`, alongside system fields you didn't ask for. See [`dlo_create`](#dlo_create).
- **The spec disagrees with itself on request bodies.** Which key holds the fields, and whether a data space goes in `dataspace_name` or `dataspace_info`, varies by source. The notes on `dlo_create` and `dlo_update` list the conflicts.

```sql
CALL cdp.dlo_list ();
CALL cdp.dlo_get (record_id_or_developer_name => 'Account_Home__dll');
CALL cdp.dlo_update (record_id_or_developer_name => 'Account_Home__dll', label => 'Account Home');
```

**Functions:** [`dlo_delete`](#dlo_delete), [`dlo_list`](#dlo_list), [`dlo_get`](#dlo_get), [`dlo_update`](#dlo_update), [`dlo_create`](#dlo_create)

## dlo_delete

`DELETE /ssot/data-lake-objects/{recordIdOrDeveloperName}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Lake-Objects/paths/~1ssot~1data-lake-objects~1%7BrecordIdOrDeveloperName%7D/delete) · tool `d360_dlo_delete` · evidence O · changes org state

Delete a data lake object (DLO). Since v60.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `record_id_or_developer_name` | `recordIdOrDeveloperName` | path | string | yes | ID or developer name of the DLO. Since v60.0. |

```sql
CALL cdp.dlo_delete (record_id_or_developer_name => 'Loyalty_Member__dll');
```

**Result**

No response body (HTTP 204). One row with only the standard columns.

**Notes:** Salesforce's tool text says this removes the DLO ["and its data"](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/DloTools.java), and to check that no mappings or data streams reference it first. No source says what happens if one does. `datastream_delete` can also remove a stream's DLOs with `should_delete_data_lake_object`, which defaults to `false`. The spec's `status` values include `Deleting`, but no source says whether a 204 means the DLO is already gone.

## dlo_list

`GET /ssot/data-lake-objects` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Lake-Objects/paths/~1ssot~1data-lake-objects/get) · tool `d360_dlo_list` · evidence O · read-only

Get a collection of all data lake objects (DLOs). Since v60.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `limit` | `limit` | query | integer |  | Maximum number of DLOs per page. The default is `20`. The spec's text says "relationships". Values above 20 are reported to be cut to 20 (community). Since v60.0. |
| `offset` | `offset` | query | integer |  | Number of rows to skip before returning results. Must be an integer greater than zero. If unspecified, no rows are skipped. Since v60.0. |
| `order_by` | `orderBy` | query | string |  | Sort order for the result set: `ASC` for ascending or `DESC` for descending. If unspecified, results are returned in ascending order. Since v60.0. |

```sql
CALL cdp.dlo_list ();
```

**Result**

One row per item of `/dataLakeObjects` in the response. Other response fields go to `_meta`: `currentPageUrl`, `nextPageUrl`, `totalSize`. Schema `DataLakeObjectRepresentation`.

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
| `category` | `category` | VARCHAR | Category of the DLO. Since v60.0. |
| `data_lake_field_info_representation` | `dataLakeFieldInfoRepresentation` | JSON (array of DataLakeFieldRepresentation) | Information about the `DataLake` field of the DLO. Since v60.0. |
| `dataspace_info` | `dataSpaceInfo` | JSON (array of DataSpaceRepresentation) | Information about the data space. Since v60.0. |
| `event_date_time_field_name` | `eventDateTimeFieldName` | VARCHAR | Name of the event date and time field. This property is required when the value of the category property is `Engagement`. Since v60.0. |
| `org_unit_identifier_field_name` | `orgUnitIdentifierFieldName` | VARCHAR | Name of the org unity identifier field. Since v60.0. |
| `record_modified_field_name` | `recordModifiedFieldName` | VARCHAR | Name of the record modified field. Since v60.0. |
| `status` | `status` | VARCHAR | Status of the DLO. Since v60.0. |
| `capabilities` | `capabilities` | JSON | Not in the spec schema: from the spec's examples. |
| `fields` | `fields` | JSON | Not in the spec schema: from the spec's examples. |

**Paging:** `next_page_url`. Follow it until it's absent, because a short page doesn't mean the end (community).

**Notes:** A loop that stops on a short page gets at most the first 20 DLOs. [One community tool](https://github.com/szymonlewandowski/config-snapshot-data360/blob/main/docs/api-quirks.md) reports all of this (community):

- `limit` is capped at 20. `current_page_url` showed `limit=20` when 200 was requested.
- DLOs of other data spaces are removed after paging, so a page in the middle can be short, such as 3 of 5.
- `total_size` counts every row, and it and `metadata` with `entity_type => 'DataLakeObject'` include more than the list does, such as system DLOs like `EngagementAggregation__dll`. Don't use `total_size` to detect missing DLOs.
- There's no data space option. Filter on the `dataspace_info` column yourself.
- Not every DLO has a stream. Examples are `<Object>_chunk__dll`, `<Object>_index__dll` and CRM currency rates.

`order_by` is `ASC` or `DESC` in the spec, but [Salesforce's MCP tool](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/DloTools.java) describes it as a field name, and its test sends `order_by=name`. The same tool's text mentions filtering by category, yet neither it nor the spec has such an option.

Values can fall outside the spec's enums. `sf-pi` [records live responses](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/registry/connect-openapi-overrides.json) with other spellings of `category`, `status` and field `data_type` (one org), and the spec's own example has `status` `ACTIVE` where the enum has `Active`.

## dlo_get

`GET /ssot/data-lake-objects/{recordIdOrDeveloperName}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Lake-Objects/paths/~1ssot~1data-lake-objects~1%7BrecordIdOrDeveloperName%7D/get) · tool `d360_dlo_get` · evidence O · read-only

Get a data lake object (DLO). Since v60.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `record_id_or_developer_name` | `recordIdOrDeveloperName` | path | string | yes | ID or developer name of the DLO. Since v60.0. |
| `limit` | `limit` | query | integer |  | Maximum number of relationships to return. If unspecified, the default value is `20`. Since v60.0. |
| `offset` | `offset` | query | integer |  | Number of rows to skip before returning results. Must be an integer greater than zero. If unspecified, no rows are skipped. Since v60.0. |
| `order_by` | `orderBy` | query | string |  | Sort order for the result set: `ASC` for ascending or `DESC` for descending. If unspecified, results are returned in ascending order. Since v60.0. |

```sql
CALL cdp.dlo_get (record_id_or_developer_name => 'Account_Home__dll');
```

**Result**

One row. Schema `DataLakeObjectRepresentation`.

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
| `category` | `category` | VARCHAR | Category of the DLO. Since v60.0. |
| `data_lake_field_info_representation` | `dataLakeFieldInfoRepresentation` | JSON (array of DataLakeFieldRepresentation) | Information about the `DataLake` field of the DLO. Since v60.0. |
| `dataspace_info` | `dataSpaceInfo` | JSON (array of DataSpaceRepresentation) | Information about the data space. Since v60.0. |
| `event_date_time_field_name` | `eventDateTimeFieldName` | VARCHAR | Name of the event date and time field. This property is required when the value of the category property is `Engagement`. Since v60.0. |
| `org_unit_identifier_field_name` | `orgUnitIdentifierFieldName` | VARCHAR | Name of the org unity identifier field. Since v60.0. |
| `record_modified_field_name` | `recordModifiedFieldName` | VARCHAR | Name of the record modified field. Since v60.0. |
| `status` | `status` | VARCHAR | Status of the DLO. Since v60.0. |
| `capabilities` | `capabilities` | JSON | Not in the spec schema: from the spec's examples. |
| `fields` | `fields` | JSON | Not in the spec schema: from the spec's examples. |

**Paging:** The spec lists `limit`, `offset` and `order_by` here, but no source says what they page in a single-object response, and Salesforce's MCP tool doesn't send them.

**Notes:** The developer name includes the suffix, such as `Account_Home__dll`. This is the call to make before `dmo_mapping_create`: Salesforce's [tool text](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/DloTools.java) says it returns the exact field names needed for `source_field_name`. They're in `data_lake_field_info_representation`. Stream mappings name the same fields without `__c`, such as `MailingStreet` for `MailingStreet__c` ([community](https://github.com/szymonlewandowski/config-snapshot-data360/blob/main/docs/api-quirks.md)).

The spec declares a single object. `sf-pi` [records a live response](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/registry/connect-openapi-overrides.json) wrapped in a `dataLakeObjects` array (one org), so the one-row result may not hold.

## dlo_update

`PATCH /ssot/data-lake-objects/{recordIdOrDeveloperName}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Lake-Objects/paths/~1ssot~1data-lake-objects~1%7BrecordIdOrDeveloperName%7D/patch) · tool `d360_dlo_update` · evidence O · changes org state

Update a data lake object (DLO) by adding new fields or changing the label. Since v60.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `record_id_or_developer_name` | `recordIdOrDeveloperName` | path | string | yes | ID or developer name of the DLO. Since v60.0. |
| `fields` | `fields` | body | array of [DataLakeFieldInput](#datalakefieldinputrepresentation) |  | Fields of the DLO. Since v60.0. |
| `label` | `label` | body | string | yes | Label of the DLO. Since v60.0. |
| `data_lake_field_input_representations` | `dataLakeFieldInputRepresentations` | body | array of [dlo_update_dataLakeFieldInputRepresentations](#dlo_update_datalakefieldinputrepresentations) |  | Not in the spec schema: from the spec's examples. |

```sql
CALL cdp.dlo_update (record_id_or_developer_name => 'Loyalty_Member__dll', label => 'Loyalty Member', fields => [(name = 'Tier', label = 'Tier', data_type = 'Text', is_primary_key = false)]);
```

**Result**

One row. Schema `DataLakeObjectRepresentation`.

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
| `category` | `category` | VARCHAR | Category of the DLO. Since v60.0. |
| `data_lake_field_info_representation` | `dataLakeFieldInfoRepresentation` | JSON (array of DataLakeFieldRepresentation) | Information about the `DataLake` field of the DLO. Since v60.0. |
| `dataspace_info` | `dataSpaceInfo` | JSON (array of DataSpaceRepresentation) | Information about the data space. Since v60.0. |
| `event_date_time_field_name` | `eventDateTimeFieldName` | VARCHAR | Name of the event date and time field. This property is required when the value of the category property is `Engagement`. Since v60.0. |
| `org_unit_identifier_field_name` | `orgUnitIdentifierFieldName` | VARCHAR | Name of the org unity identifier field. Since v60.0. |
| `record_modified_field_name` | `recordModifiedFieldName` | VARCHAR | Name of the record modified field. Since v60.0. |
| `status` | `status` | VARCHAR | Status of the DLO. Since v60.0. |
| `capabilities` | `capabilities` | JSON | Not in the spec schema: from the spec's examples. |
| `fields` | `fields` | JSON | Not in the spec schema: from the spec's examples. |

**Notes:** **The field key is in conflict.** The spec's schema calls it `fields`, which is why that's the option here. The spec's [own example](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Lake-Objects/paths/~1ssot~1data-lake-objects~1%7BrecordIdOrDeveloperName%7D/patch) and Salesforce's [`DloPatchRequest`](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/model/request/dlo/DloPatchRequest.java) both send `data_lake_field_input_representations` instead.

The spec requires `label`, so send the current label when you only add fields. Salesforce's MCP request makes it optional, and its test sends fields alone.

The spec says this adds fields or changes the label. Salesforce's [tool text](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/DloTools.java) also claims it can change fields and adjust field types. Nothing else confirms that. Name new fields as on [`dlo_create`](#dlo_create), without `__c`.

## dlo_create

`POST /ssot/data-lake-objects` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Lake-Objects/paths/~1ssot~1data-lake-objects/post) · tool `d360_dlo_create` · evidence O · changes org state

Create a data lake object (DLO). Since v60.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `dataspace_name` | `dataSpaceName` | body | string |  | Name of the data space. If unspecified, the `default` data space is used. This property is required for data graph resources. Since v59.0. |
| `description` | `description` | body | string |  | Description of the object to create. Since v59.0. |
| `label` | `label` | body | string | yes | Label of the object to create. This property is required for data graph resources. Since v59.0. |
| `name` | `name` | body | string | yes | API name of the object to create. This property is required for data graph resources. Since v59.0. |
| `category` | `category` | body | enum(Directory_Table, Engagement, Insights, Other, Profile) | yes | Category of the data object. Since v60.0. |
| `event_date_time_field_name` | `eventDateTimeFieldName` | body | string |  | Name of the event date and time field. This property is required when the value of the category property is `Engagement`. Since v60.0. |
| `fields` | `fields` | body | array of [DataObjectFieldInput](#dataobjectfieldinputrepresentation) |  | Fields in the data object. Since v60.0. |
| `record_modified_field_name` | `recordModifiedFieldName` | body | string |  | Record modified field name. Since v60.0. |
| `type` | `type` | body | enum(DataLakeObject, DataModelObject) |  | Type of data object. Since v60.0. |
| `data_lake_field_input_representations` | `dataLakeFieldInputRepresentations` | body | array of [DataLakeFieldInput](#datalakefieldinputrepresentation) |  | Information about DLO fields. For Ingestion API data streams, include only the primary key field. Since v60.0. |
| `data_model_object_config` | `dataModelObjectConfig` | body | [DataModelObjectConfigInput](#datamodelobjectconfiginputrepresentation) |  | - |
| `data_source` | `dataSource` | body | [DataLakeSourceInput](#datalakesourceinputrepresentation) |  | Where an unstructured DLO reads files, for `category => 'Directory_Table'` ([community](https://github.com/Jaganpro/sf-skills/blob/main/skills/sf-datacloud-prepare/SKILL.md)). |
| `dataspace_info` | `dataspaceInfo` | body | array of [DataSpaceInput](#dataspaceinputrepresentation) | yes | Information about the data space. Since v60.0. |
| `org_unit_identifier_field_name` | `orgUnitIdentifierFieldName` | body | string |  | Name of the org unit identifier field. Since v60.0. |
| `status` | `status` | body | string |  | Not in the spec schema: from the MCP server's request class. |

```sql
CALL cdp.dlo_create (name => 'Loyalty_Member', label => 'Loyalty Member', category => 'Profile', dataspace_info => [(name = 'default')], data_lake_field_input_representations => [(name = 'Member_Id', label = 'Member Id', data_type = 'Text', is_primary_key = true), (name = 'Joined_On', label = 'Joined On', data_type = 'DateTime', is_primary_key = false)]);
```

**Result**

One row. Schema `DataLakeObjectRepresentation`.

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
| `category` | `category` | VARCHAR | Category of the DLO. Since v60.0. |
| `data_lake_field_info_representation` | `dataLakeFieldInfoRepresentation` | JSON (array of DataLakeFieldRepresentation) | Information about the `DataLake` field of the DLO. Since v60.0. |
| `dataspace_info` | `dataSpaceInfo` | JSON (array of DataSpaceRepresentation) | Information about the data space. Since v60.0. |
| `event_date_time_field_name` | `eventDateTimeFieldName` | VARCHAR | Name of the event date and time field. This property is required when the value of the category property is `Engagement`. Since v60.0. |
| `org_unit_identifier_field_name` | `orgUnitIdentifierFieldName` | VARCHAR | Name of the org unity identifier field. Since v60.0. |
| `record_modified_field_name` | `recordModifiedFieldName` | VARCHAR | Name of the record modified field. Since v60.0. |
| `status` | `status` | VARCHAR | Status of the DLO. Since v60.0. |
| `capabilities` | `capabilities` | JSON | Not in the spec schema: from the spec's examples. |
| `fields` | `fields` | JSON | Not in the spec schema: from the spec's examples. |

**Done when:** `dlo_get.status` is `ACTIVE`. The spec's example returns `PROCESSING` right after the POST. Its enum spells these `Active` and `Processing`, and no source describes the transition.

**Notes:** Check first whether you need this. Streams usually create the DLO, and `datastream_create` takes `data_lake_object_info` or `existing_data_lake_object_info`.

**Object name.** The spec's example sends `DataLakeObjectTwo` and gets `DataLakeObjectTwo__dll` back. [A community tool](https://github.com/javrrr/afd360/blob/main/skills/afd360/SKILL.md) says the same: don't add the suffix (community). Salesforce's MCP test and its S3 stream payload example do send `__dll`, so sources disagree on whether that's accepted. `record_id_or_developer_name` on other calls takes the suffixed name.

**Field names.** The spec's example sends `FieldOne` and gets `FieldOne__c`. The response also holds fields nobody sent: `KQ_FieldOne__c`, `cdp_sys_SourceVersion__c`, `DataSource__c`, `DataSourceObject__c` and `InternalOrganization__c`. A filter's `field_name` and `table_name` use the suffixed forms.

Character rules vary by source:

- The [Ingestion API schema rules](https://developer.salesforce.com/docs/data/data-cloud-int/guide/c360-a-ingestion-api-schema-req.md) allow `a-z`, `A-Z`, `0-9`, `_` and `-`, at most 39 characters for a field and 79 for an object. A field name can't contain `__` or be a reserved word such as `version` or `row_count`. These cover schema files, and no source applies them to this call.
- Official docs, seen only through a search excerpt, want names that start with a letter, with no trailing or consecutive underscores, and 40 characters or fewer for data kits ([API notes](api_notes.md#naming)).
- A CRM custom field `Foo__c` becomes `Foo_c__c` in the DLO ([API notes](api_notes.md#naming), [community](https://github.com/Jaganpro/sf-skills/blob/main/skills/sf-datacloud-prepare/SKILL.md)).

**Which field list.** The spec has both `data_lake_field_input_representations` (attribute `data_type`) and `fields` (attribute `type`, and `DateOnly` instead of `Currency`). The spec's example uses the first. Salesforce's [`DloCreateRequest`](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/model/request/dlo/DloCreateRequest.java) uses `fields`, but [serializes `type` as `data_type`](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/model/request/dlo/DataObjectFieldInput.java) and names the qualifier `key_qualifier_field`, not `key_qualifier_field_name`. For Ingestion API streams, send only the primary key field.

**Data space.** The spec lists `dataspace_name`, but `DloCreateRequest` leaves it out because the endpoint rejects it with `Unrecognized field 'dataSpaceName'`. The spec requires `dataspace_info`, but the same class omits it and says the endpoint falls back to `default`.

**Filter shape.** Under `dataspace_info`, the spec's schema has `conditions` as an array and `operator` as `Equals`. The spec's example has `conditions` as a single object and `operator` as `EqualsOperator`. The example below avoids filters. The spec's example also quotes `is_primary_key` as a string, while the schema says boolean.

**Category.** `Engagement` needs `event_date_time_field_name`. Salesforce's MCP request offers only `Engagement`, `Other` and `Profile`. `Directory_Table` is for unstructured files with `data_source`. A [community guide](https://github.com/Jaganpro/sf-skills/blob/main/skills/sf-datacloud-prepare/SKILL.md) has a payload for it, and warns that the first setup in the UI can create more than this call does (community). It spells `source_type` as `SF_DRIVE` where the spec has `SfDrive`.

The POST isn't documented as idempotent, so check with `dlo_get` before retrying.

## Schemas

Attribute names are keywords inside the object they belong to, so completion offers exactly these.

### DataLakeFieldInputRepresentation

Represents the input for a data lake object (DLO) field.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `data_type` | `dataType` | enum(Boolean, Currency, Date, DateTime, Email, Number, Percent, Phone, Text, Unsupported, Url) | yes | Data type of the field. Since v62.0. |
| `is_primary_key` | `isPrimaryKey` | boolean | yes | Indicates whether the field is a primary key field (`true`) or not (`false`). Since v62.0. |
| `label` | `label` | string | yes | Label of the field. Since v60.0. |
| `name` | `name` | string | yes | API name of the field. Since v60.0. |

### DataLakeSourceInputRepresentation

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `directory_and_files_details` | `directoryAndFilesDetails` | array of [DirectoryAndFilesDetailsInput](#directoryandfilesdetailsinputrepresentation) |  | Directories and files to read ([community](https://github.com/Jaganpro/sf-skills/blob/main/skills/sf-datacloud-prepare/SKILL.md)). |
| `source_config` | `sourceConfig` | map to string |  | Seen with `reservedPrefix = '$dcf_content$'` in a SharePoint payload ([community](https://github.com/Jaganpro/sf-skills/blob/main/skills/sf-datacloud-prepare/SKILL.md)). |
| `source_id` | `sourceId` | string |  | - |
| `source_type` | `sourceType` | enum(SfDrive) |  | `SfDrive` in the spec, `SF_DRIVE` in a [community payload](https://github.com/Jaganpro/sf-skills/blob/main/skills/sf-datacloud-prepare/SKILL.md). |

### DataModelObjectConfigInputRepresentation

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `label` | `label` | string |  | - |
| `name` | `name` | string |  | - |

### DataObjectFieldInputRepresentation

Represents the input fields in the data object.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `is_primary_key` | `isPrimaryKey` | boolean | yes | Indicates whether this field is a primary key (`true`) or not (`false`). Since v60.0. |
| `key_qualifier_field_name` | `keyQualifierFieldName` | string |  | Key qualifier field name. Since v60.0. |
| `label` | `label` | string | yes | Label of the field. Since v60.0. |
| `name` | `name` | string | yes | Name of the field. Since v60.0. |
| `type` | `type` | enum(Boolean, Date, DateOnly, DateTime, Email, Number, Percent, Phone, Text, Url) |  | Data type of the field. Since v60.0. |
| `description` | `description` | string |  | Not in the spec schema: from the spec's examples. |
| `is_dynamic_lookup` | `isDynamicLookup` | boolean |  | Not in the spec schema: from the spec's examples. |
| `data_type` | `dataType` | string |  | Not in the spec schema: from the spec's examples. |
| `key_qualifier_field` | `keyQualifierField` | string |  | Not in the spec schema: from the spec's examples. |

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

### DataSpaceInputRepresentation

Represents the input for a data space.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `id` | `id` | string |  | ID of the asset. Since v58.0. |
| `name` | `name` | string |  | Name of the asset. Since v58.0. |
| `namespace` | `namespace` | string |  | Namespace of the asset. Since v58.0. |
| `filter` | `filter` | [DataSpaceFilterInput](#dataspacefilterinputrepresentation) |  | Filter for the data space. Since v60.0. |

### DirectoryAndFilesDetailsInputRepresentation

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `dir_name` | `dirName` | string |  | Seen as `SPUnstructuredDocument/<CONNECTION_ID>/<SITE_ID>` for SharePoint ([community](https://github.com/Jaganpro/sf-skills/blob/main/skills/sf-datacloud-prepare/SKILL.md)). |
| `file_name` | `fileName` | string |  | Seen as `*` ([community](https://github.com/Jaganpro/sf-skills/blob/main/skills/sf-datacloud-prepare/SKILL.md)). |

### dlo_update_dataLakeFieldInputRepresentations

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `name` | `name` | string |  | Seen in examples: the spec types the parent as a free-form object. |
| `label` | `label` | string |  | Seen in examples: the spec types the parent as a free-form object. |
| `data_type` | `dataType` | string |  | Seen in examples: the spec types the parent as a free-form object. |
| `is_primary_key` | `isPrimaryKey` | string |  | Seen in examples: the spec types the parent as a free-form object. |
