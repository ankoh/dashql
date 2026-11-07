<!-- Generated from extensions/d360-api/clfn/spec/search_index.yaml, edit that and run: bazel run //extensions/d360-api:update -->

# Search Index

Part of the [CDP function reference](functions.md). Nothing here is implemented or tested against an org. Every result also has the [standard columns](functions.md#result-schema).

A search index makes the text in a data model object (DMO) searchable by meaning. Data 360 splits the text into chunks, embeds them, and generates two DMOs: `<name>_chunk__dlm` holds the chunk text and `<name>_index__dlm` holds the searchable index. You query them with SQL, and [retrievers](machine_learning.md) build on them.

The order is: map data into the source DMO, read `search_index_config`, run `search_index_create`, poll `search_index_get` until `runtime_status` is `READY`, then search with a `SELECT` over the connection.

Gotchas that matter most:

- **The source DMO must be ready.** Create can fail on a new DMO, and an index without mapped data may never leave a null status (community). See [`search_index_create`](#search_index_create).
- **`runtime_status` isn't in the spec's schema**, only in its examples. See [`search_index_get`](#search_index_get).
- **`vector_embedding_related_fields` is disputed.** Salesforce says an empty list is fine, and one community tool reports a null pointer error.
- **Join on `RecordId__c`.** Salesforce's templates join index and chunk on `RecordId__c`. `vector_search` returns `score__c`, and `hybrid_search` returns `hybrid_score__c`, `keyword_score__c` and `vector_score__c`.

```sql
CALL cdp.search_index_config ();
/* search_index_create goes here, see its example */
CALL cdp.search_index_get (search_index_api_name_or_id => 'Articles_Search');
SELECT v."hybrid_score__c", c."Chunk__c", c."SourceRecordId__c"
FROM hybrid_search(TABLE("Articles_Search_index__dlm"), 'reset password', '', 5) AS v
INNER JOIN "Articles_Search_chunk__dlm" AS c ON c."RecordId__c" = v."RecordId__c"
ORDER BY v."hybrid_score__c" DESC
LIMIT 5;
```

**Functions:** [`search_index_delete`](#search_index_delete), [`search_index_list`](#search_index_list), [`search_index_get`](#search_index_get), [`search_index_config`](#search_index_config), [`search_index_update`](#search_index_update), [`search_index_create`](#search_index_create), [`search_index_process_history`](#search_index_process_history)

## search_index_delete

`DELETE /ssot/search-index/{searchIndexApiNameOrId}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Search-Index/paths/~1ssot~1search-index~1%7BsearchIndexApiNameOrId%7D/delete) · tool `d360_search_index_delete` · evidence O · changes org state

Delete a search index definition and the DMOs generated for it. Since v60.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `search_index_api_name_or_id` | `searchIndexApiNameOrId` | path | string | yes | Id of the index, such as `18lTC0000001qPZYAY`. A developer name is reported to return 404 (community). |

```sql
CALL cdp.search_index_delete (search_index_api_name_or_id => '18lTC0000001qPZYAY');
```

**Result**

No response body (HTTP 200). One row with only the standard columns.

**Notes:** **Use the id.** The spec's parameter allows a name, and [Salesforce's tool](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/SearchIndexTools.java) says id or name, but [a community SDK](https://github.com/javrrr/data-360-sdk/blob/main/src/resources/search-index.ts) and afd360, by the same author, report that a name returns 404 even when the index exists (community). Take `id` from `search_index_list`.

[Deleting also removes the chunk and index DMOs](https://github.com/javrrr/afd360/blob/main/src/resources/search-index.ts), and it can outlast a 30 s client timeout while the request still goes through (one org). A GET during teardown returned 500 (one org), so a timeout doesn't mean the delete failed. afd360 uses a 120 s timeout. No source says what happens to retrievers that use the index, so check `retriever_list` first.

## search_index_list

`GET /ssot/search-index` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Search-Index/paths/~1ssot~1search-index/get) · tool `d360_search_index_list` · evidence O · read-only

Get all search index definition details. Since v60.0.

**Options**

None.

```sql
CALL cdp.search_index_list ();
```

**Result**

One row per item of `/semanticSearchDefinitionDetails` in the response. Other response fields go to `_meta`: `currentPageUrl`, `nextPageUrl`, `totalSize`. Schema `SemanticSearchDefDetailRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `attachment_dmo_id` | `attachmentDmoId` | VARCHAR | Attachment data model object's (DMO's) ID. Since v60.0. |
| `attachment_dmo_name` | `attachmentDmoName` | VARCHAR | Attachment DMO's name. Since v60.0. |
| `chunk_dmo_developer_name` | `chunkDmoDeveloperName` | VARCHAR | Chunk DMO's developer name. Since v60.0. |
| `chunk_dmo_id` | `chunkDmoId` | VARCHAR | Chunk DMO's ID. Since v60.0. |
| `chunk_dmo_name` | `chunkDmoName` | VARCHAR | Chunk DMO's label. Since v60.0. |
| `chunking_configuration` | `chunkingConfiguration` | JSON (ChunkingConfigurationRepresentation) | Chunking configuration. Since v60.0. |
| `dataspace` | `dataspace` | VARCHAR | Name of the data space. Since v60.0. |
| `description` | `description` | VARCHAR | Description. Since v60.0. |
| `developer_name` | `developerName` | VARCHAR | Developer name. Since v60.0. |
| `id` | `id` | VARCHAR | ID of the record. Since v60.0. |
| `index_configuration` | `indexConfiguration` | JSON (IndexConfigurationRepresentation) | Index configuration for the semantic search record. Since v64.0. |
| `index_refreshed_on` | `indexRefreshedOn` | VARCHAR | Date and time of the search index's last update. Since v64.0. |
| `label` | `label` | VARCHAR | Label. Since v60.0. |
| `ranking_configurations` | `rankingConfigurations` | JSON (array of RankingFieldsDetailsRepresentation) | List of ranking configuration object IDs that were created for hybrid search. Since v60.0. |
| `search_type` | `searchType` | VARCHAR | Type of the search index (`HYBRID` or `VECTOR`). Since v60.0. |
| `source_dmo_developer_name` | `sourceDmoDeveloperName` | VARCHAR | Source DMO's developer name. Since v60.0. |
| `source_dmo_id` | `sourceDmoId` | VARCHAR | Source DMO's ID. Since v60.0. |
| `transcribe_dmo_developer_name` | `transcribeDmoDeveloperName` | VARCHAR | Transcribe DMO's developer name. Since v60.0. |
| `transcribe_dmo_name` | `transcribeDmoName` | VARCHAR | Transcribe DMO's label. Since v60.0. |
| `transform_configurations` | `transformConfigurations` | JSON (array of TransformConfigurationRepresentation) | Transform configurations. Since v60.0. |
| `vector_dmo_developer_name` | `vectorDmoDeveloperName` | VARCHAR | Vector DMO's developer name. Since v60.0. |
| `vector_dmo_id` | `vectorDmoId` | VARCHAR | Vector DMO's ID. Since v60.0. |
| `vector_dmo_name` | `vectorDmoName` | VARCHAR | Vector DMO's label. Since v60.0. |
| `vector_embedding` | `vectorEmbedding` | JSON (VectorEmbeddingDetailsRepresentation) | Vector embedding. Since v60.0. |
| `vector_embedding_configuration` | `vectorEmbeddingConfiguration` | JSON (VectorConfigurationRepresentation) | Vector embedding configuration. Since v60.0. |
| `version` | `version` | VARCHAR | Version of the record. Since v60.0. |
| `attachment_dmo_developer_name` | `attachmentDmoDeveloperName` | JSON | Not in the spec schema: from the spec's examples. |
| `processing_type` | `processingType` | VARCHAR | Not in the spec schema: from the spec's examples. |
| `runtime_status` | `runtimeStatus` | VARCHAR | Not in the spec schema: from the spec's examples. |
| `semantic_search_ranking_configurations` | `semanticSearchRankingConfigurations` | JSON | Not in the spec schema: from the spec's examples. |
| `transcribe_dmo_id` | `transcribeDmoId` | JSON | Not in the spec schema: from the spec's examples. |

**Paging:** `next_page_url`.

**Notes:** The spec's examples show `runtime_status` on each item, but the schema omits it, so it's missing from the columns above. See [`search_index_get`](#search_index_get). [Salesforce's kit](https://github.com/salesforce-misc/Data360AgentforceSolutionKitRetail/blob/main/.claude/skills/create-individual-retrievers/SKILL.md) reads it from this call to check readiness. There's no data space option, so filter on `dataspace` yourself.

## search_index_get

`GET /ssot/search-index/{searchIndexApiNameOrId}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Search-Index/paths/~1ssot~1search-index~1%7BsearchIndexApiNameOrId%7D/get) · tool `d360_search_index_get` · evidence O · read-only

Get one search index definition, including the names of its generated chunk and index DMOs. Poll this after create or update to see whether the index is ready. Since v60.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `search_index_api_name_or_id` | `searchIndexApiNameOrId` | path | string | yes | Id or developer name of the index. The developer name has no `__dlm` suffix. |

```sql
CALL cdp.search_index_get (search_index_api_name_or_id => 'Articles_Search');
```

**Result**

One row. Schema `SemanticSearchDefDetailRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `attachment_dmo_id` | `attachmentDmoId` | VARCHAR | Attachment data model object's (DMO's) ID. Since v60.0. |
| `attachment_dmo_name` | `attachmentDmoName` | VARCHAR | Attachment DMO's name. Since v60.0. |
| `chunk_dmo_developer_name` | `chunkDmoDeveloperName` | VARCHAR | Chunk DMO's developer name. Since v60.0. |
| `chunk_dmo_id` | `chunkDmoId` | VARCHAR | Chunk DMO's ID. Since v60.0. |
| `chunk_dmo_name` | `chunkDmoName` | VARCHAR | Chunk DMO's label. Since v60.0. |
| `chunking_configuration` | `chunkingConfiguration` | JSON (ChunkingConfigurationRepresentation) | Chunking configuration. Since v60.0. |
| `dataspace` | `dataspace` | VARCHAR | Name of the data space. Since v60.0. |
| `description` | `description` | VARCHAR | Description. Since v60.0. |
| `developer_name` | `developerName` | VARCHAR | Developer name. Since v60.0. |
| `id` | `id` | VARCHAR | ID of the record. Since v60.0. |
| `index_configuration` | `indexConfiguration` | JSON (IndexConfigurationRepresentation) | Index configuration for the semantic search record. Since v64.0. |
| `index_refreshed_on` | `indexRefreshedOn` | VARCHAR | Date and time of the search index's last update. Since v64.0. |
| `label` | `label` | VARCHAR | Label. Since v60.0. |
| `ranking_configurations` | `rankingConfigurations` | JSON (array of RankingFieldsDetailsRepresentation) | List of ranking configuration object IDs that were created for hybrid search. Since v60.0. |
| `search_type` | `searchType` | VARCHAR | Type of the search index (`HYBRID` or `VECTOR`). Since v60.0. |
| `source_dmo_developer_name` | `sourceDmoDeveloperName` | VARCHAR | Source DMO's developer name. Since v60.0. |
| `source_dmo_id` | `sourceDmoId` | VARCHAR | Source DMO's ID. Since v60.0. |
| `transcribe_dmo_developer_name` | `transcribeDmoDeveloperName` | VARCHAR | Transcribe DMO's developer name. Since v60.0. |
| `transcribe_dmo_name` | `transcribeDmoName` | VARCHAR | Transcribe DMO's label. Since v60.0. |
| `transform_configurations` | `transformConfigurations` | JSON (array of TransformConfigurationRepresentation) | Transform configurations. Since v60.0. |
| `vector_dmo_developer_name` | `vectorDmoDeveloperName` | VARCHAR | Vector DMO's developer name. Since v60.0. |
| `vector_dmo_id` | `vectorDmoId` | VARCHAR | Vector DMO's ID. Since v60.0. |
| `vector_dmo_name` | `vectorDmoName` | VARCHAR | Vector DMO's label. Since v60.0. |
| `vector_embedding` | `vectorEmbedding` | JSON (VectorEmbeddingDetailsRepresentation) | Vector embedding. Since v60.0. |
| `vector_embedding_configuration` | `vectorEmbeddingConfiguration` | JSON (VectorConfigurationRepresentation) | Vector embedding configuration. Since v60.0. |
| `version` | `version` | VARCHAR | Version of the record. Since v60.0. |
| `attachment_dmo_developer_name` | `attachmentDmoDeveloperName` | JSON | Not in the spec schema: from the spec's examples. |
| `semantic_search_ranking_configurations` | `semanticSearchRankingConfigurations` | JSON | Not in the spec schema: from the spec's examples. |
| `transcribe_dmo_id` | `transcribeDmoId` | JSON | Not in the spec schema: from the spec's examples. |
| `processing_type` | `processingType` | VARCHAR | Not in the spec schema: from the spec's examples. |
| `runtime_status` | `runtimeStatus` | VARCHAR | Not in the spec schema: from the spec's examples. |

**Notes:** **`runtime_status` is missing from the columns above.** The spec's schema leaves it out, but the spec's response examples return it, with `READY` and `FAILED`. The same goes for `processing_type`, `attachment_dmo_developer_name`, `transcribe_dmo_id` and `semantic_search_ranking_configurations`. Expect them in `_raw` until the schema catches up.

**Status values.** It's uppercase [`READY`, not `Ready`](https://github.com/salesforce-misc/Data360AgentforceSolutionKitRetail/blob/main/.claude/skills/create-individual-retrievers/SKILL.md), according to Salesforce's kit. afd360 [gives the path](https://github.com/javrrr/afd360/blob/main/src/resources/search-index.ts) null, `SUBMITTED`, `IN_PROGRESS`, `READY`, with `FAILED` as the terminal failure (community). It also treats `SUBMITTED` and `IN_PROGRESS` as usable, while Salesforce's kit requires `READY` before creating retrievers. Wait for `READY`.

**Wait times.** Salesforce's docs say [several minutes](https://developer.salesforce.com/docs/data/data-cloud-code-ext/guide/use-chunking-in-search-index.md). afd360 saw 10 to 12 minutes, and sometimes over 15, on newly mapped Snowflake DMOs (one org). `index_refreshed_on` shows the last update.

**Not found.** An unknown name is [reported to return `400 INVALID_INPUT`](https://github.com/javrrr/afd360/blob/main/src/resources/search-index.ts) with "was not found" in the body, not a 404 (community), and a 500 was seen during a delete (one org).

## search_index_config

`GET /ssot/search-index/config` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Search-Index/paths/~1ssot~1search-index~1config/get) · tool `d360_search_index_config` · evidence O · read-only

Get the valid options for search indexes: chunking strategies, embedding models, index types, similarity metrics and transcription models. Since v60.0.

**Options**

None.

```sql
CALL cdp.search_index_config ();
```

**Result**

One row. Schema `SemanticSearchConfigRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `config` | `config` | VARCHAR | The semantic search configuration. Since v60.0. |

**Notes:** [Salesforce's tool](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/SearchIndexTools.java) says to take the ids for `search_index_create` from this call.

`config` is one string holding JSON, and the spec's example encodes its quotes as `&quot;`. Decode the entities, then parse it. The example has these top-level keys:

- `chunkingConfigurations`: strategies `passage_extraction` (`strip_html`, `max_tokens` up to 512) and `conversation_based`, plus allowed strategies and citations per file extension.
- `vectorEmbeddingConfigurations`: models `e5_large_v2` (the default) and `multilingual-e5-large`, both 1024 dimensions and read-only settings. Index `HNSW` with read-only values. Metrics per index: `HNSW` allows `COSINE`, and `DISKANN` allows `L2`.
- `transcribeConfigurations`: `whisper_large_v3` for audio and video.

The example isn't the full list. [Salesforce's kit](https://github.com/salesforce-misc/Data360AgentforceSolutionKitRetail/blob/main/.claude/skills/intelligent-context/SKILL.md) uses `section_aware_chunking` with `overlap_tokens`, and Salesforce's tool says the config also covers image processing models and parsing stages. One community test run [got "not found" from this call](https://github.com/dsouza-anush/sf-plugin-data360/blob/main/docs/API_COVERAGE.md) (one org). No source explains why.

## search_index_update

`PATCH /ssot/search-index/{searchIndexApiNameOrId}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Search-Index/paths/~1ssot~1search-index~1%7BsearchIndexApiNameOrId%7D/patch) · tool `d360_search_index_update` · evidence O · changes org state

Update a search index. The spec requires the full definition in the body, not only the fields that change. Since v60.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `search_index_api_name_or_id` | `searchIndexApiNameOrId` | path | string | yes | Id or developer name of the index, according to Salesforce's tool. |
| `id` | `id` | body | string |  | ID of the asset. Since v58.0. |
| `name` | `name` | body | string |  | Name of the asset. Since v58.0. |
| `namespace` | `namespace` | body | string |  | Namespace of the asset. Since v58.0. |
| `activation_status` | `activationStatus` | body | string |  | Activation status of the semantic search record. Since v60.0. |
| `attachment_dmo_developer_name` | `attachmentDmoDeveloperName` | body | string |  | Developer name of the attachment `MktDataModelObject`. For example, `loanAgreement__dlm`. Since v62.0. |
| `chunk_dmo_developer_name` | `chunkDmoDeveloperName` | body | string | yes | Developer name of the data model object (DMO) used for chunking, excluding the `__dlm` suffix. Since v60.0. |
| `chunk_dmo_name` | `chunkDmoName` | body | string | yes | Name of the DMO used for chunking. Since v60.0. |
| `chunking_configuration` | `chunkingConfiguration` | body | [ChunkingConfigInput](#chunkingconfiginputrepresentation) | yes | Chunking configuration. Since v60.0. |
| `description` | `description` | body | string |  | Description of semantic search record to be created. Since v60.0. |
| `developer_name` | `developerName` | body | string | yes | Developer name of the semantic search record to be created. Since v60.0. |
| `index_configuration` | `indexConfiguration` | body | [IndexConfigInput](#indexconfiginputrepresentation) |  | Index configuration for the semantic search record. Since v64.0. |
| `label` | `label` | body | string | yes | Label of semantic search record to be created. Since v60.0. |
| `processing_type` | `processingType` | body | string |  | Processing type of the search index, such as `NEAR_REALTIME` or `REALTIME`. Since v63.0. |
| `ranking_configurations` | `rankingConfigurations` | body | array of [SearchRankingFieldInput](#searchrankingfieldinputrepresentation) |  | List of ranking configurations for hybrid search. Selecting fields for a ranking configuration is optional. Since v60.0. |
| `search_type` | `searchType` | body | string | yes | Type of the search index (`HYBRID` or `VECTOR`). Since v60.0. |
| `source_dmo_developer_name` | `sourceDmoDeveloperName` | body | string | yes | Developer name of the source (parent) `MktDataModelObject`. For example, `loanAgreement__dlm`. Since v60.0. |
| `transcribe_dmo_developer_name` | `transcribeDmoDeveloperName` | body | string |  | Transcribe output DMO developer name. Since v60.0. |
| `transcribe_dmo_id` | `transcribeDmoId` | body | string |  | Transcribe output DMO ID. Since v60.0. |
| `transcribe_dmo_name` | `transcribeDmoName` | body | string |  | Transcribe output DMO name. Since v60.0. |
| `transform_configurations` | `transformConfigurations` | body | array of [TransformConfigInput](#transformconfiginputrepresentation) |  | Transform configuration. Since v60.0. |
| `vector_dmo_developer_name` | `vectorDmoDeveloperName` | body | string | yes | Developer name of the vector DMO, excluding the `__dlm` suffix. Since v60.0. |
| `vector_dmo_name` | `vectorDmoName` | body | string | yes | Name of the vector DMO. Since v60.0. |
| `vector_embedding` | `vectorEmbedding` | body | [VectorEmbeddingInput](#vectorembeddinginputrepresentation) | yes | Vector embedding objects. Since v60.0. |
| `vector_embedding_configuration` | `vectorEmbeddingConfiguration` | body | [VectorEmbeddingConfigInput](#vectorembeddingconfiginputrepresentation) | yes | Vector embedding configuration. Since v60.0. |
| `parsing_configurations` | `parsingConfigurations` | body | array |  | Not in the spec schema: from the MCP server's request class. |
| `post_processing_configurations` | `postProcessingConfigurations` | body | array |  | Not in the spec schema: from the MCP server's request class. |
| `pre_processing_configurations` | `preProcessingConfigurations` | body | array |  | Not in the spec schema: from the MCP server's request class. |
| `rule_configuration` | `ruleConfiguration` | body | object |  | Not in the spec schema: from the MCP server's request class. |
| `semantic_search_ranking_configurations` | `semanticSearchRankingConfigurations` | body | array |  | Not in the spec schema: from the MCP server's request class. |
| `source_app` | `sourceApp` | body | string |  | Not in the spec schema: from the MCP server's request class. |
| `source_app_developer_name` | `sourceAppDeveloperName` | body | string |  | Not in the spec schema: from the MCP server's request class. |

```sql
CALL cdp.search_index_update (search_index_api_name_or_id => 'Articles_Search', label => 'Articles Search v2', developer_name => 'Articles_Search', source_dmo_developer_name => 'Articles__dlm', chunk_dmo_name => 'Articles Search chunk', chunk_dmo_developer_name => 'Articles_Search_chunk', vector_dmo_name => 'Articles Search index', vector_dmo_developer_name => 'Articles_Search_index', search_type => 'HYBRID', processing_type => 'NEAR_REALTIME', vector_embedding => (vector_embedding_related_fields = [(related_dmo_developer_name = 'Articles__dlm', related_dmo_field_developer_name = 'Id__c', relationships = [])]), chunking_configuration => (field_level_configurations = [(source_dmo_developer_name = 'Articles__dlm', source_dmo_field_developer_name = 'Body__c', config = (id = 'passage_extraction', user_values = [(id = 'strip_html', value = 'true'), (id = 'max_tokens', value = '512')]))]), vector_embedding_configuration => (embedding_model = (id = 'e5_large_v2', user_values = [(id = 'dimension', value = '1024'), (id = 'max_token_limit', value = '512')]), index = (id = 'HNSW', user_values = [(id = 'hnswEfConstruction', value = '2000'), (id = 'M', value = '64')]), similarity_metric = 'COSINE'));
```

**Result**

One row. Schema `SemanticSearchRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `current_page_url` | `currentPageUrl` | VARCHAR | Current page URL. Since v60.0. |
| `next_page_url` | `nextPageUrl` | VARCHAR | Next page URL, if it exists. Since v60.0. |
| `total_size` | `totalSize` | BIGINT | Total size of the collection. Since v60.0. |
| `chunking_strategies` | `chunkingStrategies` | JSON | List of chunking strategy object IDs. Since v60.0. |
| `id` | `id` | VARCHAR | ID of the semantic search definition that was updated or created. Since v60.0. |
| `ranking_configurations` | `rankingConfigurations` | JSON | List of ranking configuration object IDs that were created for hybrid search. Since v60.0. |
| `transformations` | `transformations` | JSON | The list of transformation IDs. Since v60.0. |
| `vector_embedding` | `vectorEmbedding` | JSON (VectorEmbeddingRepresentation) | The structure for vector embeddings, including any extra fields. Since v60.0. |

**Done when:** `search_index_get.runtime_status` = `READY`; `FAILED` is terminal. No source says whether an update resets the status.

**Notes:** [Salesforce's tool](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/SearchIndexTools.java) says to read `search_index_config` and `search_index_get` first and build the body from them. The spec requires the same fields as create, so a label change still sends the whole definition.

A GET response can't be sent back as is. GET returns `chunk_dmo_developer_name` and `vector_dmo_developer_name` with `__dlm` in the spec's examples, while this call takes them without it. GET also returns display-name fields that are [reported to return a 500 on input](https://github.com/javrrr/afd360/blob/main/docs/resources.md#searchindex) (community), per [`search_index_create`](#search_index_create).

No source says which fields can change or whether an update rebuilds the index. afd360 [avoids PATCH](https://github.com/javrrr/afd360/blob/main/src/resources/search-index.ts) and deletes and recreates the index instead (community). The `vector_embedding_related_fields` conflict on create applies here too.

## search_index_create

`POST /ssot/search-index` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Search-Index/paths/~1ssot~1search-index/post) · tool `d360_search_index_create` · evidence O · changes org state

Create a search index over a DMO. The platform generates the chunk and index DMOs, then chunks and embeds the data in the background. Since v60.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `id` | `id` | body | string |  | ID of the asset. Since v58.0. |
| `name` | `name` | body | string |  | Name of the asset. Since v58.0. |
| `namespace` | `namespace` | body | string |  | Namespace of the asset. Since v58.0. |
| `activation_status` | `activationStatus` | body | string |  | Activation status of the semantic search record. Since v60.0. |
| `attachment_dmo_developer_name` | `attachmentDmoDeveloperName` | body | string |  | Developer name of the attachment `MktDataModelObject`. For example, `loanAgreement__dlm`. Since v62.0. |
| `chunk_dmo_developer_name` | `chunkDmoDeveloperName` | body | string | yes | Developer name of the data model object (DMO) used for chunking, excluding the `__dlm` suffix. Since v60.0. |
| `chunk_dmo_name` | `chunkDmoName` | body | string | yes | Name of the DMO used for chunking. Since v60.0. |
| `chunking_configuration` | `chunkingConfiguration` | body | [ChunkingConfigInput](#chunkingconfiginputrepresentation) | yes | Chunking configuration. Since v60.0. |
| `description` | `description` | body | string |  | Description of semantic search record to be created. Since v60.0. |
| `developer_name` | `developerName` | body | string | yes | Developer name of the semantic search record to be created. Since v60.0. |
| `index_configuration` | `indexConfiguration` | body | [IndexConfigInput](#indexconfiginputrepresentation) |  | Index configuration for the semantic search record. Since v64.0. |
| `label` | `label` | body | string | yes | Label of semantic search record to be created. Since v60.0. |
| `processing_type` | `processingType` | body | string |  | Processing type of the search index, such as `NEAR_REALTIME` or `REALTIME`. Only `NEAR_REALTIME` is reported to work (community). Since v63.0. |
| `ranking_configurations` | `rankingConfigurations` | body | array of [SearchRankingFieldInput](#searchrankingfieldinputrepresentation) |  | List of ranking configurations for hybrid search. Selecting fields for a ranking configuration is optional. Since v60.0. |
| `search_type` | `searchType` | body | string | yes | Type of the search index (`HYBRID` or `VECTOR`). Since v60.0. |
| `source_dmo_developer_name` | `sourceDmoDeveloperName` | body | string | yes | Developer name of the source (parent) `MktDataModelObject`. For example, `loanAgreement__dlm`. Since v60.0. |
| `transcribe_dmo_developer_name` | `transcribeDmoDeveloperName` | body | string |  | Transcribe output DMO developer name. Since v60.0. |
| `transcribe_dmo_id` | `transcribeDmoId` | body | string |  | Transcribe output DMO ID. Since v60.0. |
| `transcribe_dmo_name` | `transcribeDmoName` | body | string |  | Transcribe output DMO name. Since v60.0. |
| `transform_configurations` | `transformConfigurations` | body | array of [TransformConfigInput](#transformconfiginputrepresentation) |  | Transform configuration, used for transcribing audio and video. Salesforce's tool calls it required, but the spec doesn't. Since v60.0. |
| `vector_dmo_developer_name` | `vectorDmoDeveloperName` | body | string | yes | Developer name of the vector DMO, excluding the `__dlm` suffix. Since v60.0. |
| `vector_dmo_name` | `vectorDmoName` | body | string | yes | Name of the vector DMO. Since v60.0. |
| `vector_embedding` | `vectorEmbedding` | body | [VectorEmbeddingInput](#vectorembeddinginputrepresentation) | yes | Vector embedding objects. Since v60.0. |
| `vector_embedding_configuration` | `vectorEmbeddingConfiguration` | body | [VectorEmbeddingConfigInput](#vectorembeddingconfiginputrepresentation) | yes | Vector embedding configuration. Since v60.0. |
| `parsing_configurations` | `parsingConfigurations` | body | array |  | Not in the spec schema: from the MCP server's request class. |
| `post_processing_configurations` | `postProcessingConfigurations` | body | array |  | Not in the spec schema: from the MCP server's request class. |
| `pre_processing_configurations` | `preProcessingConfigurations` | body | array |  | Not in the spec schema: from the MCP server's request class. |
| `rule_configuration` | `ruleConfiguration` | body | object |  | Not in the spec schema: from the MCP server's request class. |
| `semantic_search_ranking_configurations` | `semanticSearchRankingConfigurations` | body | array |  | Not in the spec schema: from the MCP server's request class. |
| `source_app` | `sourceApp` | body | string |  | Not in the spec schema: from the MCP server's request class. |
| `source_app_developer_name` | `sourceAppDeveloperName` | body | string |  | Not in the spec schema: from the MCP server's request class. |

```sql
CALL cdp.search_index_create (label => 'Articles Search', developer_name => 'Articles_Search', source_dmo_developer_name => 'Articles__dlm', chunk_dmo_name => 'Articles Search chunk', chunk_dmo_developer_name => 'Articles_Search_chunk', vector_dmo_name => 'Articles Search index', vector_dmo_developer_name => 'Articles_Search_index', search_type => 'HYBRID', processing_type => 'NEAR_REALTIME', vector_embedding => (vector_embedding_related_fields = [(related_dmo_developer_name = 'Articles__dlm', related_dmo_field_developer_name = 'Id__c', relationships = [])]), chunking_configuration => (field_level_configurations = [(source_dmo_developer_name = 'Articles__dlm', source_dmo_field_developer_name = 'Body__c', config = (id = 'passage_extraction', user_values = [(id = 'strip_html', value = 'true'), (id = 'max_tokens', value = '512')]))]), vector_embedding_configuration => (embedding_model = (id = 'e5_large_v2', user_values = [(id = 'dimension', value = '1024'), (id = 'max_token_limit', value = '512')]), index = (id = 'HNSW', user_values = [(id = 'hnswEfConstruction', value = '2000'), (id = 'M', value = '64')]), similarity_metric = 'COSINE'));
```

**Result**

One row. Schema `SemanticSearchRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `current_page_url` | `currentPageUrl` | VARCHAR | Current page URL. Since v60.0. |
| `next_page_url` | `nextPageUrl` | VARCHAR | Next page URL, if it exists. Since v60.0. |
| `total_size` | `totalSize` | BIGINT | Total size of the collection. Since v60.0. |
| `chunking_strategies` | `chunkingStrategies` | JSON | List of chunking strategy object IDs. Since v60.0. |
| `id` | `id` | VARCHAR | ID of the semantic search definition that was updated or created. Since v60.0. |
| `ranking_configurations` | `rankingConfigurations` | JSON | List of ranking configuration object IDs that were created for hybrid search. Since v60.0. |
| `transformations` | `transformations` | JSON | The list of transformation IDs. Since v60.0. |
| `vector_embedding` | `vectorEmbedding` | JSON (VectorEmbeddingRepresentation) | The structure for vector embeddings, including any extra fields. Since v60.0. |

**Done when:** `search_index_get.runtime_status` = `READY`; `FAILED` is terminal. Allow several minutes, and over 15 on a newly mapped source DMO (one org).

**Notes:** **Before you call it.** Salesforce's tool says to [read `search_index_config` first](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/SearchIndexTools.java) and take ids from there. The source DMO has to be ready, and these reports come from one community tool, [afd360](https://github.com/javrrr/afd360/blob/main/docs/resources.md#searchindex) (community):

- A custom DMO needs `dataspace_name` populated, about 90 s after creation, or create returns 400.
- A 400, sometimes a 500, saying the DMO is "not fully materialized" can last about 90 s longer. afd360 retries 6 times, 15 s apart.
- Create the mapping first. [Without mapped data](https://github.com/javrrr/afd360/blob/main/src/resources/search-index.ts), the index can sit at a null `runtime_status` indefinitely.

Salesforce's docs agree on the cause: [chunking runs only on content that exists in the source](https://developer.salesforce.com/docs/data/data-cloud-code-ext/guide/use-chunking-in-search-index.md).

**`vector_embedding_related_fields` conflict.** Salesforce's [request class](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/model/request/searchindex/SearchIndexCreateRequest.java) says to "use empty list" when no related fields are needed, and the spec's examples and [Salesforce's kit](https://github.com/salesforce-misc/Data360AgentforceSolutionKitRetail/blob/main/.claude/skills/intelligent-context/SKILL.md) send `[]`. afd360 reports that [an empty list makes the server throw a null pointer error](https://github.com/javrrr/afd360/blob/main/docs/resources.md#searchindex) and sends the source DMO's primary key instead (community). No source settles it, so the example sends the key, which fits both. The spec also ties these fields to filtering: a NoCode retriever's filter field must be one of them. A [community skill](https://github.com/Jaganpro/sf-skills/blob/main/skills/sf-datacloud-retrieve/SKILL.md) says `hybrid_search` prefilters work only on fields configured at creation (community).

**Names.** `source_dmo_developer_name` includes `__dlm`. `chunk_dmo_developer_name` and `vector_dmo_developer_name` must not, because the platform appends it. The chunk and index names you choose become the tables you query. They [also show up as DLOs](https://github.com/szymonlewandowski/config-snapshot-data360/blob/main/docs/api-quirks.md) ending `_chunk__dll` and `_index__dll`, with no data stream (community). Sending the display-name inputs `source_dmo_name`, `source_dmo_field_name`, `related_dmo_name` or `related_dmo_field_name` is [reported to return an opaque 500](https://github.com/javrrr/afd360/blob/main/docs/resources.md#searchindex) (community), although the spec lists them as input.

**Don't retry blindly.** An error doesn't prove the index wasn't created. afd360 [saw the index land while the POST failed](https://github.com/javrrr/afd360/blob/main/src/resources/search-index.ts), so it reads the index by name before giving up (community). It also uses a 120 s timeout. The response carries only ids, so call `search_index_get` afterward.

**What the sources disagree on:**

- `transform_configurations`: [Salesforce's tool](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/SearchIndexTools.java) lists it as required, but the spec doesn't, and community examples omit it.
- `processing_type`: [afd360](https://github.com/javrrr/afd360/blob/main/src/resources/search-index.ts) says only `NEAR_REALTIME` is accepted through the API and `REALTIME` is reserved (community). The spec lists both.
- HNSW `user_values`: the spec's config example marks `hnswEfConstruction` and `M` read-only, at 2000 and 64. Salesforce's examples send those values, and a [community skill](https://github.com/Jaganpro/sf-skills/blob/main/skills/sf-datacloud-retrieve/SKILL.md) says to send `[]` (community).
- The body: Salesforce's request class also has `parsing_configurations`, `pre_processing_configurations`, `post_processing_configurations`, `rule_configuration`, `semantic_search_ranking_configurations`, `source_app` and `source_app_developer_name`, which the spec lacks.
- Data space: the spec has no data space option, but [Salesforce's kit](https://github.com/salesforce-misc/Data360AgentforceSolutionKitRetail/blob/main/.claude/skills/intelligent-context/SKILL.md) posts with `?dataspace=default`.

**Reading the index.** Run `vector_search` or `hybrid_search` in a `SELECT` over the connection. The arguments are `TABLE("<name>_index__dlm")`, the search text, a prefilter string (`''` if none) and the number of results. The spec's retriever examples join `c."RecordId__c" = v."RecordId__c"`, then `c."SourceRecordId__c"` to the source DMO's key. Some also read `Chunk__c`, `DataSource__c` and `DataSourceObject__c` from the chunk DMO. A prefilter is a string, so its quotes double: `'Language__c = ''en_US'''`. [One community plugin](https://github.com/dsouza-anush/sf-plugin-data360/blob/main/src/query/searchSql.ts) joins `v."SourceRecordId__c" = c."RecordId__c"` instead, but it labels that SQL unverified, so prefer the spec's form. [Another community example](https://github.com/Jaganpro/sf-skills/blob/main/skills/sf-ai-agentforce-observability/references/query-patterns.md) uses the spec's join. Salesforce's [published SQL reference doesn't cover these functions](https://developer.salesforce.com/docs/llms-data-cloud.txt), going by its index. No source says whether `hybrid_search` works on a `VECTOR` index.

## search_index_process_history

`GET /ssot/search-index/{id}/process-history` · tool `d360_search_index_process_history` · evidence S · read-only

Get the processing runs of one search index. Use it to see why an index isn't ready or when it last ran.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `search_index_api_name_or_id` | `id` | path | string | yes | ID or API Name of the search index |
| `limit` | `limit` | query | integer |  | Maximum number of records to return (default 50) |
| `offset` | `offset` | query | integer |  | 1-based offset for pagination (default 1). Must be >= 1. |

```sql
CALL cdp.search_index_process_history (search_index_api_name_or_id => 'Articles_Search', limit => 20);
```

**Result**

The public sources don't document this response. One row, with the response in `_raw`.

**Paging:** `limit` and 1-based `offset`. Salesforce's tool says pagination "is currently unreliable" and fetches only the first page.

**Notes:** [Salesforce's tool](https://github.com/forcedotcom/d360-mcp-server/blob/main/src/main/java/com/salesforce/data360/mcp/tools/SearchIndexTools.java) says the response is a list of process history records "with status, timestamps, and details", but no source names the fields. There is no spec entry, and [one community plugin](https://github.com/dsouza-anush/sf-plugin-data360/blob/main/docs/API_COVERAGE.md) leaves this call out as unverified.

## Schemas

Attribute names are keywords inside the object they belong to, so completion offers exactly these.

### ChunkingConfigInputRepresentation

Represents the input for chunking structured/unstructured configurations.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `field_level_configurations` | `fieldLevelConfigurations` | array of [FieldLevelConfigurationInput](#fieldlevelconfigurationinputrepresentation) |  | The field level configurations used in structured flows. Send this alone for a structured DMO, and with `file_level_configuration` only when `attachment_dmo_developer_name` is set, according to Salesforce's tool. Since v65.0. |
| `file_level_configuration` | `fileLevelConfiguration` | [ChunkingConfigInput_fileLevelConfiguration](#chunkingconfiginput_filelevelconfiguration) |  | The file level configurations used in unstructured flows. In the spec's examples it holds `per_file_extensions`: items with `file_extension`, `config` and `citations`. Send this alone for an unstructured DMO, according to Salesforce's tool. Since v65.0. |

### ChunkingConfigInput_fileLevelConfiguration

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `per_file_extensions` | `perFileExtensions` | array of [ChunkingConfigInput_fileLevelConfiguration_perFileExtensions](#chunkingconfiginput_filelevelconfiguration_perfileextensions) |  | Seen in examples: the spec types the parent as a free-form object. |

### ChunkingConfigInput_fileLevelConfiguration_perFileExtensions

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `file_extension` | `fileExtension` | string |  | Seen in examples: the spec types the parent as a free-form object. |
| `config` | `config` | [ChunkingConfigInput_fileLevelConfiguration_perFileExtensions_config](#chunkingconfiginput_filelevelconfiguration_perfileextensions_config) |  | Seen in examples: the spec types the parent as a free-form object. |
| `citations` | `citations` | array |  | Seen in examples: the spec types the parent as a free-form object. |

### ChunkingConfigInput_fileLevelConfiguration_perFileExtensions_config

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `id` | `id` | string |  | Seen in examples: the spec types the parent as a free-form object. |
| `user_values` | `userValues` | array of [ChunkingConfigInput_fileLevelConfiguration_perFileExtensions_config_userValues](#chunkingconfiginput_filelevelconfiguration_perfileextensions_config_uservalues) |  | Seen in examples: the spec types the parent as a free-form object. |

### ChunkingConfigInput_fileLevelConfiguration_perFileExtensions_config_userValues

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `id` | `id` | string |  | Seen in examples: the spec types the parent as a free-form object. |
| `value` | `value` | string |  | Seen in examples: the spec types the parent as a free-form object. |

### ConfigInputRepresentation

Represents the input for the general configuration shared across chunking and vector configurations.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `id` | `id` | string |  | ID of the configuration. Since v60.0. |
| `user_values` | `userValues` | array of [UserValueInput](#uservalueinputrepresentation) |  | User input values. Since v60.0. |

### ContextFieldConfigurationInputRepresentation

Represents the input for context field configurations.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `alias_name` | `aliasName` | string |  | Alias of the index field. Since v64.0. |
| `dmo_developer_name` | `dmoDeveloperName` | string |  | Developer name of the DMO. Since v64.0. |
| `dmo_field_developer_name` | `dmoFieldDeveloperName` | string |  | Developer name of the DMO field. Since v64.0. |
| `relationships` | `relationships` | array of [SourceTargetRelationshipInput](#sourcetargetrelationshipinputrepresentation) |  | Field relationship paths between the source DMO fields and target DMO fields. Since v64.0. |

### DecoratorInputRepresentation

Represents the input for the field-level chunking decorator.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `decorator_id` | `decoratorId` | string |  | Decorator ID: `prepend` or `append`, which add another field's value to each chunk (community). Since v61.0. |
| `dmo_developer_name` | `dmoDeveloperName` | string |  | DMO developer name. Since v61.0. |
| `dmo_field_developer_name` | `dmoFieldDeveloperName` | string |  | DMO field developer name. Since v61.0. |

### FieldLevelConfigurationInputRepresentation

Represents the input for field-level configurations.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `config` | `config` | [ConfigInput](#configinputrepresentation) |  | Field-level configuration. Since v60.0. |
| `decorators` | `decorators` | array of [DecoratorInput](#decoratorinputrepresentation) |  | Chunking decorators. Since v60.0. |
| `source_dmo_developer_name` | `sourceDmoDeveloperName` | string |  | Source DMO developer name. Since v60.0. |
| `source_dmo_field_developer_name` | `sourceDmoFieldDeveloperName` | string |  | Source DMO field developer name. Since v60.0. |
| `source_dmo_field_name` | `sourceDmoFieldName` | string |  | Source DMO field name. Reported to return a 500 on input (community). Since v61.0. |
| `source_dmo_name` | `sourceDmoName` | string |  | Source DMO name. Reported to return a 500 on input (community). Since v61.0. |
| `version` | `version` | string |  | Version of the chunking configuration. Since v60.0. |

### IndexConfigInputRepresentation

Represents the input for a semantic search index configuration.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `context_field_configuration` | `contextFieldConfiguration` | array of [ContextFieldConfigurationInput](#contextfieldconfigurationinputrepresentation) |  | Configuration of the fields for the `ContextFields__c` column of the Index DMO. Fields can come from source or related DMOs. Since v64.0. |
| `record_field_configuration` | `recordFieldConfiguration` | array of [RecordFieldConfigurationInput](#recordfieldconfigurationinputrepresentation) |  | Configuration for the fields to be indexed as records. This configuration includes storage optimization, such as `TYPEAHEAD` or `STANDARD`. Fields can come from source or related DMOs. Since v64.0. |
| `should_vectorize_searchable_fields` | `shouldVectorizeSearchableFields` | boolean |  | Indicates whether the searchable fields are vectorized (`true`) or not (`false`). Since v64.0. |

### RecordFieldConfigurationInputRepresentation

Represents the input for record field configurations.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `alias_name` | `aliasName` | string |  | Alias of the index field. Since v64.0. |
| `dmo_developer_name` | `dmoDeveloperName` | string |  | Developer name of the DMO. Since v64.0. |
| `dmo_field_developer_name` | `dmoFieldDeveloperName` | string |  | Developer name of the DMO field. Since v64.0. |
| `relationships` | `relationships` | array of [SourceTargetRelationshipInput](#sourcetargetrelationshipinputrepresentation) |  | Field relationship paths between the source DMO fields and target DMO fields. Since v64.0. |
| `tokenizations` | `tokenizations` | array of [TokenizationInput](#tokenizationinputrepresentation) |  | List of tokenizations. Since v58.0. |

### SearchRankingFieldInputRepresentation

Represents the input for ranking search fields.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `id` | `id` | string |  | ID of the asset. Since v58.0. |
| `name` | `name` | string |  | Name of the asset. Since v58.0. |
| `namespace` | `namespace` | string |  | Namespace of the asset. Since v58.0. |
| `alias_name` | `aliasName` | string |  | Alias of the field. Since v64.0. |
| `developer_name` | `developerName` | string |  | Developer name of the rank field. Since v61.0. |
| `rank_type` | `rankType` | string |  | Ranking factor used to influence the ranking of search result field types, `POPULARITY` or `RECENCY`, for hybrid search. Since v61.0. |
| `related_dmo_developer_name` | `relatedDmoDeveloperName` | string |  | API name of the related data model object (DMO). Since v61.0. |
| `related_dmo_field_developer_name` | `relatedDmoFieldDeveloperName` | string |  | API name of the related DMO field chosen for ranking factor. Since v61.0. |
| `related_dmo_field_name` | `relatedDmoFieldName` | string |  | Name of the related DMO field chosen for ranking factor. Since v61.0. |
| `related_dmo_name` | `relatedDmoName` | string |  | Name of the related DMO. Since v61.0. |
| `relationships` | `relationships` | array of [SourceTargetRelationshipInput](#sourcetargetrelationshipinputrepresentation) |  | Field relationship paths. Since v61.0. |

### SourceTargetRelationshipInputRepresentation

Represents the input for the relationship to a source search index data model object (DMO).

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `id` | `id` | string |  | ID of the asset. Since v58.0. |
| `name` | `name` | string |  | Name of the asset. Since v58.0. |
| `namespace` | `namespace` | string |  | Namespace of the asset. Since v58.0. |
| `source_dmo_developer_name` | `sourceDmoDeveloperName` | string | yes | Source DMO developer name. Since v60.0. |
| `source_dmo_field_developer_name` | `sourceDmoFieldDeveloperName` | string | yes | Source DMO field developer name. Since v60.0. |
| `source_dmo_label` | `sourceDmoLabel` | string |  | Source DMO label. Since v61.0. |
| `source_field_label` | `sourceFieldLabel` | string |  | Source DMO field label. Since v61.0. |
| `target_dmo_developer_name` | `targetDmoDeveloperName` | string | yes | Target DMO developer name. Since v60.0. |
| `target_dmo_field_developer_name` | `targetDmoFieldDeveloperName` | string | yes | Target DMO field developer name. Since v60.0. |
| `target_dmo_label` | `targetDmoLabel` | string |  | Target DMO label. Since v61.0. |
| `target_field_label` | `targetFieldLabel` | string |  | Target DMO field label. Since v61.0. |

### TokenizationInputRepresentation

Represents the input for record field configuration tokenizations.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `name` | `name` | string |  | Name of the tokenization, such as `TYPEAHEAD` or `STANDARD`. Since v64.0. |

### TransformConfigInputRepresentation

Represents the input for transforming an unstructured configuration.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `file_level_configuration` | `fileLevelConfiguration` | array of [TransformFileLevelConfigurationInput](#transformfilelevelconfigurationinputrepresentation) |  | File-level configurations used in the transform. Since v61.0. |
| `transform_type` | `transformType` | string |  | Type of the transformation. Only transcribe is currently supported. Since v61.0. |

### TransformFileLevelConfigurationInputRepresentation

Represents the input for a file transform configuration.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `config` | `config` | [ConfigInput](#configinputrepresentation) |  | Transform configuration. Since v61.0. |
| `file_extensions` | `fileExtensions` | array of string |  | File extensions list, for example, `<mp4, mp3>`. Since v61.0. |

### UserValueInputRepresentation

Represents the input for a user value.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `id` | `id` | string |  | ID, such as `strip_html` or `max_tokens`. Since v60.0. |
| `value` | `value` | string |  | Value, such as `false`, `100`, or `COSINE`. Since v60.0. |

### VectorEmbeddingConfigInputRepresentation

Represents the input for a vector-embedding configuration.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `embedding_model` | `embeddingModel` | [ConfigInput](#configinputrepresentation) |  | Deployed ML model that creates embeddings, for example, `e5-large`. Since v60.0. |
| `index` | `index` | [ConfigInput](#configinputrepresentation) |  | Type used in vector indexing, such as `HNSW` or `FLAT`. Since v60.0. |
| `similarity_metric` | `similarityMetric` | string |  | Similarity metric used to calculate distance between vectors, for example, `COSINE`. Since v60.0. |
| `version` | `version` | string |  | Version of the record. Since v60.0. |

### VectorEmbeddingInputRepresentation

Represents the input for vector embedding.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `id` | `id` | string |  | ID of the asset. Since v58.0. |
| `name` | `name` | string |  | Name of the asset. Since v58.0. |
| `namespace` | `namespace` | string |  | Namespace of the asset. Since v58.0. |
| `einstein_studio_model_id` | `einsteinStudioModelId` | string |  | Einstein Studio AI model ID. Since v60.0. |
| `vector_embedding_related_fields` | `vectorEmbeddingRelatedFields` | array of [VectorEmbeddingRelatedFieldsInput](#vectorembeddingrelatedfieldsinputrepresentation) |  | Extra fields for vector embedding, which NoCode retrievers filter on. Salesforce allows an empty list, and one community tool reports a server error on it. Since v60.0. |

### VectorEmbeddingRelatedFieldsInputRepresentation

Represents the input for vector-embedding extra fields.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `id` | `id` | string |  | ID of the asset. Since v58.0. |
| `name` | `name` | string |  | Name of the asset. Since v58.0. |
| `namespace` | `namespace` | string |  | Namespace of the asset. Since v58.0. |
| `related_dmo_developer_name` | `relatedDmoDeveloperName` | string |  | Related data model object (DMO) developer name. Since v60.0. |
| `related_dmo_field_developer_name` | `relatedDmoFieldDeveloperName` | string |  | Related DMO field developer name. Since v60.0. |
| `related_dmo_field_name` | `relatedDmoFieldName` | string |  | Related DMO field name. Reported to return a 500 on input (community). Since v61.0. |
| `related_dmo_name` | `relatedDmoName` | string |  | Related DMO name. Reported to return a 500 on input (community). Since v61.0. |
| `relationship_cardinality` | `relationshipCardinality` | string |  | Relationship cardinality between the source DMO field and target DMO field. For example, `OneToOne`, `ManyToOne`, or `OneToMany`. Since v64.0. |
| `relationships` | `relationships` | array of [SourceTargetRelationshipInput](#sourcetargetrelationshipinputrepresentation) |  | Field relationship paths. Since v60.0. |
