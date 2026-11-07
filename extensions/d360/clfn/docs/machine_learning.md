<!-- Generated from extensions/d360/clfn/spec/machine_learning.yaml, edit that and run: bazel run //extensions/d360:update -->

# Machine Learning

Part of the [CDP function reference](functions.md). Nothing here is implemented or tested against an org. Every result also has the [standard columns](functions.md#result-schema).

This family trains predictive models, serves them, and manages retrievers for AI search. Everything sits under `/ssot/machine-learning`. Functions with evidence `S` come from Salesforce's [MCP server](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp) and aren't in the spec.

Training runs in this order. Inspect the data with `ml_query_setup_fields`, `ml_query_data_profile`, `ml_query_outcome` and `ml_query_row_count`. Then call `ml_model_setup_create`, `ml_setup_version_create` and `ml_setup_version_update` with `status = 'Training'`. A version that reaches `Published` produces a model artifact, and you wrap that artifact with `ml_configured_model_create`. Enable the configured model, then either score rows with `ml_predict` or batch-score a DMO with a prediction job.

Retrievers are separate. They need a search index with `runtime_status` = `READY`. Test one with `hybrid_search()` in a `SELECT` over the connection.

The gotchas that matter most:

- [Retrying `retriever_create` creates a duplicate](https://github.com/salesforce-misc/Data360AgentforceSolutionKitRetail/blob/main/.claude/skills/create-individual-retrievers/SKILL.md). List by label before retrying.
- Prediction job definitions start `Inactive`. Activate one before you run it, and deactivate it before most edits.
- For several `O` functions the spec declares only a base schema. Variant attributes such as `input_config` are in [Schemas](#schemas), and each function's notes say which apply.
- Keying differs: `model_setup_id_or_name` takes either, but a setup version takes only its ID.

```sql
CALL cdp.ml_setup_version_update (model_setup_id_or_name => 'Attrition_Risk_Predictor', model_setup_version_id => '14kSB0000005d8nYAA', status => 'Training');
CALL cdp.ml_configured_model_update (configured_model_id_or_name => 'Attrition_Predictor_Catboost', status => 'Enabled');
CALL cdp.prediction_job_def_update (prediction_job_def_id_or_name => 'attrition_scores', activation_status => 'Active');
CALL cdp.prediction_job_run (type => 'Prediction', input => (name = 'attrition_scores'));
CALL cdp.prediction_job_def_get (prediction_job_def_id_or_name => 'attrition_scores');
```

**Functions:** [`ml_configured_model_delete`](#ml_configured_model_delete), [`ml_model_artifact_delete`](#ml_model_artifact_delete), [`prediction_job_def_delete`](#prediction_job_def_delete), [`retriever_delete`](#retriever_delete), [`retriever_config_delete`](#retriever_config_delete), [`ml_configured_model_list`](#ml_configured_model_list), [`ml_configured_model_get`](#ml_configured_model_get), [`ml_job_list`](#ml_job_list), [`ml_job_get`](#ml_job_get), [`ml_job_task_list`](#ml_job_task_list), [`ml_job_task_get`](#ml_job_task_get), [`ml_model_artifact_list`](#ml_model_artifact_list), [`ml_model_artifact_get`](#ml_model_artifact_get), [`ml_setup_version_list`](#ml_setup_version_list), [`ml_setup_version_get`](#ml_setup_version_get), [`ml_setup_version_partition_list`](#ml_setup_version_partition_list), [`ml_setup_version_partition_get`](#ml_setup_version_partition_get), [`prediction_job_def_list`](#prediction_job_def_list), [`prediction_job_def_get`](#prediction_job_def_get), [`retriever_list`](#retriever_list), [`retriever_get`](#retriever_get), [`retriever_config_list`](#retriever_config_list), [`retriever_config_get`](#retriever_config_get), [`ml_alert_update`](#ml_alert_update), [`ml_configured_model_update`](#ml_configured_model_update), [`ml_model_artifact_update`](#ml_model_artifact_update), [`ml_setup_version_update`](#ml_setup_version_update), [`prediction_job_def_update`](#prediction_job_def_update), [`retriever_update`](#retriever_update), [`retriever_config_update`](#retriever_config_update), [`ml_alerts_query`](#ml_alerts_query), [`ml_setup_version_create`](#ml_setup_version_create), [`ml_predict`](#ml_predict), [`prediction_job_def_create`](#prediction_job_def_create), [`retriever_create`](#retriever_create), [`retriever_config_create`](#retriever_config_create), [`retriever_review`](#retriever_review), [`prediction_job_run`](#prediction_job_run), [`ml_setup_version_inspector_metrics_get`](#ml_setup_version_inspector_metrics_get), [`ml_configured_model_create`](#ml_configured_model_create), [`ml_configured_model_history_list`](#ml_configured_model_history_list), [`ml_configured_model_history_get`](#ml_configured_model_history_get), [`ml_query_setup_fields`](#ml_query_setup_fields), [`ml_query_data_profile`](#ml_query_data_profile), [`ml_query_outcome`](#ml_query_outcome), [`ml_query_row_count`](#ml_query_row_count), [`ml_model_setup_list`](#ml_model_setup_list), [`ml_model_setup_get`](#ml_model_setup_get), [`ml_model_setup_create`](#ml_model_setup_create), [`ml_model_setup_update`](#ml_model_setup_update), [`ml_model_setup_delete`](#ml_model_setup_delete)

## ml_configured_model_delete

`DELETE /ssot/machine-learning/configured-models/{configuredModelIdOrName}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Machine-Learning/paths/~1ssot~1machine-learning~1configured-models~1%7BconfiguredModelIdOrName%7D/delete) · tool `d360_ml_configured_model_delete` · evidence O · changes org state

Delete a configured model. Since v61.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `configured_model_id_or_name` | `configuredModelIdOrName` | path | string | yes | Configured model ID or name. A name has the form `<namespace>__<devname>`, for example `mynamespace__ourGPT35Turbo`. |

```sql
CALL cdp.ml_configured_model_delete (configured_model_id_or_name => '...');
```

**Result**

No response body (HTTP 200). One row with only the standard columns.

## ml_model_artifact_delete

`DELETE /ssot/machine-learning/model-artifacts/{modelArtifactIdOrName}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Machine-Learning/paths/~1ssot~1machine-learning~1model-artifacts~1%7BmodelArtifactIdOrName%7D/delete) · tool `d360_ml_model_artifact_delete` · evidence O · changes org state

Delete the model artifact. Since v61.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `model_artifact_id_or_name` | `modelArtifactIdOrName` | path | string | yes | Model artifact ID or developer name, for example `Attrition_Risk_Predictor_v1__mla`. |

```sql
CALL cdp.ml_model_artifact_delete (model_artifact_id_or_name => '...');
```

**Result**

No response body (HTTP 200). One row with only the standard columns.

**Notes:** [Predictive deletes do not cascade](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/runtime/FamilyCatalog.java): configured models that reference the artifact become orphaned. Check with `ml_configured_model_list (asset_id_or_name => ..., asset_type => 'ModelArtifact')` first.

## prediction_job_def_delete

`DELETE /ssot/machine-learning/prediction-job-definitions/{predictionJobDefIdOrName}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Machine-Learning/paths/~1ssot~1machine-learning~1prediction-job-definitions~1%7BpredictionJobDefIdOrName%7D/delete) · tool `d360_prediction_job_def_delete` · evidence O · changes org state

Delete a specific prediction job definition. Since v59.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `prediction_job_def_id_or_name` | `predictionJobDefIdOrName` | path | string | yes | Prediction job definition ID or API name. |

```sql
CALL cdp.prediction_job_def_delete (prediction_job_def_id_or_name => '...');
```

**Result**

No response body (HTTP 200). One row with only the standard columns.

**Notes:** [Irreversible](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/machinelearning/predictionjob/PredictionJobDefTools.java).

## retriever_delete

`DELETE /ssot/machine-learning/retrievers/{retrieverIdOrName}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Machine-Learning/paths/~1ssot~1machine-learning~1retrievers~1%7BretrieverIdOrName%7D/delete) · tool `d360_retriever_delete` · evidence O · changes org state

Deletes a retriever and all its configuration versions. The retriever must not be used by other entities. The spec marks this endpoint as pilot or beta. Since v61.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `retriever_id_or_name` | `retrieverIdOrName` | path | string | yes | Retriever ID or the parent retriever's top-level `name`. The `active_configuration.name` value returns `ITEM_NOT_FOUND`. |

```sql
CALL cdp.retriever_delete (retriever_id_or_name => '...');
```

**Result**

No response body (HTTP 200). One row with only the standard columns.

**Notes:** The way to remove a duplicate left by a retried `retriever_create`. [The kit](https://github.com/salesforce-misc/Data360AgentforceSolutionKitRetail/blob/main/.claude/skills/create-individual-retrievers/SKILL.md) (one org) saw HTTP 204 and the spec declares 200, so accept both.

## retriever_config_delete

`DELETE /ssot/machine-learning/retrievers/{retrieverIdOrName}/configurations/{retrieverConfigurationIdOrName}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Machine-Learning/paths/~1ssot~1machine-learning~1retrievers~1%7BretrieverIdOrName%7D~1configurations~1%7BretrieverConfigurationIdOrName%7D/delete) · tool `d360_retriever_config_delete` · evidence O · changes org state

Deletes one configuration version of a retriever. The spec marks this endpoint as pilot or beta. Since v61.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `retriever_configuration_id_or_name` | `retrieverConfigurationIdOrName` | path | string | yes | Configuration ID or name. |
| `retriever_id_or_name` | `retrieverIdOrName` | path | string | yes | Retriever ID or the parent retriever's top-level `name`. The `active_configuration.name` value returns `ITEM_NOT_FOUND`. |

```sql
CALL cdp.retriever_config_delete (retriever_configuration_id_or_name => '...', retriever_id_or_name => '...');
```

**Result**

No response body (HTTP 200). One row with only the standard columns.

## ml_configured_model_list

`GET /ssot/machine-learning/configured-models` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Machine-Learning/paths/~1ssot~1machine-learning~1configured-models/get) · tool `d360_ml_configured_model_list` · evidence O · read-only

Get the set of configured models and their properties. Since v61.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `asset_id_or_name` | `assetIdOrName` | query | string |  | The model's name or ID. If not provided, information for all configured models is returned. Since v61.0. |
| `asset_type` | `assetType` | query | enum(ModelArtifact, ModelSetup) |  | Whether the model is a configured model or a model artifact. Since v61.0. |
| `capabilities` | `capabilities` | query | array of enum(BinaryClassification, ChatCompletion, Completion, Embedding, Generic, MulticlassClassification, Regression) |  | Model capability. Since v61.0. |
| `connector_type` | `connectorType` | query | enum(Anthropic, AzureOpenAI, Bedrock, Databricks, Generic, InternalEmbedding, OpenAI, SageMaker, VertexAI) |  | For models that are externally connected, indicates the type of connector. Since v61.0. |
| `limit` | `limit` | query | integer |  | Maximum number of models to display on each page. Since v61.0. |
| `model_type` | `modelType` | query | enum(Generative, Predictive, Unknown) |  | The type of model. Since v61.0. |
| `offset` | `offset` | query | integer |  | The number of models to skip, or offset, during pagination. Since v61.0. |
| `out_of_the_box` | `outOfTheBox` | query | boolean |  | If `true`, the model is managed by Salesforce. Since v61.0. |
| `search` | `search` | query | string |  | The search string to use when filtering the query. Since v61.0. |
| `source_type` | `sourceType` | query | enum(EdcNoCode, ModelConnector, OutOfTheBox) |  | The model's source. - `OutOfTheBox` — a model managed by Salesforce. - `ModelConnector` — an external model exposed to Salesforce through a connector. - `EdcNoCode` — a model created using a no-code or low-code model builder. Since v61.0. |

```sql
CALL cdp.ml_configured_model_list (asset_id_or_name => 'Attrition_Risk_Predictor_v1__mla', asset_type => 'ModelArtifact');
```

**Result**

One row per item of `/configuredModels` in the response. Other response fields go to `_meta`: `currentPageUrl`, `nextPageUrl`, `totalSize`. Schema `MlConfiguredModelRepresentation`.

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
| `actionable_fields` | `actionableFields` | JSON (array of CdpMlCustomizableFieldRepresentation) | List of actionable fields. Since v61.0. |
| `activations` | `activations` | JSON | List of activations. Since v61.0. |
| `artifact` | `artifact` | JSON (CdpAssetReferenceRepresentation) | The model artifact. Since v61.0. |
| `capability` | `capability` | VARCHAR | Model capability. Since v61.0. |
| `connector_type` | `connectorType` | VARCHAR | If the configured model references a model connector, this parameter indicates the connector type. Since v61.0. |
| `description` | `description` | VARCHAR | User-defined description of the configured model. Since v61.0. |
| `foundational_model` | `foundationalModel` | JSON (CdpMlFoundationalModelRepresentation) | Details for the foundational model. Since v59.0. |
| `generative_model_type` | `generativeModelType` | VARCHAR | Type of generative model. Since v59.0. |
| `input_fields` | `inputFields` | JSON (array of CdpMlModelInputFieldBaseRepresentation) | List of input features into the model. Since v59.0. |
| `input_types` | `inputTypes` | JSON (array of MlModelInputTypeRepresentation) | List of supporting input types for multi-modalities. This includes parameters, such as maxToken for text input limits or maxImages for image input capacity. Since v63.0. |
| `is_batch_supported` | `isBatchSupported` | BOOLEAN | Indicates whether this model supports batch (`true`) or not (`false`). Since v63.0. |
| `last_activated_by` | `lastActivatedBy` | JSON (CdpUserRepresentation) | Information about the user who last activated the configured model. Since v61.0. |
| `last_activated_date` | `lastActivatedDate` | VARCHAR | Date the configured model was last activated. Since v61.0. |
| `model_capabilities` | `modelCapabilities` | JSON | List of capabilities supported by the model. Since v63.0. |
| `model_disabled_reasons` | `modelDisabledReasons` | JSON | Reason(s) why the model status is disabled. Since v64.0. |
| `model_type` | `modelType` | VARCHAR | Referenced model type. Since v61.0. |
| `output_fields` | `outputFields` | JSON (array of CdpMlModelOutputFieldRepresentation) | List of output features from the model. Since v59.0. |
| `output_types` | `outputTypes` | JSON (array of MlModelOutputTypeRepresentation) | List of supporting output types for multi-modalities, including parameters and their corresponding values. Since v63.0. |
| `parameter_overrides` | `parameterOverrides` | JSON (array of CdpMlModelParameterOverrideBaseRepresentation) | List of model parameter overrides. Since v61.0. |
| `parameters` | `parameters` | JSON (array of CdpMlModelParameterDefinitionBaseRepresentation) | List of parameters supported by the model. Since v59.0. |
| `runtime_type` | `runtimeType` | VARCHAR | Model runtime type. Since v59.0. |
| `setup_type` | `setupType` | VARCHAR | Referenced setup type. - `OutOfTheBox` — a model managed by Salesforce. - `ModelConnector` — an external model exposed to Salesforce through a connector. - `EdcNoCode` — a model created using a no-code or low-code model builder. Since v61.0. |
| `status` | `status` | VARCHAR | Model status. Since v61.0. |
| `visibility` | `visibility` | VARCHAR | Model visibility. Since v62.0. |

**Paging:** `next_page_url`.

**Notes:** `asset_id_or_name` with `asset_type` finds the configured models [bound to an artifact or a model setup](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/machinelearning/configuredmodel/ConfiguredModelTools.java). The MCP server lists enum values the spec omits: `model_type` also takes `Transcribe`, `SpeechSynthesis` and `Summarization`, and `capabilities` also takes `Clustering`, `Transcribe`, `SpeechSynthesis`, `Summarization`, `Forecast`, `SentimentAnalysis` and `TopicClassification`. It also has a `data_cloud_one_visibility` filter (`All`, `Local`, `Remote`, `Consumable`) that the spec lacks.

## ml_configured_model_get

`GET /ssot/machine-learning/configured-models/{configuredModelIdOrName}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Machine-Learning/paths/~1ssot~1machine-learning~1configured-models~1%7BconfiguredModelIdOrName%7D/get) · tool `d360_ml_configured_model_get` · evidence O · read-only

Get the configured model. If using the model's name, use `<namespace>__<devname>`, for example `mynamespace__ourGPT35Turbo`. Since v61.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `configured_model_id_or_name` | `configuredModelIdOrName` | path | string | yes | Configured model ID or name. A name has the form `<namespace>__<devname>`, for example `mynamespace__ourGPT35Turbo`. |
| `filter_group` | `filterGroup` | query | string |  | Group on which to filter response results. Valid values are `Big`, `Medium`, and `Small`. - `Big` provides comprehensive results by returning properties whose filter group is `Big`, `Medium`, or `Small`. - `Medium` provides moderate results by returning properties whose filter group is `Medium` or `Small`. - `Small` provides essential results by returning only properties whose filter group is `Small`. The default is `Big`. Since v61.0. |

```sql
CALL cdp.ml_configured_model_get (configured_model_id_or_name => 'Attrition_Predictor_Catboost');
```

**Result**

One row. Schema `MlConfiguredModelRepresentation`.

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
| `actionable_fields` | `actionableFields` | JSON (array of CdpMlCustomizableFieldRepresentation) | List of actionable fields. Since v61.0. |
| `activations` | `activations` | JSON | List of activations. Since v61.0. |
| `artifact` | `artifact` | JSON (CdpAssetReferenceRepresentation) | The model artifact. Since v61.0. |
| `capability` | `capability` | VARCHAR | Model capability. Since v61.0. |
| `connector_type` | `connectorType` | VARCHAR | If the configured model references a model connector, this parameter indicates the connector type. Since v61.0. |
| `description` | `description` | VARCHAR | User-defined description of the configured model. Since v61.0. |
| `foundational_model` | `foundationalModel` | JSON (CdpMlFoundationalModelRepresentation) | Details for the foundational model. Since v59.0. |
| `generative_model_type` | `generativeModelType` | VARCHAR | Type of generative model. Since v59.0. |
| `input_fields` | `inputFields` | JSON (array of CdpMlModelInputFieldBaseRepresentation) | List of input features into the model. Since v59.0. |
| `input_types` | `inputTypes` | JSON (array of MlModelInputTypeRepresentation) | List of supporting input types for multi-modalities. This includes parameters, such as maxToken for text input limits or maxImages for image input capacity. Since v63.0. |
| `is_batch_supported` | `isBatchSupported` | BOOLEAN | Indicates whether this model supports batch (`true`) or not (`false`). Since v63.0. |
| `last_activated_by` | `lastActivatedBy` | JSON (CdpUserRepresentation) | Information about the user who last activated the configured model. Since v61.0. |
| `last_activated_date` | `lastActivatedDate` | VARCHAR | Date the configured model was last activated. Since v61.0. |
| `model_capabilities` | `modelCapabilities` | JSON | List of capabilities supported by the model. Since v63.0. |
| `model_disabled_reasons` | `modelDisabledReasons` | JSON | Reason(s) why the model status is disabled. Since v64.0. |
| `model_type` | `modelType` | VARCHAR | Referenced model type. Since v61.0. |
| `output_fields` | `outputFields` | JSON (array of CdpMlModelOutputFieldRepresentation) | List of output features from the model. Since v59.0. |
| `output_types` | `outputTypes` | JSON (array of MlModelOutputTypeRepresentation) | List of supporting output types for multi-modalities, including parameters and their corresponding values. Since v63.0. |
| `parameter_overrides` | `parameterOverrides` | JSON (array of CdpMlModelParameterOverrideBaseRepresentation) | List of model parameter overrides. Since v61.0. |
| `parameters` | `parameters` | JSON (array of CdpMlModelParameterDefinitionBaseRepresentation) | List of parameters supported by the model. Since v59.0. |
| `runtime_type` | `runtimeType` | VARCHAR | Model runtime type. Since v59.0. |
| `setup_type` | `setupType` | VARCHAR | Referenced setup type. - `OutOfTheBox` — a model managed by Salesforce. - `ModelConnector` — an external model exposed to Salesforce through a connector. - `EdcNoCode` — a model created using a no-code or low-code model builder. Since v61.0. |
| `status` | `status` | VARCHAR | Model status. Since v61.0. |
| `visibility` | `visibility` | VARCHAR | Model visibility. Since v62.0. |

**Notes:** Read `status` and `model_disabled_reasons` to see why a model isn't usable. For `filter_group` the spec gives `Big`, `Medium` and `Small`, while the [MCP tool](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/machinelearning/configuredmodel/ConfiguredModelTools.java) gives `Small` and `Supplemental` as examples.

## ml_job_list

`GET /ssot/machine-learning/jobs` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Machine-Learning/paths/~1ssot~1machine-learning~1jobs/get) · evidence O · read-only

Get a list of predict jobs. Since v59.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `job_id_or_name` | `jobIdOrName` | query | string |  | ID or API name of the predict job. Since v59.0. |
| `limit` | `limit` | query | integer |  | Maximum number of predict jobs to return. Since v59.0. |
| `offset` | `offset` | query | integer |  | Number of rows to skip before returning results. If unspecified, no rows are skipped. Since v59.0. |
| `type` | `type` | query | enum(Prediction, Training) |  | Type of job. Since v59.0. |

```sql
CALL cdp.ml_job_list (type => 'Prediction', limit => 25);
```

**Result**

One row per item of `/jobs` in the response. Other response fields go to `_meta`: `currentPageUrl`, `nextPageUrl`, `totalSize`. Schema `CdpMlJobBaseRepresentation`.

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
| `description` | `description` | VARCHAR | Description of the job. Since v59.0. |
| `end_time` | `endTime` | VARCHAR | End time of the job run. Since v59.0. |
| `input` | `input` | JSON (CdpAssetReferenceRepresentation) | Asset input for the job run. For `Training` types, use the model setup ID. For `Prediction` types, use the model container ID. Since v59.0. |
| `message` | `message` | VARCHAR | Message associated with the job run. Since v59.0. |
| `start_time` | `startTime` | VARCHAR | Start time of the job run. Since v59.0. |
| `type` | `type` | VARCHAR | Type of job. Since v59.0. |
| `number_of_tasks` | `numberOfTasks` | BIGINT | Not in the spec schema: from the spec's examples. |
| `status` | `status` | VARCHAR | Not in the spec schema: from the spec's examples. |
| `tasks_url` | `tasksUrl` | VARCHAR | Not in the spec schema: from the spec's examples. |
| `total_rows_processed` | `totalRowsProcessed` | BIGINT | Not in the spec schema: from the spec's examples. |
| `trigger_type` | `triggerType` | VARCHAR | Not in the spec schema: from the spec's examples. |

**Paging:** `next_page_url`.

**Notes:** Despite the name this covers training jobs too: `type` is `Prediction` or `Training`. The spec's example has `status`, `number_of_tasks` and `tasks_url` on each job, but its schema doesn't declare them, so they aren't columns. Read them from `_raw`.

## ml_job_get

`GET /ssot/machine-learning/jobs/{jobId}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Machine-Learning/paths/~1ssot~1machine-learning~1jobs~1%7BjobId%7D/get) · evidence O · read-only

Get a specific predict job. Since v59.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `job_id` | `jobId` | path | string | yes | ID of the predict job. Since v59.0. |

```sql
CALL cdp.ml_job_get (job_id => '...');
```

**Result**

One row. Schema `CdpMlJobBaseRepresentation`.

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
| `description` | `description` | VARCHAR | Description of the job. Since v59.0. |
| `end_time` | `endTime` | VARCHAR | End time of the job run. Since v59.0. |
| `input` | `input` | JSON (CdpAssetReferenceRepresentation) | Asset input for the job run. For `Training` types, use the model setup ID. For `Prediction` types, use the model container ID. Since v59.0. |
| `message` | `message` | VARCHAR | Message associated with the job run. Since v59.0. |
| `start_time` | `startTime` | VARCHAR | Start time of the job run. Since v59.0. |
| `type` | `type` | VARCHAR | Type of job. Since v59.0. |
| `number_of_tasks` | `numberOfTasks` | BIGINT | Not in the spec schema: from the spec's examples. |
| `status` | `status` | VARCHAR | Not in the spec schema: from the spec's examples. |
| `tasks_url` | `tasksUrl` | VARCHAR | Not in the spec schema: from the spec's examples. |
| `total_rows_processed` | `totalRowsProcessed` | BIGINT | Not in the spec schema: from the spec's examples. |
| `trigger_type` | `triggerType` | VARCHAR | Not in the spec schema: from the spec's examples. |

**Notes:** `job_id` is the `14q...` ID from `prediction_job_run`, or `job.id` on a setup version for a training job. The spec's example has `status` (for example `Success`), but its schema doesn't declare it, so read it from `_raw`. The `input` column points at the asset that ran: per the spec, the model setup for `Training` and the model container for `Prediction`, while the spec's training example shows a `14k...` setup version ID.

## ml_job_task_list

`GET /ssot/machine-learning/jobs/{jobId}/tasks` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Machine-Learning/paths/~1ssot~1machine-learning~1jobs~1%7BjobId%7D~1tasks/get) · evidence O · read-only

Get a list of tasks associated with a specific predict job. Since v59.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `job_id` | `jobId` | path | string | yes | ID of the predict job. Since v59.0. |

```sql
CALL cdp.ml_job_task_list (job_id => '...');
```

**Result**

One row per item of `/tasks` in the response. Schema `CdpMlTaskBase`.

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
| `end_time` | `endTime` | VARCHAR | End time of the job run. Since v59.0. |
| `error_code` | `errorCode` | VARCHAR | Error code, if any. Since v59.0. |
| `message` | `message` | VARCHAR | Message associated with the job run. Since v59.0. |
| `start_time` | `startTime` | VARCHAR | Start time of the job run. Since v59.0. |
| `configuration_result` | `configurationResult` | JSON | Not in the spec schema: from the spec's examples. |
| `input` | `input` | JSON | Not in the spec schema: from the spec's examples. |
| `result_artifact` | `resultArtifact` | JSON | Not in the spec schema: from the spec's examples. |
| `status` | `status` | VARCHAR | Not in the spec schema: from the spec's examples. |

## ml_job_task_get

`GET /ssot/machine-learning/jobs/{jobId}/tasks/{taskId}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Machine-Learning/paths/~1ssot~1machine-learning~1jobs~1%7BjobId%7D~1tasks~1%7BtaskId%7D/get) · evidence O · read-only

Get a task associated with a specific predict job. Since v59.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `job_id` | `jobId` | path | string | yes | ID of the predict job. Since v59.0. |
| `task_id` | `taskId` | path | string | yes | ID of the task. Since v59.0. |

```sql
CALL cdp.ml_job_task_get (job_id => '...', task_id => '...');
```

**Result**

One row. Schema `CdpMlTaskBase`.

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
| `end_time` | `endTime` | VARCHAR | End time of the job run. Since v59.0. |
| `error_code` | `errorCode` | VARCHAR | Error code, if any. Since v59.0. |
| `message` | `message` | VARCHAR | Message associated with the job run. Since v59.0. |
| `start_time` | `startTime` | VARCHAR | Start time of the job run. Since v59.0. |
| `configuration_result` | `configurationResult` | JSON | Not in the spec schema: from the spec's examples. |
| `input` | `input` | JSON | Not in the spec schema: from the spec's examples. |
| `result_artifact` | `resultArtifact` | JSON | Not in the spec schema: from the spec's examples. |
| `status` | `status` | VARCHAR | Not in the spec schema: from the spec's examples. |

## ml_model_artifact_list

`GET /ssot/machine-learning/model-artifacts` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Machine-Learning/paths/~1ssot~1machine-learning~1model-artifacts/get) · tool `d360_ml_model_artifact_list` · evidence O · read-only

Get model artifacts. Since v61.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `limit` | `limit` | query | integer |  | Maximum number of artifacts to return. Since v61.0. |
| `model_type` | `modelType` | query | enum(Generative, Predictive, Unknown) |  | Type of artifacts to return. Since v61.0. |
| `offset` | `offset` | query | integer |  | The number of models to skip, or offset, during pagination. Since v61.0. |
| `source_type` | `sourceType` | query | enum(EdcNoCode, ModelConnector, OutOfTheBox) |  | The model's source. - `OutOfTheBox` — a model managed by Salesforce. - `ModelConnector` — an external model exposed to Salesforce through a connector. - `EdcNoCode` — a model created using a no-code or low-code model builder. Since v61.0. |

```sql
CALL cdp.ml_model_artifact_list ();
```

**Result**

One row per item of `/modelArtifacts` in the response. Other response fields go to `_meta`: `currentPageUrl`, `nextPageUrl`, `totalSize`. Schema `CdpMlModelArtifactBaseRepresentation`.

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
| `description` | `description` | VARCHAR | Description of the artifact. Since v61.0. |
| `input_fields` | `inputFields` | JSON (array of CdpMlModelInputFieldBaseRepresentation) | Input fields for the model artifact. **Available Version: 61.0** |
| `is_batch_supported` | `isBatchSupported` | BOOLEAN | Indicates whether this model supports batch (`true`) or not (`false`). Since v63.0. |
| `model_connector_endpoint` | `modelConnectorEndpoint` | JSON (MlConnectorEndpointRepresentation) | Model connector endpoint definition. Since v61.0. |
| `model_count` | `modelCount` | BIGINT | Number of configured models from this model artifact. Since v61.0. |
| `model_disabled_reasons` | `modelDisabledReasons` | JSON | Reason(s) why the model status is disabled. Since v64.0. |
| `model_type` | `modelType` | VARCHAR | Model type. Since v61.0. |
| `output_fields` | `outputFields` | JSON (array of CdpMlModelOutputFieldRepresentation) | Model artifact's output fields. **Available Version: 61.0** |
| `parameters` | `parameters` | JSON (array of CdpMlModelParameterDefinitionBaseRepresentation) | Model parameters. Since v61.0. |
| `runtime_type` | `runtimeType` | VARCHAR | Runtime type. Since v61.0. |
| `setup_container` | `setupContainer` | JSON (CdpAssetReferenceRepresentation) | Setup container. **Available Version: 61.0** |
| `source` | `source` | JSON (CdpAssetReferenceRepresentation) | Information about the source of the artifact. Since v61.0. |
| `source_container` | `sourceContainer` | JSON (CdpAssetReferenceRepresentation) | Information about the artifact's source container. Since v61.0. |
| `source_type` | `sourceType` | VARCHAR | The type of model artifact. - `OutOfTheBox` - an artifact managed by Salesforce. - `ModelConnector` - an external artifact exposed to Salesforce through a connector. - `EdcNoCode` - an artifact created using a no-code or low-code model builder. Since v61.0. |
| `status` | `status` | VARCHAR | Model artifact status. Since v61.0. |
| `sync_status` | `syncStatus` | VARCHAR | Sync status. Since v61.0. |
| `foundational_model` | `foundationalModel` | JSON | Not in the spec schema: from the spec's examples. |
| `generative_model_type` | `generativeModelType` | VARCHAR | Not in the spec schema: from the spec's examples. |
| `model_capabilities` | `modelCapabilities` | JSON | Not in the spec schema: from the spec's examples. |

**Paging:** `next_page_url`.

**Notes:** There is no create call: [artifacts are created automatically](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/machinelearning/modelartifact/ModelArtifactTools.java) when a setup version reaches `Published`. The MCP tool lists more `model_type` values than the spec (`Transcribe`, `SpeechSynthesis`, `Summarization`) and a `data_cloud_one_visibility` filter the spec lacks.

## ml_model_artifact_get

`GET /ssot/machine-learning/model-artifacts/{modelArtifactIdOrName}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Machine-Learning/paths/~1ssot~1machine-learning~1model-artifacts~1%7BmodelArtifactIdOrName%7D/get) · tool `d360_ml_model_artifact_get` · evidence O · read-only

Get the model artifact. Since v61.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `model_artifact_id_or_name` | `modelArtifactIdOrName` | path | string | yes | Model artifact ID or developer name, for example `Attrition_Risk_Predictor_v1__mla`. |

```sql
CALL cdp.ml_model_artifact_get (model_artifact_id_or_name => 'Attrition_Risk_Predictor_v1__mla');
```

**Result**

One row. Schema `CdpMlModelArtifactBaseRepresentation`.

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
| `description` | `description` | VARCHAR | Description of the artifact. Since v61.0. |
| `input_fields` | `inputFields` | JSON (array of CdpMlModelInputFieldBaseRepresentation) | Input fields for the model artifact. **Available Version: 61.0** |
| `is_batch_supported` | `isBatchSupported` | BOOLEAN | Indicates whether this model supports batch (`true`) or not (`false`). Since v63.0. |
| `model_connector_endpoint` | `modelConnectorEndpoint` | JSON (MlConnectorEndpointRepresentation) | Model connector endpoint definition. Since v61.0. |
| `model_count` | `modelCount` | BIGINT | Number of configured models from this model artifact. Since v61.0. |
| `model_disabled_reasons` | `modelDisabledReasons` | JSON | Reason(s) why the model status is disabled. Since v64.0. |
| `model_type` | `modelType` | VARCHAR | Model type. Since v61.0. |
| `output_fields` | `outputFields` | JSON (array of CdpMlModelOutputFieldRepresentation) | Model artifact's output fields. **Available Version: 61.0** |
| `parameters` | `parameters` | JSON (array of CdpMlModelParameterDefinitionBaseRepresentation) | Model parameters. Since v61.0. |
| `runtime_type` | `runtimeType` | VARCHAR | Runtime type. Since v61.0. |
| `setup_container` | `setupContainer` | JSON (CdpAssetReferenceRepresentation) | Setup container. **Available Version: 61.0** |
| `source` | `source` | JSON (CdpAssetReferenceRepresentation) | Information about the source of the artifact. Since v61.0. |
| `source_container` | `sourceContainer` | JSON (CdpAssetReferenceRepresentation) | Information about the artifact's source container. Since v61.0. |
| `source_type` | `sourceType` | VARCHAR | The type of model artifact. - `OutOfTheBox` - an artifact managed by Salesforce. - `ModelConnector` - an external artifact exposed to Salesforce through a connector. - `EdcNoCode` - an artifact created using a no-code or low-code model builder. Since v61.0. |
| `status` | `status` | VARCHAR | Model artifact status. Since v61.0. |
| `sync_status` | `syncStatus` | VARCHAR | Sync status. Since v61.0. |
| `foundational_model` | `foundationalModel` | JSON | Not in the spec schema: from the spec's examples. |
| `generative_model_type` | `generativeModelType` | VARCHAR | Not in the spec schema: from the spec's examples. |
| `model_capabilities` | `modelCapabilities` | JSON | Not in the spec schema: from the spec's examples. |

**Notes:** `source` links back to the setup version and `setup_container` to the model setup. The [MCP tool](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/machinelearning/modelartifact/ModelArtifactTools.java) also passes a `filter_group` query parameter that the spec doesn't declare on this path.

## ml_setup_version_list

`GET /ssot/machine-learning/model-setups/{modelSetupIdOrName}/setup-versions` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Machine-Learning/paths/~1ssot~1machine-learning~1model-setups~1%7BmodelSetupIdOrName%7D~1setup-versions/get) · tool `d360_ml_setup_version_list` · evidence O · read-only

Retrieve a list of model setup versions. Since v59.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `model_setup_id_or_name` | `modelSetupIdOrName` | path | string | yes | Model setup ID or developer name. |
| `active` | `active` | query | boolean |  | Indicates whether the model setup is active (`true`) or not (`false`). Since v59.0. |
| `limit` | `limit` | query | integer |  | Maximum number of model setup versions to return. Since v59.0. |
| `offset` | `offset` | query | integer |  | Number of rows to skip before returning results. If unspecified, no rows are skipped. Since v59.0. |

```sql
CALL cdp.ml_setup_version_list (model_setup_id_or_name => 'Attrition_Risk_Predictor', limit => 25);
```

**Result**

One row per item of `/versions` in the response. Other response fields go to `_meta`: `currentPageUrl`, `nextPageUrl`, `totalSize`. Schema `CdpMlSetupBaseRepresentation`.

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
| `active` | `active` | BOOLEAN | Indicates whether the setup is active (`true`) or not (`false`). Since v59.0. |
| `description` | `description` | VARCHAR | Description of the setup. Since v59.0. |
| `number_of_partitions` | `numberOfPartitions` | BIGINT | Number of partitions in a model setup version. Since v59.0. |
| `partitions_url` | `partitionsUrl` | VARCHAR | URL for retrieving the partitions associated with a model setup version. Since v59.0. |
| `type` | `type` | VARCHAR | Setup type. Since v59.0. |
| `version` | `version` | BIGINT | Setup version number. Since v59.0. |
| `field_relationships` | `fieldRelationships` | JSON | Not in the spec schema: from the spec's examples. |
| `field_selection` | `fieldSelection` | VARCHAR | Not in the spec schema: from the spec's examples. |
| `fields` | `fields` | JSON | Not in the spec schema: from the spec's examples. |
| `filter` | `filter` | JSON | Not in the spec schema: from the spec's examples. |
| `input` | `input` | JSON | Not in the spec schema: from the spec's examples. |
| `job` | `job` | JSON | Not in the spec schema: from the spec's examples. |
| `joins` | `joins` | JSON | Not in the spec schema: from the spec's examples. |
| `model_configuration` | `modelConfiguration` | JSON | Not in the spec schema: from the spec's examples. |
| `outcomes` | `outcomes` | JSON | Not in the spec schema: from the spec's examples. |
| `status` | `status` | VARCHAR | Not in the spec schema: from the spec's examples. |
| `transformations` | `transformations` | JSON | Not in the spec schema: from the spec's examples. |
| `validation_configuration` | `validationConfiguration` | JSON | Not in the spec schema: from the spec's examples. |

**Paging:** `next_page_url`.

**Notes:** The spec and its example use `versions` as the list key. An [MCP test fixture](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/test/java/com/salesforce/data360/mcp/tools/machinelearning/setup/ModelSetupToolsTest.java) uses `setupVersions`, so verify this against an org.

## ml_setup_version_get

`GET /ssot/machine-learning/model-setups/{modelSetupIdOrName}/setup-versions/{modelSetupVersionId}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Machine-Learning/paths/~1ssot~1machine-learning~1model-setups~1%7BmodelSetupIdOrName%7D~1setup-versions~1%7BmodelSetupVersionId%7D/get) · tool `d360_ml_setup_version_get` · evidence O · read-only

Retrieve a specific model setup version. Since v59.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `model_setup_id_or_name` | `modelSetupIdOrName` | path | string | yes | Model setup ID or developer name. |
| `model_setup_version_id` | `modelSetupVersionId` | path | string | yes | Setup version ID. A name is not accepted. Get it from `ml_setup_version_list` or the `ml_setup_version_create` result. |

```sql
CALL cdp.ml_setup_version_get (model_setup_id_or_name => 'Attrition_Risk_Predictor', model_setup_version_id => '14kSB0000005d8nYAA');
```

**Result**

One row. Schema `CdpMlSetupBaseRepresentation`.

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
| `active` | `active` | BOOLEAN | Indicates whether the setup is active (`true`) or not (`false`). Since v59.0. |
| `description` | `description` | VARCHAR | Description of the setup. Since v59.0. |
| `number_of_partitions` | `numberOfPartitions` | BIGINT | Number of partitions in a model setup version. Since v59.0. |
| `partitions_url` | `partitionsUrl` | VARCHAR | URL for retrieving the partitions associated with a model setup version. Since v59.0. |
| `type` | `type` | VARCHAR | Setup type. Since v59.0. |
| `version` | `version` | BIGINT | Setup version number. Since v59.0. |
| `field_relationships` | `fieldRelationships` | JSON | Not in the spec schema: from the spec's examples. |
| `field_selection` | `fieldSelection` | VARCHAR | Not in the spec schema: from the spec's examples. |
| `fields` | `fields` | JSON | Not in the spec schema: from the spec's examples. |
| `filter` | `filter` | JSON | Not in the spec schema: from the spec's examples. |
| `input` | `input` | JSON | Not in the spec schema: from the spec's examples. |
| `job` | `job` | JSON | Not in the spec schema: from the spec's examples. |
| `joins` | `joins` | JSON | Not in the spec schema: from the spec's examples. |
| `model_configuration` | `modelConfiguration` | JSON | Not in the spec schema: from the spec's examples. |
| `outcomes` | `outcomes` | JSON | Not in the spec schema: from the spec's examples. |
| `status` | `status` | VARCHAR | Not in the spec schema: from the spec's examples. |
| `transformations` | `transformations` | JSON | Not in the spec schema: from the spec's examples. |
| `validation_configuration` | `validationConfiguration` | JSON | Not in the spec schema: from the spec's examples. |

**Notes:** Poll this during training. [The lifecycle](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/machinelearning/setup/ModelSetupTools.java) is `Draft`, `Training`, then `Published` or `Failed`, and the platform sets the last two. The columns come from the spec's base schema, which lacks the fields you need here. The spec's example also has `status`, `job`, `input`, `outcomes`, `fields`, `transformations` and `modelConfiguration`, so read those from `_raw`. The MCP server also mentions a `modelArtifact` field on a published version, for `ml_configured_model_create`.

## ml_setup_version_partition_list

`GET /ssot/machine-learning/model-setups/{modelSetupIdOrName}/setup-versions/{modelSetupVersionId}/partitions` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Machine-Learning/paths/~1ssot~1machine-learning~1model-setups~1%7BmodelSetupIdOrName%7D~1setup-versions~1%7BmodelSetupVersionId%7D~1partitions/get) · evidence O · read-only

Retrieve all partitions of a specific model setup version. Since v59.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `model_setup_version_id` | `modelSetupVersionId` | path | string | yes | In the path, but missing from the spec's parameters. |
| `model_setup_id_or_name` | `modelSetupIdOrName` | path | string | yes | In the path, but missing from the spec's parameters. |

```sql
CALL cdp.ml_setup_version_partition_list (model_setup_id_or_name => 'Attrition_Risk_Predictor', model_setup_version_id => '14kSB0000005d8nYAA');
```

**Result**

One row per item of `/partitions` in the response. Other response fields go to `_meta`: `totalSize`, `url`. Schema `CdpMlSetupPartitionBaseRepresentation`.

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
| `description` | `description` | VARCHAR | Description of the model setup partition. Since v59.0. |
| `type` | `type` | VARCHAR | Setup type. Since v59.0. |

**Notes:** The options table is wrong: the path requires `model_setup_id_or_name` and `model_setup_version_id`, but the contract declares no parameters for this operation. The result is one row with `partitions` as a JSON array.

## ml_setup_version_partition_get

`GET /ssot/machine-learning/model-setups/{modelSetupIdOrName}/setup-versions/{modelSetupVersionId}/partitions/{modelSetupPartitionId}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Machine-Learning/paths/~1ssot~1machine-learning~1model-setups~1%7BmodelSetupIdOrName%7D~1setup-versions~1%7BmodelSetupVersionId%7D~1partitions~1%7BmodelSetupPartitionId%7D/get) · evidence O · read-only

Retrieve a partition of a specific model setup version. Since v59.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `model_setup_id_or_name` | `modelSetupIdOrName` | path | string | yes | Model setup ID or developer name. |
| `model_setup_partition_id` | `modelSetupPartitionId` | path | string | yes | ID of the model setup partition. Since v59.0. |
| `model_setup_version_id` | `modelSetupVersionId` | path | string | yes | Setup version ID. A name is not accepted. Get it from `ml_setup_version_list` or the `ml_setup_version_create` result. |

```sql
CALL cdp.ml_setup_version_partition_get (model_setup_id_or_name => '...', model_setup_partition_id => '...', model_setup_version_id => '...');
```

**Result**

One row. Schema `CdpMlSetupPartitionBaseRepresentation`.

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
| `description` | `description` | VARCHAR | Description of the model setup partition. Since v59.0. |
| `type` | `type` | VARCHAR | Setup type. Since v59.0. |

## prediction_job_def_list

`GET /ssot/machine-learning/prediction-job-definitions` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Machine-Learning/paths/~1ssot~1machine-learning~1prediction-job-definitions/get) · tool `d360_prediction_job_def_list` · evidence O · read-only

Get a list of existing prediction job definitions. Since v59.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `model_id` | `modelId` | query | string |  | ID of the machine learning model. Since v59.0. |

```sql
CALL cdp.prediction_job_def_list ();
```

**Result**

One row per item of `/predictionJobDefinitions` in the response. Other response fields go to `_meta`: `totalSize`, `url`. Schema `MlPredictionJobDefBaseRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `clustering_settings` | `clusteringSettings` | JSON (MlClusteringJobDefSettingsRepresentation) | - |
| `multiclass_classification_settings` | `multiclassClassificationSettings` | JSON (MlMulticlassClassificationJobDefSettingsRepresentation) | - |
| `prediction_settings` | `predictionSettings` | JSON (MlPredictionJobDefSettingsRepresentation) | - |
| `regression_settings` | `regressionSettings` | JSON (MlRegressionJobDefSettingsRepresentation) | - |
| `input_config` | `inputConfig` | JSON (MlPredictionJobDefFeaturesConfigRepresentation) | - |
| `activation_status` | `activationStatus` | VARCHAR | Activation status of the prediction job. Since v59.0. |
| `dataspace` | `dataSpace` | JSON (CdpAssetReferenceRepresentation) | Data space details for the prediction job. Since v59.0. |
| `description` | `description` | VARCHAR | Description of the prediction job. Since v59.0. |
| `last_run_date` | `lastRunDate` | VARCHAR | Last execution date for the prediction job. Since v59.0. |
| `last_run_status` | `lastRunStatus` | VARCHAR | Status of the last execution. Since v59.0. |
| `model` | `model` | JSON (CdpAssetReferenceRepresentation) | Model associated with the prediction job. Since v59.0. |
| `output_config` | `outputConfig` | JSON (MlPredictionJobDefPredictionsConfigRepresentation) | Output data model object (DMO) details. Since v59.0. |
| `scoring_mode` | `scoringMode` | VARCHAR | Scoring mode for the prediction job. Since v59.0. |
| `type` | `type` | VARCHAR | Type of prediction job. The endpoint returns the job def output object that corresponds to the job type. For example, the Ml Binary Classification Job Def Output is returned for the `BinaryClassification` job type. Since v59.0. |
| `binary_classification_settings` | `binaryClassificationSettings` | JSON (MlBinaryClassificationJobDefSettingsRepresentation) | - |
| `created_by` | `createdBy` | JSON | Not in the spec schema: from the spec's examples. |
| `created_date` | `createdDate` | VARCHAR | Not in the spec schema: from the spec's examples. |
| `id` | `id` | VARCHAR | Not in the spec schema: from the spec's examples. |
| `label` | `label` | VARCHAR | Not in the spec schema: from the spec's examples. |
| `last_modified_by` | `lastModifiedBy` | JSON | Not in the spec schema: from the spec's examples. |
| `last_modified_date` | `lastModifiedDate` | VARCHAR | Not in the spec schema: from the spec's examples. |
| `name` | `name` | VARCHAR | Not in the spec schema: from the spec's examples. |
| `namespace` | `namespace` | VARCHAR | Not in the spec schema: from the spec's examples. |

**Notes:** `model_id` is a [configured model ID](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/machinelearning/predictionjob/PredictionJobDefTools.java). The result is one row with `predictionJobDefinitions` as a JSON array, not one row per definition.

## prediction_job_def_get

`GET /ssot/machine-learning/prediction-job-definitions/{predictionJobDefIdOrName}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Machine-Learning/paths/~1ssot~1machine-learning~1prediction-job-definitions~1%7BpredictionJobDefIdOrName%7D/get) · tool `d360_prediction_job_def_get` · evidence O · read-only

Get a specific prediction job definition. Since v59.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `prediction_job_def_id_or_name` | `predictionJobDefIdOrName` | path | string | yes | Prediction job definition ID or API name. |

```sql
CALL cdp.prediction_job_def_get (prediction_job_def_id_or_name => 'attrition_scores');
```

**Result**

One row. Schema `MlPredictionJobDefBaseRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `clustering_settings` | `clusteringSettings` | JSON (MlClusteringJobDefSettingsRepresentation) | - |
| `multiclass_classification_settings` | `multiclassClassificationSettings` | JSON (MlMulticlassClassificationJobDefSettingsRepresentation) | - |
| `prediction_settings` | `predictionSettings` | JSON (MlPredictionJobDefSettingsRepresentation) | - |
| `regression_settings` | `regressionSettings` | JSON (MlRegressionJobDefSettingsRepresentation) | - |
| `input_config` | `inputConfig` | JSON (MlPredictionJobDefFeaturesConfigRepresentation) | - |
| `activation_status` | `activationStatus` | VARCHAR | Activation status of the prediction job. Since v59.0. |
| `dataspace` | `dataSpace` | JSON (CdpAssetReferenceRepresentation) | Data space details for the prediction job. Since v59.0. |
| `description` | `description` | VARCHAR | Description of the prediction job. Since v59.0. |
| `last_run_date` | `lastRunDate` | VARCHAR | Last execution date for the prediction job. Since v59.0. |
| `last_run_status` | `lastRunStatus` | VARCHAR | Status of the last execution. Since v59.0. |
| `model` | `model` | JSON (CdpAssetReferenceRepresentation) | Model associated with the prediction job. Since v59.0. |
| `output_config` | `outputConfig` | JSON (MlPredictionJobDefPredictionsConfigRepresentation) | Output data model object (DMO) details. Since v59.0. |
| `scoring_mode` | `scoringMode` | VARCHAR | Scoring mode for the prediction job. Since v59.0. |
| `type` | `type` | VARCHAR | Type of prediction job. The endpoint returns the job def output object that corresponds to the job type. For example, the Ml Binary Classification Job Def Output is returned for the `BinaryClassification` job type. Since v59.0. |
| `binary_classification_settings` | `binaryClassificationSettings` | JSON (MlBinaryClassificationJobDefSettingsRepresentation) | - |
| `label` | `label` | VARCHAR | Not in the spec schema: from the spec's examples. |
| `name` | `name` | VARCHAR | Not in the spec schema: from the spec's examples. |
| `id` | `id` | VARCHAR | Not in the spec schema: from the spec's examples. |
| `url` | `url` | VARCHAR | Not in the spec schema: from the spec's examples. |
| `namespace` | `namespace` | VARCHAR | Not in the spec schema: from the spec's examples. |

**Notes:** The call to poll after `prediction_job_run`. `last_run_status` is one of `NotStarted`, `Submited` (spelled this way in the spec), `Pending`, `InProgress`, `Success`, `Failed` or `Aborted`. [Confirm `activation_status` = `Active`](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/machinelearning/predictionjob/PredictionJobDefTools.java) before you run. The type-specific `inputConfig` and settings aren't columns, so read them from `_raw`.

## retriever_list

`GET /ssot/machine-learning/retrievers` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Machine-Learning/paths/~1ssot~1machine-learning~1retrievers/get) · tool `d360_retriever_list` · evidence O · read-only

Lists retrievers one page at a time, out-of-the-box retrievers first. Use it to find the `name` that the other retriever calls take, and to check for an existing label before you create one. The spec marks this endpoint as pilot or beta. Since v61.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `data_cloud_one_visibility` | `dataCloudOneVisibility` | query | enum(All, Consumable, Local, Remote) |  | Filter retrievers by visibility across organizations in Data Cloud One. Since v61.0. |
| `detail_level` | `detailLevel` | query | enum(Basic, Detailed) |  | Response detail level. If unspecified, the default value is `Detailed`. Since v61.0. |
| `is_active` | `isActive` | query | boolean |  | Indicates whether to return only active retrievers (`true`) or not (`false`). Since v61.0. |
| `is_default` | `isDefault` | query | boolean |  | Indicates whether to return only default retrievers (`true`) or not (`false`). Since v61.0. |
| `limit` | `limit` | query | integer |  | Maximum number of retrievers to return. Values are from `1` through `200`. `-1` is no limit. If unspecified, `25` retrievers are returned. Since v61.0. |
| `offset` | `offset` | query | integer |  | Number of rows to skip before returning results. If unspecified, no rows are skipped. Since v61.0. |
| `query_type` | `queryType` | query | array of enum(CustomSql, Ensemble, NoCode) |  | Filter by query type. Since v61.0. |
| `search` | `search` | query | string |  | Search keyword to match against label or API name. Since v61.0. |
| `sort_by` | `sortBy` | query | array of enum(CreatedDate, DataSourceType, Label, LastModifiedBy, LastModifiedDate, OwnerType, QueryType, Status) |  | Field to sort results by. If unspecified, items are returned in `CreatedDate DESC` order. Since v61.0. |
| `sort_order` | `sortOrder` | query | array of enum(Ascending, Descending) |  | Sort order. If unspecified, the default value is `Ascending`. Since v61.0. |
| `source_dmo` | `sourceDmo` | query | string |  | Filter by source data model object (DMO) ID or API name. Since v61.0. |

```sql
CALL cdp.retriever_list (search => 'Bathroom', detail_level => 'Basic', limit => 50);
```

**Result**

One row per item of `/retrievers` in the response. Other response fields go to `_meta`: `currentPageUrl`, `nextPageUrl`, `totalSize`. Schema `MlRetrieverRepresentation`.

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
| `active_configuration` | `activeConfiguration` | JSON (MlRetrieverConfigurationBaseRepresentation) | Currently active configuration. Since v61.0. |
| `configurations_url` | `configurationsUrl` | VARCHAR | URL of the configurations sub-resource. Since v61.0. |
| `connection` | `connection` | JSON (CdpAssetReferenceRepresentation) | Connection reference. Since v61.0. |
| `data_source_type` | `dataSourceType` | VARCHAR | Type of data source. Use `RealTimeSearchIndex` or `SearchIndex` for `NoCode` retrievers, and `DataCloudAsset` for `CustomSql` retrievers. Since v61.0. |
| `dataspaces` | `dataSpaces` | JSON (array of CdpAssetReferenceRepresentation) | List of data spaces. Since v61.0. |
| `description` | `description` | VARCHAR | Description of the retriever. Since v61.0. |
| `is_default` | `isDefault` | BOOLEAN | Indicates whether the retriever is the default for its search index (`true`) or not (`false`). Since v61.0. |
| `is_global` | `isGlobal` | BOOLEAN | Indicates whether the retriever is global (`true`) or not (`false`). Since v61.0. |
| `is_virtual` | `isVirtual` | BOOLEAN | Indicates whether the retriever is virtual (`true`) or not (`false`). Since v61.0. |
| `latest_configuration` | `latestConfiguration` | JSON (MlRetrieverConfigurationBaseRepresentation) | Most recent configuration version. Since v61.0. |
| `owner_type` | `ownerType` | VARCHAR | Type of owner. Since v61.0. |
| `ownership` | `ownership` | JSON (CdpAssetReferenceRepresentation) | Owner reference. Since v61.0. |
| `query_type` | `queryType` | VARCHAR | Type of query. Since v61.0. |
| `retriever_lifetime` | `retrieverLifetime` | VARCHAR | Lifetime of the retriever. Since v61.0. |
| `references` | `references` | JSON | Not in the spec schema: from the spec's examples. |

**Paging:** `next_page_url`.

**Notes:** Sources disagree on enums. The spec has `query_type` values `CustomSql`, `Ensemble` and `NoCode`, while the [MCP tool](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/RetrieverTools.java) says `NoCode`, `ProCode` and `Ensemble`. `sf-pi` also [accepts undeclared spellings](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/registry/connect-openapi-overrides.json) of `query_type` and `data_source_type` seen in a live response, without naming them. So don't validate these columns strictly. For `sort_order` the spec has `Ascending` and `Descending`, while the MCP tool says `ASC` and `DESC`.

## retriever_get

`GET /ssot/machine-learning/retrievers/{retrieverIdOrName}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Machine-Learning/paths/~1ssot~1machine-learning~1retrievers~1%7BretrieverIdOrName%7D/get) · tool `d360_retriever_get` · evidence O · read-only

Get a retriever with its latest and active configurations. Since v61.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `retriever_id_or_name` | `retrieverIdOrName` | path | string | yes | Retriever ID or the parent retriever's top-level `name`. The `active_configuration.name` value returns `ITEM_NOT_FOUND`. |

```sql
CALL cdp.retriever_get (retriever_id_or_name => 'DIY_Bathroom_Retriever_1Cx_9H02ce17169');
```

**Result**

One row. Schema `MlRetrieverRepresentation`.

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
| `active_configuration` | `activeConfiguration` | JSON (MlRetrieverConfigurationBaseRepresentation) | Currently active configuration. Since v61.0. |
| `configurations_url` | `configurationsUrl` | VARCHAR | URL of the configurations sub-resource. Since v61.0. |
| `connection` | `connection` | JSON (CdpAssetReferenceRepresentation) | Connection reference. Since v61.0. |
| `data_source_type` | `dataSourceType` | VARCHAR | Type of data source. Use `RealTimeSearchIndex` or `SearchIndex` for `NoCode` retrievers, and `DataCloudAsset` for `CustomSql` retrievers. Since v61.0. |
| `dataspaces` | `dataSpaces` | JSON (array of CdpAssetReferenceRepresentation) | List of data spaces. Since v61.0. |
| `description` | `description` | VARCHAR | Description of the retriever. Since v61.0. |
| `is_default` | `isDefault` | BOOLEAN | Indicates whether the retriever is the default for its search index (`true`) or not (`false`). Since v61.0. |
| `is_global` | `isGlobal` | BOOLEAN | Indicates whether the retriever is global (`true`) or not (`false`). Since v61.0. |
| `is_virtual` | `isVirtual` | BOOLEAN | Indicates whether the retriever is virtual (`true`) or not (`false`). Since v61.0. |
| `latest_configuration` | `latestConfiguration` | JSON (MlRetrieverConfigurationBaseRepresentation) | Most recent configuration version. Since v61.0. |
| `owner_type` | `ownerType` | VARCHAR | Type of owner. Since v61.0. |
| `ownership` | `ownership` | JSON (CdpAssetReferenceRepresentation) | Owner reference. Since v61.0. |
| `query_type` | `queryType` | VARCHAR | Type of query. Since v61.0. |
| `retriever_lifetime` | `retrieverLifetime` | VARCHAR | Lifetime of the retriever. Since v61.0. |
| `references` | `references` | JSON | Not in the spec schema: from the spec's examples. |

**Notes:** [Use the parent name](https://github.com/salesforce-misc/Data360AgentforceSolutionKitRetail/blob/main/.claude/skills/create-individual-retrievers/SKILL.md). The response nests a second name, `active_configuration.name` (for example `..._1Cy_...`), and passing that one returns `ITEM_NOT_FOUND` (one org).

## retriever_config_list

`GET /ssot/machine-learning/retrievers/{retrieverIdOrName}/configurations` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Machine-Learning/paths/~1ssot~1machine-learning~1retrievers~1%7BretrieverIdOrName%7D~1configurations/get) · tool `d360_retriever_config_list` · evidence O · read-only

Lists all configuration versions of a retriever. The spec marks this endpoint as pilot or beta. Since v61.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `retriever_id_or_name` | `retrieverIdOrName` | path | string | yes | Retriever ID or the parent retriever's top-level `name`. The `active_configuration.name` value returns `ITEM_NOT_FOUND`. |
| `limit` | `limit` | query | integer |  | Maximum number of configurations to return. Values are `1` through `200`. `-1` is no limit. If unspecified, `25` configurations are returned. Since v61.0. |
| `offset` | `offset` | query | integer |  | Number of rows to skip before returning results. If unspecified, no rows are skipped. Since v61.0. |

```sql
CALL cdp.retriever_config_list (retriever_id_or_name => '...');
```

**Result**

One row per item of `/configurations` in the response. Other response fields go to `_meta`: `currentPageUrl`, `nextPageUrl`, `totalSize`. Schema `MlRetrieverConfigurationRepresentation`.

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
| `input` | `input` | JSON (CdpAssetReferenceRepresentation) | Search index reference. Applies only to `NoCode`. Since v61.0. |
| `is_active` | `isActive` | BOOLEAN | Indicates whether the configuration is active (`true`) or not (`false`). At most one configuration can be active per retriever. Since v61.0. |
| `is_citation_enabled` | `isCitationEnabled` | BOOLEAN | Indicates whether citation is enabled (`true`) or not (`false`). Since v61.0. |
| `number_of_results` | `numberOfResults` | BIGINT | Maximum number of results to return. Must be a positive integer. Since v61.0. |
| `retrieval_mode` | `retrievalMode` | VARCHAR | Retrieval mode. Since v61.0. |
| `search_index_configuration` | `searchIndexConfiguration` | JSON (CdpAssetReferenceRepresentation) | Search index configuration reference. Applies only to `NoCode`. Since v61.0. |
| `semantic_search_type` | `semanticSearchType` | VARCHAR | Type of semantic search. Applies only to `NoCode`. Since v61.0. |
| `source_dmo` | `sourceDmo` | JSON (CdpAssetReferenceRepresentation) | Source data model object (DMO) to query. Applies only to `NoCode`. Since v61.0. |
| `vector_dmo` | `vectorDmo` | JSON (CdpAssetReferenceRepresentation) | Vector data model object (DMO) containing embeddings for semantic search. Applies only to `NoCode`. Since v61.0. |
| `version` | `version` | BIGINT | Version number of the configuration. Must be non-negative. Since v61.0. |

**Paging:** `next_page_url`.

## retriever_config_get

`GET /ssot/machine-learning/retrievers/{retrieverIdOrName}/configurations/{retrieverConfigurationIdOrName}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Machine-Learning/paths/~1ssot~1machine-learning~1retrievers~1%7BretrieverIdOrName%7D~1configurations~1%7BretrieverConfigurationIdOrName%7D/get) · tool `d360_retriever_config_get` · evidence O · read-only

Gets one configuration version, with query type, output fields, filters and citation settings. The active configuration is what the retriever uses at runtime. The spec marks this endpoint as pilot or beta. Since v61.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `retriever_configuration_id_or_name` | `retrieverConfigurationIdOrName` | path | string | yes | Configuration ID or name. |
| `retriever_id_or_name` | `retrieverIdOrName` | path | string | yes | Retriever ID or the parent retriever's top-level `name`. The `active_configuration.name` value returns `ITEM_NOT_FOUND`. |

```sql
CALL cdp.retriever_config_get (retriever_configuration_id_or_name => '...', retriever_id_or_name => '...');
```

**Result**

One row. Schema `MlRetrieverConfigurationDetailRepresentation`.

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
| `input` | `input` | JSON (CdpAssetReferenceRepresentation) | Search index reference. Applies only to `NoCode`. Since v61.0. |
| `is_active` | `isActive` | BOOLEAN | Indicates whether the configuration is active (`true`) or not (`false`). At most one configuration can be active per retriever. Since v61.0. |
| `is_citation_enabled` | `isCitationEnabled` | BOOLEAN | Indicates whether citation is enabled (`true`) or not (`false`). Since v61.0. |
| `number_of_results` | `numberOfResults` | BIGINT | Maximum number of results to return. Must be a positive integer. Since v61.0. |
| `retrieval_mode` | `retrievalMode` | VARCHAR | Retrieval mode. Since v61.0. |
| `search_index_configuration` | `searchIndexConfiguration` | JSON (CdpAssetReferenceRepresentation) | Search index configuration reference. Applies only to `NoCode`. Since v61.0. |
| `semantic_search_type` | `semanticSearchType` | VARCHAR | Type of semantic search. Applies only to `NoCode`. Since v61.0. |
| `source_dmo` | `sourceDmo` | JSON (CdpAssetReferenceRepresentation) | Source data model object (DMO) to query. Applies only to `NoCode`. Since v61.0. |
| `vector_dmo` | `vectorDmo` | JSON (CdpAssetReferenceRepresentation) | Vector data model object (DMO) containing embeddings for semantic search. Applies only to `NoCode`. Since v61.0. |
| `version` | `version` | BIGINT | Version number of the configuration. Must be non-negative. Since v61.0. |
| `citation_configuration` | `citationConfiguration` | JSON (MlRetrieverCitationConfigurationRepresentation) | Citation configuration. Applies only to `NoCode`. Since v61.0. |
| `field_placeholders` | `fieldPlaceholders` | JSON (array of MlFieldPlaceholderRepresentation) | List of field placeholders with parameter values specified at runtime. Applies only to `NoCode`. Since v61.0. |
| `is_advanced_mode_supported` | `isAdvancedModeSupported` | BOOLEAN | Indicates whether advanced mode is supported (`true`) or not (`false`). Applies only to `CustomSql`. Since v61.0. |
| `is_citation_supported` | `isCitationSupported` | BOOLEAN | Indicates whether citation output is supported (`true`) or not (`false`). Applies only to `CustomSql`. Since v61.0. |
| `is_enriched_index_supported` | `isEnrichedIndexSupported` | BOOLEAN | Indicates whether enriched search index chunk resolution is supported (`true`) or not (`false`). Applies only to `CustomSql`. Since v61.0. |
| `output_fields` | `outputFields` | JSON (array of MlRetrieverOutputFieldRepresentation) | List of output fields. Include the name and label for `CustomSql` and `Ensemble`. Include the name and field for `NoCode`. Since v61.0. |
| `query_filter` | `queryFilter` | JSON (CdpMlFilterRepresentation) | Query filter. Applies only to `NoCode`. Since v61.0. |
| `referenced_retrievers` | `referencedRetrievers` | JSON (array of MlRetrieverRepresentation) | List of sub-retrievers. Applies only to `Ensemble`. Since v61.0. |
| `retriever_query_template_definition` | `retrieverQueryTemplateDefinition` | JSON (MlRetrieverQueryTemplateDefinitionRepresentation) | Query template definition. Applies only to `CustomSql` and `Ensemble`. Since v61.0. |
| `dataspace` | `dataSpace` | JSON | Not in the spec schema: from the spec's examples. |

## ml_alert_update

`PATCH /ssot/machine-learning/alerts/{alertId}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Machine-Learning/paths/~1ssot~1machine-learning~1alerts~1%7BalertId%7D/patch) · tool `d360_ml_alert_update` · evidence O · changes org state

Partially update an existing data alert. Since v61.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `alert_id` | `alertId` | path | string | yes | ID of the data alert. Since v61.0. |
| `accepted` | `accepted` | body | boolean |  | Indicates whether the alert is accepted (`true`) or not (`false`). Include only one of the properties, `accepted` or `dismissed`, with the request. Since v61.0. |
| `dismissed` | `dismissed` | body | boolean |  | Indicates whether the alert is dismissed (`true`) or not (`false`). Include only one of the properties, `accepted` or `dismissed`, with the request Since v61.0. |
| `id` | `id` | body | string |  | ID of the alert. Since v61.0. |

```sql
CALL cdp.ml_alert_update (alert_id => '...', accepted => true);
```

**Result**

One row. Schema `MlDataAlertRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `accepted` | `accepted` | BOOLEAN | Indicates whether the alert is accepted (`true`) or not (`false`). Since v61.0. |
| `alert_type` | `alertType` | VARCHAR | Type of alert. Since v61.0. |
| `applicable` | `applicable` | BOOLEAN | Indicates whether the alert is applicable (`true`) or not (`false`). Since v61.0. |
| `directives` | `directives` | JSON (array of MlImprovementDirectiveRepresentation) | List of improvement directives (suggested actions) associated with the alert. Since v61.0. |
| `dismissed` | `dismissed` | BOOLEAN | Indicates whether the alert is dismissed (`true`) or not (`false`). Since v61.0. |
| `id` | `id` | VARCHAR | ID of the alert. Since v61.0. |
| `key` | `key` | VARCHAR | Unique key for the alert. Since v61.0. |
| `last_status_change_by` | `lastStatusChangeBy` | JSON (CdpUserRepresentation) | User or system that last changed the status of the alert. Since v61.0. |
| `last_status_change_date` | `lastStatusChangeDate` | VARCHAR | Date when the alert's status was last changed. Since v61.0. |
| `last_status_change_version` | `lastStatusChangeVersion` | BIGINT | Version number associated with the alert's most recent status change. Since v61.0. |
| `message` | `message` | VARCHAR | Alert message. Since v61.0. |
| `related_data` | `relatedData` | JSON (MlDataAlertDataBaseRepresentation) | Data that is related to the alert. Since v61.0. |
| `source_type` | `sourceType` | VARCHAR | Source type of alert. Since v61.0. |
| `subject` | `subject` | VARCHAR | Subject of the alert. Since v61.0. |
| `url` | `url` | VARCHAR | URL of the data alert. Since v61.0. |

**Notes:** [Send only one of `accepted` or `dismissed`](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/machinelearning/alerts/AlertTools.java). `accepted` flags the alert's `directives` to apply automatically on the next setup version, if you create it with `source_setup_version_number` set to the current version. `dismissed` hides the alert without applying anything.

## ml_configured_model_update

`PATCH /ssot/machine-learning/configured-models/{configuredModelIdOrName}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Machine-Learning/paths/~1ssot~1machine-learning~1configured-models~1%7BconfiguredModelIdOrName%7D/patch) · tool `d360_ml_configured_model_update`, `d360_ml_configured_model_activate` · evidence O · changes org state

Update a configured model. If using the model's name, use `<namespace>__<devname>`, for example `mynamespace__ourGPT35Turbo`. Since v61.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `configured_model_id_or_name` | `configuredModelIdOrName` | path | string | yes | Configured model ID or name. A name has the form `<namespace>__<devname>`, for example `mynamespace__ourGPT35Turbo`. |
| `actionable_fields` | `actionableFields` | body | array of object |  | The spec marks this required, but the example here leaves it out. List of actionable fields. An actionable field is a data field or variable in your dataset that you can use to drive actions based on the model's predictions. These fields are typically used to trigger workflows, automation, or other follow-up actions in Salesforce. Since v61.0. |
| `artifact` | `artifact` | body | object |  | The spec marks this required, but the example here leaves it out. Model artifact. Since v61.0. |
| `capability` | `capability` | body | enum(BinaryClassification, ChatCompletion, Completion, Embedding, Generic, MulticlassClassification, Regression) |  | The spec marks this required, but the example here leaves it out. The model's capabilities. Since v61.0. |
| `description` | `description` | body | string |  | The spec marks this required, but the example here leaves it out. Model description. Since v61.0. |
| `label` | `label` | body | string |  | The spec marks this required, but the example here leaves it out. Model's label. Since v61.0. |
| `parameter_overrides` | `parameterOverrides` | body | array of object |  | The spec marks this required, but the example here leaves it out. Model parameter overrides. Since v61.0. |
| `status` | `status` | body | enum(Disabled, Enabled) | yes | Whether the model is enabled or disabled. Since v61.0. |
| `visibility` | `visibility` | body | string |  | Not in the spec schema: from the MCP server's request class. |

```sql
CALL cdp.ml_configured_model_update (configured_model_id_or_name => 'Attrition_Predictor_Catboost', status => 'Enabled');
```

**Result**

One row. Schema `MlConfiguredModelRepresentation`.

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
| `actionable_fields` | `actionableFields` | JSON (array of CdpMlCustomizableFieldRepresentation) | List of actionable fields. Since v61.0. |
| `activations` | `activations` | JSON | List of activations. Since v61.0. |
| `artifact` | `artifact` | JSON (CdpAssetReferenceRepresentation) | The model artifact. Since v61.0. |
| `capability` | `capability` | VARCHAR | Model capability. Since v61.0. |
| `connector_type` | `connectorType` | VARCHAR | If the configured model references a model connector, this parameter indicates the connector type. Since v61.0. |
| `description` | `description` | VARCHAR | User-defined description of the configured model. Since v61.0. |
| `foundational_model` | `foundationalModel` | JSON (CdpMlFoundationalModelRepresentation) | Details for the foundational model. Since v59.0. |
| `generative_model_type` | `generativeModelType` | VARCHAR | Type of generative model. Since v59.0. |
| `input_fields` | `inputFields` | JSON (array of CdpMlModelInputFieldBaseRepresentation) | List of input features into the model. Since v59.0. |
| `input_types` | `inputTypes` | JSON (array of MlModelInputTypeRepresentation) | List of supporting input types for multi-modalities. This includes parameters, such as maxToken for text input limits or maxImages for image input capacity. Since v63.0. |
| `is_batch_supported` | `isBatchSupported` | BOOLEAN | Indicates whether this model supports batch (`true`) or not (`false`). Since v63.0. |
| `last_activated_by` | `lastActivatedBy` | JSON (CdpUserRepresentation) | Information about the user who last activated the configured model. Since v61.0. |
| `last_activated_date` | `lastActivatedDate` | VARCHAR | Date the configured model was last activated. Since v61.0. |
| `model_capabilities` | `modelCapabilities` | JSON | List of capabilities supported by the model. Since v63.0. |
| `model_disabled_reasons` | `modelDisabledReasons` | JSON | Reason(s) why the model status is disabled. Since v64.0. |
| `model_type` | `modelType` | VARCHAR | Referenced model type. Since v61.0. |
| `output_fields` | `outputFields` | JSON (array of CdpMlModelOutputFieldRepresentation) | List of output features from the model. Since v59.0. |
| `output_types` | `outputTypes` | JSON (array of MlModelOutputTypeRepresentation) | List of supporting output types for multi-modalities, including parameters and their corresponding values. Since v63.0. |
| `parameter_overrides` | `parameterOverrides` | JSON (array of CdpMlModelParameterOverrideBaseRepresentation) | List of model parameter overrides. Since v61.0. |
| `parameters` | `parameters` | JSON (array of CdpMlModelParameterDefinitionBaseRepresentation) | List of parameters supported by the model. Since v59.0. |
| `runtime_type` | `runtimeType` | VARCHAR | Model runtime type. Since v59.0. |
| `setup_type` | `setupType` | VARCHAR | Referenced setup type. - `OutOfTheBox` — a model managed by Salesforce. - `ModelConnector` — an external model exposed to Salesforce through a connector. - `EdcNoCode` — a model created using a no-code or low-code model builder. Since v61.0. |
| `status` | `status` | VARCHAR | Model status. Since v61.0. |
| `visibility` | `visibility` | VARCHAR | Model visibility. Since v62.0. |

**Notes:** The spec marks every body attribute required, but the [MCP tool](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/machinelearning/configuredmodel/ConfiguredModelTools.java) sends a partial update and documents that as the behavior, including a status-only body. A model must be `Enabled` before inference. Setting `artifact` replaces the active model. The MCP request class adds `visibility` (`Shown`, `Hidden`) and `status` values `Deprecated` and `Rerouted`, none of which are in the spec.

## ml_model_artifact_update

`PATCH /ssot/machine-learning/model-artifacts/{modelArtifactIdOrName}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Machine-Learning/paths/~1ssot~1machine-learning~1model-artifacts~1%7BmodelArtifactIdOrName%7D/patch) · tool `d360_ml_model_artifact_update` · evidence O · changes org state

Update the model artifact. Since v61.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `model_artifact_id_or_name` | `modelArtifactIdOrName` | path | string | yes | Model artifact ID or developer name, for example `Attrition_Risk_Predictor_v1__mla`. |
| `description` | `description` | body | string |  | The spec marks this required, but the example here leaves it out. The model artifact's description. Since v61.0. |
| `label` | `label` | body | string |  | The spec marks this required, but the example here leaves it out. Model artifact's label. Since v61.0. |
| `status` | `status` | body | enum(Disabled, Draft, Enabled) | yes | Model artifact's status. Since v61.0. |
| `output_fields` | `outputFields` | body | array of [ml_model_artifact_update_outputFields](#ml_model_artifact_update_outputfields) |  | Not in the spec schema: from the MCP server's payload example. |

```sql
CALL cdp.ml_model_artifact_update (model_artifact_id_or_name => 'Attrition_Risk_Predictor_v1__mla', status => 'Enabled');
```

**Result**

One row. Schema `CdpMlModelArtifactBaseRepresentation`.

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
| `description` | `description` | VARCHAR | Description of the artifact. Since v61.0. |
| `input_fields` | `inputFields` | JSON (array of CdpMlModelInputFieldBaseRepresentation) | Input fields for the model artifact. **Available Version: 61.0** |
| `is_batch_supported` | `isBatchSupported` | BOOLEAN | Indicates whether this model supports batch (`true`) or not (`false`). Since v63.0. |
| `model_connector_endpoint` | `modelConnectorEndpoint` | JSON (MlConnectorEndpointRepresentation) | Model connector endpoint definition. Since v61.0. |
| `model_count` | `modelCount` | BIGINT | Number of configured models from this model artifact. Since v61.0. |
| `model_disabled_reasons` | `modelDisabledReasons` | JSON | Reason(s) why the model status is disabled. Since v64.0. |
| `model_type` | `modelType` | VARCHAR | Model type. Since v61.0. |
| `output_fields` | `outputFields` | JSON (array of CdpMlModelOutputFieldRepresentation) | Model artifact's output fields. **Available Version: 61.0** |
| `parameters` | `parameters` | JSON (array of CdpMlModelParameterDefinitionBaseRepresentation) | Model parameters. Since v61.0. |
| `runtime_type` | `runtimeType` | VARCHAR | Runtime type. Since v61.0. |
| `setup_container` | `setupContainer` | JSON (CdpAssetReferenceRepresentation) | Setup container. **Available Version: 61.0** |
| `source` | `source` | JSON (CdpAssetReferenceRepresentation) | Information about the source of the artifact. Since v61.0. |
| `source_container` | `sourceContainer` | JSON (CdpAssetReferenceRepresentation) | Information about the artifact's source container. Since v61.0. |
| `source_type` | `sourceType` | VARCHAR | The type of model artifact. - `OutOfTheBox` - an artifact managed by Salesforce. - `ModelConnector` - an external artifact exposed to Salesforce through a connector. - `EdcNoCode` - an artifact created using a no-code or low-code model builder. Since v61.0. |
| `status` | `status` | VARCHAR | Model artifact status. Since v61.0. |
| `sync_status` | `syncStatus` | VARCHAR | Sync status. Since v61.0. |
| `foundational_model` | `foundationalModel` | JSON | Not in the spec schema: from the spec's examples. |
| `generative_model_type` | `generativeModelType` | VARCHAR | Not in the spec schema: from the spec's examples. |
| `model_capabilities` | `modelCapabilities` | JSON | Not in the spec schema: from the spec's examples. |

**Notes:** The spec marks all attributes required, but the [MCP tool](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/machinelearning/modelartifact/ModelArtifactTools.java) sends a partial update. The spec's `status` enum includes `Draft`, while the MCP server says [only `Enabled` and `Disabled` are writable](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/runtime/FamilyCatalog.java). The MCP request class also has `output_fields`, not in the spec, to rename raw outputs such as clustering labels: each entry has an output field `id` and `feature_override_values`.

## ml_setup_version_update

`PATCH /ssot/machine-learning/model-setups/{modelSetupIdOrName}/setup-versions/{modelSetupVersionId}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Machine-Learning/paths/~1ssot~1machine-learning~1model-setups~1%7BmodelSetupIdOrName%7D~1setup-versions~1%7BmodelSetupVersionId%7D/patch) · tool `d360_ml_setup_version_update` · evidence O · changes org state

Partially update an existing model setup version. Since v59.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `model_setup_id_or_name` | `modelSetupIdOrName` | path | string | yes | Model setup ID or developer name. |
| `model_setup_version_id` | `modelSetupVersionId` | path | string | yes | Setup version ID. A name is not accepted. Get it from `ml_setup_version_list` or the `ml_setup_version_create` result. |
| `type` | `type` | body | enum(EdcNoCode, ModelConnector) |  | Setup type. Since v59.0. |
| `status` | `status` | body | string |  | Not in the spec schema: send `Training` to start training (MCP server). |

```sql
CALL cdp.ml_setup_version_update (model_setup_id_or_name => 'Attrition_Risk_Predictor', model_setup_version_id => '14kSB0000005d8nYAA', type => 'EdcNoCode');
```

**Result**

One row. Schema `CdpMlSetupBaseRepresentation`.

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
| `active` | `active` | BOOLEAN | Indicates whether the setup is active (`true`) or not (`false`). Since v59.0. |
| `description` | `description` | VARCHAR | Description of the setup. Since v59.0. |
| `number_of_partitions` | `numberOfPartitions` | BIGINT | Number of partitions in a model setup version. Since v59.0. |
| `partitions_url` | `partitionsUrl` | VARCHAR | URL for retrieving the partitions associated with a model setup version. Since v59.0. |
| `type` | `type` | VARCHAR | Setup type. Since v59.0. |
| `version` | `version` | BIGINT | Setup version number. Since v59.0. |
| `field_relationships` | `fieldRelationships` | JSON | Not in the spec schema: from the spec's examples. |
| `field_selection` | `fieldSelection` | VARCHAR | Not in the spec schema: from the spec's examples. |
| `fields` | `fields` | JSON | Not in the spec schema: from the spec's examples. |
| `filter` | `filter` | JSON | Not in the spec schema: from the spec's examples. |
| `input` | `input` | JSON | Not in the spec schema: from the spec's examples. |
| `job` | `job` | JSON | Not in the spec schema: from the spec's examples. |
| `joins` | `joins` | JSON | Not in the spec schema: from the spec's examples. |
| `model_configuration` | `modelConfiguration` | JSON | Not in the spec schema: from the spec's examples. |
| `outcomes` | `outcomes` | JSON | Not in the spec schema: from the spec's examples. |
| `status` | `status` | VARCHAR | Not in the spec schema: from the spec's examples. |
| `transformations` | `transformations` | JSON | Not in the spec schema: from the spec's examples. |
| `validation_configuration` | `validationConfiguration` | JSON | Not in the spec schema: from the spec's examples. |

**Done when:** After `status => 'Training'`: `ml_setup_version_get`, field `status` in `_raw`, is `Published` or `Failed`.

**Notes:** This is the call that starts training, but the spec's base schema omits the attributes that matter. The [MCP tool](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/machinelearning/setup/ModelSetupTools.java) sends `type = 'EdcNoCode'` plus `status` and `description`, the only mutable fields:

```sql
CALL cdp.ml_setup_version_update (model_setup_id_or_name => 'Attrition_Risk_Predictor', model_setup_version_id => '14kSB0000005d8nYAA', type => 'EdcNoCode', status => 'Training');
```

To change the input, outcomes, fields or algorithm, create a new version with `source_setup_version_number` set to the prior version. An [MCP test](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/test/java/com/salesforce/data360/mcp/tools/machinelearning/setup/ModelSetupToolsTest.java) also sends `status = 'Canceled'`, which is the only evidence for that value.

## prediction_job_def_update

`PATCH /ssot/machine-learning/prediction-job-definitions/{predictionJobDefIdOrName}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Machine-Learning/paths/~1ssot~1machine-learning~1prediction-job-definitions~1%7BpredictionJobDefIdOrName%7D/patch) · tool `d360_prediction_job_def_update`, `d360_prediction_job_def_activate`, `d360_prediction_job_def_deactivate` · evidence O · changes org state

Update a specific prediction job definition. Since v59.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `prediction_job_def_id_or_name` | `predictionJobDefIdOrName` | path | string | yes | Prediction job definition ID or API name. |
| `clustering_settings` | `clusteringSettings` | body | [MlClusteringJobDefSettingsInput](#mlclusteringjobdefsettingsinputrepresentation) |  | - |
| `multiclass_classification_settings` | `multiclassClassificationSettings` | body | [MlMulticlassClassificationJobDefSettingsInput](#mlmulticlassclassificationjobdefsettingsinputrepresentation) |  | - |
| `regression_settings` | `regressionSettings` | body | [MlRegressionJobDefSettingsInput](#mlregressionjobdefsettingsinputrepresentation) |  | - |
| `input_config` | `inputConfig` | body | [MlPredictionJobDefFeaturesConfigInput](#mlpredictionjobdeffeaturesconfiginputrepresentation) |  | - |
| `activation_status` | `activationStatus` | body | enum(Active, Inactive) |  | Activation status of the prediction job. Since v59.0. |
| `api_name` | `apiName` | body | string |  | API name of the prediction job. Since v59.0. |
| `description` | `description` | body | string |  | Description of the prediction job. Since v59.0. |
| `label` | `label` | body | string |  | Label of the prediction job. Since v59.0. |
| `model` | `model` | body | [CdpAssetReferenceInput](#cdpassetreferenceinputrepresentation) |  | Model associated with the prediction job. Since v59.0. |
| `output_config` | `outputConfig` | body | [MlPredictionJobDefPredictionsConfigInput](#mlpredictionjobdefpredictionsconfiginputrepresentation) |  | Output data model object (DMO) details. Since v59.0. |
| `scoring_mode` | `scoringMode` | body | enum(Batch, Streaming) |  | Scoring mode for the prediction job. Since v59.0. |
| `type` | `type` | body | enum(BinaryClassification, Clustering, MulticlassClassification, Regression, SentimentDetection, TopicClassification) |  | Type of prediction job. Use the job def input object that corresponds to the job type. For example, use the Ml Binary Classification Job Def Input for the `BinaryClassification` job type. Since v59.0. |
| `binary_classification_settings` | `binaryClassificationSettings` | body | [MlBinaryClassificationJobDefSettingsInput](#mlbinaryclassificationjobdefsettingsinputrepresentation) |  | - |

```sql
CALL cdp.prediction_job_def_update (prediction_job_def_id_or_name => 'attrition_scores', activation_status => 'Active');
```

**Result**

One row. Schema `MlPredictionJobDefBaseRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `clustering_settings` | `clusteringSettings` | JSON (MlClusteringJobDefSettingsRepresentation) | - |
| `multiclass_classification_settings` | `multiclassClassificationSettings` | JSON (MlMulticlassClassificationJobDefSettingsRepresentation) | - |
| `prediction_settings` | `predictionSettings` | JSON (MlPredictionJobDefSettingsRepresentation) | - |
| `regression_settings` | `regressionSettings` | JSON (MlRegressionJobDefSettingsRepresentation) | - |
| `input_config` | `inputConfig` | JSON (MlPredictionJobDefFeaturesConfigRepresentation) | - |
| `activation_status` | `activationStatus` | VARCHAR | Activation status of the prediction job. Since v59.0. |
| `dataspace` | `dataSpace` | JSON (CdpAssetReferenceRepresentation) | Data space details for the prediction job. Since v59.0. |
| `description` | `description` | VARCHAR | Description of the prediction job. Since v59.0. |
| `last_run_date` | `lastRunDate` | VARCHAR | Last execution date for the prediction job. Since v59.0. |
| `last_run_status` | `lastRunStatus` | VARCHAR | Status of the last execution. Since v59.0. |
| `model` | `model` | JSON (CdpAssetReferenceRepresentation) | Model associated with the prediction job. Since v59.0. |
| `output_config` | `outputConfig` | JSON (MlPredictionJobDefPredictionsConfigRepresentation) | Output data model object (DMO) details. Since v59.0. |
| `scoring_mode` | `scoringMode` | VARCHAR | Scoring mode for the prediction job. Since v59.0. |
| `type` | `type` | VARCHAR | Type of prediction job. The endpoint returns the job def output object that corresponds to the job type. For example, the Ml Binary Classification Job Def Output is returned for the `BinaryClassification` job type. Since v59.0. |
| `binary_classification_settings` | `binaryClassificationSettings` | JSON (MlBinaryClassificationJobDefSettingsRepresentation) | - |
| `label` | `label` | VARCHAR | Not in the spec schema: from the spec's examples. |
| `name` | `name` | VARCHAR | Not in the spec schema: from the spec's examples. |
| `id` | `id` | VARCHAR | Not in the spec schema: from the spec's examples. |
| `url` | `url` | VARCHAR | Not in the spec schema: from the spec's examples. |
| `namespace` | `namespace` | VARCHAR | Not in the spec schema: from the spec's examples. |

**Notes:** Partial update. Activation has no call of its own: it's this `PATCH` with `activation_status`. [Most fields can't change while the definition is `Active`](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/machinelearning/predictionjob/PredictionJobDefTools.java), so set `Inactive`, edit, then set `Active` again. `input_config` and the settings options can be sent too (see `prediction_job_def_create`), although the spec's base schema doesn't list them.

## retriever_update

`PATCH /ssot/machine-learning/retrievers/{retrieverIdOrName}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Machine-Learning/paths/~1ssot~1machine-learning~1retrievers~1%7BretrieverIdOrName%7D/patch) · tool `d360_retriever_update` · evidence O · changes org state

Changes the label or description of a retriever. To change how it retrieves, create a new configuration version. The spec marks this endpoint as pilot or beta. Since v61.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `retriever_id_or_name` | `retrieverIdOrName` | path | string | yes | Retriever ID or the parent retriever's top-level `name`. The `active_configuration.name` value returns `ITEM_NOT_FOUND`. |
| `description` | `description` | body | string |  | Description of the retriever. Since v67.0. |
| `label` | `label` | body | string |  | Label of the retriever. Since v67.0. |

```sql
CALL cdp.retriever_update (retriever_id_or_name => '...', label => 'Enriched Search Index UDMO Retriever', description => 'A NoCode retriever from a search index with enriched index configured. The search index source DMO is unstructured for a document file.');
```

**Result**

One row. Schema `MlRetrieverRepresentation`.

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
| `active_configuration` | `activeConfiguration` | JSON (MlRetrieverConfigurationBaseRepresentation) | Currently active configuration. Since v61.0. |
| `configurations_url` | `configurationsUrl` | VARCHAR | URL of the configurations sub-resource. Since v61.0. |
| `connection` | `connection` | JSON (CdpAssetReferenceRepresentation) | Connection reference. Since v61.0. |
| `data_source_type` | `dataSourceType` | VARCHAR | Type of data source. Use `RealTimeSearchIndex` or `SearchIndex` for `NoCode` retrievers, and `DataCloudAsset` for `CustomSql` retrievers. Since v61.0. |
| `dataspaces` | `dataSpaces` | JSON (array of CdpAssetReferenceRepresentation) | List of data spaces. Since v61.0. |
| `description` | `description` | VARCHAR | Description of the retriever. Since v61.0. |
| `is_default` | `isDefault` | BOOLEAN | Indicates whether the retriever is the default for its search index (`true`) or not (`false`). Since v61.0. |
| `is_global` | `isGlobal` | BOOLEAN | Indicates whether the retriever is global (`true`) or not (`false`). Since v61.0. |
| `is_virtual` | `isVirtual` | BOOLEAN | Indicates whether the retriever is virtual (`true`) or not (`false`). Since v61.0. |
| `latest_configuration` | `latestConfiguration` | JSON (MlRetrieverConfigurationBaseRepresentation) | Most recent configuration version. Since v61.0. |
| `owner_type` | `ownerType` | VARCHAR | Type of owner. Since v61.0. |
| `ownership` | `ownership` | JSON (CdpAssetReferenceRepresentation) | Owner reference. Since v61.0. |
| `query_type` | `queryType` | VARCHAR | Type of query. Since v61.0. |
| `retriever_lifetime` | `retrieverLifetime` | VARCHAR | Lifetime of the retriever. Since v61.0. |
| `references` | `references` | JSON | Not in the spec schema: from the spec's examples. |

## retriever_config_update

`PATCH /ssot/machine-learning/retrievers/{retrieverIdOrName}/configurations/{retrieverConfigurationIdOrName}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Machine-Learning/paths/~1ssot~1machine-learning~1retrievers~1%7BretrieverIdOrName%7D~1configurations~1%7BretrieverConfigurationIdOrName%7D/patch) · tool `d360_retriever_config_update` · evidence O · changes org state

Activates or deactivates a configuration version. `is_active => true` also deactivates the previously active one. `is_active => false` on the active one deactivates the retriever, which must not be in use by other entities at that point. The spec marks this endpoint as pilot or beta. Since v61.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `retriever_configuration_id_or_name` | `retrieverConfigurationIdOrName` | path | string | yes | Configuration ID or name. |
| `retriever_id_or_name` | `retrieverIdOrName` | path | string | yes | Retriever ID or the parent retriever's top-level `name`. The `active_configuration.name` value returns `ITEM_NOT_FOUND`. |
| `is_active` | `isActive` | body | boolean | yes | Indicates whether to activate the configuration (`true`) or not (`false`). At most one configuration can be active per retriever. Since v61.0. |

```sql
CALL cdp.retriever_config_update (retriever_configuration_id_or_name => '...', retriever_id_or_name => '...', is_active => true);
```

**Result**

One row. Schema `MlRetrieverConfigurationDetailRepresentation`.

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
| `input` | `input` | JSON (CdpAssetReferenceRepresentation) | Search index reference. Applies only to `NoCode`. Since v61.0. |
| `is_active` | `isActive` | BOOLEAN | Indicates whether the configuration is active (`true`) or not (`false`). At most one configuration can be active per retriever. Since v61.0. |
| `is_citation_enabled` | `isCitationEnabled` | BOOLEAN | Indicates whether citation is enabled (`true`) or not (`false`). Since v61.0. |
| `number_of_results` | `numberOfResults` | BIGINT | Maximum number of results to return. Must be a positive integer. Since v61.0. |
| `retrieval_mode` | `retrievalMode` | VARCHAR | Retrieval mode. Since v61.0. |
| `search_index_configuration` | `searchIndexConfiguration` | JSON (CdpAssetReferenceRepresentation) | Search index configuration reference. Applies only to `NoCode`. Since v61.0. |
| `semantic_search_type` | `semanticSearchType` | VARCHAR | Type of semantic search. Applies only to `NoCode`. Since v61.0. |
| `source_dmo` | `sourceDmo` | JSON (CdpAssetReferenceRepresentation) | Source data model object (DMO) to query. Applies only to `NoCode`. Since v61.0. |
| `vector_dmo` | `vectorDmo` | JSON (CdpAssetReferenceRepresentation) | Vector data model object (DMO) containing embeddings for semantic search. Applies only to `NoCode`. Since v61.0. |
| `version` | `version` | BIGINT | Version number of the configuration. Must be non-negative. Since v61.0. |
| `citation_configuration` | `citationConfiguration` | JSON (MlRetrieverCitationConfigurationRepresentation) | Citation configuration. Applies only to `NoCode`. Since v61.0. |
| `field_placeholders` | `fieldPlaceholders` | JSON (array of MlFieldPlaceholderRepresentation) | List of field placeholders with parameter values specified at runtime. Applies only to `NoCode`. Since v61.0. |
| `is_advanced_mode_supported` | `isAdvancedModeSupported` | BOOLEAN | Indicates whether advanced mode is supported (`true`) or not (`false`). Applies only to `CustomSql`. Since v61.0. |
| `is_citation_supported` | `isCitationSupported` | BOOLEAN | Indicates whether citation output is supported (`true`) or not (`false`). Applies only to `CustomSql`. Since v61.0. |
| `is_enriched_index_supported` | `isEnrichedIndexSupported` | BOOLEAN | Indicates whether enriched search index chunk resolution is supported (`true`) or not (`false`). Applies only to `CustomSql`. Since v61.0. |
| `output_fields` | `outputFields` | JSON (array of MlRetrieverOutputFieldRepresentation) | List of output fields. Include the name and label for `CustomSql` and `Ensemble`. Include the name and field for `NoCode`. Since v61.0. |
| `query_filter` | `queryFilter` | JSON (CdpMlFilterRepresentation) | Query filter. Applies only to `NoCode`. Since v61.0. |
| `referenced_retrievers` | `referencedRetrievers` | JSON (array of MlRetrieverRepresentation) | List of sub-retrievers. Applies only to `Ensemble`. Since v61.0. |
| `retriever_query_template_definition` | `retrieverQueryTemplateDefinition` | JSON (MlRetrieverQueryTemplateDefinitionRepresentation) | Query template definition. Applies only to `CustomSql` and `Ensemble`. Since v61.0. |
| `dataspace` | `dataSpace` | JSON | Not in the spec schema: from the spec's examples. |

## ml_alerts_query

`POST /ssot/machine-learning/alerts` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Machine-Learning/paths/~1ssot~1machine-learning~1alerts/post) · tool `d360_ml_alerts_query` · evidence O · read-only

Reads data alerts for a model artifact: training-time findings such as `ObviousPredictor` or `CollinearFields`, and runtime drift. Each alert carries `directives` that can be applied on retrain.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `asset` | `asset` | body | string |  | Asset name or ID of the alert. Since v61.0. |
| `asset_type` | `assetType` | body | enum(ModelArtifact) |  | Asset type of the alert. Since v61.0. |
| `source_types` | `sourceTypes` | body | array of enum(ModelTraining, Runtime) |  | Deployed or stored artifact of an ML model. Since v61.0. |

```sql
CALL cdp.ml_alerts_query (asset => 'Attrition_Risk_Predictor_v1__mla', asset_type => 'ModelArtifact', source_types => ['ModelTraining', 'Runtime']);
```

**Result**

One row. Schema `MlDataAlertCollectionRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `current_page_url` | `currentPageUrl` | VARCHAR | Current page URL. Since v60.0. |
| `next_page_url` | `nextPageUrl` | VARCHAR | Next page URL, if it exists. Since v60.0. |
| `total_size` | `totalSize` | BIGINT | Total size of the collection. Since v60.0. |
| `alerts` | `alerts` | JSON (array of MlDataAlertRepresentation) | A list of data alerts. Since v61.0. |
| `source` | `source` | JSON (CdpAssetReferenceRepresentation) | Source the data alerts originate from. Since v61.0. |
| `data_alerts` | `dataAlerts` | JSON | Not in the spec schema: from the spec's examples. |

**Notes:** The spec describes this `POST` as creating an alert and marks all attributes optional. [Salesforce's MCP server](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/machinelearning/alerts/AlertTools.java) treats it as a query and requires `asset` and `asset_type`. The `changes org state` label above comes from the verb.

## ml_setup_version_create

`POST /ssot/machine-learning/model-setups/{modelSetupIdOrName}/setup-versions` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Machine-Learning/paths/~1ssot~1machine-learning~1model-setups~1%7BmodelSetupIdOrName%7D~1setup-versions/post) · tool `d360_ml_setup_version_create` · evidence O · changes org state

Create a new model setup version. Since v59.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `model_setup_id_or_name` | `modelSetupIdOrName` | path | string | yes | Model setup ID or developer name. |
| `description` | `description` | body | string |  | Description of the setup. Since v59.0. |
| `type` | `type` | body | enum(EdcNoCode, ModelConnector) |  | Setup type. Since v59.0. |
| `status` | `status` | body | string |  | Not in the spec schema (MCP server). |
| `input` | `input` | body | [ml_setup_version_create_input](#ml_setup_version_create_input) |  | Not in the spec schema: from the MCP server's payload example. |
| `outcomes` | `outcomes` | body | array of [ml_setup_version_create_outcomes](#ml_setup_version_create_outcomes) |  | Not in the spec schema: from the MCP server's payload example. |
| `fields` | `fields` | body | array of [ml_setup_version_create_fields](#ml_setup_version_create_fields) |  | Not in the spec schema: from the MCP server's payload example. |
| `field_selection` | `fieldSelection` | body | string |  | Not in the spec schema: from the MCP server's payload example. |
| `source_setup_version_number` | `sourceSetupVersionNumber` | body | integer |  | Not in the spec schema: from the MCP server's payload example. |
| `algorithm_type` | `algorithmType` | body | string |  | Not in the spec schema: from the MCP server's request class. |
| `transformations` | `transformations` | body | array |  | Not in the spec schema: from the MCP server's request class. |
| `filter` | `filter` | body | object |  | Not in the spec schema: from the MCP server's request class. |
| `joins` | `joins` | body | array |  | Not in the spec schema: from the MCP server's request class. |
| `field_relationships` | `fieldRelationships` | body | array |  | Not in the spec schema: from the MCP server's request class. |
| `runtime_type` | `runtimeType` | body | string |  | Not in the spec schema: from the MCP server's request class. |

```sql
CALL cdp.ml_setup_version_create (model_setup_id_or_name => '...', description => 'Initial version of the Customer Churn Prediction model setup.', type => 'EdcNoCode');
```

**Result**

One row. Schema `CdpMlSetupBaseRepresentation`.

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
| `active` | `active` | BOOLEAN | Indicates whether the setup is active (`true`) or not (`false`). Since v59.0. |
| `description` | `description` | VARCHAR | Description of the setup. Since v59.0. |
| `number_of_partitions` | `numberOfPartitions` | BIGINT | Number of partitions in a model setup version. Since v59.0. |
| `partitions_url` | `partitionsUrl` | VARCHAR | URL for retrieving the partitions associated with a model setup version. Since v59.0. |
| `type` | `type` | VARCHAR | Setup type. Since v59.0. |
| `version` | `version` | BIGINT | Setup version number. Since v59.0. |
| `field_relationships` | `fieldRelationships` | JSON | Not in the spec schema: from the spec's examples. |
| `field_selection` | `fieldSelection` | VARCHAR | Not in the spec schema: from the spec's examples. |
| `fields` | `fields` | JSON | Not in the spec schema: from the spec's examples. |
| `filter` | `filter` | JSON | Not in the spec schema: from the spec's examples. |
| `input` | `input` | JSON | Not in the spec schema: from the spec's examples. |
| `job` | `job` | JSON | Not in the spec schema: from the spec's examples. |
| `joins` | `joins` | JSON | Not in the spec schema: from the spec's examples. |
| `model_configuration` | `modelConfiguration` | JSON | Not in the spec schema: from the spec's examples. |
| `outcomes` | `outcomes` | JSON | Not in the spec schema: from the spec's examples. |
| `status` | `status` | VARCHAR | Not in the spec schema: from the spec's examples. |
| `transformations` | `transformations` | JSON | Not in the spec schema: from the spec's examples. |
| `validation_configuration` | `validationConfiguration` | JSON | Not in the spec schema: from the spec's examples. |

**Notes:** The spec's base schema has only `description` and `type`, and its example would train nothing. The [MCP tool](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/machinelearning/setup/ModelSetupTools.java) sends more, and its [payload example](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/resources/metadata/payload-examples.json) shows them:

| Attribute | Required | Type |
|---|---|---|
| `type` | yes | `'EdcNoCode'`. The MCP tool always sends this. |
| `input` | yes | [InputSourceInput](#inputsourceinput) |
| `outcomes` | yes | array of [OutcomeInput](#outcomeinput), typically one |
| `fields` | yes | array of [FieldConfigInput](#fieldconfiginput), at least 3 |
| `model_configuration` | | `(algorithm_type = ...)` |
| `field_selection` | | `Automatic` or `Manual` |
| `transformations` | | array of [TransformationInput](#transformationinput) |
| `filter` | | [FilterInput](#filterinput) |
| `joins` | | array of [JoinCriteriaInput](#joincriteriainput) |
| `field_relationships` | | array of [FieldRelationshipInput](#fieldrelationshipinput) |
| `source_setup_version_number` | | `0` for the first version, otherwise the prior version when re-training |
| `runtime_type` | | `Internal` or `InternalV2`, default `InternalV2` |

```sql
CALL cdp.ml_setup_version_create (model_setup_id_or_name => 'Attrition_Risk_Predictor', type => 'EdcNoCode',
  input => (type = 'DataModelObject', source = (name = 'Attrition__dlm'), dataspace = (name = 'default')),
  outcomes => [(type = 'Binary', name = 'Attrition__c', label = 'Attrition', goal = 'Minimize', success_value = 'Yes', failure_value = 'No')],
  fields => [(type = 'Number', name = 'Age__c', min = 18, max = 60, bucketing_strategy = (type = 'Percentile', number_of_buckets = 10)),
             (type = 'Number', name = 'Monthly_Income__c', min = 1009, max = 19999, bucketing_strategy = (type = 'Percentile', number_of_buckets = 10)),
             (type = 'Text', name = 'Over_Time__c', data_type = 'Categorical', ordering = 'Occurrence', include_other = true, balanced = false)],
  field_selection => 'Manual', source_setup_version_number => 0);
```

Pass each field as `ml_query_setup_fields` returned it. The platform requires at least 3 fields and 400 rows after filters and joins. The tool says this call [leaves the version in `Draft` and does not train](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/machinelearning/setup/ModelSetupTools.java), while its own [catalog entry](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/runtime/FamilyCatalog.java) says it kicks off training, so check `status` in the result before you send `Training`. When `algorithm_type` is omitted, the MCP tool picks one on the client: `Catboost` for `Binary` and `ContinuousVariable`, `XgboostV2` for `DiscreteVariable`, and `Kmeans` or `Hdbscan` for `Clustering`, depending on `n_clusters`. No source says what the API does without one.

## ml_predict

`POST /ssot/machine-learning/predict` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Machine-Learning/paths/~1ssot~1machine-learning~1predict/post) · tool `d360_ml_predict` · evidence O · read-only

Make a prediction using the specified model and parameters. This request is synchronous. Since v61.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `field_names` | `fieldNames` | body | array of string | yes | The names of the input fields that the model uses when making the prediction. The fields must be in the same order specified in the model artifact's `input_fields` parameter. |
| `model` | `model` | body | [CdpMlPredictInputBase_model](#cdpmlpredictinputbase_model) | yes | The model's name or ID, for example: ```json { "name": "titanic_simple" } ``` or ```json { "id": "12lX40000000DAKIA2" } ``` Since v60.0. |
| `rows` | `rows` | body | array of object | yes | The set or sets of values of the fields listed in `field_names`. For example, if your `field_names` are `["State", "Industry", "ACV"]`, your value for `Rows` could be `[["Texas", "Aerospace", "3000000"],["Arizona", "Semiconductors", "5500000"]]`. |
| `settings` | `settings` | body | object |  | The model configuration settings used to generate the prediction. Since v61.0. |
| `type` | `type` | body | enum(RawData) | yes | Type of prediction. Since v61.0. |

```sql
CALL cdp.ml_predict (model => (name = 'Attrition_Predictor_Catboost'), type => 'RawData', field_names => ['age', 'income', 'tenure_months'], rows => [['25', '50000', '12'], ['54', '120000', '240']], settings => (maxTopFactors = 3, maxPrescriptions = 5));
```

**Result**

One row. Schema `CdpMlPredictResultRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `aggregate_predictions` | `aggregatePredictions` | JSON (array of CdpMlAggregatePredictionRepresentation) | Aggregate result list. Since v61.0. |
| `model` | `model` | JSON (CdpAssetReferenceRepresentation) | Model asset reference used as part of the prediction request. Since v61.0. |
| `prediction_type` | `predictionType` | VARCHAR | Prediction type. Since v61.0. |
| `predictions` | `predictions` | JSON (array of CdpMlPredictionBaseRepresentation) | A list of prediction results. Since v61.0. |
| `settings` | `settings` | JSON (CdpMlPredictSettingsRepresentation) | Settings used for the prediction. Since v61.0. |

**Notes:** `model` is an `Enabled` [configured model, not an artifact](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/resources/metadata/payload-examples.json). [At most 200 rows per call, and each row's length must equal `field_names`](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/machinelearning/predict/PredictTools.java). The MCP tool says all row values are strings on the wire, so write `'25'`, not `25`, although the spec's own example sends numbers. A row can fail on its own: each entry in `predictions` has `status` `Success` or `Error`. The spec allows `max_prescriptions` of `-1` for unlimited, while the MCP request class has a minimum of 0.

## prediction_job_def_create

`POST /ssot/machine-learning/prediction-job-definitions` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Machine-Learning/paths/~1ssot~1machine-learning~1prediction-job-definitions/post) · tool `d360_prediction_job_def_create`, `d360_prediction_job_def_create_regression`, `d360_prediction_job_def_create_binary_classification`, `d360_prediction_job_def_create_multiclass_classification`, `d360_prediction_job_def_create_sentiment_detection`, `d360_prediction_job_def_create_topic_classification`, `d360_prediction_job_def_create_clustering` · evidence O · changes org state

Create a new prediction job definition. Since v59.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `clustering_settings` | `clusteringSettings` | body | [MlClusteringJobDefSettingsInput](#mlclusteringjobdefsettingsinputrepresentation) |  | - |
| `multiclass_classification_settings` | `multiclassClassificationSettings` | body | [MlMulticlassClassificationJobDefSettingsInput](#mlmulticlassclassificationjobdefsettingsinputrepresentation) |  | - |
| `regression_settings` | `regressionSettings` | body | [MlRegressionJobDefSettingsInput](#mlregressionjobdefsettingsinputrepresentation) |  | - |
| `input_config` | `inputConfig` | body | [MlPredictionJobDefFeaturesConfigInput](#mlpredictionjobdeffeaturesconfiginputrepresentation) |  | - |
| `activation_status` | `activationStatus` | body | enum(Active, Inactive) |  | Activation status of the prediction job. Since v59.0. |
| `api_name` | `apiName` | body | string |  | API name of the prediction job. Since v59.0. |
| `description` | `description` | body | string |  | Description of the prediction job. Since v59.0. |
| `label` | `label` | body | string |  | Label of the prediction job. Since v59.0. |
| `model` | `model` | body | [CdpAssetReferenceInput](#cdpassetreferenceinputrepresentation) |  | Model associated with the prediction job. Since v59.0. |
| `output_config` | `outputConfig` | body | [MlPredictionJobDefPredictionsConfigInput](#mlpredictionjobdefpredictionsconfiginputrepresentation) |  | Output data model object (DMO) details. Since v59.0. |
| `scoring_mode` | `scoringMode` | body | enum(Batch, Streaming) |  | Scoring mode for the prediction job. Since v59.0. |
| `type` | `type` | body | enum(BinaryClassification, Clustering, MulticlassClassification, Regression, SentimentDetection, TopicClassification) |  | Type of prediction job. Use the job def input object that corresponds to the job type. For example, use the Ml Binary Classification Job Def Input for the `BinaryClassification` job type. Since v59.0. |
| `binary_classification_settings` | `binaryClassificationSettings` | body | [MlBinaryClassificationJobDefSettingsInput](#mlbinaryclassificationjobdefsettingsinputrepresentation) |  | - |

```sql
CALL cdp.prediction_job_def_create (type => 'BinaryClassification', label => 'Binary Classification Job', description => 'Binary classification prediction job', model => (id = '12lSB000000UWdZYAW'), output_config => (object_name = 'Customer_Segments', description = 'Output description'), scoring_mode => 'Batch', input_config => (data_object = (id = '0gjSB00000SQccbYAD'), fields = [(model_field = (id = '0xmSB0000008UovYAE'), mapped_field = (id = '0gYSB00006XqM852AF', data_object = (id = '0gjSB00000SQccbYAD'), relationship_path = [(source_field = (id = '0gYSB00006XqM8F2AV', data_object = (id = '0gjSB00000SQccbYAD')), target_field = (id = '0gYSB00006W3U0t2AF', data_object = (id = '0gjSB00000SJ2xFYAT')))]), update_score = true)]), binary_classification_settings => (max_top_contributors = 3, max_prescriptions = 3, prescription_threshold = 22, show_class_probabilities = true));
```

**Result**

One row. Schema `MlPredictionJobDefBaseRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `clustering_settings` | `clusteringSettings` | JSON (MlClusteringJobDefSettingsRepresentation) | - |
| `multiclass_classification_settings` | `multiclassClassificationSettings` | JSON (MlMulticlassClassificationJobDefSettingsRepresentation) | - |
| `prediction_settings` | `predictionSettings` | JSON (MlPredictionJobDefSettingsRepresentation) | - |
| `regression_settings` | `regressionSettings` | JSON (MlRegressionJobDefSettingsRepresentation) | - |
| `input_config` | `inputConfig` | JSON (MlPredictionJobDefFeaturesConfigRepresentation) | - |
| `activation_status` | `activationStatus` | VARCHAR | Activation status of the prediction job. Since v59.0. |
| `dataspace` | `dataSpace` | JSON (CdpAssetReferenceRepresentation) | Data space details for the prediction job. Since v59.0. |
| `description` | `description` | VARCHAR | Description of the prediction job. Since v59.0. |
| `last_run_date` | `lastRunDate` | VARCHAR | Last execution date for the prediction job. Since v59.0. |
| `last_run_status` | `lastRunStatus` | VARCHAR | Status of the last execution. Since v59.0. |
| `model` | `model` | JSON (CdpAssetReferenceRepresentation) | Model associated with the prediction job. Since v59.0. |
| `output_config` | `outputConfig` | JSON (MlPredictionJobDefPredictionsConfigRepresentation) | Output data model object (DMO) details. Since v59.0. |
| `scoring_mode` | `scoringMode` | VARCHAR | Scoring mode for the prediction job. Since v59.0. |
| `type` | `type` | VARCHAR | Type of prediction job. The endpoint returns the job def output object that corresponds to the job type. For example, the Ml Binary Classification Job Def Output is returned for the `BinaryClassification` job type. Since v59.0. |
| `binary_classification_settings` | `binaryClassificationSettings` | JSON (MlBinaryClassificationJobDefSettingsRepresentation) | - |
| `label` | `label` | VARCHAR | Not in the spec schema: from the spec's examples. |
| `name` | `name` | VARCHAR | Not in the spec schema: from the spec's examples. |
| `id` | `id` | VARCHAR | Not in the spec schema: from the spec's examples. |
| `url` | `url` | VARCHAR | Not in the spec schema: from the spec's examples. |
| `namespace` | `namespace` | VARCHAR | Not in the spec schema: from the spec's examples. |

**Notes:** The table lists the spec's base schema. The attributes that differ per `type` come from the spec's `oneOf` variants, so add `input_config` and the settings option below. These are the [MCP tool](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/machinelearning/predictionjob) rules:

| `type` | `input_config` | Settings option | Limits and defaults |
|---|---|---|---|
| `Regression` | [features](#mlpredictionjobdeffeaturesconfiginputrepresentation) | [`regression_settings`](#mlregressionjobdefsettingsinputrepresentation) | `max_top_contributors` 0-3, `max_prescriptions` 0-3, `prescription_threshold` 0-100 |
| `BinaryClassification` | [features](#mlpredictionjobdeffeaturesconfiginputrepresentation) | [`binary_classification_settings`](#mlbinaryclassificationjobdefsettingsinputrepresentation) | As `Regression`. `show_class_probabilities` defaults to `true` |
| `MulticlassClassification` | [features](#mlpredictionjobdeffeaturesconfiginputrepresentation) | [`multiclass_classification_settings`](#mlmulticlassclassificationjobdefsettingsinputrepresentation) | `max_top_contributors` 0-3, `number_of_classes` at least 1, defaulting to all classes |
| `Clustering` | [features](#mlpredictionjobdeffeaturesconfiginputrepresentation) | [`clustering_settings`](#mlclusteringjobdefsettingsinputrepresentation) | `cluster_id_field_label` and `cluster_label_field_label` required, `max_top_contributors` 0-3 |
| `SentimentDetection` | [text fields](#mlsentimentdetectioninputconfiginputrepresentation), 1-3 | None | The MCP tool sends `sfdc_ai__DefaultSalesforceSentimentAnalysis` when `model` is omitted |
| `TopicClassification` | [text fields and labels](#mltopicclassificationinputconfiginputrepresentation), 1-3 fields | None | `topic_labels = (type = 'Static', values = [...])`, 2-5 distinct labels of at most 100 characters. The MCP tool sends `sfdc_ai__DefaultSalesforceTopicClassification` when `model` is omitted |

The spec marks every attribute optional. The MCP request class requires `type`, `api_name`, `model`, `output_config` and `scoring_mode`, and says `input_config` is needed for all types. The MCP tools default `scoring_mode` to `Batch` and `label` to `api_name` on the client, so don't assume the API does.

[A new definition is `Inactive`](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/machinelearning/predictionjob/PredictionJobDefTools.java). Next, set `activation_status` with `prediction_job_def_update`, confirm it with `prediction_job_def_get`, and call `prediction_job_run`. The spec also lists `activation_status` on create, but no source shows it used there.

## retriever_create

`POST /ssot/machine-learning/retrievers` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Machine-Learning/paths/~1ssot~1machine-learning~1retrievers/post) · tool `d360_retriever_create` · evidence O · changes org state

Creates a retriever and its first configuration, to query Data 360 objects or search indexes for AI use. The spec marks this endpoint as pilot or beta. Since v61.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `configuration` | `configuration` | body | [MlRetrieverConfigurationBaseInput](#mlretrieverconfigurationbaseinputrepresentation) | yes | Initial configuration. Use the configuration input object that corresponds to the type of query. For example, use the Ml Retriever Configuration Custom Sql Input for the `CustomSql` type. Since v61.0. |
| `dataspaces` | `dataSpaces` | body | array of string |  | List of data space names. Required for `CustomSql` and `NoCode` retrievers. Derive the data space from the referenced retrievers for `Ensemble` retrievers. Since v61.0. |
| `description` | `description` | body | string |  | Description of the retriever. Since v61.0. |
| `label` | `label` | body | string | yes | Label of the retriever. Since v61.0. |
| `owner_type` | `ownerType` | body | enum(AiAgent, Api) | yes | Type of owner. Since v61.0. |
| `data_source_type` | `dataSourceType` | body | string |  | Not in the spec schema: from the MCP server's request class. |

```sql
CALL cdp.retriever_create (label => 'DIY Bathroom Retriever', owner_type => 'Api', dataspaces => ['default'], configuration => (query_type = 'NoCode', is_active = true, number_of_results = 10, input = (name = 'DIY_Bathroom', type = 'SearchIndex'), output_fields = [(label = 'Chunk', relatedDmoName = 'DIY_Bathroom_chunk__dlm', relatedDmoFieldName = 'Chunk__c', relationships = [(relationSourceDmoName = 'DIY_Bathroom_chunk__dlm', relationSourceDmoFieldName = 'SourceRecordId__c', relationTargetDmoName = 'DIY_Bathroom__dlm', relationTargetDmoFieldName = 'FilePath__c')])]));
```

**Result**

One row. Schema `MlRetrieverRepresentation`.

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
| `active_configuration` | `activeConfiguration` | JSON (MlRetrieverConfigurationBaseRepresentation) | Currently active configuration. Since v61.0. |
| `configurations_url` | `configurationsUrl` | VARCHAR | URL of the configurations sub-resource. Since v61.0. |
| `connection` | `connection` | JSON (CdpAssetReferenceRepresentation) | Connection reference. Since v61.0. |
| `data_source_type` | `dataSourceType` | VARCHAR | Type of data source. Use `RealTimeSearchIndex` or `SearchIndex` for `NoCode` retrievers, and `DataCloudAsset` for `CustomSql` retrievers. Since v61.0. |
| `dataspaces` | `dataSpaces` | JSON (array of CdpAssetReferenceRepresentation) | List of data spaces. Since v61.0. |
| `description` | `description` | VARCHAR | Description of the retriever. Since v61.0. |
| `is_default` | `isDefault` | BOOLEAN | Indicates whether the retriever is the default for its search index (`true`) or not (`false`). Since v61.0. |
| `is_global` | `isGlobal` | BOOLEAN | Indicates whether the retriever is global (`true`) or not (`false`). Since v61.0. |
| `is_virtual` | `isVirtual` | BOOLEAN | Indicates whether the retriever is virtual (`true`) or not (`false`). Since v61.0. |
| `latest_configuration` | `latestConfiguration` | JSON (MlRetrieverConfigurationBaseRepresentation) | Most recent configuration version. Since v61.0. |
| `owner_type` | `ownerType` | VARCHAR | Type of owner. Since v61.0. |
| `ownership` | `ownership` | JSON (CdpAssetReferenceRepresentation) | Owner reference. Since v61.0. |
| `query_type` | `queryType` | VARCHAR | Type of query. Since v61.0. |
| `retriever_lifetime` | `retrieverLifetime` | VARCHAR | Lifetime of the retriever. Since v61.0. |
| `references` | `references` | JSON | Not in the spec schema: from the spec's examples. |

**Notes:** **Not retryable.** ["Retry creates DUPLICATE"](https://github.com/salesforce-misc/Data360AgentforceSolutionKitRetail/blob/main/.claude/skills/create-individual-retrievers/SKILL.md): this always creates a new retriever, even with the same label. Before any retry, including after a lost response, call `retriever_list` and match the label. Remove an extra one with `retriever_delete`.

`configuration` depends on `query_type`: [NoCode](#mlretrieverconfigurationnocodeinputrepresentation) needs `input` and `output_fields`, [CustomSql](#mlretrieverconfigurationcustomsqlinputrepresentation) needs `retriever_query_template_definition`, and [Ensemble](#mlretrieverconfigurationensembleinputrepresentation) needs `referenced_retrievers`, each a `NoCode` retriever. The [MCP tool](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/RetrieverTools.java) says `ProCode` where the spec says `CustomSql`, and also has `data_source_type` and web search attributes the spec lacks.

For `NoCode`, the search index must be `READY` first, so check `search_index_list`. The spec requires `owner_type` and says `dataspaces` is required for `NoCode` and `CustomSql`, yet the [kit's working payload](https://github.com/salesforce-misc/Data360AgentforceSolutionKitRetail/blob/main/.claude/skills/create-individual-retrievers/SKILL.md) (one org) sends neither. The result's top-level `name` is the one to use later. Test with `hybrid_search()` through `query_sql`.

## retriever_config_create

`POST /ssot/machine-learning/retrievers/{retrieverIdOrName}/configurations` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Machine-Learning/paths/~1ssot~1machine-learning~1retrievers~1%7BretrieverIdOrName%7D~1configurations/post) · tool `d360_retriever_config_create` · evidence O · changes org state

Adds a configuration version to a retriever, the way to change how it retrieves. `NoCode` generates a SQL template from the configuration, `CustomSql` takes your template, and `Ensemble` combines sub-retrievers with reranking. At most one configuration is active at a time. The spec marks this endpoint as pilot or beta. Since v61.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `retriever_id_or_name` | `retrieverIdOrName` | path | string | yes | Retriever ID or the parent retriever's top-level `name`. The `active_configuration.name` value returns `ITEM_NOT_FOUND`. |
| `output_fields` | `outputFields` | body | array of string |  | - |
| `referenced_retrievers` | `referencedRetrievers` | body | array of [CdpAssetReferenceInput](#cdpassetreferenceinputrepresentation) |  | - |
| `citation_configuration` | `citationConfiguration` | body | [MlRetrieverCitationConfigurationInput](#mlretrievercitationconfigurationinputrepresentation) |  | - |
| `input` | `input` | body | [MlRetrieverSourceInput](#mlretrieversourceinputrepresentation) |  | - |
| `query_filter` | `queryFilter` | body | [CdpMlFilterInput](#cdpmlfilterinputrepresentation) |  | - |
| `is_active` | `isActive` | body | boolean |  | Indicates whether to activate the configuration on creation (`true`) or not (`false`). Since v61.0. |
| `is_citation_enabled` | `isCitationEnabled` | body | boolean |  | Indicates whether to include citation fields (source record ID, label, URL) in results (`true`) or not (`false`). For CustomSql, `is_citation_supported` must be `true`. Since v61.0. |
| `number_of_results` | `numberOfResults` | body | integer |  | Maximum number of results to return. Must be a positive integer. If unspecified, the default value is `10`. Since v61.0. |
| `query_type` | `queryType` | body | enum(CustomSql, Ensemble, NoCode) | yes | Type of query. Since v61.0. |
| `retrieval_mode` | `retrievalMode` | body | enum(Advanced, Basic) |  | Retrieval mode. Since v61.0. |
| `is_advanced_mode_supported` | `isAdvancedModeSupported` | body | boolean |  | - |
| `is_citation_supported` | `isCitationSupported` | body | boolean |  | - |
| `is_enriched_index_supported` | `isEnrichedIndexSupported` | body | boolean |  | - |
| `retriever_query_template_definition` | `retrieverQueryTemplateDefinition` | body | [MlRetrieverQueryTemplateDefinitionInput](#mlretrieverquerytemplatedefinitioninputrepresentation) |  | - |
| `web_search_provider_type` | `webSearchProviderType` | body | string |  | Not in the spec schema: from the MCP server's request class. |
| `website_filters` | `websiteFilters` | body | array |  | Not in the spec schema: from the MCP server's request class. |

```sql
CALL cdp.retriever_config_create (retriever_id_or_name => 'Combined_Retriever_1Cx_7H01ab12345', query_type => 'Ensemble', is_active => true, number_of_results => 10, referenced_retrievers => [(name = 'Knowledge_Retriever_1Cx_tGW8aac9aec'), (name = 'DIY_Bathroom_Retriever_1Cx_9H02ce17169')]);
```

**Result**

One row. Schema `MlRetrieverConfigurationDetailRepresentation`.

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
| `input` | `input` | JSON (CdpAssetReferenceRepresentation) | Search index reference. Applies only to `NoCode`. Since v61.0. |
| `is_active` | `isActive` | BOOLEAN | Indicates whether the configuration is active (`true`) or not (`false`). At most one configuration can be active per retriever. Since v61.0. |
| `is_citation_enabled` | `isCitationEnabled` | BOOLEAN | Indicates whether citation is enabled (`true`) or not (`false`). Since v61.0. |
| `number_of_results` | `numberOfResults` | BIGINT | Maximum number of results to return. Must be a positive integer. Since v61.0. |
| `retrieval_mode` | `retrievalMode` | VARCHAR | Retrieval mode. Since v61.0. |
| `search_index_configuration` | `searchIndexConfiguration` | JSON (CdpAssetReferenceRepresentation) | Search index configuration reference. Applies only to `NoCode`. Since v61.0. |
| `semantic_search_type` | `semanticSearchType` | VARCHAR | Type of semantic search. Applies only to `NoCode`. Since v61.0. |
| `source_dmo` | `sourceDmo` | JSON (CdpAssetReferenceRepresentation) | Source data model object (DMO) to query. Applies only to `NoCode`. Since v61.0. |
| `vector_dmo` | `vectorDmo` | JSON (CdpAssetReferenceRepresentation) | Vector data model object (DMO) containing embeddings for semantic search. Applies only to `NoCode`. Since v61.0. |
| `version` | `version` | BIGINT | Version number of the configuration. Must be non-negative. Since v61.0. |
| `citation_configuration` | `citationConfiguration` | JSON (MlRetrieverCitationConfigurationRepresentation) | Citation configuration. Applies only to `NoCode`. Since v61.0. |
| `field_placeholders` | `fieldPlaceholders` | JSON (array of MlFieldPlaceholderRepresentation) | List of field placeholders with parameter values specified at runtime. Applies only to `NoCode`. Since v61.0. |
| `is_advanced_mode_supported` | `isAdvancedModeSupported` | BOOLEAN | Indicates whether advanced mode is supported (`true`) or not (`false`). Applies only to `CustomSql`. Since v61.0. |
| `is_citation_supported` | `isCitationSupported` | BOOLEAN | Indicates whether citation output is supported (`true`) or not (`false`). Applies only to `CustomSql`. Since v61.0. |
| `is_enriched_index_supported` | `isEnrichedIndexSupported` | BOOLEAN | Indicates whether enriched search index chunk resolution is supported (`true`) or not (`false`). Applies only to `CustomSql`. Since v61.0. |
| `output_fields` | `outputFields` | JSON (array of MlRetrieverOutputFieldRepresentation) | List of output fields. Include the name and label for `CustomSql` and `Ensemble`. Include the name and field for `NoCode`. Since v61.0. |
| `query_filter` | `queryFilter` | JSON (CdpMlFilterRepresentation) | Query filter. Applies only to `NoCode`. Since v61.0. |
| `referenced_retrievers` | `referencedRetrievers` | JSON (array of MlRetrieverRepresentation) | List of sub-retrievers. Applies only to `Ensemble`. Since v61.0. |
| `retriever_query_template_definition` | `retrieverQueryTemplateDefinition` | JSON (MlRetrieverQueryTemplateDefinitionRepresentation) | Query template definition. Applies only to `CustomSql` and `Ensemble`. Since v61.0. |
| `dataspace` | `dataSpace` | JSON | Not in the spec schema: from the spec's examples. |

**Notes:** The table lists the spec's base schema. Add the attributes of the variant for `query_type`: [NoCode](#mlretrieverconfigurationnocodeinputrepresentation), [CustomSql](#mlretrieverconfigurationcustomsqlinputrepresentation) or [Ensemble](#mlretrieverconfigurationensembleinputrepresentation). The same variants apply to `configuration` on `retriever_create`. For `CustomSql`, call `retriever_review` first. No source says a retry is safe, so list configurations first, as with `retriever_create`.

## retriever_review

`POST /ssot/machine-learning/retrievers/actions/review` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Machine-Learning/paths/~1ssot~1machine-learning~1retrievers~1actions~1review/post) · evidence O · read-only

Reviews a `CustomSql` retriever input and returns errors and suggestions. Use it to validate the SQL before you create or update a retriever configuration. The spec marks this endpoint as pilot or beta. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `existing_retriever_asset` | `existingRetrieverAsset` | body | [CdpAssetReferenceInput](#cdpassetreferenceinputrepresentation) |  | Reference to an existing retriever when reviewing a new configuration. Since v67.0. |
| `retriever_input` | `retrieverInput` | body | [MlRetrieverInput](#mlretrieverinputrepresentation) | yes | Retriever input to review. Since v67.0. |

```sql
CALL cdp.retriever_review (retriever_input => (label = 'CustomSql retriever for ADL knowledge.', description = 'CustomSql retriever matching ADL knowledge internally created retriever.', owner_type = 'Api', dataspaces = ['default'], configuration = (query_type = 'CustomSql', is_active = true, number_of_results = 5, is_citation_enabled = false, retrieval_mode = 'Basic', retriever_query_template_definition = (retriever_query_template = 'SELECT
    "v"."hybrid_score__c" AS "Score",
    "c"."Chunk__c" AS "Chunk",
    "c"."SourceRecordId__c" AS "SourceRecordId",
    "c"."RecordId__c" AS "RecordId",
    "c"."DataSource__c" AS "DataSource",
    "c"."DataSourceObject__c" AS "DataSourceObject"
FROM
    hybrid_search(
    TABLE("KA_kav_index__dlm"),
    :"SearchString",
    ''Language__c = :"Language" AND KnowledgePublicationStatus__c = ''''Online'''' AND DataSource__c IN (''''Answer_c__c'''',''''Question_c__c'''',''''ssot__Description__c'''',''''Detail_c__c'''')'',
    :"NumOfResults"
    ) AS "v"
    INNER JOIN "KA_kav_chunk__dlm" AS "c" ON "c"."RecordId__c" = "v"."RecordId__c"
    INNER JOIN "ssot__KnowledgeArticleVersion__dlm" AS "kav" ON "c"."SourceRecordId__c" = "kav"."ssot__Id__c"
ORDER BY "Score" DESC
    LIMIT :"NumOfResults"', main_user_query_parameter_name = 'NoMatchParamName', search_overall_score_column_name = 'Score', query_template_placeholders = [(placeholder_data_type = 'Text', placeholder_name = ':"SearchString"', placeholder_description = 'SearchString'), (placeholder_data_type = 'Number', placeholder_name = ':"NumOfResults"', placeholder_value = '10', placeholder_description = 'NumOfResults'), (placeholder_data_type = 'Text', placeholder_name = ':"Language"', placeholder_value = 'en_US', placeholder_description = 'Language')]))), existing_retriever_asset => (name = 'knowledge_customsql_retriever_1Cx_tGW8aac9aec'));
```

**Result**

One row. Schema `MlRetrieverReviewRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `extracted_select_columns` | `extractedSelectColumns` | JSON (array of MlRetrieverReviewSelectColumnRepresentation) | List of SELECT columns extracted from the SQL query. Since v67.0. |
| `findings` | `findings` | JSON (array of MlRetrieverReviewItemRepresentation) | List of review findings, such as errors and suggestions. Since v67.0. |
| `has_errors` | `hasErrors` | BOOLEAN | Indicates whether the input has errors that prevent creation (`true`) or not (`false`). Since v67.0. |

**Notes:** It only validates: the `changes org state` label above comes from the `POST` verb. Check `has_errors`. Set `existing_retriever_asset` when reviewing a new configuration of an existing retriever. No MCP tool covers this call.

## prediction_job_run

`POST /ssot/machine-learning/jobs` · tool `d360_prediction_job_run` · evidence S · changes org state

Submits a run of a prediction job definition, which scores the input DMO and writes the output DMO. The definition must be `Active`. The call returns before the run finishes.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `input` | `input` | body | [CdpAssetReferenceInput](#cdpassetreferenceinputrepresentation) | yes | The prediction job definition, by `id` or `name`. |
| `type` | `type` | body | enum(Prediction) | yes | Job type. The MCP tool always sends `Prediction`. |

```sql
CALL cdp.prediction_job_run (type => 'Prediction', input => (name = 'attrition_scores'));
```

**Result**

One row. This shape comes from an [MCP test fixture](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/test/java/com/salesforce/data360/mcp/tools/machinelearning/predictionjob/PredictionJobDefToolsTest.java). Other response fields, if any, go to `_raw`.

| Column | API name | Type | Description |
|---|---|---|---|
| `id` | `id` | VARCHAR | Job ID, for `ml_job_get`. |
| `status` | `status` | VARCHAR | Initial status: [`Submited`, `Pending`, `NotStarted` or `InProgress`](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/resources/metadata/payload-examples.json). |

**Done when:** `prediction_job_def_get`, column `last_run_status`, is `Success` or `Failed`. The spec's enum also has `Aborted`.

**Notes:** The [MCP tool](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/machinelearning/predictionjob/PredictionJobDefTools.java) names its parameter `predictionJobDef`, but [the wire body](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/test/java/com/salesforce/data360/mcp/tools/machinelearning/predictionjob/PredictionJobDefToolsTest.java) is `{type: 'Prediction', input: {...}}`, so these options follow the wire. Prerequisites: the definition is `Active` and its configured model is `Enabled`. The spec documents `GET` on this path but no `POST`. No source says a retry is safe, so check `last_run_date` first.

## ml_setup_version_inspector_metrics_get

`GET /ssot/machine-learning/model-setups/{idOrName}/setup-versions/{versionId}/inspector/metrics` · tool `d360_ml_setup_version_inspector_metrics_get` · evidence S · read-only

Gets the evaluation of a trained setup version: AUC, gini, MCC, MSE, RMSE, confusion matrices at 100 thresholds, a gain table and the outcome distribution. Use it after the version reaches `Published` to judge the model.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `model_setup_id_or_name` | `idOrName` | path | string | yes | Model setup ID or developer name. |
| `version_id` | `versionId` | path | string | yes | Setup version ID. A name is not accepted. Get it from `ml_setup_version_list` or the `ml_setup_version_create` result. |
| `gauges` | `gauges` | query | string |  | Comma-separated subset of `All`, `Overview`, `GainTable`, `Residuals`, `Correlations`, `FeatureImportances`, `Coefficients`, `DataSegments`, `CrossValidations`, `OutcomeDistribution`, `PairwiseCorrelations`. Defaults to `Overview`. |

```sql
CALL cdp.ml_setup_version_inspector_metrics_get (model_setup_id_or_name => 'Attrition_Risk_Predictor', version_id => '14kSB0000005d8nYAA', gauges => 'All');
```

**Result**

One row.

| Column | API name | Type | Description |
|---|---|---|---|
| `inspector_responses` | `inspectorResponses` | JSON | [From the MCP payload example](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/resources/metadata/payload-examples.json): `overview` (`auc`, `gini`, `mcc`, `mse`, `rmse`, `confusionMatrices`), `outcomeDistribution.training` and `gainTable.training`, `gainTable.validation`. |

## ml_configured_model_create

`POST /ssot/machine-learning/configured-models` · tool `d360_ml_configured_model_create` · evidence S · changes org state

Wraps a model artifact in a configured model, the object that predictions run against. Use it after a setup version reaches `Published`.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `artifact` | `artifact` | body | [CdpAssetReferenceInput](#cdpassetreferenceinputrepresentation) | yes | Reference to the underlying ML model artifact (typically discovered via the published setup-version's modelArtifact field). Required. |
| `label` | `label` | body | string |  | Display label for the configured model. |
| `description` | `description` | body | string |  | Free-form description. |
| `status` | `status` | body | string |  | One of `Disabled`, `Enabled`, `Deprecated`, `Rerouted`. Defaults to `Disabled`. Send `Enabled` to activate now, or use `ml_configured_model_update` later. |
| `visibility` | `visibility` | body | string |  | Visibility. One of: Shown, Hidden. Defaults to Shown. |
| `capability` | `capability` | body | string |  | Model capability. One of: ChatCompletion, Completion, Embedding, Regression, BinaryClassification, MulticlassClassification, Clustering, Generic, Transcribe, SpeechSynthesis, Summarization, Forecast, SentimentAnalysis, TopicClassification. |
| `parameter_overrides` | `parameterOverrides` | body | array of [ModelParameterOverrideInput](#modelparameteroverrideinput) |  | Per-parameter overrides for this configured model. |
| `actionable_fields` | `actionableFields` | body | array of [CustomizableFieldInput](#customizablefieldinput) |  | Actionable variables. Prescriptions can be generated on these variables. |

```sql
CALL cdp.ml_configured_model_create (label => 'Attrition Predictor (Catboost)', artifact => (name = 'Attrition_Risk_Predictor_v1__mla'), capability => 'BinaryClassification', visibility => 'Shown', parameter_overrides => [(parameter_name = 'decisionThreshold', continuous_value = 0.5)], actionable_fields => [(name = 'Over_Time__c', type = 'ActionableVariable'), (name = 'Monthly_Income__c', type = 'TopFactor')]);
```

**Result**

One row. The [MCP payload example](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/resources/metadata/payload-examples.json) names these fields and an [MCP test fixture](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/test/java/com/salesforce/data360/mcp/tools/machinelearning/configuredmodel/ConfiguredModelToolsTest.java) returns `id`. Types and descriptions match `ml_configured_model_get`. Other response fields go to `_raw`.

| Column | API name | Type | Description |
|---|---|---|---|
| `id` | `id` | VARCHAR | Configured model ID. |
| `status` | `status` | VARCHAR | Model status. Since v61.0. |
| `last_activated_date` | `lastActivatedDate` | VARCHAR | Date the configured model was last activated. Since v61.0. |
| `model_disabled_reasons` | `modelDisabledReasons` | JSON | Reason(s) why the model status is disabled. Since v64.0. |
| `parameters` | `parameters` | JSON (array of CdpMlModelParameterDefinitionBaseRepresentation) | List of parameters supported by the model. Since v59.0. |
| `input_fields` | `inputFields` | JSON (array of CdpMlModelInputFieldBaseRepresentation) | List of input features into the model. Since v59.0. |
| `output_fields` | `outputFields` | JSON (array of CdpMlModelOutputFieldRepresentation) | List of output features from the model. Since v59.0. |

**Notes:** [Status defaults to `Disabled`](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/resources/metadata/payload-examples.json), and a disabled model can't be used for inference. Find the artifact in the published version's `modelArtifact` field or with `ml_model_artifact_list`. `parameter_name` must be declared on the artifact. In `parameter_overrides`, give `discrete_value` or `continuous_value`, not both. No source says a retry is safe, so check `ml_configured_model_list` with `asset_id_or_name` first.

## ml_configured_model_history_list

`GET /ssot/machine-learning/configured-models/{idOrName}/histories` · tool `d360_ml_configured_model_history_list` · evidence S · read-only

Lists the history snapshots of a configured model. Use it to see how a model changed over time.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `configured_model_id_or_name` | `idOrName` | path | string | yes | Configured model ID or name. A name has the form `<namespace>__<devname>`, for example `mynamespace__ourGPT35Turbo`. |
| `limit` | `limit` | query | integer |  | Page size. |
| `offset` | `offset` | query | integer |  | Pagination offset. |

```sql
CALL cdp.ml_configured_model_history_list (configured_model_id_or_name => '...');
```

**Result**

One row per item of `/histories` in the response. This shape comes from an [MCP test fixture](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/test/java/com/salesforce/data360/mcp/tools/machinelearning/configuredmodel/ConfiguredModelToolsTest.java). The sources don't document the item fields, so each item is in `_raw`.

**Paging:** `limit` and `offset`. The sources don't document a next-page field.

**Notes:** [Snapshots are content-based](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/resources/metadata/payload-examples.json): a no-op edit adds no entry, and out-of-the-box models have no history.

## ml_configured_model_history_get

`GET /ssot/machine-learning/configured-models/{idOrName}/histories/{historyId}` · tool `d360_ml_configured_model_history_get` · evidence S · read-only

Gets one history snapshot of a configured model, as it was when the entry was recorded.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `configured_model_id_or_name` | `idOrName` | path | string | yes | Configured model ID or name. A name has the form `<namespace>__<devname>`, for example `mynamespace__ourGPT35Turbo`. |
| `history_id` | `historyId` | path | string | yes | History entry id (15- or 18-character Salesforce id). |

```sql
CALL cdp.ml_configured_model_history_get (configured_model_id_or_name => '...', history_id => '...');
```

**Result**

One row. Other response fields go to `_raw`.

| Column | API name | Type | Description |
|---|---|---|---|
| `id` | `id` | VARCHAR | History entry ID, per an [MCP test fixture](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/test/java/com/salesforce/data360/mcp/tools/machinelearning/configuredmodel/ConfiguredModelToolsTest.java). |
| `configured_model` | `configuredModel` | JSON | [Snapshot of the model](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/machinelearning/configuredmodel/ConfiguredModelTools.java) when the entry was recorded. |

## ml_query_setup_fields

`POST /ssot/machine-learning/query-setup-fields` · tool `d360_ml_query_setup_fields` · evidence S · read-only

Lists the fields and applicable transformations of a data source. This is the first call when you author a model setup.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `input` | `input` | body | [InputSourceInput](#inputsourceinput) | yes | Data source to introspect. Set type=DataModelObject/CalculatedInsightObject/SdmObject with source+dataspace for single-source, or type=MultiSourceObjects with sources[] for joined sources. |
| `filter` | `filter` | body | [FilterInput](#filterinput) |  | Optional row-level filter applied before processing. |
| `join` | `join` | body | [JoinInput](#joininput) |  | Optional join applied to multi-source inputs. |
| `filter_fields` | `filterFields` | body | boolean |  | When true, the response also surfaces fields eligible for use in filters. Optional. |
| `related_field_names` | `relatedFieldNames` | body | array of [FieldSourceInput](#fieldsourceinput) |  | Optional. Typed field references to include from related sources (use with multi-source inputs/joins). |

```sql
CALL cdp.ml_query_setup_fields (input => (type = 'DataModelObject', source = (name = 'Sales__dlm'), dataspace = (name = 'default')), filter_fields => false);
```

**Result**

One row per item of `/fields` in the response. Other response fields go to `_meta`: `transformations`. This shape comes from an [MCP test fixture](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/test/java/com/salesforce/data360/mcp/tools/machinelearning/setup/ModelSetupHelperToolsTest.java). The sources don't document the item fields, so each item is in `_raw`.

**Notes:** An ordinary read despite the `changes org state` label above, which comes from the `POST` verb: the [MCP source](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/machinelearning/setup/ModelSetupHelperTools.java) describes it as a query. Pass each returned field unchanged in `fields` on `ml_setup_version_create`.

## ml_query_data_profile

`POST /ssot/machine-learning/query-data-profile` · tool `d360_ml_query_data_profile` · evidence S · read-only

Profiles the values of a data source: minimum, maximum and bucketing for numeric fields, and distinct values with row counts for text fields. Use it to spot constant numerics, class imbalance and dominant categories.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `input` | `input` | body | [InputSourceInput](#inputsourceinput) | yes | Data source to introspect. Set type=DataModelObject/CalculatedInsightObject/SdmObject with source+dataspace for single-source, or type=MultiSourceObjects with sources[] for joined sources. |
| `filter` | `filter` | body | [FilterInput](#filterinput) |  | Optional row-level filter applied before processing. |
| `join` | `join` | body | [JoinInput](#joininput) |  | Optional join applied to multi-source inputs. |
| `profile_field_names` | `profileFieldNames` | body | array of [FieldSourceInput](#fieldsourceinput) |  | Optional. Fields to profile, each as a typed reference (works for multi-source / related-object fields). Omit to profile all eligible fields on the primary source. |

```sql
CALL cdp.ml_query_data_profile (input => (type = 'DataModelObject', source = (name = 'Sales__dlm'), dataspace = (name = 'default')), profile_field_names => [(name = 'Amount__c', source = 'Sales__dlm', type = 'DataModelObject'), (name = 'CloseDate__c', source = 'Sales__dlm', type = 'DataModelObject')]);
```

**Result**

One row per item of `/fields` in the response. This shape comes from an [MCP test fixture](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/test/java/com/salesforce/data360/mcp/tools/machinelearning/setup/ModelSetupHelperToolsTest.java). The sources don't document the item fields, so each item is in `_raw`.

**Notes:** An ordinary read despite the `changes org state` label above, which comes from the `POST` verb: the [MCP source](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/machinelearning/setup/ModelSetupHelperTools.java) describes it as a query. The [tool](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/machinelearning/setup/ModelSetupHelperTools.java) and its [catalog entry](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/runtime/FamilyCatalog.java) describe the output differently: the catalog says cardinality, null counts and distribution stats.

## ml_query_outcome

`POST /ssot/machine-learning/query-outcome` · tool `d360_ml_query_outcome` · evidence S · read-only

Lists the columns of a data source that could be a training target. `prediction_type` narrows the list to one prediction type.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `input` | `input` | body | [InputSourceInput](#inputsourceinput) | yes | Data source to introspect. Set type=DataModelObject/CalculatedInsightObject/SdmObject with source+dataspace for single-source, or type=MultiSourceObjects with sources[] for joined sources. |
| `filter` | `filter` | body | [FilterInput](#filterinput) |  | Optional row-level filter applied before processing. |
| `join` | `join` | body | [JoinInput](#joininput) |  | Optional join applied to multi-source inputs. |
| `related_field_names` | `relatedFieldNames` | body | array of [FieldSourceInput](#fieldsourceinput) |  | Optional. Typed field references to include from related sources (use with multi-source inputs/joins). |
| `prediction_type` | `predictionType` | body | string |  | Optional. Narrow outcome candidates to a prediction type. One of: Regression, BinaryClassification, MulticlassClassification. |

```sql
CALL cdp.ml_query_outcome (input => (type = 'DataModelObject', source = (name = 'Sales__dlm'), dataspace = (name = 'default')), prediction_type => 'BinaryClassification');
```

**Result**

One row per item of `/outcomes` in the response. This shape comes from an [MCP test fixture](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/test/java/com/salesforce/data360/mcp/tools/machinelearning/setup/ModelSetupHelperToolsTest.java). The sources don't document the item fields, so each item is in `_raw`.

**Notes:** An ordinary read despite the `changes org state` label above, which comes from the `POST` verb: the [MCP source](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/machinelearning/setup/ModelSetupHelperTools.java) describes it as a query. Omit `prediction_type` to get [all supervised candidates](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/resources/metadata/payload-examples.json). The [tool](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/machinelearning/setup/ModelSetupHelperTools.java) lists Binary, Discrete and Continuous candidates, while its [catalog entry](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/runtime/FamilyCatalog.java) also lists Clustering.

## ml_query_row_count

`POST /ssot/machine-learning/query-row-count` · tool `d360_ml_query_row_count` · evidence S · read-only

Counts the rows of a data source after filters and joins. Use it to check that there is enough data to train.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `input` | `input` | body | [InputSourceInput](#inputsourceinput) | yes | Data source to introspect. Set type=DataModelObject/CalculatedInsightObject/SdmObject with source+dataspace for single-source, or type=MultiSourceObjects with sources[] for joined sources. |
| `filter` | `filter` | body | [FilterInput](#filterinput) |  | Optional row-level filter applied before processing. |
| `join` | `join` | body | [JoinInput](#joininput) |  | Optional join applied to multi-source inputs. |

```sql
CALL cdp.ml_query_row_count (input => (type = 'DataModelObject', source = (name = 'Sales__dlm'), dataspace = (name = 'default')), filter => (criteria = [(filter_field = (name = 'Amount__c', source = 'Sales__dlm', type = 'DataModelObject'), operator = 'GreaterThan', values = [(value = '1000', type = 'Constant')])], conjunctive_operator = 'And'));
```

**Result**

One row. This shape comes from an [MCP test fixture](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/test/java/com/salesforce/data360/mcp/tools/machinelearning/setup/ModelSetupHelperToolsTest.java).

| Column | API name | Type | Description |
|---|---|---|---|
| `row_count` | `rowCount` | BIGINT | Rows after filters and joins. |

**Notes:** An ordinary read despite the `changes org state` label above, which comes from the `POST` verb: the [MCP source](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/machinelearning/setup/ModelSetupHelperTools.java) describes it as a query. The [platform minimum is 400 rows](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/machinelearning/setup/ModelSetupTools.java), and the [tool](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/machinelearning/setup/ModelSetupHelperTools.java) suggests a few thousand for reasonable quality. `conjunctive_operator` is required with 2 or more criteria.

## ml_model_setup_list

`GET /ssot/machine-learning/model-setups` · tool `d360_ml_model_setup_list` · evidence S · read-only

Lists model setups, the parent records that group setup versions. Filter by `search`, `model_type`, `model_capability`, `setup_type` or `connector_type`.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `search` | `search` | query | string |  | Free-text search across labels and descriptions. |
| `model_type` | `modelType` | query | string |  | Filter by model type. One of: Predictive, Generative, Transcribe, SpeechSynthesis, Summarization, Unknown. |
| `model_capability` | `modelCapability` | query | string |  | Filter by model capability (e.g. BinaryClassification, Regression). |
| `setup_type` | `setupType` | query | string |  | Filter by setup type. One of: EdcNoCode, OutOfTheBox, ModelConnector. |
| `connector_type` | `connectorType` | query | string |  | Filter by connector type (e.g. SageMaker, OpenAI). |
| `limit` | `limit` | query | integer |  | Page size (default platform-defined). |
| `offset` | `offset` | query | integer |  | Pagination offset. |

```sql
CALL cdp.ml_model_setup_list (model_type => 'Predictive', model_capability => 'BinaryClassification', limit => 50);
```

**Result**

One row per item of `/modelSetups` in the response. This shape comes from an [MCP test fixture](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/test/java/com/salesforce/data360/mcp/tools/machinelearning/setup/ModelSetupToolsTest.java). The sources don't document the item fields, so each item is in `_raw`.

**Paging:** `limit` and `offset`. The sources don't document a next-page field.

## ml_model_setup_get

`GET /ssot/machine-learning/model-setups/{idOrName}` · tool `d360_ml_model_setup_get` · evidence S · read-only

Gets one model setup by ID or developer name.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `model_setup_id_or_name` | `idOrName` | path | string | yes | Model-setup id or developer name. |

```sql
CALL cdp.ml_model_setup_get (model_setup_id_or_name => 'Attrition_Risk_Predictor');
```

**Result**

One row. This shape comes from an [MCP test fixture](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/test/java/com/salesforce/data360/mcp/tools/machinelearning/setup/ModelSetupToolsTest.java). Other response fields go to `_raw`.

| Column | API name | Type | Description |
|---|---|---|---|
| `id` | `id` | VARCHAR | Model setup ID. |

## ml_model_setup_create

`POST /ssot/machine-learning/model-setups` · tool `d360_ml_model_setup_create` · evidence S · changes org state

Creates a model setup, the parent record for setup versions. This is step 1 of 3 and starts no training. Follow with `ml_setup_version_create`.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `label` | `label` | body | string | yes | Display label for the model setup container. |
| `description` | `description` | body | string |  | Free-form description. |
| `model_type` | `modelType` | body | string | yes | Model type. One of: Predictive, Generative, Transcribe, SpeechSynthesis, Summarization, Unknown. |
| `model_capability` | `modelCapability` | body | string | yes | Model capability. For predictive use one of: Regression, BinaryClassification, MulticlassClassification, Clustering.) |
| `setup_type` | `setupType` | body | string | yes | Setup type. One of: EdcNoCode, OutOfTheBox, ModelConnector. Use EdcNoCode for the agent-authored, no-code training flow. |
| `connector_type` | `connectorType` | body | string |  | Connector type: only when setup_type=ModelConnector. One of: SageMaker, OpenAI, AzureOpenAI, InternalEmbedding, Generic, Databricks, VertexAI, Anthropic, Bedrock, OpenConnector, Salesforce. |
| `outcome_definition` | `outcomeDefinition` | body | [ModelOutcomeDefinitionInput](#modeloutcomedefinitioninput) |  | Optional outcome hints at the container level (per-version OutcomeInput is authoritative). |

```sql
CALL cdp.ml_model_setup_create (label => 'Attrition Risk Predictor', description => 'Predict whether an employee will leave the company.', model_type => 'Predictive', model_capability => 'BinaryClassification', setup_type => 'EdcNoCode', outcome_definition => (goal = 'Minimize', field_names = ['Attrition__c']));
```

**Result**

One row. This shape comes from an [MCP test fixture](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/test/java/com/salesforce/data360/mcp/tools/machinelearning/setup/ModelSetupToolsTest.java). Other response fields go to `_raw`.

| Column | API name | Type | Description |
|---|---|---|---|
| `id` | `id` | VARCHAR | Model setup ID. |

**Notes:** `EdcNoCode` is [the no-code training flow](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/model/request/machinelearning/setup/ModelSetupCreateRequest.java). `outcome_definition` is only a hint: the version's `outcomes` are authoritative. The [payload example](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/resources/metadata/payload-examples.json) says it's immutable after creation, while the same file and the patch class list it as settable on `ml_model_setup_update`. No source says a retry is safe, so check `ml_model_setup_list` first.

## ml_model_setup_update

`PATCH /ssot/machine-learning/model-setups/{idOrName}` · tool `d360_ml_model_setup_update` · evidence S · changes org state

Changes the label, description, capability or outcome hint of a model setup. Send only the attributes to change.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `model_setup_id_or_name` | `idOrName` | path | string | yes | Model setup ID or developer name. |
| `label` | `label` | body | string |  | New display label. |
| `description` | `description` | body | string |  | New description. |
| `model_capability` | `modelCapability` | body | string |  | Updated model capability. See create-request docs for valid values. |
| `outcome_definition` | `outcomeDefinition` | body | [ModelOutcomeDefinitionInput](#modeloutcomedefinitioninput) |  | Updated outcome hint. |

```sql
CALL cdp.ml_model_setup_update (model_setup_id_or_name => 'Attrition_Risk_Predictor', description => 'Updated description for the attrition predictor.');
```

**Result**

One row. This shape comes from an [MCP test fixture](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/test/java/com/salesforce/data360/mcp/tools/machinelearning/setup/ModelSetupToolsTest.java). Other response fields go to `_raw`.

| Column | API name | Type | Description |
|---|---|---|---|
| `id` | `id` | VARCHAR | Model setup ID. |

**Notes:** See `ml_model_setup_create` for the conflict about changing `outcome_definition`.

## ml_model_setup_delete

`DELETE /ssot/machine-learning/model-setups/{idOrName}` · tool `d360_ml_model_setup_delete` · evidence S · changes org state

Deletes a model setup and all its versions.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `model_setup_id_or_name` | `idOrName` | path | string | yes | Model-setup id or developer name. |

```sql
CALL cdp.ml_model_setup_delete (model_setup_id_or_name => 'Attrition_Risk_Predictor');
```

**Result**

The public sources don't document this response. One row, with the response in `_raw`.

**Notes:** [Cascades to all versions and is irreversible](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/machinelearning/setup/ModelSetupTools.java). No source says what happens to artifacts and configured models trained from those versions.

## Schemas

Attribute names are keywords inside the object they belong to, so completion offers exactly these.

### BucketingStrategyInput

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `type` | `type` | string |  | Bucketing strategy. One of: EvenWidth, Manual, Percentile. EvenWidth/Percentile use number_of_buckets; Manual uses explicit buckets[]. |
| `number_of_buckets` | `numberOfBuckets` | integer |  | Number of buckets (EvenWidth / Percentile strategies). |
| `buckets` | `buckets` | array of number |  | Explicit bucket boundaries (Manual strategy only). Each entry is a numeric upper-bound for one bucket. |

### CdpAssetReferenceInputRepresentation

Input representation for an asset reference.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `id` | `id` | string |  | ID of the asset. Since v58.0. |
| `name` | `name` | string |  | Name of the asset. Since v58.0. |
| `namespace` | `namespace` | string |  | Namespace of the asset. Since v58.0. |

### CdpMlFilterCriterionInputRepresentation

Represents the input for a filter criterion.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `field` | `field` | [MlFilterFieldAssetInput](#mlfilterfieldassetinputrepresentation) | yes | Filter field. For `NoCode` retriever configuration, this is the reference ID, alias name, or related data model object (DMO) field developer name in `vector_embedding_related_fields` of the search index. Since v67.0. |
| `operator` | `operator` | enum(EqualTo, GreaterThan, GreaterThanOrEqualTo, In, LessThan, LessThanOrEqualTo, Like, NotEqualTo, NotIn) | yes | Operator applied to the filter criterion. Since v67.0. |
| `values` | `values` | array of [CdpMlFilterValueInput](#cdpmlfiltervalueinputrepresentation) | yes | List of values to apply in the filter. Since v67.0. |

### CdpMlFilterInputRepresentation

Represents the input for a filter expression.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `conjunctive_operator` | `conjunctiveOperator` | enum(And, Custom, Or) | yes | Operator used to join filter criteria. Since v67.0. |
| `criteria` | `criteria` | array of [CdpMlFilterCriterionInput](#cdpmlfiltercriterioninputrepresentation) | yes | List of filter criteria. Since v67.0. |
| `custom_boolean_expression` | `customBooleanExpression` | string |  | Custom boolean expression in the format "{!$0} AND {!$1} AND ({!$2} OR {!$3}) AND (NOT {!$4})". Each number is the index of a criterion in the criteria list. Used when `conjunctive_operator` is `Custom`. Since v67.0. |

### CdpMlFilterValueInputRepresentation

Represents the input for a filter value.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `type` | `type` | enum(Constant, Placeholder) | yes | Type of value. Since v67.0. |
| `value` | `value` | string | yes | Value content. When `type` is `Constant`, this property contains the constant value. When `type` is `Placeholder`, this property contains the placeholder name in the format "{!$parameter}". Since v67.0. |

### CdpMlPredictInputBase_model

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `name` | `name` | string |  | Seen in examples: the spec types the parent as a free-form object. |

### CustomizableFieldInput

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `name` | `name` | string | yes | Field name on the artifact's input/output schema. |
| `type` | `type` | string | yes | Customizable field type. One of: ActionableVariable, TopFactor. |

### FieldConfigInput

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `type` | `type` | string | yes | Field type. One of: Text, Date, Number. Per-type fields: Text uses includeOther/balanced/ordering/dataType/values; Date uses min/max (ISO date strings); Number uses min/max (doubles) plus optional bucketing_strategy. |
| `name` | `name` | string | yes | Field API name (must exist on the input source). |
| `label` | `label` | string |  | Display label. |
| `source` | `source` | string |  | Owning data source name (multi-source only). |
| `ignored` | `ignored` | boolean |  | Mark field as ignored (excluded from training). |
| `include_other` | `includeOther` | boolean |  | Text fields only: group rare values into an "Other" bucket. |
| `balanced` | `balanced` | boolean |  | Text fields only: balance class frequencies during training. |
| `ordering` | `ordering` | string |  | Text fields only: value ordering. One of: Occurrence, Alphabetical, Numeric. |
| `data_type` | `dataType` | string |  | Text fields only: data type. One of: Categorical, Boolean. |
| `values` | `values` | array of [TextFieldValueInput](#textfieldvalueinput) |  | Text fields only: distinct value configurations. |
| `min` | `min` | any |  | A string or a number. Date fields: ISO-8601 minimum (e.g. 2024-01-01). Number fields: numeric minimum. |
| `max` | `max` | any |  | A string or a number. Date fields: ISO-8601 maximum. Number fields: numeric maximum. |
| `bucketing_strategy` | `bucketingStrategy` | [BucketingStrategyInput](#bucketingstrategyinput) |  | Number fields only: bucketing strategy. |

### FieldRelationshipInput

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `source` | `source` | string |  | Source dataset (DMO/CIO/SDM) name owning the related field. |
| `name` | `name` | string |  | Field API name on the source dataset. |
| `joins` | `joins` | array of [JoinCriteriaInput](#joincriteriainput) |  | Join clauses linking the primary dataset to this related field. |

### FieldSourceInput

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `name` | `name` | string | yes | Field API name (e.g. Amount__c). |
| `source` | `source` | string |  | API name of the source object that owns this field (e.g. Sales__dlm). |
| `type` | `type` | string |  | Source kind for the owning object. One of: DataModelObject, CalculatedInsightObject, SdmObject. |

### FilterCriterionInput

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `values` | `values` | array of [FilterValueInput](#filtervalueinput) |  | Values compared against the field (interpreted by operator). |
| `operator` | `operator` | string |  | Comparison operator. One of: In, NotIn, EqualTo, NotEqualTo, Contains, StartsWith, EndsWith, IsNull, IsNotNull, LessThan, LessThanOrEqualTo, GreaterThan, GreaterThanOrEqualTo, Like. |
| `filter_field` | `filterField` | [FieldSourceInput](#fieldsourceinput) |  | Reference to the field this criterion filters on. |

### FilterInput

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `criteria` | `criteria` | array of [FilterCriterionInput](#filtercriterioninput) |  | Filter conditions (each is a field/operator/values triple). |
| `conjunctive_operator` | `conjunctiveOperator` | string |  | How criteria combine. One of: And, Or, Custom. Required when there are 2+ criteria. With Custom, pair with custom_boolean_expression. |
| `custom_boolean_expression` | `customBooleanExpression` | string |  | Boolean expression over criterion indices (e.g. "(1 AND 2) OR 3"). Honored only when conjunctive_operator=Custom. |

### FilterValueInput

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `value` | `value` | string |  | Literal value (for type=Constant) or placeholder name (for type=Placeholder). |
| `type` | `type` | string |  | Value type. One of: Constant, Placeholder. |

### InputSourceInput

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `type` | `type` | string | yes | Source kind. One of: DataModelObject, CalculatedInsightObject, SdmObject, MultiSourceObjects. For the first three, set 'source' (required) and 'dataspace' and leave 'sources' empty. For MultiSourceObjects, set 'sources' (a list of single-source entries) and leave 'source'/'dataspace'/'primary' empty. |
| `source` | `source` | [CdpAssetReferenceInput](#cdpassetreferenceinputrepresentation) |  | Single-source only. Reference to the DMO/CIO/SDM entity (by name or id). |
| `dataspace` | `dataSpace` | [CdpAssetReferenceInput](#cdpassetreferenceinputrepresentation) |  | Single-source only. Dataspace the source lives in. |
| `primary` | `primary` | boolean |  | Marks this entry as the primary source (relevant for MultiSourceObjects). |
| `sources` | `sources` | array of [InputSourceInput](#inputsourceinput) |  | MultiSourceObjects only. List of single-source entries (each with its own type/source/dataSpace; mark exactly one as primary=true). |

### JoinCriteriaInput

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `fields` | `fields` | array of [JoinFieldsInput](#joinfieldsinput) |  | Field-pair conditions that make up the join key. |
| `operator` | `operator` | string |  | How field-pair conditions combine within this join. One of: And, Or. |
| `type` | `type` | string |  | Join type. One of: Inner, Left, Right, Outer. |
| `left` | `left` | string |  | API name of the primary (left) dataset. |
| `right` | `right` | string |  | API name of the related (right) dataset. |

### JoinFieldsInput

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `left_field` | `leftField` | string |  | Field API name on the left (primary) dataset. |
| `right_field` | `rightField` | string |  | Field API name on the right (related) dataset. |

### JoinInput

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `criteria` | `criteria` | array of [JoinCriteriaInput](#joincriteriainput) |  | Join clauses, each linking the primary dataset to one related dataset. |

### MlBinaryClassificationJobDefSettingsInputRepresentation

Represents the settings configuration for a binary classification prediction job definition.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `max_prescriptions` | `maxPrescriptions` | integer |  | Maximum number of prescriptions to generate. Since v66.0. |
| `max_top_contributors` | `maxTopContributors` | integer |  | Maximum number of top contributors to generate. Since v66.0. |
| `prescription_threshold` | `prescriptionThreshold` | integer |  | Prescription threshold value. Since v66.0. |
| `show_class_probabilities` | `showClassProbabilities` | boolean |  | Indicates whether the outcome columns show class probabilities for both positive and negative classes (`true`) or not (`false`). If unspecified, the default value is `true`. Since v66.0. |

### MlClusteringJobDefSettingsInputRepresentation

Represents the settings configuration for a clustering prediction job definition.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `cluster_id_field_label` | `clusterIdFieldLabel` | string |  | Label for the cluster ID output field. Since v68.0. |
| `cluster_label_field_label` | `clusterLabelFieldLabel` | string |  | Label for the cluster label output field. Since v68.0. |
| `max_top_contributors` | `maxTopContributors` | integer |  | Maximum number of top contributors for clustering. Since v68.0. |

### MlDmoFieldSourceTargetRelationshipInputRepresentation

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `relation_source_dmo_field_name` | `relationSourceDmoFieldName` | string | yes | Developer name of the source DMO field. Since v67.0. |
| `relation_source_dmo_name` | `relationSourceDmoName` | string | yes | Developer name of the source DMO. Since v67.0. |
| `relation_target_dmo_field_name` | `relationTargetDmoFieldName` | string | yes | Developer name of the target DMO field. Since v67.0. |
| `relation_target_dmo_name` | `relationTargetDmoName` | string | yes | Developer name of the target DMO. Since v67.0. |

### MlFilterFieldAssetInputRepresentation

Represents the input for a filter field asset.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `id` | `id` | string |  | ID of the asset. Since v58.0. |
| `name` | `name` | string |  | Name of the asset. Since v58.0. |
| `namespace` | `namespace` | string |  | Namespace of the asset. Since v58.0. |

### MlMulticlassClassificationJobDefSettingsInputRepresentation

Represents the settings configuration for a multiclass classification prediction job definition.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `max_top_contributors` | `maxTopContributors` | integer |  | Maximum number of top contributors to generate. Since v66.0. |
| `number_of_classes` | `numberOfClasses` | integer |  | Number of classes to include in the output. If unspecified, the default value is all classes in the outcome. Since v66.0. |

### MlPredictionJobDefDataFieldInputRepresentation

Represents a data model object (DMO) field with an optional relationship path.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `id` | `id` | string |  | ID of the asset. Since v58.0. |
| `name` | `name` | string |  | Name of the asset. Since v58.0. |
| `namespace` | `namespace` | string |  | Namespace of the asset. Since v58.0. |
| `data_object` | `dataObject` | [CdpAssetReferenceInput](#cdpassetreferenceinputrepresentation) |  | Data model object (DMO) that contains the field. Since v67.0. |

### MlPredictionJobDefFeatureMappingInputRepresentation

Represents the mapping between a model feature and a data model object (DMO) field.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `mapped_field` | `mappedField` | [MlPredictionJobDefMappedFieldInput](#mlpredictionjobdefmappedfieldinputrepresentation) |  | Mapped data model object (DMO) field. Since v59.0. |
| `model_field` | `modelField` | [CdpAssetReferenceInput](#cdpassetreferenceinputrepresentation) |  | Model feature field. Since v59.0. |
| `update_score` | `updateScore` | boolean |  | Indicates whether an update to this field triggers a prediction update for streaming jobs (`true`) or not (`false`). Since v59.0. |

### MlPredictionJobDefFeaturesConfigInputRepresentation

Represents the input configuration for features, including the data model object (DMO) and field mappings.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `data_object` | `dataObject` | [CdpAssetReferenceInput](#cdpassetreferenceinputrepresentation) |  | Input data model object (DMO). Since v59.0. |
| `fields` | `fields` | array of [MlPredictionJobDefFeatureMappingInput](#mlpredictionjobdeffeaturemappinginputrepresentation) |  | List of field mappings between model features and DMO fields. Since v59.0. |
| `text_fields` | `textFields` | array of [MlPredictionJobDefFeaturesConfigInput_textFields](#mlpredictionjobdeffeaturesconfiginput_textfields) |  | Not in the spec schema: from the spec's examples. |
| `topic_labels` | `topicLabels` | [MlPredictionJobDefFeaturesConfigInput_topicLabels](#mlpredictionjobdeffeaturesconfiginput_topiclabels) |  | Not in the spec schema: from the spec's examples. |

### MlPredictionJobDefFeaturesConfigInput_textFields

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `mapped_field` | `mappedField` | [MlPredictionJobDefFeaturesConfigInput_textFields_mappedField](#mlpredictionjobdeffeaturesconfiginput_textfields_mappedfield) |  | Seen in examples: the spec types the parent as a free-form object. |
| `update_score` | `updateScore` | boolean |  | Seen in examples: the spec types the parent as a free-form object. |

### MlPredictionJobDefFeaturesConfigInput_textFields_mappedField

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `id` | `id` | string |  | Seen in examples: the spec types the parent as a free-form object. |
| `data_object` | `dataObject` | [MlPredictionJobDefFeaturesConfigInput_textFields_mappedField_dataObject](#mlpredictionjobdeffeaturesconfiginput_textfields_mappedfield_dataobject) |  | Seen in examples: the spec types the parent as a free-form object. |
| `relationship_path` | `relationshipPath` | array of [MlPredictionJobDefFeaturesConfigInput_textFields_mappedField_relationshipPath](#mlpredictionjobdeffeaturesconfiginput_textfields_mappedfield_relationshippath) |  | Seen in examples: the spec types the parent as a free-form object. |

### MlPredictionJobDefFeaturesConfigInput_textFields_mappedField_dataObject

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `id` | `id` | string |  | Seen in examples: the spec types the parent as a free-form object. |

### MlPredictionJobDefFeaturesConfigInput_textFields_mappedField_relationshipPath

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `source_field` | `sourceField` | [MlPredictionJobDefFeaturesConfigInput_textFields_mappedField_relationshipPath_sourceField](#mlpredictionjobdeffeaturesconfiginput_textfields_mappedfield_relationshippath_sourcefield) |  | Seen in examples: the spec types the parent as a free-form object. |
| `target_field` | `targetField` | [MlPredictionJobDefFeaturesConfigInput_textFields_mappedField_relationshipPath_targetField](#mlpredictionjobdeffeaturesconfiginput_textfields_mappedfield_relationshippath_targetfield) |  | Seen in examples: the spec types the parent as a free-form object. |

### MlPredictionJobDefFeaturesConfigInput_textFields_mappedField_relationshipPath_sourceField

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `id` | `id` | string |  | Seen in examples: the spec types the parent as a free-form object. |
| `data_object` | `dataObject` | [MlPredictionJobDefFeaturesConfigInput_textFields_mappedField_relationshipPath_sourceField_dataObject](#mlpredictionjobdeffeaturesconfiginput_textfields_mappedfield_relationshippath_sourcefield_dataobject) |  | Seen in examples: the spec types the parent as a free-form object. |

### MlPredictionJobDefFeaturesConfigInput_textFields_mappedField_relationshipPath_sourceField_dataObject

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `id` | `id` | string |  | Seen in examples: the spec types the parent as a free-form object. |

### MlPredictionJobDefFeaturesConfigInput_textFields_mappedField_relationshipPath_targetField

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `id` | `id` | string |  | Seen in examples: the spec types the parent as a free-form object. |
| `data_object` | `dataObject` | [MlPredictionJobDefFeaturesConfigInput_textFields_mappedField_relationshipPath_targetField_dataObject](#mlpredictionjobdeffeaturesconfiginput_textfields_mappedfield_relationshippath_targetfield_dataobject) |  | Seen in examples: the spec types the parent as a free-form object. |

### MlPredictionJobDefFeaturesConfigInput_textFields_mappedField_relationshipPath_targetField_dataObject

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `id` | `id` | string |  | Seen in examples: the spec types the parent as a free-form object. |

### MlPredictionJobDefFeaturesConfigInput_topicLabels

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `type` | `type` | string |  | Seen in examples: the spec types the parent as a free-form object. |
| `values` | `values` | array |  | Seen in examples: the spec types the parent as a free-form object. |

### MlPredictionJobDefFieldRelationshipInputRepresentation

Represents a join relationship between two data model object (DMO) fields.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `source_field` | `sourceField` | [MlPredictionJobDefDataFieldInput](#mlpredictionjobdefdatafieldinputrepresentation) |  | Source field on the left side of the join. Since v59.0. |
| `target_field` | `targetField` | [MlPredictionJobDefDataFieldInput](#mlpredictionjobdefdatafieldinputrepresentation) |  | Target field on the right side of the join. Since v59.0. |

### MlPredictionJobDefInputFieldInputRepresentation

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `mapped_field` | `mappedField` | [MlPredictionJobDefMappedFieldInput](#mlpredictionjobdefmappedfieldinputrepresentation) |  | Mapped data model object (DMO) field. Since v66.0. |
| `update_score` | `updateScore` | boolean |  | Indicates whether a prediction is rescored when this field updates (`true`) or not (`false`). Since v66.0. |

### MlPredictionJobDefMappedFieldInputRepresentation

Represents a data model object (DMO) field with an optional relationship path.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `id` | `id` | string |  | ID of the asset. Since v58.0. |
| `name` | `name` | string |  | Name of the asset. Since v58.0. |
| `namespace` | `namespace` | string |  | Namespace of the asset. Since v58.0. |
| `data_object` | `dataObject` | [CdpAssetReferenceInput](#cdpassetreferenceinputrepresentation) |  | Data model object (DMO) that contains the field. Since v59.0. |
| `relationship_path` | `relationshipPath` | array of [MlPredictionJobDefFieldRelationshipInput](#mlpredictionjobdeffieldrelationshipinputrepresentation) |  | List of join relationships for accessing the field from a related DMO. Since v59.0. |

### MlPredictionJobDefPredictionsConfigInputRepresentation

Represents the input configuration for predictions generated by a model.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `description` | `description` | string |  | Description of the output data model object (DMO). Since v59.0. |
| `object_label` | `objectLabel` | string |  | Object label of the output DMO. Since v59.0. |
| `object_name` | `objectName` | string |  | API name of the output DMO. Since v59.0. |

### MlRegressionJobDefSettingsInputRepresentation

Represents the settings configuration for a regression prediction job definition.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `max_prescriptions` | `maxPrescriptions` | integer |  | Maximum number of prescriptions to generate. Since v66.0. |
| `max_top_contributors` | `maxTopContributors` | integer |  | Maximum number of top contributors to generate. Since v66.0. |
| `prescription_threshold` | `prescriptionThreshold` | integer |  | Improvement threshold for prescriptions. Since v66.0. |

### MlRetrieverCitationConfigurationInputRepresentation

Represents the input for configuring citation fields.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `base_url` | `baseUrl` | string |  | Base URL that the `mapped_url_field` value is appended to. For example, if `base_url` is "https://example.com" and the data model object (DMO) field contains "/docs/article-123", the resulting URL is "https://example.com/docs/article-123". Since v61.0. |
| `mapped_label_field` | `mappedLabelField` | [MlRetrieverCitationFieldInput](#mlretrievercitationfieldinputrepresentation) |  | Name of the mapped DMO field containing the citation label. Since v61.0. |
| `mapped_url_field` | `mappedUrlField` | [MlRetrieverCitationFieldInput](#mlretrievercitationfieldinputrepresentation) |  | Name of the mapped data model object (DMO) field containing the URL or URL path. When `base_url` is provided, this field's value is appended to it to construct the complete URL. Since v61.0. |
| `type` | `type` | enum(Custom, Default) | yes | Type of citation. Since v61.0. |

### MlRetrieverCitationFieldInputRepresentation

Represents the input for a citation field reference.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `related_dmo_field_name` | `relatedDmoFieldName` | string |  | Name of the related data model object (DMO) field. Since v61.0. |
| `related_dmo_name` | `relatedDmoName` | string |  | Name of the related DMO. Since v61.0. |

### MlRetrieverConfigurationBaseInputRepresentation

Represents the input for creating a retriever configuration.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `output_fields` | `outputFields` | array of string |  | - |
| `referenced_retrievers` | `referencedRetrievers` | array of [CdpAssetReferenceInput](#cdpassetreferenceinputrepresentation) |  | - |
| `citation_configuration` | `citationConfiguration` | [MlRetrieverCitationConfigurationInput](#mlretrievercitationconfigurationinputrepresentation) |  | - |
| `input` | `input` | [MlRetrieverSourceInput](#mlretrieversourceinputrepresentation) |  | - |
| `query_filter` | `queryFilter` | [CdpMlFilterInput](#cdpmlfilterinputrepresentation) |  | - |
| `is_active` | `isActive` | boolean |  | Indicates whether to activate the configuration on creation (`true`) or not (`false`). Since v61.0. |
| `is_citation_enabled` | `isCitationEnabled` | boolean |  | Indicates whether to include citation fields (source record ID, label, URL) in results (`true`) or not (`false`). For CustomSql, `is_citation_supported` must be `true`. Since v61.0. |
| `number_of_results` | `numberOfResults` | integer |  | Maximum number of results to return. Must be a positive integer. If unspecified, the default value is `10`. Since v61.0. |
| `query_type` | `queryType` | enum(CustomSql, Ensemble, NoCode) | yes | Type of query. Since v61.0. |
| `retrieval_mode` | `retrievalMode` | enum(Advanced, Basic) |  | Retrieval mode. Since v61.0. |
| `is_advanced_mode_supported` | `isAdvancedModeSupported` | boolean |  | - |
| `is_citation_supported` | `isCitationSupported` | boolean |  | - |
| `is_enriched_index_supported` | `isEnrichedIndexSupported` | boolean |  | - |
| `retriever_query_template_definition` | `retrieverQueryTemplateDefinition` | [MlRetrieverQueryTemplateDefinitionInput](#mlretrieverquerytemplatedefinitioninputrepresentation) |  | - |

### MlRetrieverConfigurationCustomSqlInputRepresentation

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `is_active` | `isActive` | boolean |  | Indicates whether to activate the configuration on creation (`true`) or not (`false`). Since v61.0. |
| `is_advanced_mode_supported` | `isAdvancedModeSupported` | boolean |  | Indicates whether advanced retrieval mode is supported (`true`) or not (`false`). If unspecified, the default value is `false`. Since v67.0. |
| `is_citation_enabled` | `isCitationEnabled` | boolean |  | Indicates whether to include citation fields (source record ID, label, URL) in results (`true`) or not (`false`). For CustomSql, `is_citation_supported` must be `true`. Since v61.0. |
| `is_citation_supported` | `isCitationSupported` | boolean |  | Indicates whether citation is supported (`true`) or not (`false`). If unspecified, the default value is `false`. When `true`, `query_citation_definition` is required. Since v67.0. |
| `is_enriched_index_supported` | `isEnrichedIndexSupported` | boolean |  | Indicates whether enriched index chunk resolution is supported (`true`) or not (`false`). If unspecified, the default value is `false`. When `true`, `enriched_search_index_definition` is required. Since v67.0. |
| `number_of_results` | `numberOfResults` | integer |  | Maximum number of results to return. Must be a positive integer. If unspecified, the default value is `10`. Since v61.0. |
| `query_type` | `queryType` | enum(CustomSql, Ensemble, NoCode) | yes | Type of query. Since v61.0. |
| `retrieval_mode` | `retrievalMode` | enum(Advanced, Basic) |  | Retrieval mode. Since v61.0. |
| `retriever_query_template_definition` | `retrieverQueryTemplateDefinition` | [MlRetrieverQueryTemplateDefinitionInput](#mlretrieverquerytemplatedefinitioninputrepresentation) | yes | SQL query template definition including query template, parameters, citation definition, and enriched index definition. Since v67.0. |

### MlRetrieverConfigurationEnsembleInputRepresentation

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `is_active` | `isActive` | boolean |  | Indicates whether to activate the configuration on creation (`true`) or not (`false`). Since v61.0. |
| `is_citation_enabled` | `isCitationEnabled` | boolean |  | Indicates whether to include citation fields (source record ID, label, URL) in results (`true`) or not (`false`). For CustomSql, `is_citation_supported` must be `true`. Since v61.0. |
| `number_of_results` | `numberOfResults` | integer |  | Maximum number of results to return. Must be a positive integer. If unspecified, the default value is `10`. Since v61.0. |
| `output_fields` | `outputFields` | array of string |  | List of output field labels (display names) to project from the ensemble results. These must match field labels defined in the active configuration of the referenced sub-retrievers. If unspecified, the default value is the union of output field labels from the referenced retrievers' active configurations. Since v67.0. |
| `query_type` | `queryType` | enum(CustomSql, Ensemble, NoCode) | yes | Type of query. Since v61.0. |
| `referenced_retrievers` | `referencedRetrievers` | array of [CdpAssetReferenceInput](#cdpassetreferenceinputrepresentation) | yes | List of sub-retrievers to fan out to. Each entry is a reference (ID or API name) pointing to an existing NoCode retriever. Since v67.0. |
| `retrieval_mode` | `retrievalMode` | enum(Advanced, Basic) |  | Retrieval mode. Since v61.0. |

### MlRetrieverConfigurationNoCodeInputRepresentation

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `citation_configuration` | `citationConfiguration` | [MlRetrieverCitationConfigurationInput](#mlretrievercitationconfigurationinputrepresentation) |  | Citation configuration. Applies only to `NoCode`. Since v67.0. |
| `input` | `input` | [MlRetrieverSourceInput](#mlretrieversourceinputrepresentation) | yes | ID or API name of the search index that the retriever is associated with. Applies only to `NoCode`. Since v67.0. |
| `is_active` | `isActive` | boolean |  | Indicates whether to activate the configuration on creation (`true`) or not (`false`). Since v61.0. |
| `is_citation_enabled` | `isCitationEnabled` | boolean |  | Indicates whether to include citation fields (source record ID, label, URL) in results (`true`) or not (`false`). For CustomSql, `is_citation_supported` must be `true`. Since v61.0. |
| `number_of_results` | `numberOfResults` | integer |  | Maximum number of results to return. Must be a positive integer. If unspecified, the default value is `10`. Since v61.0. |
| `output_fields` | `outputFields` | array of [MlRetrieverOutputFieldInput](#mlretrieveroutputfieldinputrepresentation) | yes | List of data model object (DMO) fields to include in retriever results. Since v67.0. |
| `query_filter` | `queryFilter` | [CdpMlFilterInput](#cdpmlfilterinputrepresentation) |  | Pre-filter applied to available prefilter fields on the search index. Since v67.0. |
| `query_type` | `queryType` | enum(CustomSql, Ensemble, NoCode) | yes | Type of query. Since v61.0. |
| `retrieval_mode` | `retrievalMode` | enum(Advanced, Basic) |  | Retrieval mode. Since v61.0. |

### MlRetrieverInputRepresentation

Represents the input for creating a retriever.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `configuration` | `configuration` | [MlRetrieverConfigurationBaseInput](#mlretrieverconfigurationbaseinputrepresentation) | yes | Initial configuration. Use the configuration input object that corresponds to the type of query. For example, use the Ml Retriever Configuration Custom Sql Input for the `CustomSql` type. Since v61.0. |
| `dataspaces` | `dataSpaces` | array of string |  | List of data space names. Required for `CustomSql` and `NoCode` retrievers. Derive the data space from the referenced retrievers for `Ensemble` retrievers. Since v61.0. |
| `description` | `description` | string |  | Description of the retriever. Since v61.0. |
| `label` | `label` | string | yes | Label of the retriever. Since v61.0. |
| `owner_type` | `ownerType` | enum(AiAgent, Api) | yes | Type of owner. Since v61.0. |

### MlRetrieverOutputFieldInputRepresentation

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `data_source_type` | `dataSourceType` | enum(DataModelObject, SearchFunction) |  | Type of data source. Since v67.0. |
| `label` | `label` | string | yes | Display label for the output field. Must be unique within the retriever. Since v67.0. |
| `related_dmo_field_name` | `relatedDmoFieldName` | string |  | Name of the related data model object (DMO) field. Since v61.0. |
| `related_dmo_name` | `relatedDmoName` | string |  | Name of the related DMO. Since v61.0. |
| `relationships` | `relationships` | array of [MlDmoFieldSourceTargetRelationshipInput](#mldmofieldsourcetargetrelationshipinputrepresentation) |  | List of relationships forming a path from the DMO of this output field to the source DMO of the search index. The cardinality must be 1-to-1 or 1-to-many from this DMO to the source DMO. Maximum path length is 2. Empty when the field is on the source DMO itself. Applies only to `NoCode`. Since v67.0. |

### MlRetrieverQueryEnrichedSearchIndexDefinitionInputRepresentation

Represents the input for an enriched search index definition to resolve enriched chunks to plain chunks. Required when `is_enriched_index_supported` is `true`. CustomSql only.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `chunk_column_name` | `chunkColumnName` | string | yes | Name or alias of the SELECT column containing the chunk content. Since v67.0. |
| `chunk_record_id_column_name` | `chunkRecordIdColumnName` | string | yes | Name or alias of the SELECT column containing the chunk record ID. Since v67.0. |
| `search_index_api_name` | `searchIndexApiName` | string | yes | API name of the enriched search index. Since v67.0. |

### MlRetrieverQueryTemplateCitationDefinitionCustomInputRepresentation

Represents the input for a custom citation definition where label and link are defined by user-specified SQL columns. CustomSql only.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `citation_type` | `citationType` | enum(Custom, Default) | yes | Type of citation. Since v67.0. |
| `custom_label_column_name` | `customLabelColumnName` | string |  | Name or alias of the SELECT column used as the citation label. Required when `citation_type` is `Custom`. Since v67.0. |
| `custom_base_url` | `customBaseUrl` | string |  | Base URL that the `custom_link_column_name` value is appended to. For example, if `custom_base_url` is "https://example.com" and the column contains "/docs/article-123", the resulting URL is "https://example.com/docs/article-123". Since v67.0. |
| `custom_link_column_name` | `customLinkColumnName` | string | yes | Name or alias of the SELECT column used as the citation link. When `custom_base_url` is provided, this field's value is appended to it to construct the complete URL. Since v67.0. |

### MlRetrieverQueryTemplateCitationDefinitionDefaultInputRepresentation

Represents the input for a Default citation definition where citation links are generated from source and chunk record IDs in SQL columns. CustomSql only.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `citation_type` | `citationType` | enum(Custom, Default) | yes | Type of citation. Since v67.0. |
| `custom_label_column_name` | `customLabelColumnName` | string |  | Name or alias of the SELECT column used as the citation label. Required when `citation_type` is `Custom`. Since v67.0. |
| `chunk_object_api_name` | `chunkObjectApiName` | string |  | API name of the chunk data model object (DMO) from a search index whose source DMO matches `source_object_api_name`. Applies only when the search index is not real time; ignored otherwise. When set, enables harmonized viewer and multimodal citations. Since v67.0. |
| `chunk_record_id_column_name` | `chunkRecordIdColumnName` | string |  | Name or alias of the SELECT column used as the chunk record ID. Required when the search index for `chunk_object_api_name` is not real-time; must NOT be set when that index is real-time (JIT). Since v67.0. |
| `source_object_api_name` | `sourceObjectApiName` | string | yes | API name of the source DMO whose records are cited. Must be a DMO (DLOs and calculated insights must use custom citation). Since v67.0. |
| `source_record_id_column_name` | `sourceRecordIdColumnName` | string | yes | Name or alias of the SELECT column used as the source record ID. Since v67.0. |

### MlRetrieverQueryTemplateDefinitionInputRepresentation

Represents the input for a SQL query template definition. CustomSql only.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `enriched_search_index_definition` | `enrichedSearchIndexDefinition` | [MlRetrieverQueryEnrichedSearchIndexDefinitionInput](#mlretrieverqueryenrichedsearchindexdefinitioninputrepresentation) |  | Enriched search index definition to resolve enriched chunks to plain chunks. Required when `is_enriched_index_supported` is `true`. Since v67.0. |
| `main_user_query_parameter_name` | `mainUserQueryParameterName` | string |  | Name of the parameter carrying the user query text in the format `":\"parameter\""`. Must match a parameter in `query_template_placeholders`. Recommended to help monitor the quality of search results from `vector_search()` or `hybrid_search()` functions. Required when `is_advanced_mode_supported` or `is_enriched_index_supported` is `true`. Since v67.0. |
| `query_citation_definition` | `queryCitationDefinition` | one of [MlRetrieverQueryTemplateCitationDefinitionCustomInput](#mlretrieverquerytemplatecitationdefinitioncustominputrepresentation), [MlRetrieverQueryTemplateCitationDefinitionDefaultInput](#mlretrieverquerytemplatecitationdefinitiondefaultinputrepresentation) |  | Citation definition (Default or Custom). Required when `is_citation_supported` is `true`. Use the citation definition input object that corresponds to the type of citation. For example, use the Ml Retriever Query Template Citation Definition Custom Input for custom citation types. Since v67.0. |
| `query_template_placeholders` | `queryTemplatePlaceholders` | array of [MlRetrieverQueryTemplatePlaceholderInput](#mlretrieverquerytemplateplaceholderinputrepresentation) |  | List of parameters used in the SQL query template. Each parameter specifies name, data type, placeholder type, optional default value, label, and description. Since v67.0. |
| `retriever_query_template` | `retrieverQueryTemplate` | string | yes | Data 360 SQL query template. Can contain parameters in the format `:"parameter"`. Since v67.0. |
| `search_overall_score_column_name` | `searchOverallScoreColumnName` | string |  | Name or alias of the SELECT column containing the overall search relevance score from `vector_search()` or `hybrid_search()` functions. Recommended to help monitor the quality of search results. Since v67.0. |

### MlRetrieverQueryTemplatePlaceholderInputRepresentation

Represents the input for a query template parameter or placeholder in the format `":\"parameter\""`. CustomSql only.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `placeholder_data_type` | `placeholderDataType` | enum(ArrayOfText, Boolean, Date, DateTime, Number, Text) | yes | Data type of the parameter value. Since v67.0. |
| `placeholder_description` | `placeholderDescription` | string |  | Description of the parameter purpose. Required for `CustomSql`. Not applicable to `NoCode`. Since v67.0. |
| `placeholder_label` | `placeholderLabel` | string |  | Display label for the parameter. Since v67.0. |
| `placeholder_name` | `placeholderName` | string | yes | Name of the parameter in the format `":\"parameter\""`. Must be unique in the SQL query template. Must be a valid developer name (begin with a letter, contain only alphanumeric characters and underscores, no spaces, and cannot end with or contain consecutive underscores). Since v67.0. |
| `placeholder_value` | `placeholderValue` | string |  | Default value for the parameter. Since v67.0. |

### MlRetrieverSourceInputRepresentation

Represents the input for a search index reference.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `id` | `id` | string |  | ID of the asset. Since v58.0. |
| `name` | `name` | string |  | Name of the asset. Since v58.0. |
| `namespace` | `namespace` | string |  | Namespace of the asset. Since v58.0. |
| `type` | `type` | enum(SearchIndex, SearchIndexConfiguration) |  | Type of search index source. Since v61.0. |

### MlSentimentDetectionInputConfigInputRepresentation

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `data_object` | `dataObject` | [CdpAssetReferenceInput](#cdpassetreferenceinputrepresentation) |  | Input data model object (DMO). Since v66.0. |
| `text_fields` | `textFields` | array of [MlPredictionJobDefInputFieldInput](#mlpredictionjobdefinputfieldinputrepresentation) |  | List of text fields to perform sentiment detection on. Since v66.0. |

### MlTopicClassificationInputConfigInputRepresentation

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `data_object` | `dataObject` | [CdpAssetReferenceInput](#cdpassetreferenceinputrepresentation) |  | Input data model object (DMO). Since v66.0. |
| `text_fields` | `textFields` | array of [MlPredictionJobDefInputFieldInput](#mlpredictionjobdefinputfieldinputrepresentation) |  | List of text fields to perform topic classification on. Since v66.0. |
| `topic_labels` | `topicLabels` | [MlTopicClassificationJobStaticLabelsInput](#mltopicclassificationjobstaticlabelsinputrepresentation) |  | Topic labels for classifying the text fields. Since v66.0. |

### MlTopicClassificationJobStaticLabelsInputRepresentation

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `type` | `type` | enum(Static) |  | Type of labels mapping. Since v66.0. |
| `values` | `values` | array of string |  | Static list of topic labels to be used for classification. Since v66.0. |

### ModelOutcomeDefinitionInput

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `goal` | `goal` | string |  | Outcome goal. One of: Minimize, Maximize. |
| `field_names` | `fieldNames` | array of string |  | Names of fields the outcome targets. |

### ModelParameterOverrideInput

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `parameter_name` | `parameterName` | string | yes | Parameter name as declared on the referenced model artifact's parameter definitions. |
| `discrete_value` | `discreteValue` | string |  | Override value for a discrete (string) parameter. Provide either discrete_value or continuous_value, not both. |
| `continuous_value` | `continuousValue` | number |  | Override value for a continuous (numeric) parameter. Provide either discrete_value or continuous_value, not both. |

### OutcomeInput

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `type` | `type` | string | yes | Outcome type. One of: Binary, DiscreteVariable, ContinuousVariable, Clustering. Per-type required fields: Binary needs success_value+failure_value; DiscreteVariable needs class_labels; ContinuousVariable needs min+max; Clustering needs n_clusters (omit for HDBSCAN: it's auto-determined). |
| `label` | `label` | string |  | Display label for the outcome. |
| `name` | `name` | string |  | Field API name on the data source that holds the outcome (e.g. Attrition__c). |
| `goal` | `goal` | string |  | Optimization goal. One of: Minimize, Maximize. |
| `source` | `source` | string |  | Owning data source name (multi-source only: disambiguates which DMO the outcome field belongs to). |
| `success_value` | `successValue` | string |  | Binary outcomes only: value of the success class (e.g. "Yes"). |
| `failure_value` | `failureValue` | string |  | Binary outcomes only: value of the failure class (e.g. "No"). |
| `class_labels` | `classLabels` | array of string |  | DiscreteVariable outcomes only: list of class labels. |
| `min` | `min` | number |  | ContinuousVariable outcomes only: minimum value of the target variable. |
| `max` | `max` | number |  | ContinuousVariable outcomes only: maximum value of the target variable. |
| `n_clusters` | `nClusters` | integer |  | Clustering outcomes only: desired number of clusters (omit for HDBSCAN). |

### TextFieldValueInput

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `name` | `name` | string |  | Value (the string the field actually contains, e.g. "Yes"). |
| `label` | `label` | string |  | Display label for this value. |
| `ignored` | `ignored` | boolean |  | Mark this value as ignored (excluded from training). |
| `count` | `count` | integer |  | Observed row count for this value. |

### TransformationInput

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `type` | `type` | string | yes | Transformation type. One of: ExtractDayOfWeek, ExtractMonthOfYear, FreeTextClustering, NumericalImputation, SentimentAnalysis, TopicClassification. |
| `source_field_name` | `sourceFieldName` | string | yes | Field API name to read from. |
| `target_field_name` | `targetFieldName` | string | yes | Field API name to write to (often equals source_field_name for in-place transformations). |
| `source` | `source` | string |  | Multi-source inputs only: target dataset name. |
| `source_field_source` | `sourceFieldSource` | string |  | Multi-source inputs only: source dataset name. |
| `impute_method` | `imputeMethod` | string |  | NumericalImputation only: imputation method. One of: Mean, Median, Mode. Defaults to Mean. |
| `candidates` | `candidates` | array of string |  | TopicClassification only: list of candidate topics for the classifier. |

### ml_model_artifact_update_outputFields

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `id` | `id` | string |  | Seen in examples: the spec types the parent as a free-form object. |
| `feature_override_values` | `featureOverrideValues` | array of [ml_model_artifact_update_outputFields_featureOverrideValues](#ml_model_artifact_update_outputfields_featureoverridevalues) |  | Seen in examples: the spec types the parent as a free-form object. |

### ml_model_artifact_update_outputFields_featureOverrideValues

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `source_value` | `sourceValue` | string |  | Seen in examples: the spec types the parent as a free-form object. |
| `override_value` | `overrideValue` | string |  | Seen in examples: the spec types the parent as a free-form object. |

### ml_setup_version_create_fields

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `type` | `type` | string |  | Seen in examples: the spec types the parent as a free-form object. |
| `name` | `name` | string |  | Seen in examples: the spec types the parent as a free-form object. |
| `label` | `label` | string |  | Seen in examples: the spec types the parent as a free-form object. |
| `min` | `min` | number |  | Seen in examples: the spec types the parent as a free-form object. |
| `max` | `max` | number |  | Seen in examples: the spec types the parent as a free-form object. |
| `bucketing_strategy` | `bucketingStrategy` | [ml_setup_version_create_fields_bucketingStrategy](#ml_setup_version_create_fields_bucketingstrategy) |  | Seen in examples: the spec types the parent as a free-form object. |
| `data_type` | `dataType` | string |  | Seen in examples: the spec types the parent as a free-form object. |
| `ordering` | `ordering` | string |  | Seen in examples: the spec types the parent as a free-form object. |
| `include_other` | `includeOther` | boolean |  | Seen in examples: the spec types the parent as a free-form object. |
| `balanced` | `balanced` | boolean |  | Seen in examples: the spec types the parent as a free-form object. |
| `values` | `values` | array of [ml_setup_version_create_fields_values](#ml_setup_version_create_fields_values) |  | Seen in examples: the spec types the parent as a free-form object. |

### ml_setup_version_create_fields_bucketingStrategy

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `type` | `type` | string |  | Seen in examples: the spec types the parent as a free-form object. |
| `number_of_buckets` | `numberOfBuckets` | integer |  | Seen in examples: the spec types the parent as a free-form object. |

### ml_setup_version_create_fields_values

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `name` | `name` | string |  | Seen in examples: the spec types the parent as a free-form object. |
| `label` | `label` | string |  | Seen in examples: the spec types the parent as a free-form object. |
| `count` | `count` | integer |  | Seen in examples: the spec types the parent as a free-form object. |
| `ignored` | `ignored` | boolean |  | Seen in examples: the spec types the parent as a free-form object. |

### ml_setup_version_create_input

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `type` | `type` | string |  | Seen in examples: the spec types the parent as a free-form object. |
| `source` | `source` | [ml_setup_version_create_input_source](#ml_setup_version_create_input_source) |  | Seen in examples: the spec types the parent as a free-form object. |
| `dataspace` | `dataSpace` | [ml_setup_version_create_input_dataSpace](#ml_setup_version_create_input_dataspace) |  | Seen in examples: the spec types the parent as a free-form object. |

### ml_setup_version_create_input_dataSpace

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `name` | `name` | string |  | Seen in examples: the spec types the parent as a free-form object. |

### ml_setup_version_create_input_source

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `name` | `name` | string |  | Seen in examples: the spec types the parent as a free-form object. |

### ml_setup_version_create_outcomes

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `type` | `type` | string |  | Seen in examples: the spec types the parent as a free-form object. |
| `name` | `name` | string |  | Seen in examples: the spec types the parent as a free-form object. |
| `label` | `label` | string |  | Seen in examples: the spec types the parent as a free-form object. |
| `goal` | `goal` | string |  | Seen in examples: the spec types the parent as a free-form object. |
| `success_value` | `successValue` | string |  | Seen in examples: the spec types the parent as a free-form object. |
| `failure_value` | `failureValue` | string |  | Seen in examples: the spec types the parent as a free-form object. |
