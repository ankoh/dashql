# Semantic Models

Part of the [CDP function reference](functions.md). Nothing here is implemented or tested against an org. Every result also has the [standard columns](functions.md#result-schema).

A semantic model (SDM) is a named layer over existing DMOs, DLOs and calculated insights. It gives their columns business names and adds joins, formulas and metrics, so a query names fields and the engine writes the SQL. This family is separate from the Connect spec, and its [own guide](https://developer.salesforce.com/docs/data/semantic-layer/guide/get-started.md) calls it Tableau Semantics.

Build in this order: the source objects must exist, then [`sdm_create`](#sdm_create), [`sdm_data_object_create`](#sdm_data_object_create) per object, [`sdm_relationship_create`](#sdm_relationship_create), [`sdm_calc_dim_create`](#sdm_calc_dim_create) and [`sdm_calc_measure_create`](#sdm_calc_measure_create), [`sdm_metric_create`](#sdm_metric_create), [`sdm_validate`](#sdm_validate), and [`sdm_query`](#sdm_query). [`sdm_create`](#sdm_create) can also take everything in one body.

What matters most:

- **Names.** Authoring and queries use semantic `api_name` values, not `__dlm` or `__c` names. If you send only a label, the server generates the name, so read it back.
- **Formulas** are Tableau-style (the guide calls the dialect Tua), in `$$ ... $$`: `[Object].[Field]`, `IF ... END`. A measurement whose formula aggregates needs `aggregation_type => 'UserAgg'`.
- **Queries.** Sources conflict on naming the model by ID or API name.
- **Deletes.** Deleting a data object or relationship breaks what joins through it. Check each definition's `dependencies`.

```sql
CALL cdp.sdm_create (api_name => 'AccountRevenue', label => 'Account Revenue', dataspace => 'default');
CALL cdp.sdm_data_object_create (model_api_name_or_id => 'AccountRevenue', data_object_name => 'ssot__Account__dlm', data_object_type => 'Dmo', api_name => 'Account', label => 'Account', should_include_all_fields => true);
CALL cdp.sdm_calc_measure_create (model_api_name_or_id => 'AccountRevenue', label => 'Total Revenue', api_name => 'Total_Revenue', data_type => 'Number', aggregation_type => 'UserAgg', expression => $$SUM([Account].[AnnualRevenue])$$);
CALL cdp.sdm_validate (model_api_name_or_id => 'AccountRevenue');
CALL cdp.sdm_query (semantic_model_api_name => 'AccountRevenue', structured_semantic_query => (fields = [(expression = (semantic_field = (name = 'Total_Revenue')), alias = 'revenue', semantic_aggregation_method = 'SEMANTIC_AGGREGATION_METHOD_USER_AGG')]));
```

**Functions:** [`sdm_list`](#sdm_list), [`sdm_get`](#sdm_get), [`sdm_create`](#sdm_create), [`sdm_update`](#sdm_update), [`sdm_delete`](#sdm_delete), [`sdm_clone`](#sdm_clone), [`sdm_validate`](#sdm_validate), [`sdm_dependencies`](#sdm_dependencies), [`sdm_data_object_create`](#sdm_data_object_create), [`sdm_data_objects_list`](#sdm_data_objects_list), [`sdm_data_object_get`](#sdm_data_object_get), [`sdm_data_object_update`](#sdm_data_object_update), [`sdm_data_object_delete`](#sdm_data_object_delete), [`sdm_dimensions_list`](#sdm_dimensions_list), [`sdm_measurements_list`](#sdm_measurements_list), [`sdm_calc_dims_list`](#sdm_calc_dims_list), [`sdm_calc_dim_create`](#sdm_calc_dim_create), [`sdm_calc_dim_get`](#sdm_calc_dim_get), [`sdm_calc_dim_update`](#sdm_calc_dim_update), [`sdm_calc_dim_delete`](#sdm_calc_dim_delete), [`sdm_calc_measures_list`](#sdm_calc_measures_list), [`sdm_calc_measure_create`](#sdm_calc_measure_create), [`sdm_calc_measure_get`](#sdm_calc_measure_get), [`sdm_calc_measure_update`](#sdm_calc_measure_update), [`sdm_calc_measure_delete`](#sdm_calc_measure_delete), [`sdm_metrics_list`](#sdm_metrics_list), [`sdm_metric_create`](#sdm_metric_create), [`sdm_metric_get`](#sdm_metric_get), [`sdm_metric_update`](#sdm_metric_update), [`sdm_metric_delete`](#sdm_metric_delete), [`sdm_relationships_list`](#sdm_relationships_list), [`sdm_relationship_create`](#sdm_relationship_create), [`sdm_relationship_get`](#sdm_relationship_get), [`sdm_relationship_update`](#sdm_relationship_update), [`sdm_relationship_delete`](#sdm_relationship_delete), [`sdm_formula_metadata`](#sdm_formula_metadata), [`sdm_permissions`](#sdm_permissions), [`sdm_query`](#sdm_query)

## sdm_list

`GET /ssot/semantic/models` · tool `d360_sdm_list` · evidence S · read-only

List the semantic models in the org, optionally filtered by data space, label or API names. Use it to find a model's `api_name`.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `dataspace` | `dataspace` | query | string |  | Dataspace name |
| `app` | `app` | query | string |  | App filter |
| `category` | `category` | query | string |  | Category filter (Marketing, Commerce, Sales, Service, Other) |
| `label` | `label` | query | string |  | Label filter |
| `limit` | `limit` | query | integer |  | Max number of results |
| `offset` | `offset` | query | integer |  | Offset for pagination |
| `order_by` | `orderBy` | query | string |  | Sort clause. A [community fixture](https://github.com/dsouza-anush/sf-plugin-data360/blob/main/test/fixtures/semantic/models.json) shows `api_name ASC`. |
| `search_term` | `searchTerm` | query | string |  | Search term |
| `semantic_model_api_names` | `semanticModelApiNames` | query | string |  | Comma-separated semantic model api names |
| `source_creation` | `sourceCreation` | query | string |  | Source-creation filter. Sources disagree on the values, see [`sdm_create`](#sdm_create). |
| `source_creation_name` | `sourceCreationName` | query | string |  | Source-creation-name filter |

```sql
CALL cdp.sdm_list (dataspace => 'default', limit => 100, order_by => 'apiName ASC');
```

**Result**

One row per item of `/items` in the response. Other response fields go to `_meta`: `count`, `total`, `currentPageUrl`, `nextPageUrl`, `previousPageUrl`. The key is from [sf-pi](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/references/data-shapes.md), the other response fields from a [community fixture](https://github.com/dsouza-anush/sf-plugin-data360/blob/main/test/fixtures/semantic/models.json) with no items, so the item columns come from the model schema and haven't been seen in a list response.

| Column | API name | Type | Description |
|---|---|---|---|
| `id` | `id` | VARCHAR | - |
| `api_name` | `apiName` | VARCHAR | Use this in the path of other calls. |
| `label` | `label` | VARCHAR | - |
| `description` | `description` | VARCHAR | - |
| `dataspace` | `dataspace` | VARCHAR | - |
| `app` | `app` | VARCHAR | - |
| `categories` | `categories` | JSON | - |
| `last_modified_date` | `lastModifiedDate` | TIMESTAMPTZ | - |

**Paging:** `limit`, `offset`. The response has `next_page_url`, null on the last page (community).

## sdm_get

`GET /ssot/semantic/models/{id}` · tool `d360_sdm_get` · evidence S · read-only

Read a whole model, with its data objects, relationships, calculated fields and metrics inline. Use it to read the generated API names and the `id` a query may need.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `model_api_name_or_id` | `id` | path | string | yes | Model API name or ID |
| `abac_filtering_mode` | `abacFilteringMode` | query | boolean |  | ABAC filtering mode |
| `allow_unmapped` | `allowUnmapped` | query | boolean |  | Include unmapped definitions in the response. |
| `field_name` | `fieldName` | query | string |  | Return only fields whose labels contain this text. |
| `fine_grain_security` | `fineGrainSecurity` | query | boolean |  | Apply fine-grained security rules and return a partial model. |
| `include_model_content` | `includeModelContent` | query | boolean |  | Add the model's full content to the response. |
| `include_table_keys` | `includeTableKeys` | query | boolean |  | Add key qualifiers and primary key indicators. |

```sql
CALL cdp.sdm_get (model_api_name_or_id => 'AccountRevenue', include_table_keys => true);
```

**Result**

One row. Other response fields go to `_meta`, including the `semantic...Url` links. Fields are from the official [model schema](https://developer.salesforce.com/docs/data/semantic-layer/guide/salesforce-semantic-model-schema.md).

| Column | API name | Type | Description |
|---|---|---|---|
| `id` | `id` | VARCHAR | Record ID, prefix `2SM` in the official examples. `semantic_model_id` of [`sdm_query`](#sdm_query) takes this. |
| `api_name` | `apiName` | VARCHAR | - |
| `label` | `label` | VARCHAR | - |
| `description` | `description` | VARCHAR | - |
| `dataspace` | `dataspace` | VARCHAR | - |
| `app` | `app` | VARCHAR | - |
| `categories` | `categories` | JSON | Marketing, Commerce, Sales, Service, Other. |
| `currency` | `currency` | JSON | Model default currency. |
| `source_creation` | `sourceCreation` | VARCHAR | - |
| `source_creation_name` | `sourceCreationName` | VARCHAR | - |
| `version_state` | `versionState` | VARCHAR | `Draft`, `Published` or `PublishedWithDraft`. |
| `is_locked` | `isLocked` | BOOLEAN | Locked for edit or delete. |
| `locked_actions` | `lockedActions` | JSON | Maps an action such as `edit`, `delete` or `clone` to the reasons it is restricted. |
| `is_upsertable` | `isUpsertable` | BOOLEAN | Whether the model can be edited. False when it contains non-queryable entities. |
| `has_unmapped` | `hasUnmapped` | BOOLEAN | The model contains unmapped definitions. |
| `is_partial_sdm` | `isPartialSdm` | BOOLEAN | The model is partial because of data governance. |
| `agent_enabled` | `agentEnabled` | BOOLEAN | - |
| `business_preferences` | `businessPreferences` | VARCHAR | - |
| `semantic_model_info` | `semanticModelInfo` | JSON | `definitionsCount`, `maxDefinitionCount`, `modelHierarchyDepth`. |
| `base_models` | `baseModels` | JSON | Models this one extends. |
| `semantic_data_objects` | `semanticDataObjects` | JSON | - |
| `semantic_relationships` | `semanticRelationships` | JSON | - |
| `semantic_calculated_dimensions` | `semanticCalculatedDimensions` | JSON | - |
| `semantic_calculated_measurements` | `semanticCalculatedMeasurements` | JSON | - |
| `semantic_metrics` | `semanticMetrics` | JSON | - |
| `semantic_parameters` | `semanticParameters` | JSON | - |
| `semantic_logical_views` | `semanticLogicalViews` | JSON | - |
| `semantic_groupings` | `semanticGroupings` | JSON | - |
| `created_by` | `createdBy` | VARCHAR | - |
| `created_date` | `createdDate` | TIMESTAMPTZ | - |
| `last_modified_by` | `lastModifiedBy` | VARCHAR | - |
| `last_modified_date` | `lastModifiedDate` | TIMESTAMPTZ | - |

**Notes:** Option meanings are from the [v65 Semantics OpenAPI file](https://github.com/javrrr/tableau-semantics-sdk/blob/main/src/generated/sources/authoring.yaml), a copy of the published file in a community repo. `abac_filtering_mode` appears only in [the tool](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/SdmTools.java), with no explanation. A model holds a limited number of definitions: `semantic_model_info.maxDefinitionCount` is 5000 in the [official example](https://developer.salesforce.com/docs/data/semantic-layer/guide/connect-api-in-depth-examples.md).

## sdm_create

`POST /ssot/semantic/models` · tool `d360_sdm_create` · evidence S · changes org state

Create a semantic model. The first step of every build: either an empty shell that later calls fill in, or the whole model in one call.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `api_name` | `apiName` | body | string | yes | API name of the model. |
| `label` | `label` | body | string | yes | Display name. |
| `dataspace` | `dataspace` | body | string | yes | Data space that holds the model. |
| `description` | `description` | body | string |  | Free text. |
| `app` | `app` | body | string |  | App the model belongs to. |
| `categories` | `categories` | body | array of string |  | Marketing, Commerce, Sales, Service, Other. |
| `currency` | `currency` | body | [SemanticModelCurrency](#semanticmodelcurrency) |  | Model default currency. |
| `source_creation` | `sourceCreation` | body | string |  | Where the model came from. Sources disagree on the values, see Notes. |
| `query_unrelated_data_objects` | `queryUnrelatedDataObjects` | body | string |  | What a query does across data objects with no relationship. Sources disagree on the name and the values, see Notes. |
| `agent_enabled` | `agentEnabled` | body | boolean |  | Enable agent features for the model. |
| `business_preferences` | `businessPreferences` | body | string |  | Business-specific preferences or context from analysts. |
| `base_models` | `baseModels` | body | JSON |  | Models this one extends: `api_name`, `label`. |
| `external_connections` | `externalConnections` | body | JSON |  | External connections of the model. |
| `fields_overrides` | `fieldsOverrides` | body | JSON |  | Field overrides. |
| `semantic_data_objects` | `semanticDataObjects` | body | array of [SemanticDataObject](#semanticdataobject) |  | Data objects, for the one-call build. |
| `semantic_relationships` | `semanticRelationships` | body | array of [SemanticRelationship](#semanticrelationship) |  | Relationships, for the one-call build. |
| `semantic_calculated_dimensions` | `semanticCalculatedDimensions` | body | array of [SemanticCalculatedDimension](#semanticcalculateddimension) |  | Calculated dimensions, for the one-call build. |
| `semantic_calculated_measurements` | `semanticCalculatedMeasurements` | body | array of [SemanticCalculatedMeasurement](#semanticcalculatedmeasurement) |  | Calculated measurements, for the one-call build. |
| `semantic_metrics` | `semanticMetrics` | body | array of [SemanticMetricDefinition](#semanticmetricdefinition) |  | Metrics, for the one-call build. |
| `semantic_parameters` | `semanticParameters` | body | JSON |  | Parameters that formulas and filters can reference. There is no separate function for these here. |
| `semantic_logical_views` | `semanticLogicalViews` | body | JSON |  | Join, union or custom SQL views. There is no separate function for these here. |
| `semantic_groupings` | `semanticGroupings` | body | JSON |  | Groupings. There is no separate function for these here. |
| `allow_external_definitions` | `allowExternalDefinitions` | query | boolean |  | Flag to allow external definitions |
| `allow_unmapped` | `allowUnmapped` | query | boolean |  | Flag to allow unmapped fields |
| `inherit_dc_relationship` | `inheritDcRelationship` | query | boolean |  | Flag to inherit data cloud relationships |

```sql
CALL cdp.sdm_create (api_name => 'AccountRevenue', label => 'Account Revenue Model', description => 'Accounts and revenue', dataspace => 'default');
```

**Result**

One row. Other response fields go to `_meta`, including the `semantic...Url` links. Fields are from the official [model schema](https://developer.salesforce.com/docs/data/semantic-layer/guide/salesforce-semantic-model-schema.md).

| Column | API name | Type | Description |
|---|---|---|---|
| `id` | `id` | VARCHAR | Record ID, prefix `2SM` in the official examples. `semantic_model_id` of [`sdm_query`](#sdm_query) takes this. |
| `api_name` | `apiName` | VARCHAR | - |
| `label` | `label` | VARCHAR | - |
| `description` | `description` | VARCHAR | - |
| `dataspace` | `dataspace` | VARCHAR | - |
| `app` | `app` | VARCHAR | - |
| `categories` | `categories` | JSON | Marketing, Commerce, Sales, Service, Other. |
| `currency` | `currency` | JSON | Model default currency. |
| `source_creation` | `sourceCreation` | VARCHAR | - |
| `source_creation_name` | `sourceCreationName` | VARCHAR | - |
| `version_state` | `versionState` | VARCHAR | `Draft`, `Published` or `PublishedWithDraft`. |
| `is_locked` | `isLocked` | BOOLEAN | Locked for edit or delete. |
| `locked_actions` | `lockedActions` | JSON | Maps an action such as `edit`, `delete` or `clone` to the reasons it is restricted. |
| `is_upsertable` | `isUpsertable` | BOOLEAN | Whether the model can be edited. False when it contains non-queryable entities. |
| `has_unmapped` | `hasUnmapped` | BOOLEAN | The model contains unmapped definitions. |
| `is_partial_sdm` | `isPartialSdm` | BOOLEAN | The model is partial because of data governance. |
| `agent_enabled` | `agentEnabled` | BOOLEAN | - |
| `business_preferences` | `businessPreferences` | VARCHAR | - |
| `semantic_model_info` | `semanticModelInfo` | JSON | `definitionsCount`, `maxDefinitionCount`, `modelHierarchyDepth`. |
| `base_models` | `baseModels` | JSON | Models this one extends. |
| `semantic_data_objects` | `semanticDataObjects` | JSON | - |
| `semantic_relationships` | `semanticRelationships` | JSON | - |
| `semantic_calculated_dimensions` | `semanticCalculatedDimensions` | JSON | - |
| `semantic_calculated_measurements` | `semanticCalculatedMeasurements` | JSON | - |
| `semantic_metrics` | `semanticMetrics` | JSON | - |
| `semantic_parameters` | `semanticParameters` | JSON | - |
| `semantic_logical_views` | `semanticLogicalViews` | JSON | - |
| `semantic_groupings` | `semanticGroupings` | JSON | - |
| `created_by` | `createdBy` | VARCHAR | - |
| `created_date` | `createdDate` | TIMESTAMPTZ | - |
| `last_modified_by` | `lastModifiedBy` | VARCHAR | - |
| `last_modified_date` | `lastModifiedDate` | TIMESTAMPTZ | - |

**Notes:** **Prerequisite.** All DMOs and calculated insights the model will use must already exist ([tool](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/SdmTools.java)).

**One call or several.** [Salesforce's catalog](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/runtime/FamilyCatalog.java) says "Create empty model. Add objects separately", and [sf-pi](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/references/data-shapes.md) describes the same. The [official example](https://developer.salesforce.com/docs/data/semantic-layer/guide/connect-api-in-depth-examples.md) posts a whole model in one body. [A community tool](https://github.com/javrrr/afd360/blob/main/src/resources/semantic-model.ts) moved to the one-body form at v65 (one org). Its reason: a failure part way through several calls leaves a half-built shell, and posting the same `api_name` again gives a 409 (community).

**Required body fields.** The tool's request class has only `api_name`, `label`, `description` and `dataspace`. The other body rows come from the [official examples](https://developer.salesforce.com/docs/data/semantic-layer/guide/connect-api-in-depth-examples.md) and the [v65 file](https://github.com/javrrr/tableau-semantics-sdk/blob/main/src/generated/sources/authoring.yaml). Omitting `dataspace` gives a 400, `missing a mandatory dataspace value` ([community, one org](https://github.com/javrrr/tableau-semantics-sdk/blob/main/src/resources/semantic-models.ts)).

**Conflicting enums.** The v65 file gives `source_creation` as `Manual`, `Import` and `query_unrelated_data_objects` as `Allow`, `Disallow`. [One community SDK](https://github.com/javrrr/tableau-semantics-sdk/blob/main/src/resources/semantic-models.ts) found both rejected, and `DataCloud` and `Union` accepted (one org). The [entities page](https://developer.salesforce.com/docs/data/semantic-layer/guide/connect-api-in-depth-entities.md) names the second one `UnrelatedDataObjectsQueryBehavior`, with `Exception` and `Union`.

**Imported relationships.** Relationships that already exist between Data 360 objects are [imported automatically](https://developer.salesforce.com/docs/data/semantic-layer/guide/query-api-in-depth-relationships.md) at creation. The sources don't explain how `inherit_dc_relationship` interacts with that.

**Order.** In the several-call build, calculated fields follow the data objects because their formulas name data object fields ([community](https://github.com/javrrr/afd360/blob/main/src/resources/semantic-model.ts)).

## sdm_update

`PATCH /ssot/semantic/models/{id}` · tool `d360_sdm_update` · evidence S · changes org state

Change model-level fields such as the label or description. It leaves data objects, relationships and calculated fields as they are.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `model_api_name_or_id` | `id` | path | string | yes | Model API name or ID |
| `label` | `label` | body | string |  | New display name. |
| `description` | `description` | body | string |  | New description. |
| `api_name` | `apiName` | body | string |  | New API name. |
| `allow_unmapped` | `allowUnmapped` | query | boolean |  | Flag to allow unmapped fields |

```sql
CALL cdp.sdm_update (model_api_name_or_id => 'AccountRevenue', description => 'Accounts and revenue, used by the sales dashboard');
```

**Result**

One row. Other response fields go to `_meta`, including the `semantic...Url` links. Fields are from the official [model schema](https://developer.salesforce.com/docs/data/semantic-layer/guide/salesforce-semantic-model-schema.md).

| Column | API name | Type | Description |
|---|---|---|---|
| `id` | `id` | VARCHAR | Record ID, prefix `2SM` in the official examples. `semantic_model_id` of [`sdm_query`](#sdm_query) takes this. |
| `api_name` | `apiName` | VARCHAR | - |
| `label` | `label` | VARCHAR | - |
| `description` | `description` | VARCHAR | - |
| `dataspace` | `dataspace` | VARCHAR | - |
| `app` | `app` | VARCHAR | - |
| `categories` | `categories` | JSON | Marketing, Commerce, Sales, Service, Other. |
| `currency` | `currency` | JSON | Model default currency. |
| `source_creation` | `sourceCreation` | VARCHAR | - |
| `source_creation_name` | `sourceCreationName` | VARCHAR | - |
| `version_state` | `versionState` | VARCHAR | `Draft`, `Published` or `PublishedWithDraft`. |
| `is_locked` | `isLocked` | BOOLEAN | Locked for edit or delete. |
| `locked_actions` | `lockedActions` | JSON | Maps an action such as `edit`, `delete` or `clone` to the reasons it is restricted. |
| `is_upsertable` | `isUpsertable` | BOOLEAN | Whether the model can be edited. False when it contains non-queryable entities. |
| `has_unmapped` | `hasUnmapped` | BOOLEAN | The model contains unmapped definitions. |
| `is_partial_sdm` | `isPartialSdm` | BOOLEAN | The model is partial because of data governance. |
| `agent_enabled` | `agentEnabled` | BOOLEAN | - |
| `business_preferences` | `businessPreferences` | VARCHAR | - |
| `semantic_model_info` | `semanticModelInfo` | JSON | `definitionsCount`, `maxDefinitionCount`, `modelHierarchyDepth`. |
| `base_models` | `baseModels` | JSON | Models this one extends. |
| `semantic_data_objects` | `semanticDataObjects` | JSON | - |
| `semantic_relationships` | `semanticRelationships` | JSON | - |
| `semantic_calculated_dimensions` | `semanticCalculatedDimensions` | JSON | - |
| `semantic_calculated_measurements` | `semanticCalculatedMeasurements` | JSON | - |
| `semantic_metrics` | `semanticMetrics` | JSON | - |
| `semantic_parameters` | `semanticParameters` | JSON | - |
| `semantic_logical_views` | `semanticLogicalViews` | JSON | - |
| `semantic_groupings` | `semanticGroupings` | JSON | - |
| `created_by` | `createdBy` | VARCHAR | - |
| `created_date` | `createdDate` | TIMESTAMPTZ | - |
| `last_modified_by` | `lastModifiedBy` | VARCHAR | - |
| `last_modified_date` | `lastModifiedDate` | TIMESTAMPTZ | - |

**Notes:** Model changes can affect semantic queries, dashboards and RAG retrievers ([sf-pi](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/registry/operations.json)). A locked model reports the reason in `locked_actions`. The [v65 file](https://github.com/javrrr/tableau-semantics-sdk/blob/main/src/generated/sources/authoring.yaml) also has `PUT` on this path, which replaces the whole model including relationships. No function here maps to it, and it can't create: on a missing `api_name` it returns 404 ([community, one org](https://github.com/javrrr/tableau-semantics-sdk/blob/main/src/resources/semantic-models.ts)).

## sdm_delete

`DELETE /ssot/semantic/models/{id}` · tool `d360_sdm_delete` · evidence S · changes org state

Permanently delete a model and everything in it.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `model_api_name_or_id` | `id` | path | string | yes | Model API name or ID |

```sql
CALL cdp.sdm_delete (model_api_name_or_id => 'AccountRevenue');
```

**Result**

The [v65 file](https://github.com/javrrr/tableau-semantics-sdk/blob/main/src/generated/sources/authoring.yaml) gives HTTP 200 with no body, [sf-pi](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/references/data-shapes.md) gives 204. One row with only the standard columns.

**Notes:** **What goes.** The data objects, relationships, calculated fields and metrics inside it ([catalog](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/runtime/FamilyCatalog.java)). It can't be undone ([v65 file](https://github.com/javrrr/tableau-semantics-sdk/blob/main/src/generated/sources/authoring.yaml)). Afterwards `sdm_get` returns `SEMANTIC_ENTITY_NOT_EXIST` ([sf-pi](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/references/data-shapes.md)).

**What breaks.** Queries that name the model. [sf-pi](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/registry/operations.json) also lists dashboards and RAG retrievers as consumers of model metadata. Check `sdm_dependencies` first, and `is_locked` and `locked_actions` on `sdm_get`.

**The other direction.** A model blocks deleting a calculated insight it references, with a 400 `DELETE_FAILED`. So delete the model first ([community, one org](https://github.com/javrrr/afd360/blob/main/src/resources/semantic-model.ts)).

## sdm_clone

`POST /ssot/semantic/models/{id}/clone` · tool `d360_sdm_clone` · evidence S · changes org state

Copy a model to a new one that can change independently. Use it for variations or experiments.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `model_api_name_or_id` | `id` | path | string | yes | Model API name or ID to clone |
| `api_name` | `apiName` | body | string |  | API name of the new model. |

```sql
CALL cdp.sdm_clone (model_api_name_or_id => 'AccountRevenue', api_name => 'AccountRevenue_Test');
```

**Result**

One row. Other response fields go to `_meta`, including the `semantic...Url` links. Fields are from the official [model schema](https://developer.salesforce.com/docs/data/semantic-layer/guide/salesforce-semantic-model-schema.md).

| Column | API name | Type | Description |
|---|---|---|---|
| `id` | `id` | VARCHAR | Record ID, prefix `2SM` in the official examples. `semantic_model_id` of [`sdm_query`](#sdm_query) takes this. |
| `api_name` | `apiName` | VARCHAR | - |
| `label` | `label` | VARCHAR | - |
| `description` | `description` | VARCHAR | - |
| `dataspace` | `dataspace` | VARCHAR | - |
| `app` | `app` | VARCHAR | - |
| `categories` | `categories` | JSON | Marketing, Commerce, Sales, Service, Other. |
| `currency` | `currency` | JSON | Model default currency. |
| `source_creation` | `sourceCreation` | VARCHAR | - |
| `source_creation_name` | `sourceCreationName` | VARCHAR | - |
| `version_state` | `versionState` | VARCHAR | `Draft`, `Published` or `PublishedWithDraft`. |
| `is_locked` | `isLocked` | BOOLEAN | Locked for edit or delete. |
| `locked_actions` | `lockedActions` | JSON | Maps an action such as `edit`, `delete` or `clone` to the reasons it is restricted. |
| `is_upsertable` | `isUpsertable` | BOOLEAN | Whether the model can be edited. False when it contains non-queryable entities. |
| `has_unmapped` | `hasUnmapped` | BOOLEAN | The model contains unmapped definitions. |
| `is_partial_sdm` | `isPartialSdm` | BOOLEAN | The model is partial because of data governance. |
| `agent_enabled` | `agentEnabled` | BOOLEAN | - |
| `business_preferences` | `businessPreferences` | VARCHAR | - |
| `semantic_model_info` | `semanticModelInfo` | JSON | `definitionsCount`, `maxDefinitionCount`, `modelHierarchyDepth`. |
| `base_models` | `baseModels` | JSON | Models this one extends. |
| `semantic_data_objects` | `semanticDataObjects` | JSON | - |
| `semantic_relationships` | `semanticRelationships` | JSON | - |
| `semantic_calculated_dimensions` | `semanticCalculatedDimensions` | JSON | - |
| `semantic_calculated_measurements` | `semanticCalculatedMeasurements` | JSON | - |
| `semantic_metrics` | `semanticMetrics` | JSON | - |
| `semantic_parameters` | `semanticParameters` | JSON | - |
| `semantic_logical_views` | `semanticLogicalViews` | JSON | - |
| `semantic_groupings` | `semanticGroupings` | JSON | - |
| `created_by` | `createdBy` | VARCHAR | - |
| `created_date` | `createdDate` | TIMESTAMPTZ | - |
| `last_modified_by` | `lastModifiedBy` | VARCHAR | - |
| `last_modified_date` | `lastModifiedDate` | TIMESTAMPTZ | - |

**Notes:** Check that the new `api_name` doesn't already exist ([sf-pi](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/registry/operations.json)). The [v65 file](https://github.com/javrrr/tableau-semantics-sdk/blob/main/src/generated/sources/authoring.yaml) documents the 200 response but no request body, so `api_name` comes from the [tool](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/SdmTools.java). `locked_actions` can restrict `clone`.

## sdm_validate

`GET /ssot/semantic/models/{id}/validate` · tool `d360_sdm_validate` · evidence S · read-only

Check a model's structure and configuration and report errors. Run it after building and before querying.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `model_api_name_or_id` | `id` | path | string | yes | Model API name or ID |

```sql
CALL cdp.sdm_validate (model_api_name_or_id => 'AccountRevenue');
```

**Result**

One row. See the [v65 file](https://github.com/javrrr/tableau-semantics-sdk/blob/main/src/generated/sources/authoring.yaml).

| Column | API name | Type | Description |
|---|---|---|---|
| `is_valid` | `isValid` | BOOLEAN | - |
| `validation` | `validation` | JSON | Validation details. The file doesn't document the shape. |
| `semantic_model` | `semanticModel` | JSON | The validated model. |

**Notes:** This is a `GET`. `POST` returns `METHOD_NOT_ALLOWED` ([sf-pi](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/references/data-shapes.md)).

## sdm_dependencies

`GET /ssot/semantic/models/{id}/external-dependencies` · tool `d360_sdm_dependencies` · evidence S · read-only

List what a model depends on outside itself. Read it before deleting or changing the model or its source objects.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `model_api_name_or_id` | `id` | path | string | yes | Model API name or ID |

```sql
CALL cdp.sdm_dependencies (model_api_name_or_id => 'AccountRevenue');
```

**Result**

The public sources don't document this response. One row, with the response in `_raw`.

**Notes:** Inside a model, each definition has its own `dependencies` list, in the [model schema](https://developer.salesforce.com/docs/data/semantic-layer/guide/salesforce-semantic-model-schema.md).

## sdm_data_object_create

`POST /ssot/semantic/models/{id}/data-objects` · tool `d360_sdm_data_object_create` · evidence S · changes org state

Add an existing DMO, DLO or calculated insight to a model. This is the second build step, and the source object must already exist.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `model_api_name_or_id` | `id` | path | string | yes | Model API name or ID |
| `data_object_name` | `dataObjectName` | body | string | yes | The source object, such as `Account__dlm`. |
| `label` | `label` | body | string | yes | Display name. |
| `data_object_type` | `dataObjectType` | body | string | yes | `Dmo`, `Dlo` or `Cio` (a calculated insight). Not `CalculatedInsight`. |
| `should_include_all_fields` | `shouldIncludeAllFields` | body | boolean | yes | True adds every source field as a dimension or measurement. The entities page and tool text require it, the request class marks it optional. |
| `api_name` | `apiName` | body | string |  | Semantic name of the object. If omitted, the server generates one, see Notes. |
| `description` | `description` | body | string |  | Free text. |
| `table_type` | `tableType` | body | string |  | `Standard`, `Dimension` or `Fact`. |
| `semantic_dimensions` | `semanticDimensions` | body | array of [SemanticDimension](#semanticdimension) |  | Fields to expose as dimensions, when not including all. |
| `semantic_measurements` | `semanticMeasurements` | body | array of [SemanticMeasurement](#semanticmeasurement) |  | Fields to expose as measurements, when not including all. |
| `filters` | `filters` | body | array of [SemanticFilter](#semanticfilter) |  | Restrict the rows this object contributes. |
| `filter_logic` | `filterLogic` | body | string |  | Combines `filters` by 1-based index, such as `1 AND 2`. |
| `allow_unmapped` | `allowUnmapped` | query | boolean |  | Flag to allow unmapped fields |

```sql
CALL cdp.sdm_data_object_create (model_api_name_or_id => 'AccountRevenue', data_object_name => 'ssot__Account__dlm', data_object_type => 'Dmo', api_name => 'Account', label => 'Account', should_include_all_fields => true);
```

**Result**

One row. Other response fields go to `_meta`. See the official [create example](https://developer.salesforce.com/docs/data/semantic-layer/guide/connect-api-in-depth-examples.md) and [model schema](https://developer.salesforce.com/docs/data/semantic-layer/guide/salesforce-semantic-model-schema.md).

| Column | API name | Type | Description |
|---|---|---|---|
| `id` | `id` | VARCHAR | - |
| `api_name` | `apiName` | VARCHAR | Semantic name. Relationships, formulas and queries use this. |
| `label` | `label` | VARCHAR | - |
| `description` | `description` | VARCHAR | - |
| `data_object_name` | `dataObjectName` | VARCHAR | The source object, such as `ssot__Account__dlm`. |
| `data_object_type` | `dataObjectType` | VARCHAR | - |
| `should_include_all_fields` | `shouldIncludeAllFields` | BOOLEAN | - |
| `table_type` | `tableType` | VARCHAR | `Standard`, `Dimension` or `Fact`. |
| `semantic_dimensions` | `semanticDimensions` | JSON | Items have the attributes of [SemanticDimension](#semanticdimension) plus `id` and audit fields. |
| `semantic_measurements` | `semanticMeasurements` | JSON | Items have the attributes of [SemanticMeasurement](#semanticmeasurement) plus `id` and audit fields. |
| `filters` | `filters` | JSON | - |
| `filter_logic` | `filterLogic` | VARCHAR | - |
| `is_queryable` | `isQueryable` | VARCHAR | Whether the query engine can read it. `Queryable` or `NotQueryable` in the model schema, `NonQueryable` in the v65 file. |
| `dependencies` | `dependencies` | JSON | Other definitions and fields this one depends on: `dependentDefinitionApiName`, `dependentFieldApiName`. |
| `created_by` | `createdBy` | VARCHAR | - |
| `created_date` | `createdDate` | TIMESTAMPTZ | - |
| `last_modified_by` | `lastModifiedBy` | VARCHAR | - |
| `last_modified_date` | `lastModifiedDate` | TIMESTAMPTZ | - |

**Notes:** **Read the names back.** Later steps use the semantic names from the response, not `__dlm` or `__c` names. Without an `api_name` the server makes them up: the [official example](https://developer.salesforce.com/docs/data/semantic-layer/guide/connect-api-in-depth-examples.md) sends label `Name0601_do` and gets `Name0601_do19`, and a field labelled `name__c` becomes `name_c`. [sf-pi](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/references/data-shapes.md) sends `api_name` on this call. The tool's request class has only `data_object_name`, `label`, `data_object_type` and `should_include_all_fields`. The other rows come from the official examples and schema.

**`data_object_type` spellings.** The [tool](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/SdmTools.java) and [query guide](https://developer.salesforce.com/docs/data/semantic-layer/guide/query-api-in-depth-data-objects.md) say `Dmo`, `Dlo`, `Cio`. The [official example](https://developer.salesforce.com/docs/data/semantic-layer/guide/connect-api-in-depth-examples.md) sends `DMO` and gets `Dmo` back. The [model schema](https://developer.salesforce.com/docs/data/semantic-layer/guide/salesforce-semantic-model-schema.md) lists only `Dlo` and `Query`.

**Calculated insights.** An `Active` insight isn't usable until its first compute lands. Until then this returns `SEMANTIC_ENTITY_NOT_EXIST`, and a retry can take minutes ([community, one org](https://github.com/javrrr/afd360/blob/main/src/resources/semantic-model.ts)).

**Other limits, all [community, one org](https://github.com/javrrr/afd360/blob/main/src/resources/semantic-model.ts).** A field `api_name` with a space gives a 500, not a 400. A `Currency` measure needs a dimension on `cdp_sys_record_currency__c` with `semantic_data_type => 'RecordCurrency'`. A filter on a raw column is rejected with `Invalid calculated Field`, and filters can't be changed after creation.

**Path.** The [quick start](https://developer.salesforce.com/docs/data/semantic-layer/guide/quick-start-connect-api.md) shows `/tables/`. The examples and the tool use `/data-objects`.

## sdm_data_objects_list

`GET /ssot/semantic/models/{id}/data-objects` · tool `d360_sdm_data_objects_list` · evidence S · read-only

List the data objects in a model with their fields. This is where the semantic field names for relationships and formulas come from.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `model_api_name_or_id` | `id` | path | string | yes | Model API name or ID |

```sql
CALL cdp.sdm_data_objects_list (model_api_name_or_id => 'AccountRevenue');
```

**Result**

The public sources don't document this response. One row, with the response in `_raw`. The wrapper around the list is undocumented. Items have the fields of `semanticDataObject` in the [model schema](https://developer.salesforce.com/docs/data/semantic-layer/guide/salesforce-semantic-model-schema.md), such as `api_name` and `semantic_dimensions`.

**Notes:** Use the field `api_name` values from this output in relationship criteria, for example `Individual_Id18`, not the DMO field names ([tool](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/SdmTools.java)).

## sdm_data_object_get

`GET /ssot/semantic/models/{id}/data-objects/{oid}` · tool `d360_sdm_data_object_get` · evidence S · read-only

Read one data object in a model, with its dimensions and measurements.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `model_api_name_or_id` | `id` | path | string | yes | Model API name or ID |
| `data_object_name_or_id` | `oid` | path | string | yes | Data object name or ID |

```sql
CALL cdp.sdm_data_object_get (model_api_name_or_id => 'AccountRevenue', data_object_name_or_id => 'Account');
```

**Result**

One row. Other response fields go to `_meta`. See the official [create example](https://developer.salesforce.com/docs/data/semantic-layer/guide/connect-api-in-depth-examples.md) and [model schema](https://developer.salesforce.com/docs/data/semantic-layer/guide/salesforce-semantic-model-schema.md).

| Column | API name | Type | Description |
|---|---|---|---|
| `id` | `id` | VARCHAR | - |
| `api_name` | `apiName` | VARCHAR | Semantic name. Relationships, formulas and queries use this. |
| `label` | `label` | VARCHAR | - |
| `description` | `description` | VARCHAR | - |
| `data_object_name` | `dataObjectName` | VARCHAR | The source object, such as `ssot__Account__dlm`. |
| `data_object_type` | `dataObjectType` | VARCHAR | - |
| `should_include_all_fields` | `shouldIncludeAllFields` | BOOLEAN | - |
| `table_type` | `tableType` | VARCHAR | `Standard`, `Dimension` or `Fact`. |
| `semantic_dimensions` | `semanticDimensions` | JSON | Items have the attributes of [SemanticDimension](#semanticdimension) plus `id` and audit fields. |
| `semantic_measurements` | `semanticMeasurements` | JSON | Items have the attributes of [SemanticMeasurement](#semanticmeasurement) plus `id` and audit fields. |
| `filters` | `filters` | JSON | - |
| `filter_logic` | `filterLogic` | VARCHAR | - |
| `is_queryable` | `isQueryable` | VARCHAR | Whether the query engine can read it. `Queryable` or `NotQueryable` in the model schema, `NonQueryable` in the v65 file. |
| `dependencies` | `dependencies` | JSON | Other definitions and fields this one depends on: `dependentDefinitionApiName`, `dependentFieldApiName`. |
| `created_by` | `createdBy` | VARCHAR | - |
| `created_date` | `createdDate` | TIMESTAMPTZ | - |
| `last_modified_by` | `lastModifiedBy` | VARCHAR | - |
| `last_modified_date` | `lastModifiedDate` | TIMESTAMPTZ | - |

## sdm_data_object_update

`PUT /ssot/semantic/models/{id}/data-objects/{oid}` · tool `d360_sdm_data_object_update` · evidence S · changes org state

Change a data object in a model, such as its label or whether it includes all fields.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `model_api_name_or_id` | `id` | path | string | yes | Model API name or ID |
| `data_object_name_or_id` | `oid` | path | string | yes | Data object name or ID |
| `label` | `label` | body | string |  | New display name. |
| `data_object_type` | `dataObjectType` | body | string |  | `Dmo`, `Dlo` or `Cio`. |
| `should_include_all_fields` | `shouldIncludeAllFields` | body | boolean |  | Whether to include all fields of the source. |

```sql
CALL cdp.sdm_data_object_update (model_api_name_or_id => 'AccountRevenue', data_object_name_or_id => 'Account', label => 'Customer Account');
```

**Result**

The public sources don't document this response. One row, with the response in `_raw`.

**Notes:** This is a `PUT`, but the [tool](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/SdmTools.java) sends only the attributes you set. The sources don't say whether omitted attributes are reset. The change can affect dimensions, measurements, relationships and queries ([sf-pi](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/registry/operations.json)).

## sdm_data_object_delete

`DELETE /ssot/semantic/models/{id}/data-objects/{oid}` · tool `d360_sdm_data_object_delete` · evidence S · changes org state

Remove a data object from a model. A data object is only a reference to an existing DMO or calculated insight.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `model_api_name_or_id` | `id` | path | string | yes | Model API name or ID |
| `data_object_name_or_id` | `oid` | path | string | yes | Data object name or ID |
| `relationship_cascade_delete` | `relationshipCascadeDelete` | query | boolean |  | Also delete the relationships that depend on this object. |

```sql
CALL cdp.sdm_data_object_delete (model_api_name_or_id => 'AccountRevenue', data_object_name_or_id => 'Opportunity', relationship_cascade_delete => true);
```

**Result**

The public sources don't document this response. One row, with the response in `_raw`.

**Notes:** This [breaks relationships](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/runtime/FamilyCatalog.java) that use the object, and then [queries that needed that join path fail](https://developer.salesforce.com/docs/data/semantic-layer/guide/query-api-in-depth-relationships.md). The sources don't say what happens without `relationship_cascade_delete`, whether the call is refused or leaves relationships dangling. They also don't say what happens to calculated fields and metrics that name the object. Their `dependencies` lists show which do, in `sdm_get`.

## sdm_dimensions_list

`GET /ssot/semantic/models/{id}/data-objects/{oid}/dimensions` · tool `d360_sdm_dimensions_list` · evidence S · read-only

List the dimensions of one data object in a model, the fields used for grouping and filtering.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `model_api_name_or_id` | `id` | path | string | yes | Model API name or ID |
| `data_object_name_or_id` | `oid` | path | string | yes | Data object name or ID |
| `name` | `name` | query | string |  | Dimension name filter |

```sql
CALL cdp.sdm_dimensions_list (model_api_name_or_id => 'AccountRevenue', data_object_name_or_id => 'Account');
```

**Result**

The public sources don't document this response. One row, with the response in `_raw`. The wrapper around the list is undocumented. Items have the fields of `semanticDimension` in the [model schema](https://developer.salesforce.com/docs/data/semantic-layer/guide/salesforce-semantic-model-schema.md).

**Notes:** The path is under a data object, although the [tool's text](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/SdmTools.java) says "in a specific Semantic Model". There are no create, update or delete functions for fields: they arrive with the data object.

## sdm_measurements_list

`GET /ssot/semantic/models/{id}/data-objects/{oid}/measurements` · tool `d360_sdm_measurements_list` · evidence S · read-only

List the measurements of one data object in a model, the numeric fields a query can aggregate.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `model_api_name_or_id` | `id` | path | string | yes | Model API name or ID |
| `data_object_name_or_id` | `oid` | path | string | yes | Data object name or ID |
| `name` | `name` | query | string |  | Measurement name filter |

```sql
CALL cdp.sdm_measurements_list (model_api_name_or_id => 'AccountRevenue', data_object_name_or_id => 'Account');
```

**Result**

The public sources don't document this response. One row, with the response in `_raw`. The wrapper around the list is undocumented. Items have the fields of `semanticMeasurement` in the [model schema](https://developer.salesforce.com/docs/data/semantic-layer/guide/salesforce-semantic-model-schema.md).

## sdm_calc_dims_list

`GET /ssot/semantic/models/{id}/calculated-dimensions` · tool `d360_sdm_calc_dims_list` · evidence S · read-only

List the calculated dimensions of a model.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `model_api_name_or_id` | `id` | path | string | yes | Model API name or ID |
| `name` | `name` | query | string |  | Calculated dimension name filter |

```sql
CALL cdp.sdm_calc_dims_list (model_api_name_or_id => 'AccountRevenue');
```

**Result**

The public sources don't document this response. One row, with the response in `_raw`. The wrapper around the list is undocumented. Items have the fields of `semanticCalculatedDimension` in the [model schema](https://developer.salesforce.com/docs/data/semantic-layer/guide/salesforce-semantic-model-schema.md).

## sdm_calc_dim_create

`POST /ssot/semantic/models/{id}/calculated-dimensions` · tool `d360_sdm_calc_dim_create` · evidence S · changes org state

Add a calculated dimension: a formula over model fields whose value classifies or groups rows, such as a revenue tier. Its data objects must already be in the model.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `model_api_name_or_id` | `id` | path | string | yes | Model API name or ID |
| `label` | `label` | body | string | yes | Display name. |
| `expression` | `expression` | body | string | yes | Formula. Write it as `$$ ... $$` so its quotes need no escaping. |
| `data_type` | `dataType` | body | string | yes | Text, Date, DateTime, Image, Boolean, Geo or Number on the entities page. The tool lists only Text, Number and DateTime. |
| `api_name` | `apiName` | body | string |  | API name. If you only send `label`, the server generates one: `calcdim19` became `calcdim1965` in the official example. |
| `description` | `description` | body | string |  | Free text. |
| `syntax` | `syntax` | body | string |  | Formula dialect: `Tua` (`[Object].[Field]`) or `Salesforce` (`Object.Field`). |
| `geo_role` | `geoRole` | body | string |  | Airport, Area Code (US), CBSA/MSA (US), City, Congressional District (US), Country/Region, Country, NUTS Europe, Latitude, Longitude, State/Province, Zip Code/Postcode. |
| `sort_order` | `sortOrder` | body | string |  | `Ascending`, `Descending` or `None`. |
| `display_category` | `displayCategory` | body | string |  | `Discrete` or `Continuous`. |
| `is_visible` | `isVisible` | body | boolean |  | Visible in the consumption layer. Default true. |
| `level` | `level` | body | string |  | `Row` or `AggregateFunction` in the model schema. |
| `filters` | `filters` | body | array of [SemanticFilter](#semanticfilter) |  | Scope the data the expression sees. |
| `filter_logic` | `filterLogic` | body | string |  | Combines `filters` by 1-based index, such as `1 AND 2`. |

```sql
CALL cdp.sdm_calc_dim_create (model_api_name_or_id => 'AccountRevenue', label => 'Revenue Tier', api_name => 'Revenue_Tier', data_type => 'Text', expression => $$IF [Account].[AnnualRevenue] > 1000000 THEN 'Enterprise' ELSEIF [Account].[AnnualRevenue] > 100000 THEN 'Mid-Market' ELSE 'SMB' END$$);
```

**Result**

One row. Other response fields go to `_meta`. See the official [create example](https://developer.salesforce.com/docs/data/semantic-layer/guide/connect-api-in-depth-examples.md) and [model schema](https://developer.salesforce.com/docs/data/semantic-layer/guide/salesforce-semantic-model-schema.md).

| Column | API name | Type | Description |
|---|---|---|---|
| `id` | `id` | VARCHAR | - |
| `api_name` | `apiName` | VARCHAR | Queries reference the field by this name through `semantic_field`. |
| `label` | `label` | VARCHAR | - |
| `description` | `description` | VARCHAR | - |
| `expression` | `expression` | VARCHAR | - |
| `syntax` | `syntax` | VARCHAR | `Tua` or `Salesforce`. |
| `data_type` | `dataType` | VARCHAR | - |
| `display_category` | `displayCategory` | VARCHAR | - |
| `geo_role` | `geoRole` | VARCHAR | - |
| `sort_order` | `sortOrder` | VARCHAR | - |
| `is_visible` | `isVisible` | BOOLEAN | - |
| `level` | `level` | VARCHAR | - |
| `filters` | `filters` | JSON | - |
| `filter_logic` | `filterLogic` | VARCHAR | - |
| `is_queryable` | `isQueryable` | VARCHAR | Whether the query engine can read it. `Queryable` or `NotQueryable` in the model schema, `NonQueryable` in the v65 file. |
| `dependencies` | `dependencies` | JSON | Other definitions and fields this one depends on: `dependentDefinitionApiName`, `dependentFieldApiName`. |
| `created_by` | `createdBy` | VARCHAR | - |
| `created_date` | `createdDate` | TIMESTAMPTZ | - |
| `last_modified_by` | `lastModifiedBy` | VARCHAR | - |
| `last_modified_date` | `lastModifiedDate` | TIMESTAMPTZ | - |

**Notes:** **Formula syntax.** Field references are `[DataObject].[Field]`, using semantic `api_name` values, not `{field}` ([tool](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/SdmTools.java)). The other dialect, `syntax => 'Salesforce'`, writes `Object.Field` ([guide](https://developer.salesforce.com/docs/data/semantic-layer/guide/query-api-in-depth-calculated-fields.md)). [One community tool](https://github.com/javrrr/afd360/blob/main/src/resources/semantic-model.ts) writes `[Object.Field]` in single brackets instead (one org, v64). A formula can name other calculated fields, and model parameters as `[Parameters].[name]`. Comments `//` and `/* */` are [ignored](https://developer.salesforce.com/docs/data/semantic-layer/guide/query-api-in-depth-functions.md).

**Conditionals.** Use `IF ... THEN ... ELSEIF ... ELSE ... END`. The tool says not to use `CASE WHEN`. The [function reference](https://developer.salesforce.com/docs/data/semantic-layer/guide/query-api-in-depth-functions.md) has `CASE <expression> WHEN <value> THEN ...` and `IIF(test, then, else)`. Look functions up there or in [`sdm_formula_metadata`](#sdm_formula_metadata).

**Dimensions are row-level.** A dimension isn't aggregated. Of the level-of-detail forms, only `{ FIXED ... }` is [allowed](https://developer.salesforce.com/docs/data/semantic-layer/guide/query-api-in-depth-calculated-fields.md), and it needs the Tua dialect.

The tool's request class has only `label`, `expression`, `data_type`. The other rows come from the [official examples](https://developer.salesforce.com/docs/data/semantic-layer/guide/connect-api-in-depth-examples.md) and [entities page](https://developer.salesforce.com/docs/data/semantic-layer/guide/connect-api-in-depth-entities.md).

## sdm_calc_dim_get

`GET /ssot/semantic/models/{id}/calculated-dimensions/{dimId}` · tool `d360_sdm_calc_dim_get` · evidence S · read-only

Read one calculated dimension, including its formula and dependencies.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `model_api_name_or_id` | `id` | path | string | yes | Model API name or ID |
| `calculated_dimension_name_or_id` | `dimId` | path | string | yes | Calculated dimension name or ID |

```sql
CALL cdp.sdm_calc_dim_get (model_api_name_or_id => 'AccountRevenue', calculated_dimension_name_or_id => 'Revenue_Tier');
```

**Result**

One row. Other response fields go to `_meta`. See the official [create example](https://developer.salesforce.com/docs/data/semantic-layer/guide/connect-api-in-depth-examples.md) and [model schema](https://developer.salesforce.com/docs/data/semantic-layer/guide/salesforce-semantic-model-schema.md).

| Column | API name | Type | Description |
|---|---|---|---|
| `id` | `id` | VARCHAR | - |
| `api_name` | `apiName` | VARCHAR | Queries reference the field by this name through `semantic_field`. |
| `label` | `label` | VARCHAR | - |
| `description` | `description` | VARCHAR | - |
| `expression` | `expression` | VARCHAR | - |
| `syntax` | `syntax` | VARCHAR | `Tua` or `Salesforce`. |
| `data_type` | `dataType` | VARCHAR | - |
| `display_category` | `displayCategory` | VARCHAR | - |
| `geo_role` | `geoRole` | VARCHAR | - |
| `sort_order` | `sortOrder` | VARCHAR | - |
| `is_visible` | `isVisible` | BOOLEAN | - |
| `level` | `level` | VARCHAR | - |
| `filters` | `filters` | JSON | - |
| `filter_logic` | `filterLogic` | VARCHAR | - |
| `is_queryable` | `isQueryable` | VARCHAR | Whether the query engine can read it. `Queryable` or `NotQueryable` in the model schema, `NonQueryable` in the v65 file. |
| `dependencies` | `dependencies` | JSON | Other definitions and fields this one depends on: `dependentDefinitionApiName`, `dependentFieldApiName`. |
| `created_by` | `createdBy` | VARCHAR | - |
| `created_date` | `createdDate` | TIMESTAMPTZ | - |
| `last_modified_by` | `lastModifiedBy` | VARCHAR | - |
| `last_modified_date` | `lastModifiedDate` | TIMESTAMPTZ | - |

## sdm_calc_dim_update

`PUT /ssot/semantic/models/{id}/calculated-dimensions/{dimId}` · tool `d360_sdm_calc_dim_update` · evidence S · changes org state

Change a calculated dimension, usually its formula.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `model_api_name_or_id` | `id` | path | string | yes | Model API name or ID |
| `calculated_dimension_name_or_id` | `dimId` | path | string | yes | Calculated dimension name or ID |
| `label` | `label` | body | string |  | New display name. |
| `expression` | `expression` | body | string |  | Formula. Write it as `$$ ... $$` so its quotes need no escaping. |
| `data_type` | `dataType` | body | string |  | New data type, see [`sdm_calc_dim_create`](#sdm_calc_dim_create). |

```sql
CALL cdp.sdm_calc_dim_update (model_api_name_or_id => 'AccountRevenue', calculated_dimension_name_or_id => 'Revenue_Tier', expression => $$IF [Account].[AnnualRevenue] > 5000000 THEN 'Enterprise' ELSE 'SMB' END$$);
```

**Result**

The public sources don't document this response. One row, with the response in `_raw`.

**Notes:** This is a `PUT`, but the [tool](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/SdmTools.java) sends only the attributes you set. The sources don't say whether omitted attributes are reset. Check the formula against [`sdm_formula_metadata`](#sdm_formula_metadata) first ([sf-pi](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/registry/operations.json)).

## sdm_calc_dim_delete

`DELETE /ssot/semantic/models/{id}/calculated-dimensions/{dimId}` · tool `d360_sdm_calc_dim_delete` · evidence S · changes org state

Delete a calculated dimension from a model.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `model_api_name_or_id` | `id` | path | string | yes | Model API name or ID |
| `calculated_dimension_name_or_id` | `dimId` | path | string | yes | Calculated dimension name or ID |
| `relationship_cascade_delete` | `relationshipCascadeDelete` | query | boolean |  | Also delete the relationships that depend on this field. |

```sql
CALL cdp.sdm_calc_dim_delete (model_api_name_or_id => 'AccountRevenue', calculated_dimension_name_or_id => 'Revenue_Tier');
```

**Result**

The public sources don't document this response. One row, with the response in `_raw`.

**Notes:** A relationship criterion [can name a calculated field](https://developer.salesforce.com/docs/data/semantic-layer/guide/query-api-in-depth-relationships.md) with `SemanticField`, which is how a relationship can depend on this. Metrics can use one as their time dimension ([entities](https://developer.salesforce.com/docs/data/semantic-layer/guide/connect-api-in-depth-entities.md)), and other formulas can name it. The sources don't say whether the delete is refused or leaves them broken. Their `dependencies` lists show which do, in `sdm_get`.

## sdm_calc_measures_list

`GET /ssot/semantic/models/{id}/calculated-measurements` · tool `d360_sdm_calc_measures_list` · evidence S · read-only

List the calculated measurements of a model.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `model_api_name_or_id` | `id` | path | string | yes | Model API name or ID |
| `name` | `name` | query | string |  | Calculated measurement name filter |

```sql
CALL cdp.sdm_calc_measures_list (model_api_name_or_id => 'AccountRevenue');
```

**Result**

The public sources don't document this response. One row, with the response in `_raw`. The wrapper around the list is undocumented. Items have the fields of `semanticCalculatedMeasurement` in the [model schema](https://developer.salesforce.com/docs/data/semantic-layer/guide/salesforce-semantic-model-schema.md).

## sdm_calc_measure_create

`POST /ssot/semantic/models/{id}/calculated-measurements` · tool `d360_sdm_calc_measure_create` · evidence S · changes org state

Add a calculated measurement: a numeric formula over model fields, computed at query time, such as total pipeline. Metrics usually build on these.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `model_api_name_or_id` | `id` | path | string | yes | Model API name or ID |
| `label` | `label` | body | string | yes | Display name. |
| `expression` | `expression` | body | string | yes | Formula. Write it as `$$ ... $$` so its quotes need no escaping. |
| `data_type` | `dataType` | body | string | yes | Usually `Number`. Currency, Number, Duration or Percentage on the entities page. |
| `aggregation_type` | `aggregationType` | body | string | yes | Sum, Average, Min, Max, Median, Count, Count Distinct, Stddev, Stddevp, Var, Varp, First, Last, UserAgg, None. Use `UserAgg` when the formula aggregates itself. |
| `decimal_place` | `decimalPlace` | body | integer |  | Decimal places to display. The entities page marks it required, the tool's request class leaves it out. |
| `api_name` | `apiName` | body | string |  | API name. If you only send `label`, the server generates one: `calcMeasurement` became `calcMeasurement225` in the official example. |
| `description` | `description` | body | string |  | Free text. |
| `syntax` | `syntax` | body | string |  | Formula dialect: `Tua` (`[Object].[Field]`) or `Salesforce` (`Object.Field`). |
| `level` | `level` | body | string |  | `Row` or `AggregateFunction` in the model schema. The functions page also shows `TableCalc`. |
| `total_aggregation_type` | `totalAggregationType` | body | string |  | Aggregation for totals. The enum is the same as `aggregation_type` without `UserAgg` and `CountDistinct`. |
| `sort_order` | `sortOrder` | body | string |  | `Ascending`, `Descending` or `None`. |
| `display_category` | `displayCategory` | body | string |  | `Discrete` or `Continuous`. |
| `directionality` | `directionality` | body | string |  | Whether an upward trend is good (`Up`) or a downward one (`Down`). |
| `should_treat_nulls_as_zeros` | `shouldTreatNullsAsZeros` | body | boolean |  | Treat nulls as zero. |
| `is_visible` | `isVisible` | body | boolean |  | Visible in the consumption layer. Default true. |
| `filters` | `filters` | body | array of [SemanticFilter](#semanticfilter) |  | Scope the data the expression sees. |
| `filter_logic` | `filterLogic` | body | string |  | Combines `filters` by 1-based index, such as `1 AND 2`. |

```sql
CALL cdp.sdm_calc_measure_create (model_api_name_or_id => 'AccountRevenue', label => 'Total Pipeline', api_name => 'Total_Pipeline', data_type => 'Number', aggregation_type => 'UserAgg', decimal_place => 2, expression => $$SUM([Opportunity].[Amount])$$);
```

**Result**

One row. Other response fields go to `_meta`. See the official [create example](https://developer.salesforce.com/docs/data/semantic-layer/guide/connect-api-in-depth-examples.md) and [model schema](https://developer.salesforce.com/docs/data/semantic-layer/guide/salesforce-semantic-model-schema.md).

| Column | API name | Type | Description |
|---|---|---|---|
| `id` | `id` | VARCHAR | - |
| `api_name` | `apiName` | VARCHAR | Queries reference the field by this name through `semantic_field`. |
| `label` | `label` | VARCHAR | - |
| `description` | `description` | VARCHAR | - |
| `expression` | `expression` | VARCHAR | - |
| `syntax` | `syntax` | VARCHAR | `Tua` or `Salesforce`. |
| `data_type` | `dataType` | VARCHAR | - |
| `aggregation_type` | `aggregationType` | VARCHAR | - |
| `total_aggregation_type` | `totalAggregationType` | VARCHAR | - |
| `decimal_place` | `decimalPlace` | INTEGER | - |
| `is_aggregatable` | `isAggregatable` | BOOLEAN | - |
| `directionality` | `directionality` | VARCHAR | `Up` or `Down`. |
| `display_category` | `displayCategory` | VARCHAR | - |
| `should_treat_nulls_as_zeros` | `shouldTreatNullsAsZeros` | BOOLEAN | - |
| `sort_order` | `sortOrder` | VARCHAR | - |
| `is_visible` | `isVisible` | BOOLEAN | - |
| `level` | `level` | VARCHAR | - |
| `filters` | `filters` | JSON | - |
| `filter_logic` | `filterLogic` | VARCHAR | - |
| `is_queryable` | `isQueryable` | VARCHAR | Whether the query engine can read it. `Queryable` or `NotQueryable` in the model schema, `NonQueryable` in the v65 file. |
| `dependencies` | `dependencies` | JSON | Other definitions and fields this one depends on: `dependentDefinitionApiName`, `dependentFieldApiName`. |
| `created_by` | `createdBy` | VARCHAR | - |
| `created_date` | `createdDate` | TIMESTAMPTZ | - |
| `last_modified_by` | `lastModifiedBy` | VARCHAR | - |
| `last_modified_date` | `lastModifiedDate` | TIMESTAMPTZ | - |

**Notes:** **`aggregation_type`.** `UserAgg` is required for any formula with an aggregation function such as `SUM` or `COUNT` ([tool](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/SdmTools.java)). The [query guide](https://developer.salesforce.com/docs/data/semantic-layer/guide/query-api-in-depth-functions.md) says the same at query time. The other way round, a row-level formula with `UserAgg` is rejected with `does not support userAgg` ([community, one org](https://github.com/javrrr/afd360/blob/main/src/resources/semantic-model.ts)). An [official row-level example](https://developer.salesforce.com/docs/data/semantic-layer/guide/query-api-in-depth-functions.md) uses `Sum` with `level => 'Row'`.

**Spellings conflict.** The [entities page](https://developer.salesforce.com/docs/data/semantic-layer/guide/connect-api-in-depth-entities.md) has `Average` and `Count Distinct`, the [model schema](https://developer.salesforce.com/docs/data/semantic-layer/guide/salesforce-semantic-model-schema.md) `Avg` and `CountDistinct`. `Avg` was rejected with `Invalid Semantic Aggregation Type` ([community, one org](https://github.com/javrrr/afd360/blob/main/src/resources/semantic-model.ts)).

**Formula.** Same syntax as [`sdm_calc_dim_create`](#sdm_calc_dim_create). The tool suggests `IIF(condition, true_val, false_val)` for inline conditionals. A level-of-detail expression can use `FIXED`, `INCLUDE` or `EXCLUDE`, nested [up to six levels](https://developer.salesforce.com/docs/data/semantic-layer/guide/query-api-in-depth-calculated-fields.md). Each adds a subquery.

The tool's request class has only `label`, `expression`, `data_type`, `aggregation_type`. The other rows come from the [official examples](https://developer.salesforce.com/docs/data/semantic-layer/guide/connect-api-in-depth-examples.md) and [entities page](https://developer.salesforce.com/docs/data/semantic-layer/guide/connect-api-in-depth-entities.md).

## sdm_calc_measure_get

`GET /ssot/semantic/models/{id}/calculated-measurements/{mid}` · tool `d360_sdm_calc_measure_get` · evidence S · read-only

Read one calculated measurement, including its formula and dependencies.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `model_api_name_or_id` | `id` | path | string | yes | Model API name or ID |
| `calculated_measurement_name_or_id` | `mid` | path | string | yes | Calculated measurement name or ID |

```sql
CALL cdp.sdm_calc_measure_get (model_api_name_or_id => 'AccountRevenue', calculated_measurement_name_or_id => 'Total_Pipeline');
```

**Result**

One row. Other response fields go to `_meta`. See the official [create example](https://developer.salesforce.com/docs/data/semantic-layer/guide/connect-api-in-depth-examples.md) and [model schema](https://developer.salesforce.com/docs/data/semantic-layer/guide/salesforce-semantic-model-schema.md).

| Column | API name | Type | Description |
|---|---|---|---|
| `id` | `id` | VARCHAR | - |
| `api_name` | `apiName` | VARCHAR | Queries reference the field by this name through `semantic_field`. |
| `label` | `label` | VARCHAR | - |
| `description` | `description` | VARCHAR | - |
| `expression` | `expression` | VARCHAR | - |
| `syntax` | `syntax` | VARCHAR | `Tua` or `Salesforce`. |
| `data_type` | `dataType` | VARCHAR | - |
| `aggregation_type` | `aggregationType` | VARCHAR | - |
| `total_aggregation_type` | `totalAggregationType` | VARCHAR | - |
| `decimal_place` | `decimalPlace` | INTEGER | - |
| `is_aggregatable` | `isAggregatable` | BOOLEAN | - |
| `directionality` | `directionality` | VARCHAR | `Up` or `Down`. |
| `display_category` | `displayCategory` | VARCHAR | - |
| `should_treat_nulls_as_zeros` | `shouldTreatNullsAsZeros` | BOOLEAN | - |
| `sort_order` | `sortOrder` | VARCHAR | - |
| `is_visible` | `isVisible` | BOOLEAN | - |
| `level` | `level` | VARCHAR | - |
| `filters` | `filters` | JSON | - |
| `filter_logic` | `filterLogic` | VARCHAR | - |
| `is_queryable` | `isQueryable` | VARCHAR | Whether the query engine can read it. `Queryable` or `NotQueryable` in the model schema, `NonQueryable` in the v65 file. |
| `dependencies` | `dependencies` | JSON | Other definitions and fields this one depends on: `dependentDefinitionApiName`, `dependentFieldApiName`. |
| `created_by` | `createdBy` | VARCHAR | - |
| `created_date` | `createdDate` | TIMESTAMPTZ | - |
| `last_modified_by` | `lastModifiedBy` | VARCHAR | - |
| `last_modified_date` | `lastModifiedDate` | TIMESTAMPTZ | - |

## sdm_calc_measure_update

`PUT /ssot/semantic/models/{id}/calculated-measurements/{mid}` · tool `d360_sdm_calc_measure_update` · evidence S · changes org state

Change a calculated measurement, usually its formula or aggregation.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `model_api_name_or_id` | `id` | path | string | yes | Model API name or ID |
| `calculated_measurement_name_or_id` | `mid` | path | string | yes | Calculated measurement name or ID |
| `label` | `label` | body | string |  | New display name. |
| `expression` | `expression` | body | string |  | Formula. Write it as `$$ ... $$` so its quotes need no escaping. |
| `data_type` | `dataType` | body | string |  | New data type, see [`sdm_calc_measure_create`](#sdm_calc_measure_create). |
| `aggregation_type` | `aggregationType` | body | string |  | New aggregation, see [`sdm_calc_measure_create`](#sdm_calc_measure_create). |

```sql
CALL cdp.sdm_calc_measure_update (model_api_name_or_id => 'AccountRevenue', calculated_measurement_name_or_id => 'Total_Pipeline', expression => $$SUM(IIF([Opportunity].[IsClosed], 0, [Opportunity].[Amount]))$$);
```

**Result**

The public sources don't document this response. One row, with the response in `_raw`.

**Notes:** This is a `PUT`, but the [tool](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/SdmTools.java) sends only the attributes you set. The sources don't say whether omitted attributes are reset. Check the metrics and queries that use the measurement first ([sf-pi](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/registry/operations.json)).

## sdm_calc_measure_delete

`DELETE /ssot/semantic/models/{id}/calculated-measurements/{mid}` · tool `d360_sdm_calc_measure_delete` · evidence S · changes org state

Delete a calculated measurement from a model.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `model_api_name_or_id` | `id` | path | string | yes | Model API name or ID |
| `calculated_measurement_name_or_id` | `mid` | path | string | yes | Calculated measurement name or ID |
| `relationship_cascade_delete` | `relationshipCascadeDelete` | query | boolean |  | Also delete the relationships that depend on this field. |

```sql
CALL cdp.sdm_calc_measure_delete (model_api_name_or_id => 'AccountRevenue', calculated_measurement_name_or_id => 'Total_Pipeline');
```

**Result**

The public sources don't document this response. One row, with the response in `_raw`.

**Notes:** Metrics [evaluate a calculated measurement or a field](https://developer.salesforce.com/docs/data/semantic-layer/guide/salesforce-semantic-model-schema.md), other formulas can name it, and relationship criteria [can reference one](https://developer.salesforce.com/docs/data/semantic-layer/guide/query-api-in-depth-relationships.md). The sources don't say whether the delete is refused or leaves them broken. Their `dependencies` lists show which do, in `sdm_get`.

## sdm_metrics_list

`GET /ssot/semantic/models/{id}/metrics` · tool `d360_sdm_metrics_list` · evidence S · read-only

List the metrics of a model.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `model_api_name_or_id` | `id` | path | string | yes | Model API name or ID |

```sql
CALL cdp.sdm_metrics_list (model_api_name_or_id => 'AccountRevenue');
```

**Result**

The public sources don't document this response. One row, with the response in `_raw`. The wrapper around the list is undocumented. Items have the fields of `semanticMetric` in the [model schema](https://developer.salesforce.com/docs/data/semantic-layer/guide/salesforce-semantic-model-schema.md).

## sdm_metric_create

`POST /ssot/semantic/models/{id}/metrics` · tool `d360_sdm_metric_create` · evidence S · changes org state

Add a metric: a business KPI tracked over time, made of one measurement, one time field and allowed time grains. It comes last in a build, because it references fields that must exist.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `model_api_name_or_id` | `id` | path | string | yes | Model API name or ID |
| `name` | `name` | body | string | yes | API name of the metric. |
| `label` | `label` | body | string | yes | Display name. |
| `definition` | `definition` | body | [SemanticMetricDefinition](#semanticmetricdefinition) | yes | What the metric measures. |

```sql
CALL cdp.sdm_metric_create (model_api_name_or_id => 'AccountRevenue', name => 'Annual_Revenue_md', label => 'Annual Revenue', definition => (measurement_reference = (table_field_reference = (field_api_name = 'AnnualRevenue', table_api_name = 'Account')), time_dimension_reference = (table_field_reference = (field_api_name = 'CreatedDate', table_api_name = 'Account')), aggregation_type = 'Sum', time_grains = ['Month', 'Quarter'], additional_dimensions = [(table_field_reference = (field_api_name = 'Region', table_api_name = 'Account'))]));
```

**Result**

One row. Other response fields go to `_meta`. Fields are from the official [model schema](https://developer.salesforce.com/docs/data/semantic-layer/guide/salesforce-semantic-model-schema.md).

| Column | API name | Type | Description |
|---|---|---|---|
| `id` | `id` | VARCHAR | - |
| `api_name` | `apiName` | VARCHAR | `metric_api_name` of a metric query. |
| `label` | `label` | VARCHAR | - |
| `description` | `description` | VARCHAR | - |
| `measurement_reference` | `measurementReference` | JSON | The calculated measurement or field the metric evaluates. |
| `time_dimension_reference` | `timeDimensionReference` | JSON | The time field. |
| `additional_dimensions` | `additionalDimensions` | JSON | Dimensions usable as filters. |
| `time_grains` | `timeGrains` | JSON | Time grains allowed in a query. |
| `insights_settings` | `insightsSettings` | JSON | - |
| `filters` | `filters` | JSON | - |
| `filter_logic` | `filterLogic` | VARCHAR | - |
| `aggregation_type` | `aggregationType` | VARCHAR | - |
| `is_cumulative` | `isCumulative` | BOOLEAN | - |
| `is_goal_editing_blocked` | `isGoalEditingBlocked` | BOOLEAN | - |
| `is_queryable` | `isQueryable` | VARCHAR | Whether the query engine can read it. `Queryable` or `NotQueryable` in the model schema, `NonQueryable` in the v65 file. |
| `dependencies` | `dependencies` | JSON | Other definitions and fields this one depends on: `dependentDefinitionApiName`, `dependentFieldApiName`. |
| `created_by` | `createdBy` | VARCHAR | - |
| `created_date` | `createdDate` | TIMESTAMPTZ | - |
| `last_modified_by` | `lastModifiedBy` | VARCHAR | - |
| `last_modified_date` | `lastModifiedDate` | TIMESTAMPTZ | - |

**Notes:** **Shape conflict.** The [tool](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/SdmTools.java) sends `name`, `label` and a `definition` object, and its source has no example of `definition`. No source shows this call's body. The [SemanticMetricDefinition](#semanticmetricdefinition) attributes come from the [model schema](https://developer.salesforce.com/docs/data/semantic-layer/guide/salesforce-semantic-model-schema.md) and the metric inside an [inline model](https://developer.salesforce.com/docs/data/semantic-layer/guide/metric-query-api-in-depth-overview.md), which have them directly on the metric and use `api_name`, not `name`. So they may belong at the top level of this call. The inline example also writes `table_field_reference` where the schema has `measurement_reference`.

**Required by the [entities page](https://developer.salesforce.com/docs/data/semantic-layer/guide/connect-api-in-depth-entities.md).** A time dimension, a measurement and allowed time grains. It also marks filters and filter logic required, though the inline example has neither.

**Querying.** A metric is read through a [Semantic Metric Query](https://developer.salesforce.com/docs/data/semantic-layer/guide/metric-query-api-in-depth-overview.md) (`structuredMetricQuery`), not `structured_semantic_query`. The guide says it goes to "a gateway service" without naming a path, and no function here covers it.

## sdm_metric_get

`GET /ssot/semantic/models/{id}/metrics/{mid}` · tool `d360_sdm_metric_get` · evidence S · read-only

Read one metric.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `model_api_name_or_id` | `id` | path | string | yes | Model API name or ID |
| `metric_name_or_id` | `mid` | path | string | yes | Metric name or ID |

```sql
CALL cdp.sdm_metric_get (model_api_name_or_id => 'AccountRevenue', metric_name_or_id => 'Annual_Revenue_md');
```

**Result**

One row. Other response fields go to `_meta`. Fields are from the official [model schema](https://developer.salesforce.com/docs/data/semantic-layer/guide/salesforce-semantic-model-schema.md).

| Column | API name | Type | Description |
|---|---|---|---|
| `id` | `id` | VARCHAR | - |
| `api_name` | `apiName` | VARCHAR | `metric_api_name` of a metric query. |
| `label` | `label` | VARCHAR | - |
| `description` | `description` | VARCHAR | - |
| `measurement_reference` | `measurementReference` | JSON | The calculated measurement or field the metric evaluates. |
| `time_dimension_reference` | `timeDimensionReference` | JSON | The time field. |
| `additional_dimensions` | `additionalDimensions` | JSON | Dimensions usable as filters. |
| `time_grains` | `timeGrains` | JSON | Time grains allowed in a query. |
| `insights_settings` | `insightsSettings` | JSON | - |
| `filters` | `filters` | JSON | - |
| `filter_logic` | `filterLogic` | VARCHAR | - |
| `aggregation_type` | `aggregationType` | VARCHAR | - |
| `is_cumulative` | `isCumulative` | BOOLEAN | - |
| `is_goal_editing_blocked` | `isGoalEditingBlocked` | BOOLEAN | - |
| `is_queryable` | `isQueryable` | VARCHAR | Whether the query engine can read it. `Queryable` or `NotQueryable` in the model schema, `NonQueryable` in the v65 file. |
| `dependencies` | `dependencies` | JSON | Other definitions and fields this one depends on: `dependentDefinitionApiName`, `dependentFieldApiName`. |
| `created_by` | `createdBy` | VARCHAR | - |
| `created_date` | `createdDate` | TIMESTAMPTZ | - |
| `last_modified_by` | `lastModifiedBy` | VARCHAR | - |
| `last_modified_date` | `lastModifiedDate` | TIMESTAMPTZ | - |

## sdm_metric_update

`PUT /ssot/semantic/models/{id}/metrics/{mid}` · tool `d360_sdm_metric_update` · evidence S · changes org state

Change a metric.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `model_api_name_or_id` | `id` | path | string | yes | Model API name or ID |
| `metric_name_or_id` | `mid` | path | string | yes | Metric name or ID |
| `name` | `name` | body | string |  | New API name. |
| `label` | `label` | body | string |  | New display name. |
| `definition` | `definition` | body | [SemanticMetricDefinition](#semanticmetricdefinition) |  | New definition. |

```sql
CALL cdp.sdm_metric_update (model_api_name_or_id => 'AccountRevenue', metric_name_or_id => 'Annual_Revenue_md', label => 'Annual Revenue (booked)');
```

**Result**

The public sources don't document this response. One row, with the response in `_raw`.

**Notes:** Metric changes can affect BI and semantic query consumers ([sf-pi](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/registry/operations.json)). The shape of `definition` is unsettled, see [`sdm_metric_create`](#sdm_metric_create).

## sdm_metric_delete

`DELETE /ssot/semantic/models/{id}/metrics/{mid}` · tool `d360_sdm_metric_delete` · evidence S · changes org state

Delete a metric from a model.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `model_api_name_or_id` | `id` | path | string | yes | Model API name or ID |
| `metric_name_or_id` | `mid` | path | string | yes | Metric name or ID |

```sql
CALL cdp.sdm_metric_delete (model_api_name_or_id => 'AccountRevenue', metric_name_or_id => 'Annual_Revenue_md');
```

**Result**

The public sources don't document this response. One row, with the response in `_raw`.

**Notes:** Metric queries name a metric by [`metric_api_name`](https://developer.salesforce.com/docs/data/semantic-layer/guide/metric-query-api-in-depth-fields.md), so they stop resolving. The sources don't describe other effects.

## sdm_relationships_list

`GET /ssot/semantic/models/{id}/relationships` · tool `d360_sdm_relationships_list` · evidence S · read-only

List the joins defined between data objects in a model, including those imported from existing Data 360 relationships.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `model_api_name_or_id` | `id` | path | string | yes | Model API name or ID |

```sql
CALL cdp.sdm_relationships_list (model_api_name_or_id => 'AccountRevenue');
```

**Result**

The public sources don't document this response. One row, with the response in `_raw`. The wrapper around the list is undocumented. Items have the fields of `semanticRelationship` in the [model schema](https://developer.salesforce.com/docs/data/semantic-layer/guide/salesforce-semantic-model-schema.md).

## sdm_relationship_create

`POST /ssot/semantic/models/{id}/relationships` · tool `d360_sdm_relationship_create` · evidence S · changes org state

Define the join between two data objects in a model. A query across objects needs a path of these. Add it once both data objects are in the model.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `model_api_name_or_id` | `id` | path | string | yes | Model API name or ID |
| `label` | `label` | body | string | yes | Display name. |
| `left_semantic_definition_api_name` | `leftSemanticDefinitionApiName` | body | string | yes | Semantic `api_name` of the left data object. |
| `right_semantic_definition_api_name` | `rightSemanticDefinitionApiName` | body | string | yes | Semantic `api_name` of the right data object. |
| `cardinality` | `cardinality` | body | string | yes | `OneToOne`, `OneToMany`, `ManyToOne`, `ManyToMany` or `Unspecified`. The tool requires it, the guide calls it optional. |
| `criteria` | `criteria` | body | array of [SemanticRelationshipCriterion](#semanticrelationshipcriterion) |  | Join conditions. The tool marks it optional, the entities page and schema required. |
| `join_type` | `joinType` | body | string |  | `Auto` (the default), `Inner`, `Left`, `Right` or `Full`. |
| `api_name` | `apiName` | body | string |  | API name of the relationship. |
| `is_enabled` | `isEnabled` | body | boolean |  | Whether the relationship is active. |

```sql
CALL cdp.sdm_relationship_create (model_api_name_or_id => 'AccountRevenue', label => 'Account to Opportunity', left_semantic_definition_api_name => 'Account', right_semantic_definition_api_name => 'Opportunity', cardinality => 'OneToMany', join_type => 'Auto', criteria => [(join_operator = 'Equals', left_field_type = 'TableField', left_semantic_field_api_name = 'Account_Id', right_field_type = 'TableField', right_semantic_field_api_name = 'AccountId')]);
```

**Result**

One row. Other response fields go to `_meta`. Fields are from the official [model schema](https://developer.salesforce.com/docs/data/semantic-layer/guide/salesforce-semantic-model-schema.md).

| Column | API name | Type | Description |
|---|---|---|---|
| `id` | `id` | VARCHAR | - |
| `api_name` | `apiName` | VARCHAR | - |
| `label` | `label` | VARCHAR | - |
| `description` | `description` | VARCHAR | - |
| `left_semantic_definition_api_name` | `leftSemanticDefinitionApiName` | VARCHAR | - |
| `right_semantic_definition_api_name` | `rightSemanticDefinitionApiName` | VARCHAR | - |
| `criteria` | `criteria` | JSON | Items have the attributes of [SemanticRelationshipCriterion](#semanticrelationshipcriterion). |
| `cardinality` | `cardinality` | VARCHAR | - |
| `join_type` | `joinType` | VARCHAR | - |
| `is_enabled` | `isEnabled` | BOOLEAN | - |
| `is_queryable` | `isQueryable` | VARCHAR | Whether the query engine can read it. `Queryable` or `NotQueryable` in the model schema, `NonQueryable` in the v65 file. |
| `dependencies` | `dependencies` | JSON | Other definitions and fields this one depends on: `dependentDefinitionApiName`, `dependentFieldApiName`. |
| `created_by` | `createdBy` | VARCHAR | - |
| `created_date` | `createdDate` | TIMESTAMPTZ | - |
| `last_modified_by` | `lastModifiedBy` | VARCHAR | - |
| `last_modified_date` | `lastModifiedDate` | TIMESTAMPTZ | - |

**Notes:** **Names.** Use the semantic field names from [`sdm_data_objects_list`](#sdm_data_objects_list), such as `Individual_Id18`, not DMO field names ([tool](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/SdmTools.java)).

**Rules** from the [guide](https://developer.salesforce.com/docs/data/semantic-layer/guide/query-api-in-depth-relationships.md). At most one relationship between any pair of objects, including ones imported at creation, so read the list first. The graph must be acyclic. Both sides of a criterion must have the same data type, and can't be aggregates. A `Formula` side is row-level only.

**Conflicts.** The [tool's request class](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/model/request/sdm/SdmRelationshipCreateRequest.java) says join_type `Inner` or `LeftOuter`, its text says `Auto`, and the [entities page](https://developer.salesforce.com/docs/data/semantic-layer/guide/connect-api-in-depth-entities.md) lists the values above. [One community tool](https://github.com/javrrr/afd360/blob/main/src/resources/semantic-model.ts) found every value but `Auto` rejected outside logical views (one org), yet the [official guide](https://developer.salesforce.com/docs/data/semantic-layer/guide/query-api-in-depth-relationships.md) shows `Left`. The tool also [parses](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/SdmTools.java) `criteria` into a single object, while its [own example](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/resources/metadata/payload-examples.json) and the schema use an array.

Accurate `cardinality` lets the engine [skip a deduplication pass](https://developer.salesforce.com/docs/data/semantic-layer/guide/query-api-in-depth-grouping.md). Prefer `Equals`: case-insensitive and range operators [can't use a hash join](https://developer.salesforce.com/docs/data/semantic-layer/guide/query-api-in-depth-relationships.md).

## sdm_relationship_get

`GET /ssot/semantic/models/{id}/relationships/{rid}` · tool `d360_sdm_relationship_get` · evidence S · read-only

Read one relationship, including its join criteria.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `model_api_name_or_id` | `id` | path | string | yes | Model API name or ID |
| `relationship_name_or_id` | `rid` | path | string | yes | Relationship name or ID |

```sql
CALL cdp.sdm_relationship_get (model_api_name_or_id => 'AccountRevenue', relationship_name_or_id => 'Account_to_Opportunity');
```

**Result**

One row. Other response fields go to `_meta`. Fields are from the official [model schema](https://developer.salesforce.com/docs/data/semantic-layer/guide/salesforce-semantic-model-schema.md).

| Column | API name | Type | Description |
|---|---|---|---|
| `id` | `id` | VARCHAR | - |
| `api_name` | `apiName` | VARCHAR | - |
| `label` | `label` | VARCHAR | - |
| `description` | `description` | VARCHAR | - |
| `left_semantic_definition_api_name` | `leftSemanticDefinitionApiName` | VARCHAR | - |
| `right_semantic_definition_api_name` | `rightSemanticDefinitionApiName` | VARCHAR | - |
| `criteria` | `criteria` | JSON | Items have the attributes of [SemanticRelationshipCriterion](#semanticrelationshipcriterion). |
| `cardinality` | `cardinality` | VARCHAR | - |
| `join_type` | `joinType` | VARCHAR | - |
| `is_enabled` | `isEnabled` | BOOLEAN | - |
| `is_queryable` | `isQueryable` | VARCHAR | Whether the query engine can read it. `Queryable` or `NotQueryable` in the model schema, `NonQueryable` in the v65 file. |
| `dependencies` | `dependencies` | JSON | Other definitions and fields this one depends on: `dependentDefinitionApiName`, `dependentFieldApiName`. |
| `created_by` | `createdBy` | VARCHAR | - |
| `created_date` | `createdDate` | TIMESTAMPTZ | - |
| `last_modified_by` | `lastModifiedBy` | VARCHAR | - |
| `last_modified_date` | `lastModifiedDate` | TIMESTAMPTZ | - |

## sdm_relationship_update

`PUT /ssot/semantic/models/{id}/relationships/{rid}` · tool `d360_sdm_relationship_update` · evidence S · changes org state

Change a relationship's join criteria, cardinality or join type.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `model_api_name_or_id` | `id` | path | string | yes | Model API name or ID |
| `relationship_name_or_id` | `rid` | path | string | yes | Relationship name or ID |
| `label` | `label` | body | string |  | New display name. |
| `cardinality` | `cardinality` | body | string |  | `OneToOne`, `OneToMany`, `ManyToOne`, `ManyToMany` or `Unspecified`. |
| `criteria` | `criteria` | body | array of [SemanticRelationshipCriterion](#semanticrelationshipcriterion) |  | New join conditions. |
| `join_type` | `joinType` | body | string |  | `Auto` (the default), `Inner`, `Left`, `Right` or `Full`. |

```sql
CALL cdp.sdm_relationship_update (model_api_name_or_id => 'AccountRevenue', relationship_name_or_id => 'Account_to_Opportunity', cardinality => 'ManyToOne');
```

**Result**

The public sources don't document this response. One row, with the response in `_raw`.

**Notes:** Changes affect joins and query results ([sf-pi](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/registry/operations.json)). Wrong cardinality or criteria [multiply or drop rows](https://developer.salesforce.com/docs/data/semantic-layer/guide/query-api-in-depth-relationships.md). This is a `PUT`, but the [tool](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/SdmTools.java) sends only the attributes you set. The sources don't say whether omitted attributes are reset.

## sdm_relationship_delete

`DELETE /ssot/semantic/models/{id}/relationships/{rid}` · tool `d360_sdm_relationship_delete` · evidence S · changes org state

Delete a relationship from a model.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `model_api_name_or_id` | `id` | path | string | yes | Model API name or ID |
| `relationship_name_or_id` | `rid` | path | string | yes | Relationship name or ID |

```sql
CALL cdp.sdm_relationship_delete (model_api_name_or_id => 'AccountRevenue', relationship_name_or_id => 'Account_to_Opportunity');
```

**Result**

The public sources don't document this response. One row, with the response in `_raw`.

**Notes:** This [breaks queries](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/runtime/FamilyCatalog.java) that need the join. A query over objects with no relationship path [fails](https://developer.salesforce.com/docs/data/semantic-layer/guide/query-api-in-depth-relationships.md). The [entities page](https://developer.salesforce.com/docs/data/semantic-layer/guide/connect-api-in-depth-entities.md) adds a model setting for this case, `UnrelatedDataObjectsQueryBehavior`, with `Exception` and `Union`.

## sdm_formula_metadata

`GET /ssot/semantic/models/formula-metadata` · tool `d360_sdm_formula_metadata` · evidence S · read-only

List the functions the semantic engine supports in formulas. Use it to check a calculated field's formula before saving it.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `model_api_name_or_id` | `modelApiNameOrId` | query | string |  | Model API name or ID |

```sql
CALL cdp.sdm_formula_metadata ();
```

**Result**

The public sources don't document this response. One row, with the response in `_raw`.

**Notes:** The readable version is the [function reference](https://developer.salesforce.com/docs/data/semantic-layer/guide/query-api-in-depth-functions.md), which documents the Tua dialect.

## sdm_permissions

`GET /ssot/semantic/permissions` · tool `d360_sdm_permissions` · evidence S · read-only

Read the semantic layer permissions. The sources don't say more about what it returns.

**Options**

None.

```sql
CALL cdp.sdm_permissions ();
```

**Result**

The public sources don't document this response. One row, with the response in `_raw`.

**Notes:** To query, the org needs [CDP Semantic Query Permissions](https://developer.salesforce.com/docs/data/semantic-layer/guide/quick-start-query-api.md).

## sdm_query

`POST /semantic-engine/gateway` · tool `d360_sdm_query` · evidence S · read-only

Run a query against a semantic model. You name fields, filters and groupings, and the engine works out the joins and SQL, then returns rows. This is the read side of the family.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `structured_semantic_query` | `structuredSemanticQuery` | body | [StructuredSemanticQuery](#structuredsemanticquery) | yes | The query. |
| `semantic_model_api_name` | `semanticModelApiName` | body | string |  | API name of a saved model. The guide's preferred way. Give exactly one of the three model options. |
| `semantic_model_id` | `semanticModelId` | body | string |  | Record ID of a saved model. The guide calls it deprecated, Salesforce's tool uses it. |
| `semantic_model` | `semanticModel` | body | JSON |  | A whole model inline, not saved. Has the attributes of the [model schema](https://developer.salesforce.com/docs/data/semantic-layer/guide/salesforce-semantic-model-schema.md). See Notes. |
| `dataspace` | `dataspace` | body | string |  | Data space to run in. The default data space if omitted. |
| `group_id` | `groupId` | body | string |  | Sends the query as part of this group of queries. |
| `query_parameter` | `queryParameter` | body | string |  | Parameter name and value for parameterized queries. The guide's examples use `parameters` on the query instead. |
| `source` | `source` | body | string |  | Identifies the source of the query. In the [metric guide](https://developer.salesforce.com/docs/data/semantic-layer/guide/metric-query-api-in-depth-fields.md) it is for usage reporting. |

```sql
CALL cdp.sdm_query (
  semantic_model_api_name => 'AccountRevenue',
  structured_semantic_query => (
    fields = [
      (expression = (table_field = (name = 'Region', table_name = 'Account')), alias = 'Region', row_grouping = true),
      (expression = (semantic_field = (name = 'Revenue_Tier')), alias = 'RevenueSegment', row_grouping = true),
      (expression = (table_field = (name = 'AnnualRevenue', table_name = 'Account')), alias = 'TotalRevenue', semantic_aggregation_method = 'SEMANTIC_AGGREGATION_METHOD_SUM')
    ],
    filter = (binary_predicate = (left_expression = (table_field = (name = 'AnnualRevenue', table_name = 'Account')), binary_operator = 'BINARY_OPERATOR_GREATER_THAN', right_expression = (int_expression = 0))),
    options = (limit_options = (limit = 100))
  )
);
```

**Result**

One row per item of `/queryResults/queryData/rows` in the response. Other response fields go to `_meta`: `status`, `queryResults.queryMetadata`. Each row's `values` array is positional, and `queryMetadata.fields.<alias>.placeInOrder` gives each column's place ([v65 file](https://github.com/javrrr/tableau-semantics-sdk/blob/main/src/generated/sources/queries.yaml), [community fixture](https://github.com/javrrr/tableau-semantics-sdk/blob/main/tests/fixtures/semantic-query.response.json)).

| Column | API name | Type | Description |
|---|---|---|---|
| `<alias>` | `<alias>` | From `queryMetadata.fields.<alias>.type`: VARCHAR, or NUMERIC mapped to DOUBLE | One column per query field, named by its `alias`. |

**Notes:** This is a read despite the `POST`. The "changes org state" above comes from the verb. [sf-pi](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/registry/operations.json) treats it as a safe `POST`.

**Naming the model: sources conflict.** The [official guide](https://developer.salesforce.com/docs/data/semantic-layer/guide/query-api-in-depth-overview.md) prefers `semantic_model_api_name` and calls `semantic_model_id` deprecated. [Salesforce's catalog](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/runtime/FamilyCatalog.java) says "Use semantic_model_id not api_name", and the [tool's request class](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/SdmTools.java) has only that. [sf-pi](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/references/data-shapes.md) shows `semantic_model_id` with an ID or API name. [One community SDK](https://github.com/javrrr/tableau-semantics-sdk/blob/main/src/resources/semantic-query.ts) requires `semantic_model_api_name` and found inline `semantic_model` rejected (one org, v65), though the guide documents it.

**Give each field a role.** A dimension sets `row_grouping`, and a measurement sets `semantic_aggregation_method` with the full enum name. Otherwise the field is dropped, with `Query doesn't include select fields` ([community, one org](https://github.com/javrrr/tableau-semantics-sdk/blob/main/src/resources/semantic-query.ts)). The guide's plain row queries instead set `options.detailed_rows`, which disallows aggregates, aggregate filters and level-of-detail expressions ([guide](https://developer.salesforce.com/docs/data/semantic-layer/guide/query-api-in-depth-calculated-fields.md)). Once any field groups, [every other measurement must aggregate](https://developer.salesforce.com/docs/data/semantic-layer/guide/query-api-in-depth-grouping.md).

**Field references.** `table_field` needs `name` and `table_name`, the semantic `api_name` values, not `__dlm` or `__c` names. Calculated fields are model-level: use `semantic_field` with just `name` ([tool](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/SdmTools.java)). Everything must [resolve within the model](https://developer.salesforce.com/docs/data/semantic-layer/guide/query-api-in-depth-overview.md). An aggregation on a formula with its own aggregate must be `SEMANTIC_AGGREGATION_METHOD_USER_AGG`.

**Limit.** `limit` [applies after grouping](https://developer.salesforce.com/docs/data/semantic-layer/guide/query-api-in-depth-sorting-limiting.md), so it caps groups, not source records. Inline formulas exist only for that one query.

**Errors.** A 400 has `error_code` and `message`, and the message lists the queryable fields when a name is wrong ([v65 file](https://github.com/javrrr/tableau-semantics-sdk/blob/main/src/generated/sources/queries.yaml)). [`sdm_validate`](#sdm_validate) first helps ([sf-pi](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/registry/operations.json)).

**Spelling.** Attributes here are camelCase as in the tool's example. The guide says [the API also takes snake_case](https://developer.salesforce.com/docs/data/semantic-layer/guide/query-api-in-depth-overview.md), and most of its examples use it. The guide also shows the same payload through `semantic_query('...')` in the SQL of `query_sql`, which returns a `query_id`.

## Schemas

Attribute names are keywords inside the object they belong to, so completion offers exactly these.

### AggregativeSortOrder

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `grouped_field_alias` | `groupedFieldAlias` | string |  | Alias of the grouped dimension. Give this or `grouped_expression`. |
| `grouped_expression` | `groupedExpression` | [Expression](#expression) |  | The grouped dimension. |
| `sort_by_field` | `sortByField` | [SortField](#sortfield) |  | Field to sort by. |
| `sort_by_field_alias` | `sortByFieldAlias` | string |  | Alias from `fields`. |
| `sort_by_row_count` | `sortByRowCount` | boolean |  | Sort by the group's row count. |
| `sorting_order` | `sortingOrder` | string |  | Sort direction: `ASC` or `DESC`. Default ascending. |
| `null_values_position` | `nullValuesPosition` | string |  | `NULLS_FIRST` or `NULLS_LAST`. |

### BinaryPredicate

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `left_expression` | `leftExpression` | [Expression](#expression) | yes | Left side. |
| `binary_operator` | `binaryOperator` | string | yes | `BINARY_OPERATOR_` plus EQUALS, NOT_EQUAL_TO, GREATER_THAN, GREATER_THAN_OR_EQUAL_TO, LESS_THAN, LESS_THAN_OR_EQUAL_TO, EQUALS_IGNORE_CASE, NOT_EQUALS_IGNORE_CASE, IN, NOT_IN, BETWEEN, CONTAINS, STARTS_WITH, ENDS_WITH, IS_NULL, IS_NOT_NULL, IS_EMPTY or IS_NOT_EMPTY. |
| `right_expression` | `rightExpression` | [Expression](#expression) |  | Right side. |

### CalculatedDimensionExpression

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `dimension_output_type` | `dimensionOutputType` | string | yes | A `SEMANTIC_DIMENSION_TYPE_*` value: TEXT, NUMBER, DATE_TIME. |

### CalculatedField

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `name` | `name` | string | yes | Label for the calculation within the query. |
| `expression` | `expression` | string | yes | Formula. Write it as `$$ ... $$` so its quotes need no escaping. |
| `syntax` | `syntax` | string |  | `Tua` (the default here) or `Salesforce`. |
| `calculated_measure_expression` | `calculatedMeasureExpression` | [CalculatedMeasureExpression](#calculatedmeasureexpression) |  | Declares a numeric output. Set exactly one of this and `calculated_dimension_expression`. |
| `calculated_dimension_expression` | `calculatedDimensionExpression` | [CalculatedDimensionExpression](#calculateddimensionexpression) |  | Declares a non-numeric output. |

### CalculatedMeasureExpression

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `measure_output_type` | `measureOutputType` | string | yes | A `SEMANTIC_MEASUREMENT_TYPE_*` value, such as `SEMANTIC_MEASUREMENT_TYPE_NUMBER`. |
| `decimal_places_options` | `decimalPlacesOptions` | JSON |  | Holds `decimalPlaces`. |

### Expression

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `table_field` | `tableField` | [TableField](#tablefield) |  | A field on a data object. |
| `semantic_field` | `semanticField` | [SemanticField](#semanticfield) |  | A model-level field, such as a calculated field or `Parameters.<api_name>`. |
| `calculated_field` | `calculatedField` | [CalculatedField](#calculatedfield) |  | A formula for this query only. |
| `string_expression` | `stringExpression` | string |  | Literal. |
| `bool_expression` | `boolExpression` | boolean |  | Literal. |
| `int_expression` | `intExpression` | integer |  | Literal, 32-bit. |
| `long_expression` | `longExpression` | integer |  | Literal, 64-bit. |
| `float_expression` | `floatExpression` | number |  | Literal. |
| `double_expression` | `doubleExpression` | number |  | Literal. |
| `bytes_expression` | `bytesExpression` | string |  | Binary literal. |
| `datetime_expression` | `datetimeExpression` | string |  | ISO 8601 datetime. |
| `date_expression` | `dateExpression` | JSON |  | Date without time. |
| `array_expression` | `arrayExpression` | JSON |  | Array of expressions. |
| `range_values` | `rangeValues` | [RangeValues](#rangevalues) |  | For `BINARY_OPERATOR_BETWEEN`. |
| `relative_date_range` | `relativeDateRange` | JSON |  | Dynamic range: `datePart`, `startOffset`, `endOffset`, `anchorDate`, `useCurrentDateAsEndDate`. |
| `null_value` | `nullValue` | JSON |  | Null. |
| `forecast_field` | `forecastField` | JSON |  | Forecast field for predictive queries. |
| `relationship_formula` | `relationshipFormula` | string |  | Inline row-level join formula. |

### FlattenFilter

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `filters` | `filters` | JSON | yes | Items have `field_name`, a PascalCase `operator`, `value` or `values`, and optionally `fieldType`. |
| `filter_logic` | `filterLogic` | string | yes | Combines `filters` by 1-based index, such as `(1 AND 2) OR 3`. |

### LimitOptions

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `limit` | `limit` | integer | yes | Non-negative. |

### LogicalBinaryPredicate

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `left_predicate` | `leftPredicate` | [Predicate](#predicate) | yes | Left side. |
| `logical_binary_operator` | `logicalBinaryOperator` | string | yes | `LOGICAL_BINARY_OPERATOR_AND`, `_OR` or `_NOT`. |
| `right_predicate` | `rightPredicate` | [Predicate](#predicate) | yes | Right side. |

### Predicate

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `binary_predicate` | `binaryPredicate` | [BinaryPredicate](#binarypredicate) |  | A comparison. |
| `unary_predicate` | `unaryPredicate` | [UnaryPredicate](#unarypredicate) |  | A test on one expression. |
| `logical_binary_predicate` | `logicalBinaryPredicate` | [LogicalBinaryPredicate](#logicalbinarypredicate) |  | Two predicates combined. |
| `simple_dimension_filter` | `simpleDimensionFilter` | [Predicate](#predicate) |  | Wraps a predicate. The guide uses it in context filters. |
| `flatten_filter` | `flattenFilter` | [FlattenFilter](#flattenfilter) |  | A list of filters plus a logic string. |

### QueryField

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `expression` | `expression` | [Expression](#expression) | yes | What the field returns. |
| `alias` | `alias` | string |  | Column name in the response. Sorts can reference it. |
| `row_grouping` | `rowGrouping` | boolean |  | Group by this field. Shorthand for `grouping => 'ROW_GROUPING'`. |
| `grouping` | `grouping` | string |  | `ROW_GROUPING` or `COLUMN_GROUPING`. |
| `semantic_aggregation_method` | `semanticAggregationMethod` | string |  | `SEMANTIC_AGGREGATION_METHOD_` plus AUTO, NONE, SUM, AVG, MIN, MAX, MEDIAN, COUNT, UNIQUE_COUNT, STDDEV, STDDEVP, VAR, VARP, FIRST, LAST, UNIQUE or USER_AGG. |
| `show_missing_values` | `showMissingValues` | JSON |  | Data densification settings. |

### QueryOptions

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `sort_orders` | `sortOrders` | array of [SortOrder](#sortorder) |  | Applied in list order. |
| `limit_options` | `limitOptions` | [LimitOptions](#limitoptions) |  | Maximum rows, after grouping. |
| `offset_options` | `offsetOptions` | JSON |  | Offset of the results from a row. |
| `detailed_rows` | `detailedRows` | boolean |  | Return individual rows. Disallows aggregates and aggregate filters. |
| `subtotals` | `subtotals` | boolean |  | Add one summary row per grouped dimension. Needs a row-grouping field. |
| `grand_total` | `grandTotal` | boolean |  | Add one summary row for the whole result. |
| `row_counts` | `rowCounts` | boolean |  | Include the count of underlying rows per group. |
| `join_path_plan` | `joinPathPlan` | string |  | `JOIN_ALL_TABLES` or `JOIN_MINIMAL_TABLES`. |
| `smart_aggregations` | `smartAggregations` | boolean |  | Compute subtotal and grand total rows in one grouped pass. |
| `apply_model_sorting` | `applyModelSorting` | boolean |  | Apply each field's model-defined sort order. |
| `disallow_cross_join` | `disallowCrossJoin` | boolean |  | Disallow cross joins. |

### QueryParameter

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `name` | `name` | string | yes | API name of the model parameter. |
| `value` | `value` | string | yes | Must convert to the parameter's data type. |

### RangeValues

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `lower_boundary` | `lowerBoundary` | [Expression](#expression) | yes | Inclusive. |
| `upper_boundary` | `upperBoundary` | [Expression](#expression) | yes | Inclusive. |

### SemanticCalculatedDimension

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `expression` | `expression` | string | yes | Formula. Write it as `$$ ... $$` so its quotes need no escaping. |
| `data_type` | `dataType` | string | yes | See [`sdm_calc_dim_create`](#sdm_calc_dim_create). |
| `label` | `label` | string |  | Display name. |
| `api_name` | `apiName` | string |  | API name. If you only send `label`, the server generates one: `calcdim19` became `calcdim1965` in the official example. |
| `description` | `description` | string |  | Free text. |
| `syntax` | `syntax` | string |  | Formula dialect: `Tua` (`[Object].[Field]`) or `Salesforce` (`Object.Field`). |
| `geo_role` | `geoRole` | string |  | Airport, Area Code (US), CBSA/MSA (US), City, Congressional District (US), Country/Region, Country, NUTS Europe, Latitude, Longitude, State/Province, Zip Code/Postcode. |
| `sort_order` | `sortOrder` | string |  | `Ascending`, `Descending` or `None`. |
| `display_category` | `displayCategory` | string |  | `Discrete` or `Continuous`. |
| `is_visible` | `isVisible` | boolean |  | Visible in the consumption layer. Default true. |
| `level` | `level` | string |  | `Row` or `AggregateFunction` in the model schema. |
| `filters` | `filters` | array of [SemanticFilter](#semanticfilter) |  | Scope the data the expression sees. |
| `filter_logic` | `filterLogic` | string |  | Combines `filters` by 1-based index, such as `1 AND 2`. |

### SemanticCalculatedMeasurement

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `expression` | `expression` | string | yes | Formula. Write it as `$$ ... $$` so its quotes need no escaping. |
| `data_type` | `dataType` | string | yes | See [`sdm_calc_measure_create`](#sdm_calc_measure_create). |
| `aggregation_type` | `aggregationType` | string |  | Sum, Average, Min, Max, Median, Count, Count Distinct, Stddev, Stddevp, Var, Varp, First, Last, UserAgg, None. Use `UserAgg` when the formula aggregates itself. |
| `label` | `label` | string |  | Display name. |
| `decimal_place` | `decimalPlace` | integer |  | Decimal places to display. The entities page marks it required, the tool's request class leaves it out. |
| `api_name` | `apiName` | string |  | API name. If you only send `label`, the server generates one: `calcMeasurement` became `calcMeasurement225` in the official example. |
| `description` | `description` | string |  | Free text. |
| `syntax` | `syntax` | string |  | Formula dialect: `Tua` (`[Object].[Field]`) or `Salesforce` (`Object.Field`). |
| `level` | `level` | string |  | `Row` or `AggregateFunction` in the model schema. The functions page also shows `TableCalc`. |
| `total_aggregation_type` | `totalAggregationType` | string |  | Aggregation for totals. The enum is the same as `aggregation_type` without `UserAgg` and `CountDistinct`. |
| `sort_order` | `sortOrder` | string |  | `Ascending`, `Descending` or `None`. |
| `display_category` | `displayCategory` | string |  | `Discrete` or `Continuous`. |
| `directionality` | `directionality` | string |  | Whether an upward trend is good (`Up`) or a downward one (`Down`). |
| `should_treat_nulls_as_zeros` | `shouldTreatNullsAsZeros` | boolean |  | Treat nulls as zero. |
| `is_visible` | `isVisible` | boolean |  | Visible in the consumption layer. Default true. |
| `filters` | `filters` | array of [SemanticFilter](#semanticfilter) |  | Scope the data the expression sees. |
| `filter_logic` | `filterLogic` | string |  | Combines `filters` by 1-based index, such as `1 AND 2`. |

### SemanticContext

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `time_zone` | `timezone` | JSON |  | Holds `id`, an IANA zone such as `America/Los_Angeles`. |
| `locale` | `locale` | JSON |  | Holds `code`, such as `en_US`. |
| `currency` | `currency` | JSON |  | Holds `id`, an ISO code. Takes precedence over model and org defaults. |
| `context_filter` | `contextFilter` | [Predicate](#predicate) |  | Applies before all other query filters except model and data object filters. |

### SemanticDataObject

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `data_object_name` | `dataObjectName` | string | yes | The source object. |
| `data_object_type` | `dataObjectType` | string | yes | `Dmo`, `Dlo` or `Cio`. |
| `label` | `label` | string |  | Display name. |
| `api_name` | `apiName` | string |  | Semantic name of the object. |
| `description` | `description` | string |  | Free text. |
| `should_include_all_fields` | `shouldIncludeAllFields` | boolean |  | True adds every source field. |
| `table_type` | `tableType` | string |  | `Standard`, `Dimension` or `Fact`. |
| `semantic_dimensions` | `semanticDimensions` | array of [SemanticDimension](#semanticdimension) |  | Dimensions. |
| `semantic_measurements` | `semanticMeasurements` | array of [SemanticMeasurement](#semanticmeasurement) |  | Measurements. |
| `filters` | `filters` | array of [SemanticFilter](#semanticfilter) |  | Restrict the rows this object contributes. |
| `filter_logic` | `filterLogic` | string |  | Combines `filters` by 1-based index. |

### SemanticDimension

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `data_object_field_name` | `dataObjectFieldName` | string | yes | The source column, such as `ssot__Name__c`. |
| `label` | `label` | string |  | Display name. |
| `api_name` | `apiName` | string |  | Semantic name. Letters, digits and underscores only (community). |
| `description` | `description` | string |  | Free text. |
| `data_type` | `dataType` | string |  | Text, Number, Date, DateTime, Boolean, Currency, Email, Percentage, PhoneNumber, Url or Geo. |
| `display_category` | `displayCategory` | string |  | `Discrete` or `Continuous`. |
| `geo_role` | `geoRole` | string |  | Geographic role, see `geo_role` of [`sdm_calc_dim_create`](#sdm_calc_dim_create). |
| `sort_order` | `sortOrder` | string |  | `Ascending`, `Descending` or `None`. |
| `is_visible` | `isVisible` | boolean |  | Visible in the consumption layer. Default true. |
| `is_primary_key` | `isPrimaryKey` | boolean |  | - |
| `semantic_data_type` | `semanticDataType` | string |  | `RecordCurrency` marks the record currency field (community). |
| `storage_data_type` | `storageDataType` | string |  | Native storage type. For a `Cio` it must equal the field's type (community). |

### SemanticField

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `name` | `name` | string | yes | API name of the model-level field. |

### SemanticFieldReference

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `table_field_reference` | `tableFieldReference` | [SemanticTableFieldReference](#semantictablefieldreference) |  | A field on a data object. |
| `calculated_field_api_name` | `calculatedFieldApiName` | string |  | A calculated field, as an alternative to `table_field_reference`. |

### SemanticFilter

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `field_name` | `fieldName` | string |  | API name of the field being filtered. |
| `operator` | `operator` | string |  | PascalCase operator such as `GreaterThan`, `In`, `StartsWith`, `Between`, `IsNull`. |
| `value` | `value` | string |  | Value as a string. `Between` takes `lower \| upper`. |
| `values` | `values` | array of string |  | Values, for operators such as `In`. |

### SemanticMeasurement

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `data_object_field_name` | `dataObjectFieldName` | string | yes | The source column, such as `ssot__AnnualRevenueAmount__c`. |
| `label` | `label` | string |  | Display name. |
| `api_name` | `apiName` | string |  | Semantic name. Letters, digits and underscores only (community). |
| `description` | `description` | string |  | Free text. |
| `data_type` | `dataType` | string |  | Number, Currency or Percentage. `Percent` is rejected (community). |
| `aggregation_type` | `aggregationType` | string |  | Default aggregation, see [`sdm_calc_measure_create`](#sdm_calc_measure_create). `Sum` when omitted in the official example. |
| `decimal_place` | `decimalPlace` | integer |  | Decimal places to display. |
| `directionality` | `directionality` | string |  | `Up` or `Down`, whether a rising trend is good. |
| `display_category` | `displayCategory` | string |  | `Continuous`. |
| `should_treat_nulls_as_zeros` | `shouldTreatNullsAsZeros` | boolean |  | Treat nulls as zero. |
| `sort_order` | `sortOrder` | string |  | `Ascending`, `Descending` or `None`. |
| `is_visible` | `isVisible` | boolean |  | Visible in the consumption layer. Default true. |
| `is_aggregatable` | `isAggregatable` | boolean |  | - |

### SemanticMetricDefinition

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `measurement_reference` | `measurementReference` | [SemanticFieldReference](#semanticfieldreference) | yes | The calculated measurement or field the metric evaluates. |
| `time_dimension_reference` | `timeDimensionReference` | [SemanticFieldReference](#semanticfieldreference) | yes | The time field. |
| `time_grains` | `timeGrains` | array of string | yes | Allowed grains: Day, Week, Month, Quarter, Year. |
| `aggregation_type` | `aggregationType` | string |  | Such as `Sum`. |
| `additional_dimensions` | `additionalDimensions` | array of [SemanticFieldReference](#semanticfieldreference) |  | Dimensions usable as filters. |
| `insights_settings` | `insightsSettings` | JSON |  | Which insight types and dimensions to use when generating insights. |
| `filters` | `filters` | array of [SemanticFilter](#semanticfilter) |  | Filters on the metric. |
| `filter_logic` | `filterLogic` | string |  | Combines `filters` by 1-based index. |
| `is_cumulative` | `isCumulative` | boolean |  | Whether the metric is cumulative. |
| `is_goal_editing_blocked` | `isGoalEditingBlocked` | boolean |  | Whether goal editing is blocked. |
| `api_name` | `apiName` | string |  | Only inside `semantic_metrics` of [`sdm_create`](#sdm_create). |
| `label` | `label` | string |  | Only inside `semantic_metrics` of [`sdm_create`](#sdm_create). |

### SemanticModelCurrency

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `id` | `id` | string |  | Currency ISO code. |
| `use_org_default` | `useOrgDefault` | boolean |  | Use the org default currency. |

### SemanticRelationship

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `left_semantic_definition_api_name` | `leftSemanticDefinitionApiName` | string | yes | Semantic `api_name` of the left data object. |
| `right_semantic_definition_api_name` | `rightSemanticDefinitionApiName` | string | yes | Semantic `api_name` of the right data object. |
| `criteria` | `criteria` | array of [SemanticRelationshipCriterion](#semanticrelationshipcriterion) | yes | Join conditions. |
| `api_name` | `apiName` | string |  | API name. |
| `label` | `label` | string |  | Display name. |
| `cardinality` | `cardinality` | string |  | `OneToOne`, `OneToMany`, `ManyToOne`, `ManyToMany` or `Unspecified`. |
| `join_type` | `joinType` | string |  | `Auto` (the default), `Inner`, `Left`, `Right` or `Full`. |
| `is_enabled` | `isEnabled` | boolean |  | Whether the relationship is active. |

### SemanticRelationshipCriterion

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `left_semantic_field_api_name` | `leftSemanticFieldApiName` | string | yes | Field on the left object, or a formula if `left_field_type` is `Formula`. |
| `right_semantic_field_api_name` | `rightSemanticFieldApiName` | string | yes | Field on the right object, or a formula if `right_field_type` is `Formula`. |
| `join_operator` | `joinOperator` | string |  | Equals, EqualsIgnoreCase, GreaterThan, LessThan, GreaterThanOrEqual, LessThanOrEqual, NotEquals or NotEqualsIgnoreCase. |
| `left_field_type` | `leftFieldType` | string |  | `TableField` (the default), `SemanticField` for a calculated field, or `Formula`. |
| `right_field_type` | `rightFieldType` | string |  | `TableField` (the default), `SemanticField` for a calculated field, or `Formula`. |

### SemanticTableFieldReference

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `field_api_name` | `fieldApiName` | string | yes | Semantic field name. |
| `table_api_name` | `tableApiName` | string | yes | Semantic data object name. |

### SimpleSortOrder

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `sort_by_field` | `sortByField` | [SortField](#sortfield) |  | Field to sort by. Give this or `sort_by_field_alias`. |
| `sort_by_field_alias` | `sortByFieldAlias` | string |  | Alias from `fields`. |
| `sorting_order` | `sortingOrder` | string |  | Sort direction: `ASC` or `DESC`. Default ascending. |
| `null_values_position` | `nullValuesPosition` | string |  | `NULLS_FIRST` or `NULLS_LAST`. |

### SortField

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `expression` | `expression` | [Expression](#expression) | yes | The field. |
| `semantic_aggregation_method` | `semanticAggregationMethod` | string |  | `SEMANTIC_AGGREGATION_METHOD_` plus AUTO, NONE, SUM, AVG, MIN, MAX, MEDIAN, COUNT, UNIQUE_COUNT, STDDEV, STDDEVP, VAR, VARP, FIRST, LAST, UNIQUE or USER_AGG. |

### SortOrder

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `simple_sort_order` | `simpleSortOrder` | [SimpleSortOrder](#simplesortorder) |  | Sort by one field or alias. |
| `aggregative_sort_order` | `aggregativeSortOrder` | [AggregativeSortOrder](#aggregativesortorder) |  | Sort a grouped dimension by an aggregated measure or row count. |

### StructuredSemanticQuery

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `fields` | `fields` | array of [QueryField](#queryfield) | yes | The dimensions, measurements and calculations to return. |
| `filter` | `filter` | [Predicate](#predicate) |  | Applies before aggregation. |
| `aggregate_filter` | `aggregateFilter` | [Predicate](#predicate) |  | Applies after aggregation, like `HAVING`. Must reference an aggregated expression. |
| `options` | `options` | [QueryOptions](#queryoptions) |  | Sorting, limits, totals, join strategy. |
| `semantic_context` | `semanticContext` | [SemanticContext](#semanticcontext) |  | Time zone, locale, currency and context filter for this query. |
| `parameters` | `parameters` | array of [QueryParameter](#queryparameter) |  | Values for model parameters. An unknown name is ignored. |
| `advanced_dimension_filters_v2` | `advancedDimensionFiltersV2` | JSON |  | Top-N and bottom-N filters on dimension values ranked by a measure. |
| `unpivot` | `unpivot` | JSON |  | Rotates selected aggregated measures into name and value rows. |

### TableField

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `name` | `name` | string | yes | Semantic field `api_name`. |
| `table_name` | `tableName` | string | yes | Semantic data object `api_name`. |

### UnaryPredicate

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `expression` | `expression` | [Expression](#expression) | yes | The expression tested. |
| `unary_operator` | `unaryOperator` | string | yes | Such as `UNARY_OPERATOR_IS_NOT_NULL`. |
