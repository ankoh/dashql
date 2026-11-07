<!-- Generated from extensions/d360-api/clfn/spec/document_ai.yaml, edit that and run: bazel run //extensions/d360-api:update -->

# Document AI

Part of the [CDP function reference](functions.md). Nothing here is implemented or tested against an org. Every result also has the [standard columns](functions.md#result-schema).

Document AI uses an LLM to read documents such as PDFs and images, and returns structured data that follows a JSON schema you define. The [architect guide](https://architect.salesforce.com/docs/architect/fundamentals/guide/data360-document-ai) calls Agentforce a hard prerequisite: all Document AI APIs are unavailable until it is active, and they stop if it or the chosen model is disabled.

There are two ways to use it:

- **Ad hoc:** `document_ai_data_extract` answers synchronously with JSON and stores nothing. Pass `ml_model` and `schema_config`, or name a saved configuration.
- **Batch:** a configuration bound to an unstructured DMO. `document_ai_process_run` starts it, and the results land in DLOs.

The usual order is to read the valid models and file types with `document_ai_global_configuration_get`, draft a schema with `document_ai_schema_generate`, test it with an extract, and save it with `document_ai_configuration_create`. `document_ai_schema_detect` picks among saved configurations when the document type is unknown.

The gotchas that matter most, per the guide: 10 MB per file, 50 extraction calls per minute per tenant, and credits spent on processing. Fields not found come back as null, and content past the model's context is dropped silently. The spec's schemas and examples also disagree in several places, noted per function.

```sql
CALL cdp.document_ai_global_configuration_get ();
CALL cdp.document_ai_schema_generate (ml_model => 'llmgateway__VertexAIGemini25Flash001', files => [(file_id = '068xxxxxxxxxxxxxxx')]);
CALL cdp.document_ai_data_extract (idp_configuration_id_or_name => 'Vendor_Invoice', files => [(file_id = '068xxxxxxxxxxxxxxx')]);
```

**Functions:** [`document_ai_configuration_delete`](#document_ai_configuration_delete), [`document_ai_configuration_list`](#document_ai_configuration_list), [`document_ai_configuration_get`](#document_ai_configuration_get), [`document_ai_global_configuration_get`](#document_ai_global_configuration_get), [`document_ai_configuration_update`](#document_ai_configuration_update), [`document_ai_schema_detect`](#document_ai_schema_detect), [`document_ai_data_extract`](#document_ai_data_extract), [`document_ai_schema_generate`](#document_ai_schema_generate), [`document_ai_configuration_create`](#document_ai_configuration_create), [`document_ai_process_run`](#document_ai_process_run)

## document_ai_configuration_delete

`DELETE /ssot/document-processing/configurations/{idOrApiName}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Document-AI/paths/~1ssot~1document-processing~1configurations~1%7BidOrApiName%7D/delete) · evidence O · changes org state

Delete a Document AI configuration. Since v63.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `id_or_api_name` | `idOrApiName` | path | string | yes | ID or API name of the configuration. Since v63.0. |

```sql
CALL cdp.document_ai_configuration_delete (id_or_api_name => 'Vendor_Invoice');
```

**Result**

No response body (HTTP 200). One row with only the standard columns.

**Notes:** The sources don't say whether the DLOs in `extracted_dlos` go with the configuration, so check them afterwards. Extract calls that still name it should fail: the [architect guide](https://architect.salesforce.com/docs/architect/fundamentals/guide/data360-document-ai) maps "schema ID not found" to HTTP 400.

## document_ai_configuration_list

`GET /ssot/document-processing/configurations` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Document-AI/paths/~1ssot~1document-processing~1configurations/get) · evidence O · read-only

Get all Document AI configurations. Since v63.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `activation_status` | `activationStatus` | query | string |  | Filter by activation status, either `Activated` or `Deactivated`. Since v63.0. |
| `limit` | `limit` | query | integer |  | Maximum number of records to return. Since v63.0. |
| `offset` | `offset` | query | integer |  | Number of records to skip. Since v63.0. |
| `order_by` | `orderBy` | query | string |  | Return record sorted by a given field. Sort order is DESC by default. (for example, "Label DESC"). Since v63.0. |
| `search` | `search` | query | string |  | Return only records that contain a specific search term. Since v63.0. |

```sql
CALL cdp.document_ai_configuration_list (activation_status => 'Activated', order_by => 'Label DESC', limit => 25);
```

**Result**

One row per item of `/configurations` in the response. Other response fields go to `_meta`: `currentPageUrl`, `nextPageUrl`, `totalSize`. Schema `IdpConfigurationRepresentation`.

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
| `activation_status` | `activationStatus` | VARCHAR | The configuration activation status. Since v63.0. |
| `config_metadata` | `configMetadata` | JSON | A collection of custom key-value pairs. Since v63.0. |
| `dataspace` | `dataspace` | JSON (CdpAssetReferenceRepresentation) | Data space of the configuration. Since v63.0. |
| `description` | `description` | VARCHAR | Description of the configuration. Since v63.0. |
| `last_run_on` | `lastRunOn` | VARCHAR | The last unstructured data-extraction job run. Since v63.0. |
| `ml_model` | `mlModel` | VARCHAR | The ML model used to extract the unstructured data. Since v63.0. |
| `runtime_status` | `runtimeStatus` | VARCHAR | The status of the last off-core unstructured data-extraction job run. Since v63.0. |
| `source_dmo` | `sourceDmo` | JSON (CdpAssetReferenceRepresentation) | The unstructured DMO used as the input for the data extraction process. Since v63.0. |
| `status` | `status` | VARCHAR | The status of the latest configuration version that's been synced off-core. Since v63.0. |
| `version` | `version` | VARCHAR | The current version of the configuration. This is incremented automatically with each edit. Since v63.0. |

**Paging:** `next_page_url`.

**Notes:** Empty collections return `current_page_url` and `next_page_url` as null, unlike the spec's declared string type ([sf-pi override](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/registry/connect-openapi-overrides.json), from a live test). Items have no `schema_config`: use `document_ai_configuration_get` for that.

## document_ai_configuration_get

`GET /ssot/document-processing/configurations/{idOrApiName}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Document-AI/paths/~1ssot~1document-processing~1configurations~1%7BidOrApiName%7D/get) · evidence O · read-only

Get the details of a Document AI configuration. Since v63.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `id_or_api_name` | `idOrApiName` | path | string | yes | ID or API name of the configuration. Since v63.0. |

```sql
CALL cdp.document_ai_configuration_get (id_or_api_name => 'Vendor_Invoice');
```

**Result**

One row. Schema `IdpConfigurationDetailsRepresentation`.

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
| `activation_status` | `activationStatus` | VARCHAR | The configuration activation status. Since v63.0. |
| `config_metadata` | `configMetadata` | JSON | A collection of custom key-value pairs. Since v63.0. |
| `dataspace` | `dataspace` | JSON (CdpAssetReferenceRepresentation) | Data space of the configuration. Since v63.0. |
| `description` | `description` | VARCHAR | Description of the configuration. Since v63.0. |
| `last_run_on` | `lastRunOn` | VARCHAR | The last unstructured data-extraction job run. Since v63.0. |
| `ml_model` | `mlModel` | VARCHAR | The ML model used to extract the unstructured data. Since v63.0. |
| `runtime_status` | `runtimeStatus` | VARCHAR | The status of the last off-core unstructured data-extraction job run. Since v63.0. |
| `source_dmo` | `sourceDmo` | JSON (CdpAssetReferenceRepresentation) | The unstructured DMO used as the input for the data extraction process. Since v63.0. |
| `status` | `status` | VARCHAR | The status of the latest configuration version that's been synced off-core. Since v63.0. |
| `version` | `version` | VARCHAR | The current version of the configuration. This is incremented automatically with each edit. Since v63.0. |
| `extracted_dlo_config` | `extractedDloConfig` | VARCHAR | The configuration details of the DLOs to be extracted. Since v63.0. |
| `extracted_dlos` | `extractedDlos` | JSON (array of IdpConfigExtractedDloRepresentation) | List of references for the output DLOs. Since v63.0. |
| `file_config` | `fileConfig` | JSON (IdpFileConfigRepresentation) | The specs for the file types supported by the Document AI process. Since v63.0. |
| `schema_config` | `schemaConfig` | VARCHAR | The schema of the data to be extracted. Since v63.0. |

**Notes:** The spec's example responses don't match its schema. `schema_config` and `extracted_dlo_config` are typed as strings but shown as JSON objects, `version` appears as both `3` and `"1"`, and `filterByDmo` and `externalServiceRegistrationId` appear with no schema entry. Example values also vary in case: `status` is `SYNCED` or `Synced`, and `activation_status` is `ACTIVATED` or `Activated`.

## document_ai_global_configuration_get

`GET /ssot/document-processing/global-config` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Document-AI/paths/~1ssot~1document-processing~1global-config/get) · evidence O · read-only

Reads which file types, size limits and models this org accepts for Document AI. Use it to find valid `ml_model` values before creating a configuration or extracting. Since v63.0.

**Options**

None.

```sql
CALL cdp.document_ai_global_configuration_get ();
```

**Result**

One row. Schema `IdpGlobalConfigRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `supported_content_types` | `supportedContentTypes` | JSON (array of IdpContentTypeRepresentation) | Content types supported for unstructured data extraction. Since v63.0. |
| `supported_models` | `supportedModels` | JSON (array of IdpSupportedModelRepresentation) | Models supported for unstructured data extraction. Since v63.0. |
| `version` | `version` | VARCHAR | The version of the configuration schema. Since v63.0. |

**Notes:** Read `max_file_size_in_mb` here instead of assuming a limit, because the sources differ: the spec's example shows 20, a [live fixture](https://github.com/dsouza-anush/sf-plugin-data360/blob/main/test/fixtures/live/docai-describe.json) shows 10 (community, one org), and the [architect guide](https://architect.salesforce.com/docs/architect/fundamentals/guide/data360-document-ai) says 10 MB. That fixture also lists only PDF, PNG and JPG, while the spec's extract call allows Office files too. Model ids in the spec's examples look like `llmgateway__VertexAIGemini25Flash001`, but one also shows `VertexAIGemini25Flash`, so copy `id` from this result.

## document_ai_configuration_update

`PATCH /ssot/document-processing/configurations/{idOrApiName}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Document-AI/paths/~1ssot~1document-processing~1configurations~1%7BidOrApiName%7D/patch) · evidence O · changes org state

Update an existing Document AI configuration. Since v63.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `id_or_api_name` | `idOrApiName` | path | string | yes | ID or API name of the configuration. Since v63.0. |
| `activation_status` | `activationStatus` | body | enum(Activated, Deactivated) |  | Activation status of the configuration. Since v63.0. |
| `description` | `description` | body | string |  | New description for the configuration. Since v63.0. |
| `label` | `label` | body | string |  | New display label for the configuration. Since v63.0. |

```sql
CALL cdp.document_ai_configuration_update (id_or_api_name => 'Vendor_Invoice', description => 'Supplier invoices, EU and US', activation_status => 'Deactivated');
```

**Result**

One row. Schema `IdpConfigurationDetailsRepresentation`.

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
| `activation_status` | `activationStatus` | VARCHAR | The configuration activation status. Since v63.0. |
| `config_metadata` | `configMetadata` | JSON | A collection of custom key-value pairs. Since v63.0. |
| `dataspace` | `dataspace` | JSON (CdpAssetReferenceRepresentation) | Data space of the configuration. Since v63.0. |
| `description` | `description` | VARCHAR | Description of the configuration. Since v63.0. |
| `last_run_on` | `lastRunOn` | VARCHAR | The last unstructured data-extraction job run. Since v63.0. |
| `ml_model` | `mlModel` | VARCHAR | The ML model used to extract the unstructured data. Since v63.0. |
| `runtime_status` | `runtimeStatus` | VARCHAR | The status of the last off-core unstructured data-extraction job run. Since v63.0. |
| `source_dmo` | `sourceDmo` | JSON (CdpAssetReferenceRepresentation) | The unstructured DMO used as the input for the data extraction process. Since v63.0. |
| `status` | `status` | VARCHAR | The status of the latest configuration version that's been synced off-core. Since v63.0. |
| `version` | `version` | VARCHAR | The current version of the configuration. This is incremented automatically with each edit. Since v63.0. |
| `extracted_dlo_config` | `extractedDloConfig` | VARCHAR | The configuration details of the DLOs to be extracted. Since v63.0. |
| `extracted_dlos` | `extractedDlos` | JSON (array of IdpConfigExtractedDloRepresentation) | List of references for the output DLOs. Since v63.0. |
| `file_config` | `fileConfig` | JSON (IdpFileConfigRepresentation) | The specs for the file types supported by the Document AI process. Since v63.0. |
| `schema_config` | `schemaConfig` | VARCHAR | The schema of the data to be extracted. Since v63.0. |

**Notes:** Only `label`, `description` and `activation_status` can change. The spec has no way to edit `schema_config`, `ml_model` or `file_config` here, so through this API a schema change means creating a new configuration. The enum is `Activated` or `Deactivated`, but the spec's own example sends `ACTIVATED`. The [architect guide](https://architect.salesforce.com/docs/architect/fundamentals/guide/data360-document-ai) warns that in-flight batch documents keep using the previous version after a schema change, which breaks downstream mappings on renamed fields.

## document_ai_schema_detect

`POST /ssot/document-processing/actions/detect-schema` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Document-AI/paths/~1ssot~1document-processing~1actions~1detect-schema/post) · evidence O · changes org state

Detects which extraction schema best matches a document using single or multi-schema mode. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `threshold` | `threshold` | query | number (double) |  | Minimum matching score (0-1) required for a schema to be returned in the response. If unspecified, the default value is `0.80`. Since v67.0. |
| `files` | `files` | body | array of [IdpGenerateSchemaFileInput](#idpgenerateschemafileinputrepresentation) |  | List of unstructured source files to detect the schema from. Supported file types are: PDF (`application/pdf`) and images (`image/png`, `image/jpg`, `image/jpeg`). Since v67.0. |
| `ml_model` | `mlModel` | body | string |  | ID of the model to use for schema detection. Since v67.0. |
| `mode` | `mode` | body | enum(Multi, Single) |  | Schema detection mode. - `Single`: Detect one schema for the entire document. - `Multi`: Detect and map multiple schemas to different page ranges. Since v67.0. |
| `schema_configurations` | `schemaConfigurations` | body | array of string |  | List of Document AI schema configuration IDs to match against. Since v67.0. |

```sql
CALL cdp.document_ai_schema_detect (schema_configurations => ['Invoice_Schema_v1', 'Receipt_Schema_v2'], ml_model => 'llmgateway__VertexAIGemini25Flash001', files => [(file_id = '068xxxxxxxxxxxxxxx')], mode => 'Single', threshold => 0.9);
```

**Result**

One row per item of `/data` in the response. Schema `IdpSchemaDetectionInnerRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `matching_fields_in_schema` | `matchingFieldsInSchema` | BIGINT | Matching number of fields in the schema. Only returned for the `Single` schema detection mode. Since v67.0. |
| `matching_score` | `matchingScore` | DOUBLE | Matching score for the schema with the requested document. Only returned for the `Single` schema detection mode. Since v67.0. |
| `pages` | `pages` | JSON (array of IdpSchemaDetectionPagesRepresentation) | Page details and the matching score for the schema with the requested page. Only returned for the `Multi` schema detection mode. Since v67.0. |
| `schema_configuration` | `schemaConfiguration` | VARCHAR | Name of the schema configuration. Since v67.0. |
| `total_fields_in_schema` | `totalFieldsInSchema` | BIGINT | Total number of fields in the schema. Only returned for the `Single` schema detection mode. Since v67.0. |
| `subdocuments` | `subdocuments` | JSON | Not in the spec schema: from the spec's examples. |

**Notes:** A schema scoring under `threshold` isn't returned, so zero rows can mean no match rather than a failure. PDF and images only, a narrower list than extract. The spec marks nothing as required and gives no default for `mode`, so pass all four body options.

`schema_configurations` is described as IDs, but the examples pass names such as `Invoice_Schema_v1`. **Multi mode disagrees with itself:** the schema has `pages` with `pageNumber` and `matching_score`, while the spec's example returns `subdocuments` with `start_page`, `end_page` and `matching_score`.

## document_ai_data_extract

`POST /ssot/document-processing/actions/extract-data` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Document-AI/paths/~1ssot~1document-processing~1actions~1extract-data/post) · evidence O · read-only

Extracts structured data from a file and returns it synchronously as JSON, without storing anything. Use a saved configuration or pass `ml_model` and `schema_config` inline. Supports PDF, images, .docx, .pptx and .xlsx. Since v63.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `end_page` | `endPage` | query | integer |  | Ending page number for data extraction. Since v66.0. |
| `extract_data_with_confidence_score` | `extractDataWithConfidenceScore` | query | boolean |  | Indicates whether to assign a confidence score to each field in the extracted data (`true`) or not (`false`). Since v64.0. |
| `start_page` | `startPage` | query | integer |  | Starting page number for data extraction. Since v66.0. |
| `files` | `files` | body | array of [IdpGenerateSchemaFileInput](#idpgenerateschemafileinputrepresentation) | yes | The list of unstructured data source files to extract data from. Supported file types: PDF, image (PNG, JPG, JPEG), Microsoft Word (.docx), PowerPoint (.pptx), and Excel (.xlsx). Since v63.0. |
| `idp_configuration_id_or_name` | `idpConfigurationIdOrName` | body | string |  | ID of the Document AI configuration to use. Either idp_configuration_id_or_name or ml_model and schema_config must be present. Since v63.0. |
| `ml_model` | `mlModel` | body | string |  | The ID of the ML model to use for schema extraction. Use the [get Document AI global configuration](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Document-AI/paths/~1ssot~1document-processing~1global-config/get) endpoint to retrieve the list of acceptable values. Since v63.0. |
| `schema_config` | `schemaConfig` | body | string |  | The schema of the data to be extracted in JSON format. Use the root `description` field to provide a schema-level prompt for global instructions, such as setting the extraction language or sections to ignore. This document-wide guidance works with field-level prompts to enhance extraction accuracy across complex documents. Since v63.0. |

```sql
CALL cdp.document_ai_data_extract (
  ml_model => 'llmgateway__VertexAIGemini25Flash001',
  files => [(file_id = '068xxxxxxxxxxxxxxx')],
  extract_data_with_confidence_score => true,
  schema_config => $$
    {
      "$schema": "http://json-schema.org/draft-07/schema#",
      "title": "Invoice",
      "description": "Ignore the terms and conditions pages.",
      "type": "object",
      "properties": {
        "invoice_number": { "type": "string", "description": "The legal invoice identifier." },
        "invoice_date": { "type": "string", "format": "date" },
        "total": { "type": "number" }
      },
      "required": ["invoice_number"]
    }
  $$
);
```

**Result**

One row per item of `/data` in the response. Schema `IdpExtractedFileDataRepresenation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `data` | `data` | VARCHAR | Extracted JSON data. The JSON includes metadata for each extracted field, such as `type`, `value`, and `confidence_score`. The `confidence_score` value ranges from `0` to `1.0`. Since v63.0. |
| `error` | `error` | VARCHAR | Error message if the data extraction fails. Since v63.0. |

**Token:** The [architect guide](https://architect.salesforce.com/docs/architect/fundamentals/guide/data360-document-ai) lists OAuth scopes `cdp_ingest_api` and `api` for this pipeline.

**Notes:** **Config or inline:** pass `idp_configuration_id_or_name`, or both `ml_model` and `schema_config`. The spec can't express this rule, so none of the three shows as required. The architect guide says a stored schema must exist first, while the spec and the [developer blog](https://developer.salesforce.com/blogs/2025/08/process-unstructured-data-with-document-ai) allow inline schemas.

**Files:** set `data` with `mime_type`, or `file_id`. The guide describes this pipeline as single-document, although `files` is an array. Excel needs `additional_params = (sheet_name = '...')` (v67).

**Schema:** `schema_config` is typed as a string, yet one spec example passes an object, so use a `$$` string. The guide limits schemas to 50 root fields and says nested objects (up to 3 levels) are for batch with a source object only. The spec's inline example nests an array of objects anyway. The root `description` is a document-wide prompt, and field descriptions act as field prompts.

**Reading results:** `data` is a JSON string, not an object. Each field holds `type`, `value` and `confidence_score`. The spec doesn't say what it looks like without `extract_data_with_confidence_score`. Check `error` on each row. The guide's status codes are 200 (including partial nulls), 400 (malformed, or schema not found), 413 (over 10 MB) and 5xx.

**Limits, per the [guide](https://architect.salesforce.com/docs/architect/fundamentals/guide/data360-document-ai):** 50 calls per minute per tenant, typically 5 to 15 seconds each, so set timeouts to at least 30 s. Password-protected and permission-restricted PDFs aren't processed. Content past the model's context is dropped silently, so split long documents with `start_page` and `end_page`. Scans under 150 DPI lose accuracy with no error.

**PII:** the guide says Trust Layer masking doesn't apply to document content, so it reaches the model as is and comes back in results.

## document_ai_schema_generate

`POST /ssot/document-processing/actions/generate-schema` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Document-AI/paths/~1ssot~1document-processing~1actions~1generate-schema/post) · evidence O · changes org state

Asks a model to propose a JSON extraction schema from sample files. Use it to draft a `schema_config` instead of writing one by hand. Nothing is saved. Since v63.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `files` | `files` | body | array of [IdpGenerateSchemaFileInput](#idpgenerateschemafileinputrepresentation) | yes | The list of unstructured data source files to extract the schema from. Since v63.0. |
| `ml_model` | `mlModel` | body | string | yes | The ID of the ML model to use for schema extraction. Use the [get Document AI global configuration](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Document-AI/paths/~1ssot~1document-processing~1global-config/get) endpoint to retrieve the list of acceptable values. Since v63.0. |

```sql
CALL cdp.document_ai_schema_generate (ml_model => 'llmgateway__VertexAIGemini25Flash001', files => [(file_id = '068xxxxxxxxxxxxxxx')]);
```

**Result**

One row. Schema `IdpGeneratedSchemaRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `error` | `error` | VARCHAR | Error message if the schema generation fails. Since v63.0. |
| `schema` | `schema` | VARCHAR | JSON schema definition. Since v63.0. |

**Notes:** The result is a draft, and the [architect guide](https://architect.salesforce.com/docs/architect/fundamentals/guide/data360-document-ai) advises designing schemas from a diverse set of documents rather than a single example. `schema` is a JSON string, and the spec's example wraps it again as `{"schema": {...}}`, unlike the draft-07 root its extract example passes as `schema_config`. The sources don't say whether `schema_config` accepts the wrapper, so unwrap it. Check `error` too, since the response carries it in its success shape. "Nothing is saved" is inferred: the spec documents no stored object.

## document_ai_configuration_create

`POST /ssot/document-processing/configurations` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Document-AI/paths/~1ssot~1document-processing~1configurations/post) · evidence O · changes org state

Create a new Document AI configuration. Since v63.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `activation_status` | `activationStatus` | body | enum(Activated, Deactivated) | yes | Status of the configuration. Since v63.0. |
| `config_metadata` | `configMetadata` | body | object |  | A custom collection of key-value attributes. Since v63.0. |
| `description` | `description` | body | string |  | Description of the configuration. Since v63.0. |
| `extracted_dlo_config` | `extractedDloConfig` | body | map to [IdpConfigExtractedDloInput](#idpconfigextracteddloinputrepresentation) |  | The configuration details for the DLOs to be extracted. Since v63.0. |
| `file_config` | `fileConfig` | body | [IdpFileConfigInput](#idpfileconfiginputrepresentation) | yes | The specs for the file types supported by the Document AI process to be created. Since v63.0. |
| `label` | `label` | body | string | yes | Display label of the configuration. Since v63.0. |
| `ml_model` | `mlModel` | body | string | yes | The API name of the model used to extract the unstructured data. Since v63.0. |
| `name` | `name` | body | string | yes | Name of the configuration. Since v63.0. |
| `schema_config` | `schemaConfig` | body | string | yes | The schema of the data to be extracted. Since v63.0. |
| `source_dmo_developer_name` | `sourceDmoDeveloperName` | body | string |  | The API name of the unstructured DMO used as input to the data extraction process. Since v63.0. |

```sql
CALL cdp.document_ai_configuration_create (
  name => 'Vendor_Invoice',
  label => 'Vendor Invoice',
  ml_model => 'llmgateway__VertexAIGemini25Flash001',
  activation_status => 'Activated',
  file_config => (file_types = ['application/pdf', 'image/png', 'image/jpeg']),
  schema_config => $$
    {
      "$schema": "http://json-schema.org/draft-07/schema#",
      "title": "Vendor Invoice",
      "type": "object",
      "properties": {
        "invoice_number": { "type": "string", "description": "The legal invoice identifier." },
        "total": { "type": "number" }
      }
    }
  $$
);
```

**Result**

One row. Schema `IdpConfigurationDetailsRepresentation`.

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
| `activation_status` | `activationStatus` | VARCHAR | The configuration activation status. Since v63.0. |
| `config_metadata` | `configMetadata` | JSON | A collection of custom key-value pairs. Since v63.0. |
| `dataspace` | `dataspace` | JSON (CdpAssetReferenceRepresentation) | Data space of the configuration. Since v63.0. |
| `description` | `description` | VARCHAR | Description of the configuration. Since v63.0. |
| `last_run_on` | `lastRunOn` | VARCHAR | The last unstructured data-extraction job run. Since v63.0. |
| `ml_model` | `mlModel` | VARCHAR | The ML model used to extract the unstructured data. Since v63.0. |
| `runtime_status` | `runtimeStatus` | VARCHAR | The status of the last off-core unstructured data-extraction job run. Since v63.0. |
| `source_dmo` | `sourceDmo` | JSON (CdpAssetReferenceRepresentation) | The unstructured DMO used as the input for the data extraction process. Since v63.0. |
| `status` | `status` | VARCHAR | The status of the latest configuration version that's been synced off-core. Since v63.0. |
| `version` | `version` | VARCHAR | The current version of the configuration. This is incremented automatically with each edit. Since v63.0. |
| `extracted_dlo_config` | `extractedDloConfig` | VARCHAR | The configuration details of the DLOs to be extracted. Since v63.0. |
| `extracted_dlos` | `extractedDlos` | JSON (array of IdpConfigExtractedDloRepresentation) | List of references for the output DLOs. Since v63.0. |
| `file_config` | `fileConfig` | JSON (IdpFileConfigRepresentation) | The specs for the file types supported by the Document AI process. Since v63.0. |
| `schema_config` | `schemaConfig` | VARCHAR | The schema of the data to be extracted. Since v63.0. |

**Done when:** No documented wait. `document_ai_configuration_get.status` reports the off-core sync of the latest version. Spec examples show `SYNCED` and `Synced`, with no full list.

**Notes:** **Which pipeline:** the [architect guide](https://architect.salesforce.com/docs/architect/fundamentals/guide/data360-document-ai) says to choose first. Omit `source_dmo_developer_name` for ad hoc extraction. For batch, set it to an unstructured DMO and describe the output with `extracted_dlo_config`.

**`extracted_dlo_config` disagrees with itself.** The schema gives each DLO a `fields` array of objects with `data_type` in `STRING`, `NUMBER`, `DATE`, `BOOLEAN`. The spec's examples make `fields` a map keyed by field, add `name`, `label`, `category` and `eventDateFieldName` on the DLO, and use `data_type` values `Date`, `Text` and null. The example below leaves it out for that reason.

**Values:** `activation_status` is `Activated` or `Deactivated`, though the spec's example sends `ACTIVATED`. That example's `My_Document AI_Config` also has a space, unlike the `Vendor_Invoice` shape of another example. Field limits are under `document_ai_data_extract`.

The guide advises one schema per document type, with field names matching the target columns.

## document_ai_process_run

`POST /ssot/document-processing/configurations/{idOrApiName}/actions/run` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Document-AI/paths/~1ssot~1document-processing~1configurations~1%7BidOrApiName%7D~1actions~1run/post) · evidence O · changes org state

Starts a batch run of a saved configuration over the documents in its source DMO, writing results to its output DLOs. Returns as soon as the run is triggered. Since v63.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `id_or_api_name` | `idOrApiName` | path | string | yes | ID or API name of the configuration. Since v63.0. |

```sql
CALL cdp.document_ai_process_run (id_or_api_name => 'Vendor_Invoice');
```

**Result**

No response body (HTTP 200). One row with only the standard columns.

**Done when:** Poll `document_ai_configuration_get.runtime_status` and `last_run_on`. The spec gives no enum: its examples show `SUCCESS` and `Ready`, so `Ready` may not mean the run finished.

**Notes:** The sources don't say what happens for a configuration with no source DMO, or whether it must be `Activated` first. Don't retry blindly: they also don't say whether a repeat run reprocesses documents, and batch runs spend credits. The [architect guide](https://architect.salesforce.com/docs/architect/fundamentals/guide/data360-document-ai) warns that credits can run out mid-run, leaving incomplete DLOs that look complete, and that batch failures are silent without monitoring. It advises wallet alerts at 75% and 90%. Check the DLOs in `extracted_dlos` to confirm the output.

## Schemas

Attribute names are keywords inside the object they belong to, so completion offers exactly these.

### IdpConfigExtractedDloFieldInputRepresentation

This type contains the fields required to configure an extracted field.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `data_type` | `dataType` | enum(STRING, NUMBER, DATE, BOOLEAN) | yes | Data type of the extracted field. Specifies how the field data should be interpreted. Since v63.0. |
| `label` | `label` | string | yes | Display label for the extracted field. This is the human-readable name for the field. Since v63.0. |
| `name` | `name` | string | yes | Name of the extracted field. This is the identifier for the field in the extracted data. Since v63.0. |
| `required` | `required` | boolean | yes | Whether the field is required. Indicates if this field must have a value in the extracted data. Since v63.0. |
| `validation_rules` | `validationRules` | object |  | Validation rules for the extracted field. Defines additional validation criteria for the field data. Since v63.0. |

### IdpConfigExtractedDloInputRepresentation

This type contains the fields required to configure DLO extraction settings.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `fields` | `fields` | array of [IdpConfigExtractedDloFieldInput](#idpconfigextracteddlofieldinputrepresentation) | yes | List of extracted DLO fields. Since v63.0. |
| `mapping_rules` | `mappingRules` | object |  | Mapping rules for extracted data. Defines how extracted data should be mapped to target fields. Since v63.0. |

### IdpFileAdditionalParamsInputRepresentation

Represents the additional parameters for file processing in IDP.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `sheet_name` | `sheetName` | string |  | Name of the sheet to extract data from, for Excel and Google Sheets files. Since v67.0. |

### IdpFileConfigInputRepresentation

This type contains the fields required to configure file processing settings.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `file_types` | `fileTypes` | array of string | yes | List of allowed file formats for processing. Specifies which file types can be processed by this configuration. Since v63.0. |

### IdpGenerateSchemaFileInputRepresentation

This type contains the fields required to generate a schema from a file.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `additional_params` | `additionalParams` | [IdpFileAdditionalParamsInput](#idpfileadditionalparamsinputrepresentation) |  | Additional parameters for file processing, for example, `sheet_name` for Excel and Google Sheets. Since v67.0. |
| `data` | `data` | string |  | Base64-encoded content of the file. The actual file data in base64 format. Since v63.0. |
| `file_id` | `fileId` | string |  | Either a Salesforce file Id or a URI to SF Drive. Spec examples: `068xxxxxxxxxxxxxxx`, `sfdrive://$dc_file_upload$/path-to-file`. Since v63.0. |
| `mime_type` | `mimeType` | string |  | The file type. Since v63.0. |
