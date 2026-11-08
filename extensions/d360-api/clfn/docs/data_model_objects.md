<!-- Generated from extensions/d360-api/clfn/spec/data_model_objects.yaml, edit that and run: bazel run //extensions/d360-api:update -->

# Data Model Objects

Part of the [CDP function reference](functions.md). Nothing here is implemented or tested against an org. Every result also has the [standard columns](functions.md#result-schema).

A data lake object (DLO, `__dll`) holds ingested rows as they arrived. A data model object (DMO, `__dlm`) is the shared schema that identity resolution, insights and segments read. This family defines DMOs, maps DLO fields onto them, and declares relationships between DMOs.

The order is: a stream creates the DLO, you pick or create a DMO, you map one onto the other, then you add relationships. Read the exact field names with `dlo_get` and `dmo_get` first. The [DMO guide](https://developer.salesforce.com/docs/data/connectapi/guide/dmo-use-case.md) walks through the mapping calls.

The traps:

- Pass a custom DMO name without `__dlm` on create. Every later call uses the full name. Sources disagree, see [`dmo_create`](#dmo_create).
- Each `dmo_mapping_create` covers one DLO and one DMO, and must include the DLO's primary key.
- For Engagement data, the event date field must be mapped to a field of exactly the same type.
- Mapping create returns `CREATING`, so poll `dmo_mapping_get`.
- Relationships need mappings on both DMOs (community).
- Empty results vary: a DMO with no relationships returns 204, and one with no mappings returns 404 (community).

```sql
CALL cdp.dmo_get (data_model_object_name => 'ssot__Individual__dlm');
CALL cdp.dmo_mapping_create (
  dataspace => 'default',
  label => 'S3_Subscribers_Individual',
  source_entity_developer_name => 'S3_Subscribers__dll',
  target_entity_developer_name => 'ssot__Individual__dlm',
  field_mapping => [
    (source_field_developer_name = 'Subscriber_ID__c', target_field_developer_name = 'ssot__SourceSystemId__c'),
    (source_field_developer_name = 'LastName__c', target_field_developer_name = 'ssot__LastName__c')
  ]
);
/* Repeat until status is ACTIVE */
CALL cdp.dmo_mapping_get (object_source_target_map_developer_name => 'S3_Subscribers_Individual');
```

**Functions:** [`dmo_mapping_delete`](#dmo_mapping_delete), [`dmo_field_mappings_delete`](#dmo_field_mappings_delete), [`dmo_delete`](#dmo_delete), [`dmo_relationship_delete`](#dmo_relationship_delete), [`dmo_mapping_list`](#dmo_mapping_list), [`dmo_mapping_get`](#dmo_mapping_get), [`dmo_list`](#dmo_list), [`dmo_get`](#dmo_get), [`dmo_relationship_list`](#dmo_relationship_list), [`dmo_field_mapping_update`](#dmo_field_mapping_update), [`dmo_update`](#dmo_update), [`dmo_mapping_create`](#dmo_mapping_create), [`dmo_create`](#dmo_create), [`dmo_relationship_create`](#dmo_relationship_create), [`dmo_field_mapping_add`](#dmo_field_mapping_add), [`dmo_field_mapping_delete`](#dmo_field_mapping_delete)

## dmo_mapping_delete

`DELETE /ssot/data-model-object-mappings/{objectSourceTargetMapDeveloperName}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Model-Objects/paths/~1ssot~1data-model-object-mappings~1%7BobjectSourceTargetMapDeveloperName%7D/delete) · tool `d360_dmo_mapping_delete` · evidence O · changes org state

Delete a mapping between a data lake object (DLO) source and a data model object (DMO) target. Since v61.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `object_source_target_map_developer_name` | `objectSourceTargetMapDeveloperName` | path | string | yes | Developer name of the object mapping. Retrieve it from `dmo_mapping_list`, or from the `developer_name` that `dmo_mapping_create` returns. |
| `dataspace` | `dataspace` | query | string |  | Name of the data space. If unspecified, the `default` data space is used. |

```sql
CALL cdp.dmo_mapping_delete (object_source_target_map_developer_name => 'S3_Subscribers_Individual');
```

**Result**

No response body (HTTP 200). One row with only the standard columns.

**Notes:** The [tool source](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/MappingTools.java) says the stream and the DMO stay, but data stops flowing into the DMO from that source. Sources disagree on whether this call works: the spec and the MCP server offer it, and a [community plugin](https://github.com/dsouza-anush/sf-plugin-data360/blob/main/test/fixtures/live/mapping-delete.json) ran a mapping delete live (community, one org), while [afd360](https://github.com/javrrr/afd360/blob/main/src/resources/mapping.ts) says a mapping can't be deleted directly and relies on deleting the DMO (community, one org).

## dmo_field_mappings_delete

`DELETE /ssot/data-model-object-mappings/{objectSourceTargetMapDeveloperName}/field-mappings` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Model-Objects/paths/~1ssot~1data-model-object-mappings~1%7BobjectSourceTargetMapDeveloperName%7D~1field-mappings/delete) · evidence O · changes org state

Delete a field mapping between a data lake object (DLO) source and a data model object (DMO) target. Since v61.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `object_source_target_map_developer_name` | `objectSourceTargetMapDeveloperName` | path | string | yes | Developer name of the object source target mapping between a DLO and a DMO. Retrieve this value from the [get data model object mappings](https://developer.salesforce.com/docs/data/connectapi/references/spec?meta=getDataModelObjectMappingCollection) endpoint. Since v61.0. |
| `dataspace` | `dataspace` | query | string |  | Name of the data space. If unspecified, the `default` data space is used. Since v61.0. |

```sql
CALL cdp.dmo_field_mappings_delete (object_source_target_map_developer_name => 'S3_Subscribers_Individual');
```

**Result**

No response body (HTTP 200). One row with only the standard columns.

**Notes:** The spec's path names no field mapping and defines no body, so nothing says which field this removes, or whether it removes all of them. The [DMO guide](https://developer.salesforce.com/docs/data/connectapi/guide/dmo-use-case.md) doesn't show the request. Prefer [`dmo_field_mapping_delete`](#dmo_field_mapping_delete), whose path names the field.

## dmo_delete

`DELETE /ssot/data-model-objects/{dataModelObjectName}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Model-Objects/paths/~1ssot~1data-model-objects~1%7BdataModelObjectName%7D/delete) · tool `d360_dmo_delete` · evidence O · changes org state

Delete a standard or custom data model object (DMO). Since v61.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `data_model_object_name` | `dataModelObjectName` | path | string | yes | Developer name of the DMO, with the `__dlm` suffix. |

```sql
CALL cdp.dmo_delete (data_model_object_name => 'CustomDMO__dlm');
```

**Result**

No response body (HTTP 204). One row with only the standard columns.

**Notes:** The [catalog](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/runtime/FamilyCatalog.java) says this "Cascades to dependent objects". The [tool source](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/DmoTools.java) says to make sure no streams, mappings, insights or segments reference the DMO first. [afd360](https://github.com/javrrr/afd360/blob/main/src/resources/dmo.ts) reports both behaviors (community, one org): mappings cascade, while other references return 412 "referenced in other features". It retries for about a minute, because a reference can linger after its dependent is deleted. It also reports that deleting a DMO that is already gone returns 500 `INTERNAL_ERROR`, not the spec's 404.

## dmo_relationship_delete

`DELETE /ssot/data-model-objects/relationships/{name}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Model-Objects/paths/~1ssot~1data-model-objects~1relationships~1%7Bname%7D/delete) · evidence O · changes org state

Delete a data model object (DMO) relationship between a field in the source DMO and a field in the target DMO. Since v64.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `name` | `name` | path | string | yes | ID or developer name of the field source target relationship. Since v64.0. |
| `dataspace` | `dataspace` | query | string |  | Name of the data space. If unspecified, the `default` data space is used. Since v64.0. |

```sql
CALL cdp.dmo_relationship_delete (name => 'ds1_Individual_Id_map_ds1_DataSpace1Dmo_Id_1726382174104');
```

**Result**

No response body (HTTP 200). One row with only the standard columns.

## dmo_mapping_list

`GET /ssot/data-model-object-mappings` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Model-Objects/paths/~1ssot~1data-model-object-mappings/get) · tool `d360_dmo_mapping_list` · evidence O · read-only

Get the details of all mappings associated with a data model object (DMO). Since v61.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `dataspace` | `dataspace` | query | string |  | Name of the data space. If unspecified, the `default` data space is used. Since v61.0. |
| `dlo_developer_name` | `dloDeveloperName` | query | string |  | Developer name of the data lake object (DLO) source object. Since v61.0. |
| `dmo_developer_name` | `dmoDeveloperName` | query | string | yes | Developer name of the DMO target object. Since v61.0. |

```sql
CALL cdp.dmo_mapping_list (dmo_developer_name => 'ssot__Individual__dlm');
```

**Result**

One row per item of `/objectSourceTargetMaps` in the response. Other response fields go to `_meta`: `currentPageUrl`, `nextPageUrl`, `totalSize`. Schema `CdpObjectSourceTargetMapRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `developer_name` | `developerName` | VARCHAR | Developer name of the object source target map. Since v61.0. |
| `field_mappings` | `fieldMappings` | JSON (array of CdpFieldSourceTargetMapRepresentation) | List of field mappings from the object source target map. Since v61.0. |
| `source_entity_developer_name` | `sourceEntityDeveloperName` | VARCHAR | Source DLO entity developer name of the object source target map. Since v61.0. |
| `status` | `status` | VARCHAR | Status of the object source target map. Since v61.0. |
| `target_entity_developer_name` | `targetEntityDeveloperName` | VARCHAR | Target DMO entity developer name of the object source target map. Since v61.0. |

**Paging:** `next_page_url`.

**Notes:** A 404 here can mean "no mappings", not a failure. The spec lists `Object source target map not found for the given target object developer name` under 404, and two community sources treat it as an empty list ([API quirks](https://github.com/szymonlewandowski/config-snapshot-data360/blob/main/docs/api-quirks.md), one org, and [data-360-sdk](https://github.com/javrrr/data-360-sdk/blob/main/src/resources/data-model-objects.ts), which matches the message prefix `Object Source Target Map not found`). A 404 saying the DLO wasn't found is a real error, so check the message. Identity resolution DMOs (`Unified*`, `*IdentityLink__dlm`) have no mappings (community).

There's no call for all mappings, so loop over DMOs (community). The spec requires `dmo_developer_name`, yet its 400 text reads "DMO or source object (CRM) developer name is missing", and the [tool text](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/MappingTools.java) also sends `source_object_name` (for example `Account`) as an alternative. The spec doesn't list that parameter.

## dmo_mapping_get

`GET /ssot/data-model-object-mappings/{objectSourceTargetMapDeveloperName}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Model-Objects/paths/~1ssot~1data-model-object-mappings~1%7BobjectSourceTargetMapDeveloperName%7D/get) · tool `d360_dmo_mapping_get` · evidence O · read-only

Get one DLO-to-DMO mapping by developer name, with its field mappings and status. Use it to check that a new or changed mapping became active.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `object_source_target_map_developer_name` | `objectSourceTargetMapDeveloperName` | path | string | yes | Developer name of the object mapping. Retrieve it from `dmo_mapping_list`, or from the `developer_name` that `dmo_mapping_create` returns. |
| `dataspace` | `dataspace` | query | string |  | Name of the data space. If unspecified, the `default` data space is used. |

```sql
CALL cdp.dmo_mapping_get (object_source_target_map_developer_name => 'S3_Subscribers_Individual');
```

**Result**

One row. Schema `CdpObjectSourceTargetMapRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `developer_name` | `developerName` | VARCHAR | Developer name of the object source target map. Since v61.0. |
| `field_mappings` | `fieldMappings` | JSON (array of CdpFieldSourceTargetMapRepresentation) | List of field mappings from the object source target map. Since v61.0. |
| `source_entity_developer_name` | `sourceEntityDeveloperName` | VARCHAR | Source DLO entity developer name of the object source target map. Since v61.0. |
| `status` | `status` | VARCHAR | Status of the object source target map. Since v61.0. |
| `target_entity_developer_name` | `targetEntityDeveloperName` | VARCHAR | Target DMO entity developer name of the object source target map. Since v61.0. |

**Notes:** The spec's `status` enum is Title Case (`Active`, `Creating`), while the [DMO guide](https://developer.salesforce.com/docs/data/connectapi/guide/dmo-use-case.md) and spec examples show `ACTIVE` and `CREATING`. [sf-pi overrides](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/registry/connect-openapi-overrides.json) also record live spellings outside the enum. Compare without regard to case. `field_mappings` also holds system fields the server added.

## dmo_list

`GET /ssot/data-model-objects` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Model-Objects/paths/~1ssot~1data-model-objects/get) · tool `d360_dmo_list` · evidence O · read-only

Get a paginated list of all data model objects (DMOs). Since v61.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `limit` | `limit` | query | integer |  | Maximum number of DMOs to return. If unspecified, the default value is `50`. Since v61.0. |
| `offset` | `offset` | query | integer |  | Number of rows to skip before returning results. Must be an integer greater than zero. If unspecified, no rows are skipped. Since v61.0. |
| `order_by` | `orderBy` | query | string |  | Sort order for the result set: `ASC` for ascending or `DESC` for descending. If unspecified, results are returned in ascending order. Since v61.0. |

```sql
CALL cdp.dmo_list ();
```

**Result**

One row per item of `/dataModelObject` in the response. Other response fields go to `_meta`: `currentPageUrl`, `nextPageUrl`, `totalSize`. Schema `DataModelObjectRepresentation`.

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
| `category` | `category` | VARCHAR | Category. Since v60.0. |
| `event_date_time_field_name` | `eventDateTimeFieldName` | VARCHAR | Name of the event date and time field. This property is required when the value of the category property is `Engagement`. Since v60.0. |
| `fields` | `fields` | JSON (array of DataObjectFieldRepresentation) | List of fields. Since v60.0. |
| `record_modified_field_name` | `recordModifiedFieldName` | VARCHAR | Record modified field. Since v60.0. |
| `type` | `type` | VARCHAR | Type of data object. Since v60.0. |
| `status` | `status` | VARCHAR | Status of the DMO. Since v60.0. |
| `creation_type` | `creationType` | VARCHAR | Not in the spec schema: from the spec's examples. |
| `dataspace_name` | `dataSpaceName` | VARCHAR | Not in the spec schema: from the spec's examples. |
| `has_external_data_lake_object_mappings` | `hasExternalDataLakeObjectMappings` | BOOLEAN | Not in the spec schema: from the spec's examples. |
| `is_editable` | `isEditable` | BOOLEAN | Not in the spec schema: from the spec's examples. |
| `is_enabled` | `isEnabled` | BOOLEAN | Not in the spec schema: from the spec's examples. |
| `is_segmentable` | `isSegmentable` | BOOLEAN | Not in the spec schema: from the spec's examples. |

**Paging:** `next_page_url`.

**Notes:** This returns the whole catalog, including DMOs the org doesn't use: over 1,000, at 20 to 40 s per page of 200 ([API quirks](https://github.com/szymonlewandowski/config-snapshot-data360/blob/main/docs/api-quirks.md), community, one org). For the ones in use, [`metadata`](profiles_and_metadata.md#metadata) with `entity_type = 'DataModelObject'` is one fast call, but it lists each active relationship twice (same source). The spec's 400 text caps `offset` at 2000.

The [tool text](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/DmoTools.java) sends filters the spec omits: `dataObjectCategory`, `dataspace_name`, `creation_type`, `dataModelObjectStatus`, `includeFields`, `includeStatus`, `is_enabled`, `mktDataConnectionId`, `search`. It also limits `limit` to 1 to 50, which the 200-per-page report above contradicts.

`category` comes back in upper case (`PROFILE`, `UNASSIGNED`), and [sf-pi overrides](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/registry/connect-openapi-overrides.json) record live values outside the spec's enum. The MCP server names `DirectoryTable` for unstructured file DMOs, and the community names `Segment_Membership`, `Activation_Audience` and `Vector_Embedding`. The tool text says `is_enabled = false` doesn't mean disabled: the DMO can still be mapped.

## dmo_get

`GET /ssot/data-model-objects/{dataModelObjectName}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Model-Objects/paths/~1ssot~1data-model-objects~1%7BdataModelObjectName%7D/get) · tool `d360_dmo_get` · evidence O · read-only

Get a data model object (DMO). Since v61.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `data_model_object_name` | `dataModelObjectName` | path | string | yes | Developer name of the DMO, with the `__dlm` suffix. |

```sql
CALL cdp.dmo_get (data_model_object_name => 'ssot__Individual__dlm');
```

**Result**

One row. Schema `DataModelObjectRepresentation`.

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
| `category` | `category` | VARCHAR | Category. Since v60.0. |
| `event_date_time_field_name` | `eventDateTimeFieldName` | VARCHAR | Name of the event date and time field. This property is required when the value of the category property is `Engagement`. Since v60.0. |
| `fields` | `fields` | JSON (array of DataObjectFieldRepresentation) | List of fields. Since v60.0. |
| `record_modified_field_name` | `recordModifiedFieldName` | VARCHAR | Record modified field. Since v60.0. |
| `type` | `type` | VARCHAR | Type of data object. Since v60.0. |
| `status` | `status` | VARCHAR | Status of the DMO. Since v60.0. |
| `creation_type` | `creationType` | VARCHAR | Not in the spec schema: from the spec's examples. |
| `dataspace_name` | `dataSpaceName` | VARCHAR | Not in the spec schema: from the spec's examples. |
| `has_external_data_lake_object_mappings` | `hasExternalDataLakeObjectMappings` | BOOLEAN | Not in the spec schema: from the spec's examples. |
| `is_editable` | `isEditable` | BOOLEAN | Not in the spec schema: from the spec's examples. |
| `is_enabled` | `isEnabled` | BOOLEAN | Not in the spec schema: from the spec's examples. |
| `is_segmentable` | `isSegmentable` | BOOLEAN | Not in the spec schema: from the spec's examples. |

**Notes:** A 404 can also mean you lack access to the DMO (spec). The spec's examples and [live fixtures](https://github.com/dsouza-anush/sf-plugin-data360/blob/main/test/fixtures/live/dmo-create.json) (community) show fields the schema omits, so they land in `_raw`: `dataSpaceName`, `creationType`, `isEnabled`, `isEditable`, `isSegmentable` and `hasExternalDataLakeObjectMappings`. The [tool text](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/DmoTools.java) also sends `includeActiveFieldsOnly` and `includeStatus`, which the spec doesn't list.

## dmo_relationship_list

`GET /ssot/data-model-objects/{dataModelObjectName}/relationships` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Model-Objects/paths/~1ssot~1data-model-objects~1%7BdataModelObjectName%7D~1relationships/get) · evidence O · read-only

Get the details of all data model object (DMO) relationships between fields in the source DMO and fields in the target DMO. Since v64.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `data_model_object_name` | `dataModelObjectName` | path | string | yes | Developer name of the DMO, with the `__dlm` suffix. |
| `creation_type` | `creationType` | query | enum(CalculatedInsight, Curated, Custom, SegmentMembership, Standard, System) |  | Filter the returned results based on relationship creation type. Since v64.0. |
| `dataspace` | `dataspace` | query | string |  | Name of the data space. If unspecified, the `default` data space is used. Since v64.0. |
| `limit` | `limit` | query | integer |  | Maximum number of relationships to return. If unspecified, the default value is `20`. Since v64.0. |
| `offset` | `offset` | query | integer |  | Number of rows to skip before returning results. Must be an integer greater than zero. If unspecified, no rows are skipped. Since v64.0. |
| `order_by` | `orderBy` | query | enum(FilterSortOrderAsc, FilterSortOrderDesc) |  | Sort order for the result set: `ASC` for ascending or `DESC` for descending. If unspecified, results are returned in ascending order. Since v64.0. |
| `sort_by` | `sortBy` | query | string |  | The field on which the results are to be sorted. Since v64.0. |
| `status` | `status` | query | enum(Active, Creating, DeactivateByUser, Deleting, Error, Inactive, Updating) |  | Filter the returned results based on relationship status. Since v64.0. |

```sql
CALL cdp.dmo_relationship_list (data_model_object_name => 'ssot__Individual__dlm', status => 'Active');
```

**Result**

One row per item of `/relationships` in the response. Other response fields go to `_meta`: `currentPageUrl`, `nextPageUrl`, `totalSize`. Schema `FieldSrcTrgtRelationshipRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `cardinality` | `cardinality` | VARCHAR | Cardinality between the fields involved in the relationship. Since v64.0. |
| `creation_type` | `creationType` | VARCHAR | Creation type of the relationship. Since v64.0. |
| `id` | `id` | VARCHAR | ID of the relationship. Since v64.0. |
| `name` | `name` | VARCHAR | Developer name of the relationship. Since v64.0. |
| `owner` | `owner` | VARCHAR | Owner of the relationship. Since v64.0. |
| `source_field` | `sourceField` | JSON (RelationshipFieldRepresentation) | Details about the source field involved in the relationship. Since v64.0. |
| `source_object` | `sourceObject` | JSON (RelationshipObjectRepresentation) | Details about the source object involved in the relationship. Since v64.0. |
| `status` | `status` | VARCHAR | Status of the relationship. Since v64.0. |
| `target_field` | `targetField` | JSON (RelationshipFieldRepresentation) | Details about the target field involved in the relationship. Since v64.0. |
| `target_object` | `targetObject` | JSON (RelationshipObjectRepresentation) | Details about the target object involved in the relationship. Since v64.0. |
| `source_entity` | `sourceEntity` | JSON | Not in the spec schema: from the spec's examples. |
| `target_entity` | `targetEntity` | JSON | Not in the spec schema: from the spec's examples. |

**Paging:** `next_page_url`.

**Notes:** A DMO with no relationships returns 204 with no body, so expect zero rows rather than a JSON result ([API quirks](https://github.com/szymonlewandowski/config-snapshot-data360/blob/main/docs/api-quirks.md), community, one org). The spec documents only 200.

Page through results: the default `limit` is 20, and the same source saw 326 relationships on `ssot__Account__dlm`. This call also returns inactive relationships, while [`metadata`](profiles_and_metadata.md#metadata) returns only active ones, each listed twice (same source).

The spec's enums and examples disagree. `status` is `Active` in the enum, but the example and [live fixtures](https://github.com/dsouza-anush/sf-plugin-data360/blob/main/test/fixtures/live/dmo-relationship-list.json) (community) show `ACTIVE` and `INACTIVE`. `creation_type` is `CalculatedInsight` in the enum and `Calculated_Insight` in the example. `order_by` is `FilterSortOrderAsc` in the enum, while its description and the example use `ASC`. The example shows `source_entity` and `target_entity`, where the schema and the live fixtures have `source_object` and `target_object`.

## dmo_field_mapping_update

`PATCH /ssot/data-model-object-mappings/{objectSourceTargetMapDeveloperName}/field-mappings/{fieldSourceTargetMapDeveloperName}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Model-Objects/paths/~1ssot~1data-model-object-mappings~1%7BobjectSourceTargetMapDeveloperName%7D~1field-mappings~1%7BfieldSourceTargetMapDeveloperName%7D/patch) · evidence O · changes org state

Add or update field mappings on an existing mapping, with one field mapping named in the path. To add fields without naming one, see `dmo_field_mapping_add`.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `field_source_target_map_developer_name` | `fieldSourceTargetMapDeveloperName` | path | string | yes | Developer name of the field source target mapping between a DLO and a DMO. Required when adding new field mappings. Retrieve this value from the [get data model object mappings](https://developer.salesforce.com/docs/data/connectapi/references/spec?meta=getDataModelObjectMappingCollection) endpoint. Since v61.0. |
| `object_source_target_map_developer_name` | `objectSourceTargetMapDeveloperName` | path | string | yes | Developer name of the object source target mapping between a DLO and a DMO. Retrieve this value from the [get data model object mappings](https://developer.salesforce.com/docs/data/connectapi/references/spec?meta=getDataModelObjectMappingCollection) endpoint. Since v61.0. |
| `dataspace` | `dataspace` | query | string |  | Name of the data space. If unspecified, the `default` data space is used. Since v61.0. |
| `dataspace_name` | `dataSpaceName` | body | string |  | Name of the data space. If unspecified, the `default` data space is used. This property is required for data graph resources. Since v59.0. |
| `description` | `description` | body | string |  | Description of the object to create. Since v59.0. |
| `label` | `label` | body | string |  | Label of the object to create. This property is required for data graph resources. Since v59.0. |
| `name` | `name` | body | string |  | API name of the object to create. This property is required for data graph resources. Since v59.0. |
| `field_mapping` | `fieldMapping` | body | array of [CdpFieldSourceTargetMapInput](#cdpfieldsourcetargetmapinputrepresentation) |  | Details about the fields mappings between the DLO source and the DMO target. Since v61.0. |
| `source_entity_developer_name` | `sourceEntityDeveloperName` | body | string |  | Source DLO entity developer name. Since v61.0. |
| `target_entity_developer_name` | `targetEntityDeveloperName` | body | string |  | Target DMO entity developer name. Since v61.0. |

```sql
CALL cdp.dmo_field_mapping_update (object_source_target_map_developer_name => 'StaticCurrencyRates_Home_map_StaticCurrencyRates_Home_1754427001213', field_source_target_map_developer_name => 'InternalOrganization__c_fieldmap_InternalOrganizationId__c', source_entity_developer_name => 'StaticCurrencyRates_Home__dll', target_entity_developer_name => 'StaticCurrencyRates_Home__dlm', field_mapping => [(source_field_developer_name = 'InternalOrganization__c', target_field_developer_name = 'InternalOrganizationId__c')]);
```

**Result**

One row. Schema `CdpObjectSourceTargetMapRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `developer_name` | `developerName` | VARCHAR | Developer name of the object source target map. Since v61.0. |
| `field_mappings` | `fieldMappings` | JSON (array of CdpFieldSourceTargetMapRepresentation) | List of field mappings from the object source target map. Since v61.0. |
| `source_entity_developer_name` | `sourceEntityDeveloperName` | VARCHAR | Source DLO entity developer name of the object source target map. Since v61.0. |
| `status` | `status` | VARCHAR | Status of the object source target map. Since v61.0. |
| `target_entity_developer_name` | `targetEntityDeveloperName` | VARCHAR | Target DMO entity developer name of the object source target map. Since v61.0. |

**Done when:** `dmo_mapping_get.status` returns to `ACTIVE`. The guide shows `UPDATING` in the response.

**Notes:** The spec's facts conflict here. It titles this PATCH "Delete data model object field mapping". It marks `field_source_target_map_developer_name` optional although it's in the path, and says it's required "when adding", yet a new field mapping has no developer name to pass. The [DMO guide](https://developer.salesforce.com/docs/data/connectapi/guide/dmo-use-case.md) adds fields with a PATCH to `/field-mappings`, without that segment, which is [`dmo_field_mapping_add`](#dmo_field_mapping_add).

The body repeats the entity names: the spec's 400 text covers a missing source entity and missing field mappings. A [community plugin](https://github.com/dsouza-anush/sf-plugin-data360/blob/main/src/mapping/client.ts) sends both entity names with a one-item `field_mapping`. Its [fixtures](https://github.com/dsouza-anush/sf-plugin-data360/blob/main/test/fixtures/live/mapping-update.json) record a success, and an [earlier failure](https://github.com/dsouza-anush/sf-plugin-data360/blob/main/test/fixtures/live/p4-mapping-update-field-error.json) with `Unrecognized field "sourceFieldDeveloperName"` (community, one org). The body shape of the failed call isn't recorded.

## dmo_update

`PATCH /ssot/data-model-objects/{dataModelObjectName}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Model-Objects/paths/~1ssot~1data-model-objects~1%7BdataModelObjectName%7D/patch) · tool `d360_dmo_update` · evidence O · changes org state

Update a custom data model object (DMO). The state of the DMO prior to the patch update is returned. To view the latest updates, send this request again or use the [get data model object](https://developer.salesforce.com/docs/data/connectapi/references/spec?meta=getDataModelObject) endpoint. Since v61.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `data_model_object_name` | `dataModelObjectName` | path | string | yes | Developer name of the DMO, with the `__dlm` suffix. |
| `dataspace_name` | `dataSpaceName` | body | string |  | Name of the data space. If unspecified, the `default` data space is used. This property is required for data graph resources. Since v59.0. |
| `description` | `description` | body | string |  | Description of the object to create. Since v59.0. |
| `label` | `label` | body | string |  | Label of the object to create. This property is required for data graph resources. Since v59.0. |
| `name` | `name` | body | string |  | API name of the object to create. This property is required for data graph resources. Since v59.0. |
| `category` | `category` | body | enum(Engagement, Other, Profile) |  | Category of the data object. Since v60.0. |
| `event_date_time_field_name` | `eventDateTimeFieldName` | body | string |  | Name of the event date and time field. This property is required when the value of the category property is `Engagement`. Since v60.0. |
| `fields` | `fields` | body | array of [DataObjectFieldInput](#dataobjectfieldinputrepresentation) |  | Fields in the data object. Since v60.0. |
| `record_modified_field_name` | `recordModifiedFieldName` | body | string |  | Record modified field name. Since v60.0. |
| `type` | `type` | body | enum(DataLakeObject, DataModelObject) |  | Type of data object. Since v60.0. |
| `status` | `status` | body | enum(Active, Error, Inactive, Processing) |  | Status of DMO. Since v60.0. |

```sql
CALL cdp.dmo_update (data_model_object_name => 'CustomDMO__dlm', label => 'Custom DMO', fields => [(name = 'CustomDMO789', label = 'CustomDMO789', is_primary_key = false, data_type = 'DateTime')]);
```

**Result**

One row. Schema `DataModelObjectRepresentation`.

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
| `category` | `category` | VARCHAR | Category. Since v60.0. |
| `event_date_time_field_name` | `eventDateTimeFieldName` | VARCHAR | Name of the event date and time field. This property is required when the value of the category property is `Engagement`. Since v60.0. |
| `fields` | `fields` | JSON (array of DataObjectFieldRepresentation) | List of fields. Since v60.0. |
| `record_modified_field_name` | `recordModifiedFieldName` | VARCHAR | Record modified field. Since v60.0. |
| `type` | `type` | VARCHAR | Type of data object. Since v60.0. |
| `status` | `status` | VARCHAR | Status of the DMO. Since v60.0. |
| `creation_type` | `creationType` | VARCHAR | Not in the spec schema: from the spec's examples. |
| `dataspace_name` | `dataSpaceName` | VARCHAR | Not in the spec schema: from the spec's examples. |
| `description` | `description` | VARCHAR | Not in the spec schema: from the spec's examples. |
| `has_external_data_lake_object_mappings` | `hasExternalDataLakeObjectMappings` | BOOLEAN | Not in the spec schema: from the spec's examples. |
| `is_editable` | `isEditable` | BOOLEAN | Not in the spec schema: from the spec's examples. |
| `is_enabled` | `isEnabled` | BOOLEAN | Not in the spec schema: from the spec's examples. |
| `is_segmentable` | `isSegmentable` | BOOLEAN | Not in the spec schema: from the spec's examples. |

**Notes:** The result shows the state before the patch, so read back with `dmo_get`. The developer name can't change, and fields without a data type are rejected (spec 400 text). The [`data_type` vs `type`](#dataobjectfieldinputrepresentation) conflict applies here too. [afd360](https://github.com/javrrr/afd360/blob/main/src/resources/dmo.ts) calls the shape for adding fields undocumented and deletes and recreates instead (community).

## dmo_mapping_create

`POST /ssot/data-model-object-mappings` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Model-Objects/paths/~1ssot~1data-model-object-mappings/post) · tool `d360_dmo_mapping_create`, `d360_standard_mapping_create` · evidence O · changes org state

Create one mapping from a DLO to a DMO, with its field pairs. Call it once per source and target pair.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `dataspace` | `dataspace` | query | string | yes | Name of the data space. If unspecified, the `default` data space is used. Since v61.0. |
| `dataspace_name` | `dataSpaceName` | body | string |  | Name of the data space. If unspecified, the `default` data space is used. This property is required for data graph resources. Since v59.0. |
| `description` | `description` | body | string |  | Description of the object to create. Since v59.0. |
| `label` | `label` | body | string |  | Label of the mapping. In the guide, this value becomes `developer_name`. |
| `name` | `name` | body | string |  | Name of the mapping. The spec calls this the API name, but the guide sends free text here and gets `label` back as `developer_name`. |
| `field_mapping` | `fieldMapping` | body | array of [CdpFieldSourceTargetMapInput](#cdpfieldsourcetargetmapinputrepresentation) |  | Details about the fields mappings between the DLO source and the DMO target. Since v61.0. |
| `source_entity_developer_name` | `sourceEntityDeveloperName` | body | string |  | Source DLO developer name, with the `__dll` suffix. |
| `target_entity_developer_name` | `targetEntityDeveloperName` | body | string |  | Target DMO developer name, with the `__dlm` suffix. |

```sql
CALL cdp.dmo_mapping_create (dataspace => 'default', label => 'S3_Subscribers_Individual', source_entity_developer_name => 'S3_Subscribers__dll', target_entity_developer_name => 'ssot__Individual__dlm', field_mapping => [(source_field_developer_name = 'Subscriber_ID__c', target_field_developer_name = 'ssot__SourceSystemId__c'), (source_field_developer_name = 'LastName__c', target_field_developer_name = 'ssot__LastName__c'), (source_field_developer_name = 'FirstName__c', target_field_developer_name = 'ssot__FirstName__c')]);
```

**Result**

One row. Schema `CdpObjectSourceTargetMapRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `developer_name` | `developerName` | VARCHAR | Developer name of the object source target map. Since v61.0. |
| `field_mappings` | `fieldMappings` | JSON (array of CdpFieldSourceTargetMapRepresentation) | List of field mappings from the object source target map. Since v61.0. |
| `source_entity_developer_name` | `sourceEntityDeveloperName` | VARCHAR | Source DLO entity developer name of the object source target map. Since v61.0. |
| `status` | `status` | VARCHAR | Status of the object source target map. Since v61.0. |
| `target_entity_developer_name` | `targetEntityDeveloperName` | VARCHAR | Target DMO entity developer name of the object source target map. Since v61.0. |

**Done when:** `dmo_mapping_get.status` is `ACTIVE`, after `CREATING`. The spec's enum also has `Error`. No source documents a typical wait.

**Notes:** **One pair per call.** Each call covers one DLO and one DMO ([tool text](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/MappingTools.java)). [`d360_standard_mapping_create`](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/StandardMappingTools.java) looks like a bulk call, but it loops over definitions bundled in the MCP server and sends one POST per DMO, so the API has no bulk form.

**Required pairs:**
- The DLO's primary key must be mapped. Otherwise the spec lists a 400, `Unable to find the primary key of the DLO`. [afd360](https://github.com/javrrr/afd360/blob/main/src/resources/mapping.ts) reports this as `MISSING_ARGUMENT` (community).
- For Engagement DLOs, the event date field must be mapped, and the source and target types must match exactly (`Date` to `Date`, `DateTime` to `DateTime`). If the DMO has no matching field, create a custom DMO that does ([tool text](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/MappingTools.java)).
- `ContactPointEmail` needs the person id mapped to both `ssot__Id__c` and `ssot__PartyId__c`, which links the email to the Individual ([payload examples](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/resources/metadata/payload-examples.json)).

**Names:** DLO fields include `__c` (`customer_id__c`), so read them from `dlo_get`. Don't map `DataSource__c`, `DataSourceObject__c` or `KQ_*`: the server adds them ([payload examples](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/resources/metadata/payload-examples.json)). Read the mapping's name from `developer_name`. The [DMO guide](https://developer.salesforce.com/docs/data/connectapi/guide/dmo-use-case.md) sends `label` and `name` and gets the label back as the name. The spec's example sends neither and gets a generated `test1_map_AcademicYear_1756753400979`.

**Prerequisites:** a custom DMO must be created with an explicit `dataspace_name`, or this returns `DMO not found` ([payload examples](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/resources/metadata/payload-examples.json)). `is_enabled = false` on a DMO doesn't block mapping ([tool text](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/DmoTools.java)). A new DLO can take 5 to 60 s to expose its fields ([afd360](https://github.com/javrrr/afd360/blob/main/src/resources/mapping.ts), community), and a DMO of the wrong category fails with `Cannot map DLO to DMO` ([afd360](https://github.com/javrrr/afd360/blob/main/src/resources/dmo.ts), community).

**Retries:** repeating a call for the same DLO, DMO and data space returns `DUPLICATE_DLO_TO_DMO_MAPPING` ([afd360](https://github.com/javrrr/afd360/blob/main/src/resources/mapping.ts), community).

**`dataspace`:** the spec marks it required, while its description gives a default and the guide's request omits it. The payload notes call it required. The [tool text](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/MappingTools.java) also sends `ignoreSystemFieldValidations`, which the spec doesn't list.

## dmo_create

`POST /ssot/data-model-objects` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Model-Objects/paths/~1ssot~1data-model-objects/post) · tool `d360_dmo_create` · evidence O · changes org state

Create a custom data model object (DMO). Since v61.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `dataspace_name` | `dataSpaceName` | body | string |  | Name of the data space. If unspecified, the `default` data space is used. Set it explicitly: mapping a custom DMO created without it returns `DMO not found` (payload examples). |
| `description` | `description` | body | string |  | Description of the object to create. Since v59.0. |
| `label` | `label` | body | string |  | Label of the object to create. This property is required for data graph resources. Since v59.0. |
| `name` | `name` | body | string |  | DMO name without `__dlm`, see the notes. Letters, digits and underscores. Starts with a letter, has no trailing or consecutive underscores, and doesn't start with `SSOT`. |
| `category` | `category` | body | enum(Engagement, Other, Profile) |  | Category of the data object. Since v60.0. |
| `event_date_time_field_name` | `eventDateTimeFieldName` | body | string |  | Name of the event date and time field. This property is required when the value of the category property is `Engagement`. Since v60.0. |
| `fields` | `fields` | body | array of [DataObjectFieldInput](#dataobjectfieldinputrepresentation) |  | Fields in the data object. Since v60.0. |
| `record_modified_field_name` | `recordModifiedFieldName` | body | string |  | Record modified field name. Since v60.0. |
| `type` | `type` | body | enum(DataLakeObject, DataModelObject) |  | Type of data object. Since v60.0. |
| `status` | `status` | body | enum(Active, Error, Inactive, Processing) |  | Status of DMO. Since v60.0. |

```sql
CALL cdp.dmo_create (name => 'CustomDMO', label => 'Custom DMO', dataspace_name => 'default', category => 'Profile', fields => [(name = 'CustomId', label = 'Custom Id', is_primary_key = true, data_type = 'Text'), (name = 'SignupDate', label = 'Signup Date', is_primary_key = false, data_type = 'DateTime')]);
```

**Result**

One row. Schema `DataModelObjectRepresentation`.

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
| `category` | `category` | VARCHAR | Category. Since v60.0. |
| `event_date_time_field_name` | `eventDateTimeFieldName` | VARCHAR | Name of the event date and time field. This property is required when the value of the category property is `Engagement`. Since v60.0. |
| `fields` | `fields` | JSON (array of DataObjectFieldRepresentation) | List of fields. Since v60.0. |
| `record_modified_field_name` | `recordModifiedFieldName` | VARCHAR | Record modified field. Since v60.0. |
| `type` | `type` | VARCHAR | Type of data object. Since v60.0. |
| `status` | `status` | VARCHAR | Status of the DMO. Since v60.0. |
| `creation_type` | `creationType` | VARCHAR | Not in the spec schema: from the spec's examples. |
| `dataspace_name` | `dataSpaceName` | VARCHAR | Not in the spec schema: from the spec's examples. |
| `description` | `description` | VARCHAR | Not in the spec schema: from the spec's examples. |
| `has_external_data_lake_object_mappings` | `hasExternalDataLakeObjectMappings` | BOOLEAN | Not in the spec schema: from the spec's examples. |
| `is_editable` | `isEditable` | BOOLEAN | Not in the spec schema: from the spec's examples. |
| `is_enabled` | `isEnabled` | BOOLEAN | Not in the spec schema: from the spec's examples. |
| `is_segmentable` | `isSegmentable` | BOOLEAN | Not in the spec schema: from the spec's examples. |

**Done when:** `dmo_get` returns a populated `dataSpaceName`, found in `_raw`. It may return incomplete fields before that ([afd360](https://github.com/javrrr/afd360/blob/main/src/resources/dmo.ts), community). Waits of 60 to 90 s are reported (community).

**Notes:** **The `__dlm` conflict.** Sources disagree on whether `name` takes the suffix.

| Source | Says |
|---|---|
| The spec's example | Sends `CustomDMO`, returns `CustomDMO__dlm` |
| MCP [tool text](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/DmoTools.java) and [request class](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/model/request/dmo/DmoCreateRequest.java) | Don't include it, "the API appends it" |
| [afd360](https://github.com/javrrr/afd360/blob/main/skills/afd360/SKILL.md) (community) | "The platform appends these" |
| MCP [catalog](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/runtime/FamilyCatalog.java) | "API name must end with `__dlm`" |
| MCP [payload examples](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/resources/metadata/payload-examples.json) | Send `CustomMetric__dlm`, and also `objectType` and `objectCategory`, which the spec lacks |

Pass the bare name. The spec's 400 text forbids two consecutive underscores, which a suffixed name would break, though that's my inference. This hasn't been tested. Field names behave the same way: the spec's `CustomDMO123` returns as `CustomDMO123__c`, with `KQ_CustomDMO123__c` added.

**Rules:** at least one field needs `is_primary_key = true` for the create to succeed, and Engagement DMOs need `event_date_time_field_name` ([tool text](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/DmoTools.java)). No source documents whether that value takes `__c`. A name that "has been previously used" is also rejected (spec 400 text), so a deleted DMO's name may not be reusable.

**`category`:** the enum is `Profile`, while the spec's example sends `PROFILE`. [afd360](https://github.com/javrrr/afd360/blob/main/src/resources/dmo.ts) sends title case and reads back upper case (community, one org). The tool text also accepts `Segment_Membership`, while the [request class](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/model/request/dmo/DmoCreateRequest.java) lists only the three spec values.

**`is_dynamic_lookup`** appears in the spec's example but not its schema, and the field-level `data_type` conflict is under [the schema](#dataobjectfieldinputrepresentation).

## dmo_relationship_create

`POST /ssot/data-model-objects/{dataModelObjectName}/relationships` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Data-Model-Objects/paths/~1ssot~1data-model-objects~1%7BdataModelObjectName%7D~1relationships/post) · evidence O · changes org state

Create bulk data model object (DMO) relationships between fields in the source DMO and fields in the target DMO. If a relationship already exists, it is skipped. Since v64.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `data_model_object_name` | `dataModelObjectName` | path | string | yes | Developer name of the source DMO, with the `__dlm` suffix. The spec doesn't say which end goes here, but afd360 passes the source (community). |
| `dataspace` | `dataspace` | query | string |  | Name of the data space. If unspecified, the `default` data space is used. Since v64.0. |
| `relationships` | `relationships` | body | array of [FieldSrcTrgtRelationshipInput](#fieldsrctrgtrelationshipinputrepresentation) | yes | List of relationships to be created. Since v64.0. |

```sql
CALL cdp.dmo_relationship_create (data_model_object_name => 'SalesOrder__dlm', dataspace => 'default', relationships => [(source_object_name = 'SalesOrder__dlm', target_object_name = 'ssot__Individual__dlm', source_field_name = 'CustomerId__c', target_field_name = 'ssot__Id__c', cardinality = 'ManyToOne', relationship_owner = 'DataCloud')]);
```

**Result**

One row per item of `/relationships` in the response. Other response fields go to `_meta`: `currentPageUrl`, `nextPageUrl`, `totalSize`. Schema `FieldSrcTrgtRelationshipRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `cardinality` | `cardinality` | VARCHAR | Cardinality between the fields involved in the relationship. Since v64.0. |
| `creation_type` | `creationType` | VARCHAR | Creation type of the relationship. Since v64.0. |
| `id` | `id` | VARCHAR | ID of the relationship. Since v64.0. |
| `name` | `name` | VARCHAR | Developer name of the relationship. Since v64.0. |
| `owner` | `owner` | VARCHAR | Owner of the relationship. Since v64.0. |
| `source_field` | `sourceField` | JSON (RelationshipFieldRepresentation) | Details about the source field involved in the relationship. Since v64.0. |
| `source_object` | `sourceObject` | JSON (RelationshipObjectRepresentation) | Details about the source object involved in the relationship. Since v64.0. |
| `status` | `status` | VARCHAR | Status of the relationship. Since v64.0. |
| `target_field` | `targetField` | JSON (RelationshipFieldRepresentation) | Details about the target field involved in the relationship. Since v64.0. |
| `target_object` | `targetObject` | JSON (RelationshipObjectRepresentation) | Details about the target object involved in the relationship. Since v64.0. |
| `source_entity` | `sourceEntity` | JSON | Not in the spec schema: from the spec's examples. |
| `target_entity` | `targetEntity` | JSON | Not in the spec schema: from the spec's examples. |

**Paging:** `next_page_url`.

**Done when:** `dmo_relationship_list.status` is `ACTIVE`, found by `name`. Live responses start at `CREATING` (community). The spec's enum also has `Error`.

**Notes:** **Both DMOs need mappings first.** Otherwise this returns 400 `INVALID_INPUT` with `No ObjectSourceTargetMaps were found` ([afd360](https://github.com/javrrr/afd360/blob/main/src/resources/relationship.ts), community, one org). The same source says this works for any mapped pair, not only custom DMOs.

**The spec's example is wrong on two names.** It sends `owner` and `creation_type`, but the schema has `relationship_owner` and no creation type. The same source reports the API rejects both as unrecognized (community, one org). A [community template](https://github.com/Jaganpro/sf-skills/blob/main/skills/sf-datacloud/assets/definitions/relationship.template.json) also uses `relationship_owner`.

The spec says existing relationships are skipped, but not whether they appear in the response. [afd360](https://github.com/javrrr/afd360/blob/main/src/resources/relationship.ts) falls back to `dmo_relationship_list` when the response has none (community). Segment joins need a declared relationship ([notes](api_notes.md)).

## dmo_field_mapping_add

`PATCH /ssot/data-model-object-mappings/{mappingName}/field-mappings` · tool `d360_dmo_field_mapping_add` · evidence S · changes org state

Add field mappings to an existing DLO-to-DMO mapping without recreating it. Use it when the source gains a field or a mapping missed one.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `mapping_name` | `mappingName` | path | string | yes | Developer name of the object mapping, for example `Contact_00D000000000000_map_ContactPointAddress_1714460254874`. |
| `dataspace` | `dataspace` | query | string |  | Name of the data space. If unspecified, the `default` data space is used. |
| `field_mapping` | `fieldMapping` | body | array of [CdpFieldSourceTargetMapInput](#cdpfieldsourcetargetmapinputrepresentation) | yes | Field mappings to add. See the notes for the `field_mappings` conflict. |
| `source_entity_developer_name` | `sourceEntityDeveloperName` | body | string | yes | Source DLO developer name. The guide sends it, and the spec's 400 text for the sibling PATCH treats it as required. |
| `target_entity_developer_name` | `targetEntityDeveloperName` | body | string |  | Target DMO developer name. The guide sends it. |
| `description` | `description` | body | string |  | Description of the mapping. The guide sends it. |
| `label` | `label` | body | string |  | Label of the mapping. The guide sends it. |
| `name` | `name` | body | string |  | Name of the mapping. The guide sends it. |

```sql
CALL cdp.dmo_field_mapping_add (mapping_name => 'S3_Subscribers_Individual', source_entity_developer_name => 'S3_Subscribers__dll', target_entity_developer_name => 'ssot__Individual__dlm', field_mapping => [(source_field_developer_name = 'DateOfBirth__c', target_field_developer_name = 'ssot__BirthDate__c')]);
```

**Result**

One row.

| Column | API name | Type | Description |
|---|---|---|---|
| `developer_name` | `developerName` | VARCHAR | Developer name of the object mapping. |
| `field_mappings` | `fieldMappings` | JSON | Field mappings, each with `developer_name`, `source_field_developer_name` and `target_field_developer_name`. |
| `source_entity_developer_name` | `sourceEntityDeveloperName` | VARCHAR | Source DLO developer name. |
| `status` | `status` | VARCHAR | Mapping status. The guide shows `UPDATING` here. |
| `target_entity_developer_name` | `targetEntityDeveloperName` | VARCHAR | Target DMO developer name. |

**Done when:** `dmo_mapping_get.status` returns to `ACTIVE`. The guide shows `UPDATING` in the response.

**Notes:** This path isn't in the spec, and it's the `dmo_field_mapping_update` path without the last segment. The options follow Step 4 of the [DMO guide](https://developer.salesforce.com/docs/data/connectapi/guide/dmo-use-case.md), the only source showing a full request. The MCP [request class](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/model/request/mapping/FieldMappingAddRequest.java) differs: it sends only `field_mappings`, plural, with no entity names. Check which one the server accepts.

## dmo_field_mapping_delete

`DELETE /ssot/data-model-object-mappings/{mappingName}/field-mappings/{fieldMappingName}` · tool `d360_dmo_field_mapping_delete` · evidence S · changes org state

Delete one field mapping and keep the rest of the DLO-to-DMO mapping. Use it to remove a field for governance or cleanup.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `mapping_name` | `mappingName` | path | string | yes | Developer name of the object mapping |
| `field_mapping_name` | `fieldMappingName` | path | string | yes | Developer name of the field mapping to delete (e.g. MailingCity__c_fieldmap_ssot__CityId__c) |
| `dataspace` | `dataspace` | query | string |  | Dataspace name |

```sql
CALL cdp.dmo_field_mapping_delete (mapping_name => 'S3_Subscribers_Individual', field_mapping_name => 'DateOfBirth__c_fieldmap_ssot__BirthDate__c');
```

**Result**

The public sources don't document this response. One row, with the response in `_raw`.

**Notes:** This path isn't in the spec, which has only [`dmo_field_mappings_delete`](#dmo_field_mappings_delete) with no field name. The MCP server and a [community plugin](https://github.com/dsouza-anush/sf-plugin-data360/blob/main/src/mapping/client.ts) use this one, and the plugin's [fixture](https://github.com/dsouza-anush/sf-plugin-data360/blob/main/test/fixtures/live/mapping-delete.json) records a live success (community, one org). Field mapping names follow `<source>_fieldmap_<target>`, as `dmo_mapping_get` shows.

## Schemas

Attribute names are keywords inside the object they belong to, so completion offers exactly these.

### CdpFieldSourceTargetMapInputRepresentation

Represents the input for creating a field source target map.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `dataspace_name` | `dataSpaceName` | string |  | Name of the data space. If unspecified, the `default` data space is used. This property is required for data graph resources. Since v59.0. |
| `description` | `description` | string |  | Description of the object to create. Since v59.0. |
| `label` | `label` | string |  | Label of the object to create. This property is required for data graph resources. Since v59.0. |
| `name` | `name` | string |  | API name of the object to create. This property is required for data graph resources. Since v59.0. |
| `source_field_developer_name` | `sourceFieldDeveloperName` | string |  | Source DLO field developer name, with `__c` (`customer_id__c`). Since v61.0. |
| `target_field_developer_name` | `targetFieldDeveloperName` | string |  | Target DMO field developer name, for example `ssot__FirstName__c`. Since v61.0. |

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

### FieldSrcTrgtRelationshipInputRepresentation

Represents the input to create a field source target relationship between data model objects (DMOs).

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `cardinality` | `cardinality` | enum(ManyToOne, OneToOne) | yes | Cardinality between the fields involved in the relationship. Since v64.0. |
| `dataspace_name` | `dataSpaceName` | string |  | Name of the data space for the relationship creation. Since v64.0. |
| `relationship_owner` | `relationshipOwner` | enum(DataCloud, Sobject) |  | Owner of the relationship. The spec's example sends `owner`, which a community source reports the API rejects (one org). Since v64.0. |
| `source_field_name` | `sourceFieldName` | string | yes | Developer name of the source field in the relationship. Since v64.0. |
| `source_object_name` | `sourceObjectName` | string |  | Developer name of the source object in the relationship. Optional in the spec, though its example and community clients send it. Since v64.0. |
| `target_field_name` | `targetFieldName` | string | yes | Developer name of the target field in the relationship. Since v64.0. |
| `target_object_name` | `targetObjectName` | string |  | Developer name of target object in the relationship. Optional in the spec, though its example and community clients send it. Since v64.0. |
| `creation_type` | `creationType` | string |  | Not in the spec schema: from the spec's examples. |
| `owner` | `owner` | string |  | Not in the spec schema: from the spec's examples. |
