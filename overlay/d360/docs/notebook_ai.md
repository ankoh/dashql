<!-- Generated from overlay/d360/api/notebook_ai.yaml, edit that and run: bazel run //overlay/d360:update -->

# Notebook AI

Part of the [CDP function reference](functions.md). Nothing here is implemented or tested against an org. Every result also has the [standard columns](functions.md#result-schema).

Notebook AI keeps documents in searchable notebooks. The API calls a notebook a *knowledge space*. A space holds libraries, a library holds sources, and a source holds files. Deep research jobs produce reports that can be added back to a space as a source. Intelligent Context lenses and Agentforce Data Libraries (`1JD` IDs) are separate surfaces.

The order is: enable the feature and grant permissions, create the space, read its `PERSONAL` library, get upload URLs, upload, index, then poll. Almost all behavior below comes from one source, the [MedTech kit](https://github.com/salesforce-misc/Data360MedTechSolutionKit/blob/main/.claude/skills/notebook-ai/SKILL.md), validated in its authors' orgs.

The gotchas that matter most:

- Enabling Notebook AI has no public API. `knowledge_space_list` returns an empty list whether it's on or off, so `knowledge_space_create` is the real check.
- The upload is a plain S3 `PUT`, and no function here does it.
- `files_index` can return HTTP 500 after indexing has started. Check file status before you retry.
- The spec and the kit disagree on `file_path`. See [`files_index`](#files_index).
- The spec has no call that creates a deep research job.

```sql
CALL cdp.knowledge_space_create (label => 'Diagnosis', developer_name => 'Diagnosis', dataspace => 'default');
CALL cdp.knowledge_space_details_get (knowledge_space_api_name_or_id => '1T8xx0000004CYqCAM');
CALL cdp.presigned_urls_get (library_id => '1aQxx00000000JNEAY', file_names => ['report.pdf']);
/* PUT the file to the returned URL outside SQL */
CALL cdp.files_index (knowledge_artifact_id => '1aQxx00000000JNEAY', knowledge_artifact_source => 'FILE_UPLOAD', knowledge_source_files_list => [(file_name = 'report.pdf', file_path = 'collections/1aQxx00000000JNEAY/report.pdf', file_type = 'PDF')]);
```

**Functions:** [`knowledge_space_delete`](#knowledge_space_delete), [`knowledge_space_configuration_delete`](#knowledge_space_configuration_delete), [`knowledge_space_session_delete`](#knowledge_space_session_delete), [`knowledge_space_list`](#knowledge_space_list), [`knowledge_space_get`](#knowledge_space_get), [`knowledge_space_details_get`](#knowledge_space_details_get), [`session_conversation_list`](#session_conversation_list), [`knowledge_space_session_list`](#knowledge_space_session_list), [`knowledge_space_configuration_list`](#knowledge_space_configuration_list), [`knowledge_space_configuration_get`](#knowledge_space_configuration_get), [`deep_research_status_get`](#deep_research_status_get), [`knowledge_library_list`](#knowledge_library_list), [`knowledge_library_details_get`](#knowledge_library_details_get), [`knowledge_space_session_get`](#knowledge_space_session_get), [`knowledge_space_update`](#knowledge_space_update), [`deep_research_plan_update`](#deep_research_plan_update), [`knowledge_library_update`](#knowledge_library_update), [`knowledge_space_create`](#knowledge_space_create), [`knowledge_space_session_create`](#knowledge_space_session_create), [`knowledge_space_configuration_create`](#knowledge_space_configuration_create), [`deep_research_cancel`](#deep_research_cancel), [`deep_research_report_get`](#deep_research_report_get), [`deep_research_run`](#deep_research_run), [`file_status_get`](#file_status_get), [`knowledge_import_get`](#knowledge_import_get), [`knowledge_import`](#knowledge_import), [`files_index`](#files_index), [`knowledge_library_create`](#knowledge_library_create), [`knowledge_library_remove`](#knowledge_library_remove), [`knowledge_library_search`](#knowledge_library_search), [`presigned_urls_get`](#presigned_urls_get), [`knowledge_space_provision`](#knowledge_space_provision), [`files_remove`](#files_remove), [`deep_research_as_knowledge_source_add`](#deep_research_as_knowledge_source_add), [`file_chunks_summary_get`](#file_chunks_summary_get)

## knowledge_space_delete

`DELETE /ssot/knowledge-space/{knowledgeSpaceApiNameOrId}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Notebook-AI/paths/~1ssot~1knowledge-space~1%7BknowledgeSpaceApiNameOrId%7D/delete) · evidence O · changes org state

Delete a knowledge space. Since v65.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `knowledge_space_api_name_or_id` | `knowledgeSpaceApiNameOrId` | path | string | yes | API name or ID of the knowledge space. |

```sql
CALL cdp.knowledge_space_delete (knowledge_space_api_name_or_id => '1T8xx0000004CYqCAM');
```

**Result**

No response body (HTTP 200). One row with only the standard columns.

**Notes:** No source says what happens to the space's libraries, files or sessions.

## knowledge_space_configuration_delete

`DELETE /ssot/knowledge-space/config/{knowledgeSpaceConfigApiNameOrId}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Notebook-AI/paths/~1ssot~1knowledge-space~1config~1%7BknowledgeSpaceConfigApiNameOrId%7D/delete) · evidence O · changes org state

Delete a knowledge space configuration. Since v65.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `knowledge_space_config_api_name_or_id` | `knowledgeSpaceConfigApiNameOrId` | path | string | yes | API name or ID of the knowledge space configuration. |

```sql
CALL cdp.knowledge_space_configuration_delete (knowledge_space_config_api_name_or_id => 'Default_Config');
```

**Result**

No response body (HTTP 200). One row with only the standard columns.

**Notes:** The [MedTech kit](https://github.com/salesforce-misc/Data360MedTechSolutionKit/blob/main/.claude/skills/notebook-ai/SKILL.md) reports that `knowledge_space_create` fails with `No Knowledge Space Config Found For the DataSpace` when a data space has no configuration.

## knowledge_space_session_delete

`DELETE /ssot/knowledge-space/session/{knowledgeSpaceSessionId}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Notebook-AI/paths/~1ssot~1knowledge-space~1session~1%7BknowledgeSpaceSessionId%7D/delete) · evidence O · changes org state

Delete a knowledge space session. Since v65.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `knowledge_space_session_id` | `knowledgeSpaceSessionId` | path | string | yes | ID of the knowledge space session. |

```sql
CALL cdp.knowledge_space_session_delete (knowledge_space_session_id => 'session-123');
```

**Result**

No response body (HTTP 200). One row with only the standard columns.

## knowledge_space_list

`GET /ssot/knowledge-space` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Notebook-AI/paths/~1ssot~1knowledge-space/get) · evidence O · read-only

Get all knowledge spaces in the current data space. Since v65.0.

**Options**

None.

```sql
CALL cdp.knowledge_space_list ();
```

**Result**

One row per item of `/knowledgeSpaces` in the response. Schema `KnowledgeSpaceOutputRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `client_context` | `clientContext` | VARCHAR | Client context of the knowledge space. Since v65.0. |
| `dataspace` | `dataSpace` | VARCHAR | Name of the data space that the knowledge space belongs to. Since v65.0. |
| `description` | `description` | VARCHAR | Description of the knowledge space. Since v65.0. |
| `developer_name` | `developerName` | VARCHAR | Developer name of the knowledge space. Since v65.0. |
| `knowledge_space_config_id` | `knowledgeSpaceConfigId` | VARCHAR | ID of the knowledge space configuration. Since v65.0. |
| `knowledge_space_def_id` | `knowledgeSpaceDefId` | VARCHAR | Definition ID of the knowledge space. Since v65.0. |
| `knowledge_space_id` | `knowledgeSpaceId` | VARCHAR | ID of the knowledge space. Since v65.0. |
| `label` | `label` | VARCHAR | Label of the knowledge space. Since v65.0. |
| `libraries` | `libraries` | JSON (array of KnowledgeSpaceLibraryOutputRepresentation) | List of libraries in the knowledge space. Since v65.0. |

**Notes:** An empty list doesn't mean Notebook AI is available: this returns `{"knowledgeSpaces":[]}` with HTTP 200 on both enabled and disabled orgs ([MedTech kit](https://github.com/salesforce-misc/Data360MedTechSolutionKit/blob/main/.claude/skills/notebook-ai/SKILL.md), one org). The spec says "current data space", but this call has no data space option and no source says how the space is chosen. To find a space, match on `label`, because `developer_name` can come back with a suffix. See [`knowledge_space_create`](#knowledge_space_create).

## knowledge_space_get

`GET /ssot/knowledge-space/{knowledgeSpaceApiNameOrId}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Notebook-AI/paths/~1ssot~1knowledge-space~1%7BknowledgeSpaceApiNameOrId%7D/get) · evidence O · read-only

Get a knowledge space. Since v65.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `knowledge_space_api_name_or_id` | `knowledgeSpaceApiNameOrId` | path | string | yes | API name or ID of the knowledge space. |

```sql
CALL cdp.knowledge_space_get (knowledge_space_api_name_or_id => '1T8xx0000004CYqCAM');
```

**Result**

One row. Schema `KnowledgeSpaceOutputRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `client_context` | `clientContext` | VARCHAR | Client context of the knowledge space. Since v65.0. |
| `dataspace` | `dataSpace` | VARCHAR | Name of the data space that the knowledge space belongs to. Since v65.0. |
| `description` | `description` | VARCHAR | Description of the knowledge space. Since v65.0. |
| `developer_name` | `developerName` | VARCHAR | Developer name of the knowledge space. Since v65.0. |
| `knowledge_space_config_id` | `knowledgeSpaceConfigId` | VARCHAR | ID of the knowledge space configuration. Since v65.0. |
| `knowledge_space_def_id` | `knowledgeSpaceDefId` | VARCHAR | Definition ID of the knowledge space. Since v65.0. |
| `knowledge_space_id` | `knowledgeSpaceId` | VARCHAR | ID of the knowledge space. Since v65.0. |
| `label` | `label` | VARCHAR | Label of the knowledge space. Since v65.0. |
| `libraries` | `libraries` | JSON (array of KnowledgeSpaceLibraryOutputRepresentation) | List of libraries in the knowledge space. Since v65.0. |

**Notes:** The spec's example for this call has no `libraries`, while the one for [`knowledge_space_details_get`](#knowledge_space_details_get) does, even though both use one schema. Use the details call when you need libraries or files.

## knowledge_space_details_get

`GET /ssot/knowledge-space/{knowledgeSpaceApiNameOrId}/details` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Notebook-AI/paths/~1ssot~1knowledge-space~1%7BknowledgeSpaceApiNameOrId%7D~1details/get) · evidence O · read-only

Reads one knowledge space with its libraries, sources and files. Use it to find the library to upload into and to poll file indexing. Since v65.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `knowledge_space_api_name_or_id` | `knowledgeSpaceApiNameOrId` | path | string | yes | API name or ID of the knowledge space. |

```sql
CALL cdp.knowledge_space_details_get (knowledge_space_api_name_or_id => '1T8xx0000004CYqCAM');
```

**Result**

One row. Schema `KnowledgeSpaceOutputRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `client_context` | `clientContext` | VARCHAR | Client context of the knowledge space. Since v65.0. |
| `dataspace` | `dataSpace` | VARCHAR | Name of the data space that the knowledge space belongs to. Since v65.0. |
| `description` | `description` | VARCHAR | Description of the knowledge space. Since v65.0. |
| `developer_name` | `developerName` | VARCHAR | Developer name of the knowledge space. Since v65.0. |
| `knowledge_space_config_id` | `knowledgeSpaceConfigId` | VARCHAR | ID of the knowledge space configuration. Since v65.0. |
| `knowledge_space_def_id` | `knowledgeSpaceDefId` | VARCHAR | Definition ID of the knowledge space. Since v65.0. |
| `knowledge_space_id` | `knowledgeSpaceId` | VARCHAR | ID of the knowledge space. Since v65.0. |
| `label` | `label` | VARCHAR | Label of the knowledge space. Since v65.0. |
| `libraries` | `libraries` | JSON (array of KnowledgeSpaceLibraryOutputRepresentation) | List of libraries in the knowledge space. Since v65.0. |

**Notes:** This returns one row, not a list. The useful data is nested in the `libraries` JSON column, at `libraries[].sources[].files[]`.

The [MedTech kit](https://github.com/salesforce-misc/Data360MedTechSolutionKit/blob/main/.claude/skills/notebook-ai/SKILL.md) takes the upload target from the library with `knowledge_category` = `PERSONAL`. `sources` stays `[]` until indexing starts, so this call can't show whether a file already reached S3 (one org).

## session_conversation_list

`GET /ssot/knowledge-space/{knowledgeSpaceApiNameOrId}/session/{knowledgeSpaceSessionId}/conversation` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Notebook-AI/paths/~1ssot~1knowledge-space~1%7BknowledgeSpaceApiNameOrId%7D~1session~1%7BknowledgeSpaceSessionId%7D~1conversation/get) · evidence O · read-only

Get conversation messages for a knowledge space session. Since v65.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `knowledge_space_api_name_or_id` | `knowledgeSpaceApiNameOrId` | path | string | yes | API name or ID of the knowledge space. |
| `knowledge_space_session_id` | `knowledgeSpaceSessionId` | path | string | yes | ID of the knowledge space session. |

```sql
CALL cdp.session_conversation_list (knowledge_space_api_name_or_id => '1T8xx0000004CYqCAM', knowledge_space_session_id => 'session-123');
```

**Result**

One row per item of `/messages` in the response. Schema `KnowledgeSpaceConversationMsgOutputRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `cited_references` | `citedReferences` | JSON | List of cited references. Since v65.0. |
| `feedback_id` | `feedbackId` | VARCHAR | Feedback ID for the message. Since v65.0. |
| `id` | `id` | VARCHAR | Unique identifier of the message. Since v65.0. |
| `is_content_safe` | `isContentSafe` | BOOLEAN | Indicates whether the content is safe (`true`) or not (`false`). Since v65.0. |
| `message` | `message` | VARCHAR | Message content for the InformResponseMessage type. Since v65.0. |
| `message_type` | `messageType` | VARCHAR | Type of the message. Since v65.0. |
| `sequence_id` | `sequenceId` | BIGINT | Sequence ID of the message. Since v65.0. |
| `text` | `text` | VARCHAR | Text content of the message. Since v65.0. |
| `timestamp` | `timestamp` | BIGINT | Timestamp of the message. Since v65.0. |
| `role` | `role` | VARCHAR | Not in the spec schema: from the spec's examples. |
| `content` | `content` | VARCHAR | Not in the spec schema: from the spec's examples. |

**Notes:** The spec contradicts itself here. The schema has `message`, `text`, `message_type` and a BIGINT `timestamp`. Its response example has `role`, `content` and an ISO 8601 string `timestamp`. If the example is right, the columns above stay empty and the data is only in `_raw`.

## knowledge_space_session_list

`GET /ssot/knowledge-space/{knowledgeSpaceApiNameOrId}/sessions` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Notebook-AI/paths/~1ssot~1knowledge-space~1%7BknowledgeSpaceApiNameOrId%7D~1sessions/get) · evidence O · read-only

Get all sessions for a knowledge space. Since v65.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `knowledge_space_api_name_or_id` | `knowledgeSpaceApiNameOrId` | path | string | yes | API name or ID of the knowledge space. |
| `limit` | `limit` | query | integer |  | Maximum number of sessions to return. Since v65.0. |

```sql
CALL cdp.knowledge_space_session_list (knowledge_space_api_name_or_id => '1T8xx0000004CYqCAM', limit => 20);
```

**Result**

One row per item of `/knowledgeSpaceSessions` in the response. Schema `KnowledgeSpaceSessionOutputRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `agent_type` | `agentType` | VARCHAR | Agent type used when the session was created. Since v65.0. |
| `knowledge_space_def_id` | `knowledgeSpaceDefId` | VARCHAR | Definition ID of the knowledge space. Since v65.0. |
| `knowledge_space_id` | `knowledgeSpaceId` | VARCHAR | ID of the knowledge space. Since v65.0. |
| `knowledge_space_session_entity_id` | `knowledgeSpaceSessionEntityId` | VARCHAR | Entity ID of the knowledge space session. Since v65.0. |
| `last_active_time` | `lastActiveTime` | VARCHAR | Last active time of the session. Since v65.0. |
| `session_id` | `sessionId` | VARCHAR | ID of the knowledge space session. Since v65.0. |

**Notes:** `limit` is the only paging control in the spec, with no offset or token. The result has both `session_id` and `knowledge_space_session_entity_id`, and no source says which one the session calls expect as `knowledge_space_session_id`.

## knowledge_space_configuration_list

`GET /ssot/knowledge-space/config` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Notebook-AI/paths/~1ssot~1knowledge-space~1config/get) · evidence O · read-only

Get all knowledge space configuration details. Since v65.0.

**Options**

None.

```sql
CALL cdp.knowledge_space_configuration_list ();
```

**Result**

One row per item of `/knowledgeSpaceConfigs` in the response. Schema `KnowledgeSpaceConfigOutputRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `dataspace` | `dataspace` | VARCHAR | Name of the data space that the knowledge space configuration belongs to. Since v65.0. |
| `developer_name` | `developerName` | VARCHAR | Developer name of the configuration. Since v65.0. |
| `instance_url` | `instanceUrl` | VARCHAR | Instance URL of the org. Since v65.0. |
| `knowledge_file_dlo` | `knowledgeFileDlo` | VARCHAR | Data lake object (DLO) identifier for the knowledge file source. Since v65.0. |
| `knowledge_file_dmo` | `knowledgeFileDmo` | VARCHAR | Data model object (DMO) identifier for the knowledge file source. Since v65.0. |
| `knowledge_file_ref_dmo` | `knowledgeFileRefDmo` | VARCHAR | DMO reference for the knowledge file stream. Since v65.0. |
| `knowledge_space_agent_active_version` | `knowledgeSpaceAgentActiveVersion` | VARCHAR | Active version of the knowledge space agent. Since v65.0. |
| `knowledge_space_agent_id` | `knowledgeSpaceAgentId` | VARCHAR | Knowledge space agent ID. Since v65.0. |
| `knowledge_space_config_id` | `knowledgeSpaceConfigId` | VARCHAR | ID of the knowledge space configuration. Since v65.0. |
| `knowledge_space_file_based_agent` | `knowledgeSpaceFileBasedAgent` | VARCHAR | File-based agent identifier for NotebookAI. Since v65.0. |
| `knowledge_space_index` | `knowledgeSpaceIndex` | VARCHAR | Knowledge space search index. Since v65.0. |
| `knowledge_space_index_id` | `knowledgeSpaceIndexId` | VARCHAR | ID of the knowledge space search index. Since v65.0. |
| `label` | `label` | VARCHAR | Label of the configuration. Since v65.0. |
| `provisioning_status` | `provisioningStatus` | VARCHAR | Provisioning status of the configuration. Since v65.0. |

**Notes:** The spec doesn't list the `provisioning_status` values. This object spells the data space column `dataspace`, while knowledge spaces use `dataSpace`.

## knowledge_space_configuration_get

`GET /ssot/knowledge-space/config/{knowledgeSpaceConfigApiNameOrId}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Notebook-AI/paths/~1ssot~1knowledge-space~1config~1%7BknowledgeSpaceConfigApiNameOrId%7D/get) · evidence O · read-only

Get the details of a specific knowledge space configuration record. Since v65.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `knowledge_space_config_api_name_or_id` | `knowledgeSpaceConfigApiNameOrId` | path | string | yes | API name or ID of the knowledge space configuration. |

```sql
CALL cdp.knowledge_space_configuration_get (knowledge_space_config_api_name_or_id => 'Default_Config');
```

**Result**

One row. Schema `KnowledgeSpaceConfigOutputRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `dataspace` | `dataspace` | VARCHAR | Name of the data space that the knowledge space configuration belongs to. Since v65.0. |
| `developer_name` | `developerName` | VARCHAR | Developer name of the configuration. Since v65.0. |
| `instance_url` | `instanceUrl` | VARCHAR | Instance URL of the org. Since v65.0. |
| `knowledge_file_dlo` | `knowledgeFileDlo` | VARCHAR | Data lake object (DLO) identifier for the knowledge file source. Since v65.0. |
| `knowledge_file_dmo` | `knowledgeFileDmo` | VARCHAR | Data model object (DMO) identifier for the knowledge file source. Since v65.0. |
| `knowledge_file_ref_dmo` | `knowledgeFileRefDmo` | VARCHAR | DMO reference for the knowledge file stream. Since v65.0. |
| `knowledge_space_agent_active_version` | `knowledgeSpaceAgentActiveVersion` | VARCHAR | Active version of the knowledge space agent. Since v65.0. |
| `knowledge_space_agent_id` | `knowledgeSpaceAgentId` | VARCHAR | Knowledge space agent ID. Since v65.0. |
| `knowledge_space_config_id` | `knowledgeSpaceConfigId` | VARCHAR | ID of the knowledge space configuration. Since v65.0. |
| `knowledge_space_file_based_agent` | `knowledgeSpaceFileBasedAgent` | VARCHAR | File-based agent identifier for NotebookAI. Since v65.0. |
| `knowledge_space_index` | `knowledgeSpaceIndex` | VARCHAR | Knowledge space search index. Since v65.0. |
| `knowledge_space_index_id` | `knowledgeSpaceIndexId` | VARCHAR | ID of the knowledge space search index. Since v65.0. |
| `label` | `label` | VARCHAR | Label of the configuration. Since v65.0. |
| `provisioning_status` | `provisioningStatus` | VARCHAR | Provisioning status of the configuration. Since v65.0. |

## deep_research_status_get

`GET /ssot/knowledge-space/deep-research/{researchId}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Notebook-AI/paths/~1ssot~1knowledge-space~1deep-research~1%7BresearchId%7D/get) · evidence O · read-only

Get the deep research status by research ID. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `research_id` | `researchId` | path | string | yes | Unique identifier for the deep research job. |

```sql
CALL cdp.deep_research_status_get (research_id => 'research-abc123');
```

**Result**

One row. Schema `KnowledgeSpaceRunResearchOutputRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `config` | `config` | JSON | Deep research configuration. Since v67.0. |
| `error` | `error` | JSON | Error details if the job failed. Since v67.0. |
| `plan` | `plan` | JSON (KnowledgeSpaceDeepResearchPlanOutputRepresentation) | Execution plan with steps. Since v67.0. |
| `query` | `query` | VARCHAR | Query text. Since v67.0. |
| `report` | `report` | JSON | Report content. Since v67.0. |
| `research_id` | `researchId` | VARCHAR | Deep research job identifier. Since v67.0. |
| `run_details` | `runDetails` | JSON | Execution details. Since v67.0. |
| `status` | `status` | VARCHAR | Job status. Valid values are PENDING, RUNNING, COMPLETED, FAILED, and CANCELLED. Since v67.0. |

**Notes:** The JSON columns have no schema in the spec. Its examples show `run_details` with `start_time`, `currentStep` and `progress`, and `plan` with `title`, `estimatedDurationMinutes` and `steps`. `report` is an object here, while [`deep_research_report_get`](#deep_research_report_get) returns it as a string.

## knowledge_library_list

`GET /ssot/knowledge-space/library` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Notebook-AI/paths/~1ssot~1knowledge-space~1library/get) · evidence O · read-only

Get all knowledge libraries. Since v65.0.

**Options**

None.

```sql
CALL cdp.knowledge_library_list ();
```

**Result**

One row per item of `/knowledgeSpaceLibraries` in the response. Schema `KnowledgeSpaceLibraryOutputRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `developer_name` | `developerName` | VARCHAR | Developer name of the library. Since v65.0. |
| `knowledge_category` | `knowledgeCategory` | VARCHAR | Knowledge category. Since v65.0. |
| `knowledge_library_id` | `knowledgeLibraryId` | VARCHAR | ID of the library. Since v65.0. |
| `knowledge_space_id` | `knowledgeSpaceId` | VARCHAR | ID of the parent knowledge space. Since v65.0. |
| `knowledge_space_name` | `knowledgeSpaceName` | VARCHAR | Name of the parent knowledge space. Since v65.0. |
| `label` | `label` | VARCHAR | Label of the library. Since v65.0. |
| `sources` | `sources` | JSON (array of KnowledgeSourceOutputRepresentation) | List of knowledge sources in the library. Since v65.0. |

**Notes:** The spec says this gets all knowledge libraries, and it has no space filter. `knowledge_category` values seen in the spec's examples are `PERSONAL` and `ENTERPRISE`, and the spec doesn't list them all. Agentforce Data Libraries (`1JD` IDs) are [a different surface](https://github.com/salesforce-misc/Data360MedTechSolutionKit/blob/main/.claude/skills/notebook-ai/SKILL.md) under `/einstein/data-libraries`.

## knowledge_library_details_get

`GET /ssot/knowledge-space/library/{libraryId}/details` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Notebook-AI/paths/~1ssot~1knowledge-space~1library~1%7BlibraryId%7D~1details/get) · evidence O · read-only

Get detailed information about a specific knowledge library. Since v65.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `library_id` | `libraryId` | path | string | yes | ID of the knowledge library. |

```sql
CALL cdp.knowledge_library_details_get (library_id => '1aQxx00000000JNEAY');
```

**Result**

One row. Schema `KnowledgeSpaceLibraryOutputRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `developer_name` | `developerName` | VARCHAR | Developer name of the library. Since v65.0. |
| `knowledge_category` | `knowledgeCategory` | VARCHAR | Knowledge category. Since v65.0. |
| `knowledge_library_id` | `knowledgeLibraryId` | VARCHAR | ID of the library. Since v65.0. |
| `knowledge_space_id` | `knowledgeSpaceId` | VARCHAR | ID of the parent knowledge space. Since v65.0. |
| `knowledge_space_name` | `knowledgeSpaceName` | VARCHAR | Name of the parent knowledge space. Since v65.0. |
| `label` | `label` | VARCHAR | Label of the library. Since v65.0. |
| `sources` | `sources` | JSON (array of KnowledgeSourceOutputRepresentation) | List of knowledge sources in the library. Since v65.0. |

**Notes:** This returns one row, not a list. Files are nested in the `sources` JSON column.

## knowledge_space_session_get

`GET /ssot/knowledge-space/session/{knowledgeSpaceSessionId}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Notebook-AI/paths/~1ssot~1knowledge-space~1session~1%7BknowledgeSpaceSessionId%7D/get) · evidence O · read-only

Get a knowledge space session. Since v65.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `knowledge_space_session_id` | `knowledgeSpaceSessionId` | path | string | yes | ID of the knowledge space session. |

```sql
CALL cdp.knowledge_space_session_get (knowledge_space_session_id => 'session-123');
```

**Result**

One row. Schema `KnowledgeSpaceSessionOutputRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `agent_type` | `agentType` | VARCHAR | Agent type used when the session was created. Since v65.0. |
| `knowledge_space_def_id` | `knowledgeSpaceDefId` | VARCHAR | Definition ID of the knowledge space. Since v65.0. |
| `knowledge_space_id` | `knowledgeSpaceId` | VARCHAR | ID of the knowledge space. Since v65.0. |
| `knowledge_space_session_entity_id` | `knowledgeSpaceSessionEntityId` | VARCHAR | Entity ID of the knowledge space session. Since v65.0. |
| `last_active_time` | `lastActiveTime` | VARCHAR | Last active time of the session. Since v65.0. |
| `session_id` | `sessionId` | VARCHAR | ID of the knowledge space session. Since v65.0. |

**Notes:** The path has no knowledge space, unlike [`session_conversation_list`](#session_conversation_list), which needs both IDs.

## knowledge_space_update

`PATCH /ssot/knowledge-space/{knowledgeSpaceApiNameOrId}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Notebook-AI/paths/~1ssot~1knowledge-space~1%7BknowledgeSpaceApiNameOrId%7D/patch) · evidence O · changes org state

Update a knowledge space. Since v65.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `knowledge_space_api_name_or_id` | `knowledgeSpaceApiNameOrId` | path | string | yes | API name or ID of the knowledge space. |
| `id` | `id` | body | string |  | ID of the asset. Since v58.0. |
| `name` | `name` | body | string |  | Name of the asset. Since v58.0. |
| `namespace` | `namespace` | body | string |  | Namespace of the asset. Since v58.0. |
| `create_default_library` | `createDefaultLibrary` | body | boolean |  | Indicates whether to create a default library for the knowledge space (`true`) or not (`false`). If unspecified, the default value is `true`. Since v65.0. |
| `dataspace` | `dataSpace` | body | string |  | Name of the data space that the knowledge space belongs to. Since v65.0. |
| `description` | `description` | body | string |  | Description of the knowledge space. Since v65.0. |
| `developer_name` | `developerName` | body | string |  | Developer name of the knowledge space. Since v65.0. |
| `label` | `label` | body | string |  | Label of the knowledge space. Since v65.0. |

```sql
CALL cdp.knowledge_space_update (knowledge_space_api_name_or_id => '1T8xx0000004CYqCAM', label => 'Updated Knowledge Space', description => 'Updated description');
```

**Result**

One row. Schema `KnowledgeSpaceOutputRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `client_context` | `clientContext` | VARCHAR | Client context of the knowledge space. Since v65.0. |
| `dataspace` | `dataSpace` | VARCHAR | Name of the data space that the knowledge space belongs to. Since v65.0. |
| `description` | `description` | VARCHAR | Description of the knowledge space. Since v65.0. |
| `developer_name` | `developerName` | VARCHAR | Developer name of the knowledge space. Since v65.0. |
| `knowledge_space_config_id` | `knowledgeSpaceConfigId` | VARCHAR | ID of the knowledge space configuration. Since v65.0. |
| `knowledge_space_def_id` | `knowledgeSpaceDefId` | VARCHAR | Definition ID of the knowledge space. Since v65.0. |
| `knowledge_space_id` | `knowledgeSpaceId` | VARCHAR | ID of the knowledge space. Since v65.0. |
| `label` | `label` | VARCHAR | Label of the knowledge space. Since v65.0. |
| `libraries` | `libraries` | JSON (array of KnowledgeSpaceLibraryOutputRepresentation) | List of libraries in the knowledge space. Since v65.0. |

**Notes:** This shares its input schema with create, and no source says which fields can change. The spec's example sends only `label` and `description`.

## deep_research_plan_update

`PATCH /ssot/knowledge-space/deep-research/{researchId}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Notebook-AI/paths/~1ssot~1knowledge-space~1deep-research~1%7BresearchId%7D/patch) · evidence O · changes org state

Update the deep research plan (instructions and/or steps) before execution. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `research_id` | `researchId` | path | string | yes | Unique identifier for the deep research job. |
| `id` | `id` | body | string |  | ID of the asset. Since v58.0. |
| `name` | `name` | body | string |  | Name of the asset. Since v58.0. |
| `namespace` | `namespace` | body | string |  | Namespace of the asset. Since v58.0. |
| `edit_instructions` | `editInstructions` | body | string |  | Natural-language instructions for modifying the research plan. Since v67.0. |
| `plan` | `plan` | body | [KnowledgeSpaceDeepResearchPlanPatchPlanInput](#knowledgespacedeepresearchplanpatchplaninputrepresentation) |  | Direct plan update with explicit steps. Since v67.0. |
| `research_template_id` | `researchTemplateId` | body | string |  | ID of the research template to use for the research job. Since v67.0. |

```sql
CALL cdp.deep_research_plan_update (research_id => 'research-abc123', edit_instructions => 'Focus more on recent developments in the last 6 months', plan => (steps = [(title = 'Literature Review', description = 'Review recent publications and research papers'), (title = 'Data Analysis', description = 'Analyze trends and patterns in the collected data')]));
```

**Result**

One row. Schema `KnowledgeSpaceRunResearchOutputRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `config` | `config` | JSON | Deep research configuration. Since v67.0. |
| `error` | `error` | JSON | Error details if the job failed. Since v67.0. |
| `plan` | `plan` | JSON (KnowledgeSpaceDeepResearchPlanOutputRepresentation) | Execution plan with steps. Since v67.0. |
| `query` | `query` | VARCHAR | Query text. Since v67.0. |
| `report` | `report` | JSON | Report content. Since v67.0. |
| `research_id` | `researchId` | VARCHAR | Deep research job identifier. Since v67.0. |
| `run_details` | `runDetails` | JSON | Execution details. Since v67.0. |
| `status` | `status` | VARCHAR | Job status. Valid values are PENDING, RUNNING, COMPLETED, FAILED, and CANCELLED. Since v67.0. |

**Notes:** The spec says this applies before execution, and its response example shows `status` = `PENDING`. It doesn't say what happens after the job starts. Its example sends both `edit_instructions` and `plan`, without saying which one wins. No call in the spec lists research templates, so the source of `research_template_id` is unknown.

## knowledge_library_update

`PATCH /ssot/knowledge-space/library/{id}` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Notebook-AI/paths/~1ssot~1knowledge-space~1library~1%7Bid%7D/patch) · evidence O · changes org state

Update a knowledge library. Since v65.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `id` | `id` | path | string | yes | ID of the knowledge library. |
| `body_id` | `id` | body | string |  | ID of the asset. Since v58.0. |
| `name` | `name` | body | string |  | Name of the asset. Since v58.0. |
| `namespace` | `namespace` | body | string |  | Namespace of the asset. Since v58.0. |
| `description` | `description` | body | string |  | Description of the library. Since v65.0. |
| `developer_name` | `developerName` | body | string |  | Developer name of the library. Since v65.0. |
| `knowledge_library_id` | `knowledgeLibraryId` | body | string |  | Knowledge library ID. Since v65.0. |
| `knowledge_space_id` | `knowledgeSpaceId` | body | string |  | ID of the knowledge space associated with the library. Since v65.0. |
| `label` | `label` | body | string |  | Label of the library. Since v65.0. |

```sql
CALL cdp.knowledge_library_update (id => '1aQxx00000000JNEAY', label => 'Updated Library Name', description => 'Updated description');
```

**Result**

One row. Schema `KnowledgeSpaceLibraryOutputRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `developer_name` | `developerName` | VARCHAR | Developer name of the library. Since v65.0. |
| `knowledge_category` | `knowledgeCategory` | VARCHAR | Knowledge category. Since v65.0. |
| `knowledge_library_id` | `knowledgeLibraryId` | VARCHAR | ID of the library. Since v65.0. |
| `knowledge_space_id` | `knowledgeSpaceId` | VARCHAR | ID of the parent knowledge space. Since v65.0. |
| `knowledge_space_name` | `knowledgeSpaceName` | VARCHAR | Name of the parent knowledge space. Since v65.0. |
| `label` | `label` | VARCHAR | Label of the library. Since v65.0. |
| `sources` | `sources` | JSON (array of KnowledgeSourceOutputRepresentation) | List of knowledge sources in the library. Since v65.0. |
| `description` | `description` | VARCHAR | Not in the spec schema: from the spec's examples. |

**Notes:** The path `id` is the library. `body_id` is the base `id` field that every input inherits, renamed to avoid the clash, and the spec's example doesn't send it.

## knowledge_space_create

`POST /ssot/knowledge-space` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Notebook-AI/paths/~1ssot~1knowledge-space/post) · evidence O · changes org state

Create a knowledge space in the current data space. Since v65.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `id` | `id` | body | string |  | ID of the asset. Since v58.0. |
| `name` | `name` | body | string |  | Name of the asset. Since v58.0. |
| `namespace` | `namespace` | body | string |  | Namespace of the asset. Since v58.0. |
| `create_default_library` | `createDefaultLibrary` | body | boolean |  | Indicates whether to create a default library for the knowledge space (`true`) or not (`false`). If unspecified, the default value is `true`. Since v65.0. |
| `dataspace` | `dataSpace` | body | string |  | Name of the data space that the knowledge space belongs to. Since v65.0. |
| `description` | `description` | body | string |  | Description of the knowledge space. Since v65.0. |
| `developer_name` | `developerName` | body | string |  | Developer name of the knowledge space. Since v65.0. |
| `label` | `label` | body | string |  | Label of the knowledge space. Since v65.0. |

```sql
CALL cdp.knowledge_space_create (label => 'My Knowledge Space', developer_name => 'My_Knowledge_Space', description => 'This is my personal space', dataspace => 'default', create_default_library => true);
```

**Result**

One row. Schema `KnowledgeSpaceOutputRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `client_context` | `clientContext` | VARCHAR | Client context of the knowledge space. Since v65.0. |
| `dataspace` | `dataSpace` | VARCHAR | Name of the data space that the knowledge space belongs to. Since v65.0. |
| `description` | `description` | VARCHAR | Description of the knowledge space. Since v65.0. |
| `developer_name` | `developerName` | VARCHAR | Developer name of the knowledge space. Since v65.0. |
| `knowledge_space_config_id` | `knowledgeSpaceConfigId` | VARCHAR | ID of the knowledge space configuration. Since v65.0. |
| `knowledge_space_def_id` | `knowledgeSpaceDefId` | VARCHAR | Definition ID of the knowledge space. Since v65.0. |
| `knowledge_space_id` | `knowledgeSpaceId` | VARCHAR | ID of the knowledge space. Since v65.0. |
| `label` | `label` | VARCHAR | Label of the knowledge space. Since v65.0. |
| `libraries` | `libraries` | JSON (array of KnowledgeSpaceLibraryOutputRepresentation) | List of libraries in the knowledge space. Since v65.0. |

**Notes:** Everything here is from the [MedTech kit](https://github.com/salesforce-misc/Data360MedTechSolutionKit/blob/main/.claude/skills/notebook-ai/SKILL.md), which ran against its authors' orgs.

**Prerequisites.** Notebook AI must be on. The kit flips it through an undocumented Aura action that [was already renamed once](https://github.com/salesforce-misc/Data360MedTechSolutionKit/blob/main/.claude/skills/notebook-ai/SKILL.md#testing-history), or an admin can use Setup, Feature Manager, Notebook AI. The user needs the system permissions `Create, edit, and delete knowledge spaces` and `Grant users permission to sfDrive`, object access including `DataKnowledgeSpaceDef` and `DataKnowledgeLibrary`, and access to the `Notebook AI Agent`.

**Errors.** `400 INVALID_INPUT: No Knowledge Space Config Found For the DataSpace` means Notebook AI isn't provisioned for that data space. The kit says not to retry.

**Names.** `label` takes 1 to 255 characters. `developer_name` takes letters, digits and underscores, and Salesforce can add a suffix (`Diagnosis` became `Diagnosis_005d200000QTTqr`, one org). So the kit does find-or-create by matching `label`, case-insensitively, through [`knowledge_space_list`](#knowledge_space_list).

The kit says the personal library exists as soon as the space does, and it never sends `create_default_library`. It gives both 200 and 201 as the success status.

## knowledge_space_session_create

`POST /ssot/knowledge-space/{knowledgeSpaceApiNameOrId}/sessions` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Notebook-AI/paths/~1ssot~1knowledge-space~1%7BknowledgeSpaceApiNameOrId%7D~1sessions/post) · evidence O · changes org state

Create a new session for a knowledge space. Since v65.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `knowledge_space_api_name_or_id` | `knowledgeSpaceApiNameOrId` | path | string | yes | API name or ID of the knowledge space. |
| `id` | `id` | body | string |  | ID of the asset. Since v58.0. |
| `name` | `name` | body | string |  | Name of the asset. Since v58.0. |
| `namespace` | `namespace` | body | string |  | Namespace of the asset. Since v58.0. |
| `knowledge_space_id` | `knowledgeSpaceId` | body | string |  | Knowledge space ID. Since v65.0. |
| `last_active_time` | `lastActiveTime` | body | string |  | Last active time of the session. Since v65.0. |
| `session_id` | `sessionId` | body | string |  | Session ID. Since v65.0. |

```sql
CALL cdp.knowledge_space_session_create (knowledge_space_api_name_or_id => '1T8xx0000004CYqCAM', knowledge_space_id => '1T8xx0000004CYqCAM', session_id => 'session-123');
```

**Result**

One row. Schema `KnowledgeSpaceSessionOutputRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `agent_type` | `agentType` | VARCHAR | Agent type used when the session was created. Since v65.0. |
| `knowledge_space_def_id` | `knowledgeSpaceDefId` | VARCHAR | Definition ID of the knowledge space. Since v65.0. |
| `knowledge_space_id` | `knowledgeSpaceId` | VARCHAR | ID of the knowledge space. Since v65.0. |
| `knowledge_space_session_entity_id` | `knowledgeSpaceSessionEntityId` | VARCHAR | Entity ID of the knowledge space session. Since v65.0. |
| `last_active_time` | `lastActiveTime` | VARCHAR | Last active time of the session. Since v65.0. |
| `session_id` | `sessionId` | VARCHAR | ID of the knowledge space session. Since v65.0. |

**Notes:** Sessions aren't needed to upload or index, and the [MedTech kit](https://github.com/salesforce-misc/Data360MedTechSolutionKit/blob/main/.claude/skills/notebook-ai/SKILL.md) doesn't use them. No function in this section sends a prompt to a session. The spec's example repeats `knowledge_space_id` in the body and supplies its own `session_id`, and doesn't say what happens if you leave them out. Its response example shows `agent_type` = `FILE_BASED`.

The kit reports that the system `Notebook AI Agent` can have an inactive `BotVersion` even when Setup shows it as active. No source says whether sessions need it active.

## knowledge_space_configuration_create

`POST /ssot/knowledge-space/config` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Notebook-AI/paths/~1ssot~1knowledge-space~1config/post) · evidence O · changes org state

Create a knowledge space configuration. Since v65.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `id` | `id` | body | string |  | ID of the asset. Since v58.0. |
| `name` | `name` | body | string |  | Name of the asset. Since v58.0. |
| `namespace` | `namespace` | body | string |  | Namespace of the asset. Since v58.0. |
| `dataspace` | `dataspace` | body | string |  | Name of the data space that the knowledge space configuration belongs to. Since v65.0. |
| `developer_name` | `developerName` | body | string |  | Developer name of the configuration. Since v65.0. |
| `knowledge_file_dlo` | `knowledgeFileDlo` | body | string |  | Data lake object (DLO) identifier for the knowledge file source. Since v65.0. |
| `knowledge_file_dmo` | `knowledgeFileDmo` | body | string |  | Data model object (DMO) identifier for the knowledge file source. Since v65.0. |
| `knowledge_file_ref_dmo` | `knowledgeFileRefDmo` | body | string |  | DMO reference for the knowledge file stream. Since v65.0. |
| `knowledge_space_agent` | `knowledgeSpaceAgent` | body | string |  | Knowledge space agent ID. Since v65.0. |
| `knowledge_space_file_based_agent` | `knowledgeSpaceFileBasedAgent` | body | string |  | File-based agent identifier for NotebookAI. Since v65.0. |
| `knowledge_space_index` | `knowledgeSpaceIndex` | body | string |  | Knowledge space search index. Since v65.0. |
| `label` | `label` | body | string |  | Label of the configuration. Since v65.0. |
| `provisioning_status` | `provisioningStatus` | body | string |  | Provisioning status of the knowledge space. Since v65.0. |

```sql
CALL cdp.knowledge_space_configuration_create (developer_name => 'My_Config', label => 'My Configuration', dataspace => 'default');
```

**Result**

One row. Schema `KnowledgeSpaceConfigOutputRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `dataspace` | `dataspace` | VARCHAR | Name of the data space that the knowledge space configuration belongs to. Since v65.0. |
| `developer_name` | `developerName` | VARCHAR | Developer name of the configuration. Since v65.0. |
| `instance_url` | `instanceUrl` | VARCHAR | Instance URL of the org. Since v65.0. |
| `knowledge_file_dlo` | `knowledgeFileDlo` | VARCHAR | Data lake object (DLO) identifier for the knowledge file source. Since v65.0. |
| `knowledge_file_dmo` | `knowledgeFileDmo` | VARCHAR | Data model object (DMO) identifier for the knowledge file source. Since v65.0. |
| `knowledge_file_ref_dmo` | `knowledgeFileRefDmo` | VARCHAR | DMO reference for the knowledge file stream. Since v65.0. |
| `knowledge_space_agent_active_version` | `knowledgeSpaceAgentActiveVersion` | VARCHAR | Active version of the knowledge space agent. Since v65.0. |
| `knowledge_space_agent_id` | `knowledgeSpaceAgentId` | VARCHAR | Knowledge space agent ID. Since v65.0. |
| `knowledge_space_config_id` | `knowledgeSpaceConfigId` | VARCHAR | ID of the knowledge space configuration. Since v65.0. |
| `knowledge_space_file_based_agent` | `knowledgeSpaceFileBasedAgent` | VARCHAR | File-based agent identifier for NotebookAI. Since v65.0. |
| `knowledge_space_index` | `knowledgeSpaceIndex` | VARCHAR | Knowledge space search index. Since v65.0. |
| `knowledge_space_index_id` | `knowledgeSpaceIndexId` | VARCHAR | ID of the knowledge space search index. Since v65.0. |
| `label` | `label` | VARCHAR | Label of the configuration. Since v65.0. |
| `provisioning_status` | `provisioningStatus` | VARCHAR | Provisioning status of the configuration. Since v65.0. |

**Notes:** Sources disagree on whether this is usable. The spec offers this call, while the [MedTech kit](https://github.com/salesforce-misc/Data360MedTechSolutionKit/blob/main/.claude/skills/notebook-ai/SKILL.md) says a skill "CANNOT create the knowledge-space config" and that an admin must enable Notebook AI first. The kit never calls this function.

The option is `dataspace` here and `dataSpace` on knowledge spaces. The input is `knowledge_space_agent`, and the result column is `knowledge_space_agent_id`.

## deep_research_cancel

`POST /ssot/knowledge-space/deep-research/{researchId}/cancel` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Notebook-AI/paths/~1ssot~1knowledge-space~1deep-research~1%7BresearchId%7D~1cancel/post) · evidence O · changes org state

Cancel a running deep research job, optionally requesting a partial report from completed steps. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `research_id` | `researchId` | path | string | yes | Unique identifier for the deep research job to cancel. Since v67.0. |
| `id` | `id` | body | string |  | ID of the asset. Since v58.0. |
| `name` | `name` | body | string |  | Name of the asset. Since v58.0. |
| `namespace` | `namespace` | body | string |  | Namespace of the asset. Since v58.0. |
| `partial_report` | `partialReport` | body | boolean |  | Indicates whether to request a partial report from completed steps (`true`) or not (`false`). Since v67.0. |

```sql
CALL cdp.deep_research_cancel (research_id => 'research-abc123', partial_report => true);
```

**Result**

One row. Schema `KnowledgeSpaceRunResearchOutputRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `config` | `config` | JSON | Deep research configuration. Since v67.0. |
| `error` | `error` | JSON | Error details if the job failed. Since v67.0. |
| `plan` | `plan` | JSON (KnowledgeSpaceDeepResearchPlanOutputRepresentation) | Execution plan with steps. Since v67.0. |
| `query` | `query` | VARCHAR | Query text. Since v67.0. |
| `report` | `report` | JSON | Report content. Since v67.0. |
| `research_id` | `researchId` | VARCHAR | Deep research job identifier. Since v67.0. |
| `run_details` | `runDetails` | JSON | Execution details. Since v67.0. |
| `status` | `status` | VARCHAR | Job status. Valid values are PENDING, RUNNING, COMPLETED, FAILED, and CANCELLED. Since v67.0. |

**Done when:** `status` = `CANCELLED`, in this response or from [`deep_research_status_get`](#deep_research_status_get). The spec's example shows it in this response, and nothing says that's guaranteed.

**Notes:** With `partial_report => true`, the spec's example returns `report` as an object with `summary` and `sections[]`, each section having `title` and `content`.

## deep_research_report_get

`POST /ssot/knowledge-space/deep-research/{researchId}/report` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Notebook-AI/paths/~1ssot~1knowledge-space~1deep-research~1%7BresearchId%7D~1report/post) · evidence O · read-only

Get the deep research report for a research ID. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `research_id` | `researchId` | path | string | yes | Unique identifier for the deep research job. Since v67.0. |
| `id` | `id` | body | string |  | ID of the asset. Since v58.0. |
| `name` | `name` | body | string |  | Name of the asset. Since v58.0. |
| `namespace` | `namespace` | body | string |  | Namespace of the asset. Since v58.0. |
| `output_format` | `outputFormat` | body | string |  | Output format of the deep research report. `markdown` is the only value in the spec's examples. Since v67.0. |

```sql
CALL cdp.deep_research_report_get (research_id => 'research-abc123', output_format => 'markdown');
```

**Result**

One row. Schema `KnowledgeSpaceDeepResReportOutputRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `report` | `report` | VARCHAR | Content of the deep research report. Since v67.0. |
| `research_id` | `researchId` | VARCHAR | Deep research job identifier. Since v67.0. |

**Notes:** This is a read that uses `POST`. `markdown` is the only `output_format` in any source. No source says what this returns before the job is `COMPLETED`.

## deep_research_run

`POST /ssot/knowledge-space/deep-research/{researchId}/run` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Notebook-AI/paths/~1ssot~1knowledge-space~1deep-research~1%7BresearchId%7D~1run/post) · evidence O · changes org state

Run deep research for a research ID. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `research_id` | `researchId` | path | string | yes | The unique identifier for the deep research job. Since v67.0. |

```sql
CALL cdp.deep_research_run (research_id => 'research-abc123');
```

**Result**

One row. Schema `KnowledgeSpaceDeepResRunResearchOutputRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `research_id` | `researchId` | VARCHAR | Deep research job identifier. Since v67.0. |

**Done when:** [`deep_research_status_get`](#deep_research_status_get)`.status` is `COMPLETED`, `FAILED` or `CANCELLED`. `PENDING` and `RUNNING` mean it isn't finished.

**Notes:** This needs an existing `research_id`, and the spec has no call that creates a job. `KnowledgeSpaceRunResearchInputRepresentation` exists in the spec, but no operation uses it, and no source I found says where the ID comes from. The spec's status example estimates 45 minutes for a plan.

## file_status_get

`POST /ssot/knowledge-space/files/status` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Notebook-AI/paths/~1ssot~1knowledge-space~1files~1status/post) · evidence O · read-only

Get the file status of a knowledge space for the specified file IDs. Since v65.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `id` | `id` | body | string |  | ID of the asset. Since v58.0. |
| `name` | `name` | body | string |  | Name of the asset. Since v58.0. |
| `namespace` | `namespace` | body | string |  | Namespace of the asset. Since v58.0. |
| `file_ids` | `fileIds` | body | array of string |  | List of file IDs to retrieve status for. Since v65.0. |
| `knowledge_space_id` | `knowledgeSpaceId` | body | string |  | Knowledge space ID. Since v65.0. |

```sql
CALL cdp.file_status_get (knowledge_space_id => '1T8xx0000004CYqCAM', file_ids => ['1Utxx0000004DJcCAM', '1Utxx0000004DJdCAM']);
```

**Result**

One row per item of `/files` in the response. Schema `KnowledgeSourceFileOutputRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `file_name` | `fileName` | VARCHAR | Name of the file. Since v65.0. |
| `file_path` | `filePath` | VARCHAR | Path of the file. Since v65.0. |
| `file_record_id` | `fileRecordId` | VARCHAR | Record ID of the file. Since v65.0. |
| `file_status` | `fileStatus` | VARCHAR | Status of the file. Since v65.0. |
| `file_type` | `fileType` | VARCHAR | Type of the file. Since v65.0. |
| `job_id` | `jobId` | VARCHAR | Job ID. Since v65.0. |
| `off_core_job_id` | `offCoreJobId` | VARCHAR | Off-core job ID from the search index API call. Since v65.0. |

**Notes:** `file_ids` are `file_record_id` values, going by the spec's example. The [MedTech kit](https://github.com/salesforce-misc/Data360MedTechSolutionKit/blob/main/.claude/skills/notebook-ai/SKILL.md) polls [`knowledge_space_details_get`](#knowledge_space_details_get) instead, so its findings don't cover this call. It reports `file_status` values `INDEXED`, `IN_PROGRESS`, `PROCESSING` and `FAILED`, which the spec doesn't list.

## knowledge_import_get

`POST /ssot/knowledge-space/getKnowledgeForImport` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Notebook-AI/paths/~1ssot~1knowledge-space~1getKnowledgeForImport/post) · evidence O · read-only

Lists the libraries and search indexes that can be imported into a knowledge space, without changing anything. Use it to get the IDs for `knowledge_import`. Since v65.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `id` | `id` | body | string |  | ID of the asset. Since v58.0. |
| `name` | `name` | body | string |  | Name of the asset. Since v58.0. |
| `namespace` | `namespace` | body | string |  | Namespace of the asset. Since v58.0. |
| `dataspace` | `dataSpace` | body | string |  | Name of the data space that the knowledge modal belongs to. Since v65.0. |
| `filter_list` | `filterList` | body | object |  | Knowledge select filters. Since v65.0. |
| `knowledge_space_id` | `knowledgeSpaceId` | body | string |  | Knowledge space ID. Since v65.0. |
| `selected_list` | `selectedList` | body | [KnowledgeModalInput_selectedList](#knowledgemodalinput_selectedlist) |  | List of knowledge select options. Since v65.0. |
| `type` | `type` | body | string |  | Type of knowledge source. Since v65.0. |

```sql
CALL cdp.knowledge_import_get (knowledge_space_id => '1T8xx0000004CYqCAM');
```

**Result**

One row. Schema `KnowledgeModalOutputRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `knowledge_list` | `knowledgeList` | JSON (array of KnowledgeSpaceLibraryOutputRepresentation) | List of knowledge space libraries. Since v65.0. |
| `search_indexes` | `searchIndexes` | JSON (array of SemanticSearchDefDetailRepresentation) | List of semantic search summaries. Since v65.0. |

**Notes:** This is a read that uses `POST`. No source documents `type`, `filter_list` or `selected_list` for this call, and the spec's example sends only `knowledge_space_id`.

## knowledge_import

`POST /ssot/knowledge-space/importKnowledge` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Notebook-AI/paths/~1ssot~1knowledge-space~1importKnowledge/post) · evidence O · changes org state

Import selected knowledge libraries and search indexes into a target knowledge space. Since v65.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `id` | `id` | body | string |  | ID of the asset. Since v58.0. |
| `name` | `name` | body | string |  | Name of the asset. Since v58.0. |
| `namespace` | `namespace` | body | string |  | Namespace of the asset. Since v58.0. |
| `dataspace` | `dataSpace` | body | string |  | Name of the data space that the knowledge modal belongs to. Since v65.0. |
| `filter_list` | `filterList` | body | object |  | Knowledge select filters. Since v65.0. |
| `knowledge_space_id` | `knowledgeSpaceId` | body | string |  | Knowledge space ID. Since v65.0. |
| `selected_list` | `selectedList` | body | [KnowledgeModalInput_selectedList](#knowledgemodalinput_selectedlist) |  | Object with `knowledge_ids` and `search_indexes`, both arrays of strings, from `KnowledgeSelectInputRepresentation`. The spec types it as a plain object. Since v65.0. |
| `type` | `type` | body | string |  | Type of knowledge source. Since v65.0. |

```sql
CALL cdp.knowledge_import (knowledge_space_id => '1T8xx0000004CYqCAM', selected_list => (knowledge_ids = ['1aQxx000000003FEAQ'], search_indexes = ['18lxx0000004C92AAE']));
```

**Result**

One row. Schema `KnowledgeModalOutputRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `knowledge_list` | `knowledgeList` | JSON (array of KnowledgeSpaceLibraryOutputRepresentation) | List of knowledge space libraries. Since v65.0. |
| `search_indexes` | `searchIndexes` | JSON (array of SemanticSearchDefDetailRepresentation) | List of semantic search summaries. Since v65.0. |

**Notes:** In the spec's examples, `knowledge_ids` takes `knowledge_list[].knowledgeLibraryId` and `search_indexes` takes `search_indexes[].id` from [`knowledge_import_get`](#knowledge_import_get). The spec types `selected_list` as a plain object, so completion needs `KnowledgeSelectInputRepresentation` wired in by hand.

## files_index

`POST /ssot/knowledge-space/index-files` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Notebook-AI/paths/~1ssot~1knowledge-space~1index-files/post) · evidence O · changes org state

Starts indexing files already uploaded to a library, or a website URL. It's the last step of the upload flow, after `presigned_urls_get` and the S3 `PUT`. Since v65.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `id` | `id` | body | string |  | ID of the asset. Since v58.0. |
| `name` | `name` | body | string |  | Name of the asset. Since v58.0. |
| `namespace` | `namespace` | body | string |  | Namespace of the asset. Since v58.0. |
| `knowledge_artifact_id` | `knowledgeArtifactId` | body | string |  | ID of the library the files belong to: `knowledge_library_id`, not the knowledge space ID. |
| `knowledge_artifact_source` | `knowledgeArtifactSource` | body | string |  | `FILE_UPLOAD` or `URL`, the two values in the spec's examples. |
| `knowledge_source_files_list` | `knowledgeSourceFilesList` | body | array of [KnowledgeSpaceIndexFilesInput_knowledgeSourceFilesList](#knowledgespaceindexfilesinput_knowledgesourcefileslist) |  | Items take `file_name`, `file_path`, `file_type` and `fileIndexStatus`, from `KnowledgeSourceFileInputRepresentation`. The spec types the items as plain objects. |
| `knowledge_source_id` | `knowledgeSourceId` | body | string |  | Unique identifier of the knowledge source. Applies only to URL sources. Since v65.0. |
| `search_index_api_name` | `searchIndexApiName` | body | string |  | API name of the search index to use for knowledge indexing. Since v65.0. |
| `website_url` | `websiteUrl` | body | string |  | Website URL. Since v65.0. |

```sql
CALL cdp.files_index (knowledge_artifact_id => '1aQxx00000000JNEAY', knowledge_artifact_source => 'FILE_UPLOAD', knowledge_source_files_list => [(file_name = 'report.pdf', file_path = 'collections/1aQxx00000000JNEAY/report.pdf', file_type = 'PDF')]);
```

**Result**

One row. Schema `KnowledgeSpaceIndexFilesOutputRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `knowledge_artifact_id` | `knowledgeArtifactId` | VARCHAR | Unique identifier of the knowledge artifact. Since v65.0. |
| `knowledge_artifact_source` | `knowledgeArtifactSource` | VARCHAR | Source system or origin of the knowledge artifact. Since v65.0. |
| `knowledge_source_files_list` | `knowledgeSourceFilesList` | JSON (array of KnowledgeSourceFileOutputRepresentation) | List of indexed knowledge source files. Since v65.0. |
| `knowledge_source_id` | `knowledgeSourceId` | VARCHAR | Unique identifier of the knowledge source. Since v65.0. |
| `off_core_job_id` | `offCoreJobId` | VARCHAR | Off-core job ID from the search index API call. Since v65.0. |
| `search_index_api_name` | `searchIndexApiName` | VARCHAR | API name of the search index. Since v65.0. |
| `website_url` | `websiteUrl` | VARCHAR | Website URL. Since v65.0. |

**Done when:** [`knowledge_space_details_get`](#knowledge_space_details_get), at `libraries[].sources[].files[].fileStatus`: `INDEXED` or `FAILED`. `IN_PROGRESS` and `PROCESSING` mean it's still running. The [MedTech kit](https://github.com/salesforce-misc/Data360MedTechSolutionKit/blob/main/.claude/skills/notebook-ai/SKILL.md) polls every 10 seconds for about 5 minutes.

**Notes:** **`file_path` conflict.** The [MedTech kit](https://github.com/salesforce-misc/Data360MedTechSolutionKit/blob/main/.claude/skills/notebook-ai/SKILL.md) says it must be `collections/{knowledgeLibraryId}/{fileName}`, "NOT `knowledge_space/collections/...`". The spec's examples use `knowledge_space/collections/library/document.pdf`. The kit's form is the one it ran (one org), so the example above uses it.

**Not safely retryable.** This can take 60 to 180 seconds, and it has returned HTTP 500 after indexing began (one org). After a timeout or 5xx, the kit waits about 5 seconds and reads the file status first. It re-sends only if none of the files appear, and only once, because a re-send can start a duplicate job. It also never sends files that are already `INDEXED` or still running.

**Failures.** `FAILED` means the file never reached S3 or `file_path` is wrong, according to the kit, which stops rather than retrying. Accepted types are PDF, TXT and HTML, and other types fail with `Unsupported file type`. Small files can return `INDEXED` right away.

The URL form (`knowledge_artifact_source => 'URL'` with `website_url`) appears only in the spec's example, and the kit doesn't cover it. No example sends `search_index_api_name`.

For comparison, the [Retail kit](https://github.com/salesforce-misc/Data360AgentforceSolutionKitRetail/blob/main/.claude/skills/intelligent-context/SKILL.md) reports a 30 to 90 second wait between upload and processing for Intelligent Context. That's a different pipeline, and the MedTech kit has no such wait.

## knowledge_library_create

`POST /ssot/knowledge-space/library` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Notebook-AI/paths/~1ssot~1knowledge-space~1library/post) · evidence O · changes org state

Create a knowledge library in an existing knowledge space. Since v65.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `id` | `id` | body | string |  | ID of the asset. Since v58.0. |
| `name` | `name` | body | string |  | Name of the asset. Since v58.0. |
| `namespace` | `namespace` | body | string |  | Namespace of the asset. Since v58.0. |
| `description` | `description` | body | string |  | Description of the library. Since v65.0. |
| `developer_name` | `developerName` | body | string |  | Developer name of the library. Since v65.0. |
| `knowledge_library_id` | `knowledgeLibraryId` | body | string |  | Knowledge library ID. Since v65.0. |
| `knowledge_space_id` | `knowledgeSpaceId` | body | string |  | ID of the knowledge space associated with the library. Since v65.0. |
| `label` | `label` | body | string |  | Label of the library. Since v65.0. |

```sql
CALL cdp.knowledge_library_create (knowledge_space_id => '1T8xx0000004CYqCAM', developer_name => 'My_Library', label => 'My Knowledge Library', description => 'Library for technical documentation');
```

**Result**

One row. Schema `KnowledgeSpaceLibraryOutputRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `developer_name` | `developerName` | VARCHAR | Developer name of the library. Since v65.0. |
| `knowledge_category` | `knowledgeCategory` | VARCHAR | Knowledge category. Since v65.0. |
| `knowledge_library_id` | `knowledgeLibraryId` | VARCHAR | ID of the library. Since v65.0. |
| `knowledge_space_id` | `knowledgeSpaceId` | VARCHAR | ID of the parent knowledge space. Since v65.0. |
| `knowledge_space_name` | `knowledgeSpaceName` | VARCHAR | Name of the parent knowledge space. Since v65.0. |
| `label` | `label` | VARCHAR | Label of the library. Since v65.0. |
| `sources` | `sources` | JSON (array of KnowledgeSourceOutputRepresentation) | List of knowledge sources in the library. Since v65.0. |

**Notes:** You don't need this to upload files. The [MedTech kit](https://github.com/salesforce-misc/Data360MedTechSolutionKit/blob/main/.claude/skills/notebook-ai/SKILL.md) uploads into the personal library that comes with the space.

## knowledge_library_remove

`POST /ssot/knowledge-space/library/remove-library` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Notebook-AI/paths/~1ssot~1knowledge-space~1library~1remove-library/post) · evidence O · changes org state

Remove a knowledge library from a knowledge space. Since v65.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `id` | `id` | body | string |  | ID of the asset. Since v58.0. |
| `name` | `name` | body | string |  | Name of the asset. Since v58.0. |
| `namespace` | `namespace` | body | string |  | Namespace of the asset. Since v58.0. |
| `description` | `description` | body | string |  | Description of the library. Since v65.0. |
| `developer_name` | `developerName` | body | string |  | Developer name of the library. Since v65.0. |
| `knowledge_library_id` | `knowledgeLibraryId` | body | string |  | Knowledge library ID. Since v65.0. |
| `knowledge_space_id` | `knowledgeSpaceId` | body | string |  | ID of the knowledge space associated with the library. Since v65.0. |
| `label` | `label` | body | string |  | Label of the library. Since v65.0. |

```sql
CALL cdp.knowledge_library_remove (knowledge_library_id => '1aQxx00000000G9EAI', knowledge_space_id => '1T8xx0000004CYqCAM');
```

**Result**

One row. Schema `KnowledgeSpaceLibraryOutputRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `developer_name` | `developerName` | VARCHAR | Developer name of the library. Since v65.0. |
| `knowledge_category` | `knowledgeCategory` | VARCHAR | Knowledge category. Since v65.0. |
| `knowledge_library_id` | `knowledgeLibraryId` | VARCHAR | ID of the library. Since v65.0. |
| `knowledge_space_id` | `knowledgeSpaceId` | VARCHAR | ID of the parent knowledge space. Since v65.0. |
| `knowledge_space_name` | `knowledgeSpaceName` | VARCHAR | Name of the parent knowledge space. Since v65.0. |
| `label` | `label` | VARCHAR | Label of the library. Since v65.0. |
| `sources` | `sources` | JSON (array of KnowledgeSourceOutputRepresentation) | List of knowledge sources in the library. Since v65.0. |

**Notes:** The spec says this removes a library from a knowledge space, and its example sends both IDs. No source says whether the library itself survives. The library-to-space link is its own object in the permission list of the [MedTech kit](https://github.com/salesforce-misc/Data360MedTechSolutionKit/blob/main/.claude/skills/notebook-ai/SKILL.md) (`DataKnowledgeSpcLibRel`), so this may only unlink it, but that's my inference.

## knowledge_library_search

`POST /ssot/knowledge-space/library/search` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Notebook-AI/paths/~1ssot~1knowledge-space~1library~1search/post) · evidence O · read-only

Search for a knowledge library. Since v65.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `id` | `id` | body | string |  | ID of the asset. Since v58.0. |
| `name` | `name` | body | string |  | Name of the asset. Since v58.0. |
| `namespace` | `namespace` | body | string |  | Namespace of the asset. Since v58.0. |
| `description` | `description` | body | string |  | Description of the library. Since v65.0. |
| `developer_name` | `developerName` | body | string |  | Developer name of the library. Since v65.0. |
| `knowledge_library_id` | `knowledgeLibraryId` | body | string |  | Knowledge library ID. Since v65.0. |
| `knowledge_space_id` | `knowledgeSpaceId` | body | string |  | ID of the knowledge space associated with the library. Since v65.0. |
| `label` | `label` | body | string |  | Label of the library. Since v65.0. |

```sql
CALL cdp.knowledge_library_search (knowledge_space_id => '1T8xx0000004CYqCAM', developer_name => 'Search_Term');
```

**Result**

One row per item of `/knowledgeSpaceLibraries` in the response. Schema `KnowledgeSpaceLibraryOutputRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `developer_name` | `developerName` | VARCHAR | Developer name of the library. Since v65.0. |
| `knowledge_category` | `knowledgeCategory` | VARCHAR | Knowledge category. Since v65.0. |
| `knowledge_library_id` | `knowledgeLibraryId` | VARCHAR | ID of the library. Since v65.0. |
| `knowledge_space_id` | `knowledgeSpaceId` | VARCHAR | ID of the parent knowledge space. Since v65.0. |
| `knowledge_space_name` | `knowledgeSpaceName` | VARCHAR | Name of the parent knowledge space. Since v65.0. |
| `label` | `label` | VARCHAR | Label of the library. Since v65.0. |
| `sources` | `sources` | JSON (array of KnowledgeSourceOutputRepresentation) | List of knowledge sources in the library. Since v65.0. |

**Notes:** This is a read that uses `POST`. The spec's example searches by `developer_name`, and no source says whether matching is exact or partial, or how the other fields apply.

## presigned_urls_get

`POST /ssot/knowledge-space/presigned-urls` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Notebook-AI/paths/~1ssot~1knowledge-space~1presigned-urls/post) · evidence O · read-only

Gets one S3 upload URL per file name for a library. Use it before the upload, then call `files_index`. Since v65.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `file_names` | `fileNames` | body | array of string |  | List of file names to upload. Since v65.0. |
| `library_id` | `libraryId` | body | string |  | ID of the knowledge space library. Since v65.0. |

```sql
CALL cdp.presigned_urls_get (library_id => '1aQxx00000000JNEAY', file_names => ['document1.pdf', 'document2.pdf']);
```

**Result**

One row. Schema `KnowledgeSpaceUploadPresignedURLOutputRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `presigned_urls` | `presignedUrls` | JSON | List of presigned URLs for uploading to a knowledge library. Since v65.0. |

**Notes:** All of this is from the [MedTech kit](https://github.com/salesforce-misc/Data360MedTechSolutionKit/blob/main/.claude/skills/notebook-ai/SKILL.md).

**Limits.** Five files per call (`Files uploaded cannot be more than: 5`), so batch larger sets. URLs come back in the order of `file_names`. This has returned a transient HTTP 500 (one org). The kit waits 2 seconds and retries once.

**The upload is outside `cdp.*`.** Send the raw bytes with `PUT`, and two details break it. The URLs contain `&amp;`, and leaving it unescaped returns S3 `403 AccessDenied: No AWSAccessKey was presented`. Any extra header, including `Content-Type`, returns `403 SignatureDoesNotMatch`.

**Treat the URLs as credentials.** The kit keeps them out of logs and durable state, and requests new ones rather than computing an expiry, which no source documents. Uploading the same file again overwrites the same key.

The heading marks this read-only, but [sf-pi](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data360/registry/connect-openapi-promotions.json) classes it as `confirmed`, not `safe_post`, and the kit sends it through its write tool.

## knowledge_space_provision

`POST /ssot/knowledge-space/provision` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Notebook-AI/paths/~1ssot~1knowledge-space~1provision/post) · evidence O · changes org state

Provision a knowledge space for the specified data spaces. Since v65.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `id` | `id` | body | string |  | ID of the asset. Since v58.0. |
| `name` | `name` | body | string |  | Name of the asset. Since v58.0. |
| `namespace` | `namespace` | body | string |  | Namespace of the asset. Since v58.0. |
| `dataspaces` | `dataSpaces` | body | array of string |  | List of data space names to provision. Since v65.0. |

```sql
CALL cdp.knowledge_space_provision (dataspaces => ['default', 'analytics']);
```

**Result**

One row. Schema `KnowledgeSpaceProvisionOutputRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `success` | `success` | BOOLEAN | Indicates whether the provisioning request succeeded (`true`) or not (`false`). Since v65.0. |

**Notes:** No source explains how this relates to enabling Notebook AI. The [MedTech kit](https://github.com/salesforce-misc/Data360MedTechSolutionKit/blob/main/.claude/skills/notebook-ai/SKILL.md) never calls it, and it treats provisioning as an admin step. The result is only `success`, and the spec doesn't say whether provisioning continues after the response. [`knowledge_space_configuration_list`](#knowledge_space_configuration_list) has a `provisioning_status` column with undocumented values.

## files_remove

`POST /ssot/knowledge-space/remove-files` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Notebook-AI/paths/~1ssot~1knowledge-space~1remove-files/post) · evidence O · changes org state

Remove files from a knowledge library. Since v65.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `id` | `id` | body | string |  | ID of the asset. Since v58.0. |
| `name` | `name` | body | string |  | Name of the asset. Since v58.0. |
| `namespace` | `namespace` | body | string |  | Namespace of the asset. Since v58.0. |
| `knowledge_artifact_id` | `knowledgeArtifactId` | body | string |  | ID of the library the files belong to: `knowledge_library_id`, not the knowledge space ID. |
| `knowledge_artifact_source` | `knowledgeArtifactSource` | body | string |  | `FILE_UPLOAD` or `URL`, the two values in the spec's examples. |
| `knowledge_source_files_list` | `knowledgeSourceFilesList` | body | array of [KnowledgeSpaceIndexFilesInput_knowledgeSourceFilesList](#knowledgespaceindexfilesinput_knowledgesourcefileslist) |  | Items take `file_name`, `file_path`, `file_type` and `fileIndexStatus`, from `KnowledgeSourceFileInputRepresentation`. The spec types the items as plain objects. |
| `knowledge_source_id` | `knowledgeSourceId` | body | string |  | Unique identifier of the knowledge source. Applies only to URL sources. Since v65.0. |
| `search_index_api_name` | `searchIndexApiName` | body | string |  | API name of the search index to use for knowledge indexing. Since v65.0. |
| `website_url` | `websiteUrl` | body | string |  | Website URL. Since v65.0. |

```sql
CALL cdp.files_remove (knowledge_artifact_id => '1aQxx00000000JNEAY', knowledge_artifact_source => 'FILE_UPLOAD', knowledge_source_files_list => [(file_name = 'old-document.pdf', file_path = 'collections/1aQxx00000000JNEAY/old-document.pdf')]);
```

**Result**

One row. Schema `KnowledgeSpaceIndexFilesOutputRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `knowledge_artifact_id` | `knowledgeArtifactId` | VARCHAR | Unique identifier of the knowledge artifact. Since v65.0. |
| `knowledge_artifact_source` | `knowledgeArtifactSource` | VARCHAR | Source system or origin of the knowledge artifact. Since v65.0. |
| `knowledge_source_files_list` | `knowledgeSourceFilesList` | JSON (array of KnowledgeSourceFileOutputRepresentation) | List of indexed knowledge source files. Since v65.0. |
| `knowledge_source_id` | `knowledgeSourceId` | VARCHAR | Unique identifier of the knowledge source. Since v65.0. |
| `off_core_job_id` | `offCoreJobId` | VARCHAR | Off-core job ID from the search index API call. Since v65.0. |
| `search_index_api_name` | `searchIndexApiName` | VARCHAR | API name of the search index. Since v65.0. |
| `website_url` | `websiteUrl` | VARCHAR | Website URL. Since v65.0. |

**Notes:** The [MedTech kit](https://github.com/salesforce-misc/Data360MedTechSolutionKit/blob/main/.claude/skills/notebook-ai/SKILL.md) covers indexing but not this call, so its `file_path` rule isn't confirmed here. The spec's example uses the `knowledge_space/collections/library/...` form. Copying the `file_path` that [`knowledge_space_details_get`](#knowledge_space_details_get) reports for the file is my suggestion, and no source states it. The spec's response example has an empty `knowledge_source_files_list`, so an empty list doesn't mean nothing was removed.

## deep_research_as_knowledge_source_add

`POST /ssot/knowledge-space/space/{knowledgeSpaceApiNameOrId}/deep-research/source` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Notebook-AI/paths/~1ssot~1knowledge-space~1space~1%7BknowledgeSpaceApiNameOrId%7D~1deep-research~1source/post) · evidence O · changes org state

Copy a completed deep research report into the knowledge space's GENERATED_RESOURCES library and trigger indexing. This causes the research findings to be available for future queries. Since v67.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `knowledge_space_api_name_or_id` | `knowledgeSpaceApiNameOrId` | path | string | yes | API name or ID of the knowledge space. Since v67.0. |
| `id` | `id` | body | string |  | ID of the asset. Since v58.0. |
| `name` | `name` | body | string |  | Name of the asset. Since v58.0. |
| `namespace` | `namespace` | body | string |  | Namespace of the asset. Since v58.0. |
| `file_name` | `fileName` | body | string |  | File name that overrides the default. If unspecified, the default value is the base name of `report_file_path`. Since v67.0. |
| `report_file_path` | `reportFilePath` | body | string |  | Short-lived sfdrive path where the report is stored. Since v67.0. |
| `research_id` | `researchId` | body | string |  | Deep research job identifier, used for logging. Since v67.0. |

```sql
CALL cdp.deep_research_as_knowledge_source_add (knowledge_space_api_name_or_id => '1T8xx0000004CYqCAM', research_id => 'research-abc123', report_file_path => '/sfdrive/temp/research-abc123-report.md', file_name => 'AI_Research_Trends_Report.md');
```

**Result**

One row. Schema `KnowledgeSpaceDeepResearchAddSourceOutputRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `knowledge_source_id` | `knowledgeSourceId` | VARCHAR | ID of the GENERATED_RESOURCES knowledge source in the library. Since v67.0. |
| `knowledge_src_file_ref_id` | `knowledgeSrcFileRefId` | VARCHAR | ID of the knowledge source file reference record. Since v67.0. |
| `persisted_file_path` | `persistedFilePath` | VARCHAR | Persistent sfdrive path of the copied report. Since v67.0. |

**Notes:** No documented call returns `report_file_path`: [`deep_research_report_get`](#deep_research_report_get) returns only `research_id` and the report text. The spec calls the path short-lived, so don't store it for later. The spec says `research_id` is used for logging, which suggests the path decides which report is copied. The spec says this triggers indexing, and no source says how to watch that finish.

## file_chunks_summary_get

`POST /ssot/knowledge-space/summary` · [spec](https://developer.salesforce.com/docs/data/connectapi/references/spec#tag/Notebook-AI/paths/~1ssot~1knowledge-space~1summary/post) · evidence O · read-only

Get all chunks for files in a knowledge space. Since v65.0.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `id` | `id` | body | string |  | ID of the asset. Since v58.0. |
| `name` | `name` | body | string |  | Name of the asset. Since v58.0. |
| `namespace` | `namespace` | body | string |  | Namespace of the asset. Since v58.0. |
| `additional_filter` | `additionalFilter` | body | map to object |  | Additional filter parameters. Since v65.0. |
| `container_id` | `containerId` | body | array of string |  | List of container IDs. Since v65.0. |
| `search_index_name` | `searchIndexName` | body | string |  | Name of the search index. Since v65.0. |

```sql
CALL cdp.file_chunks_summary_get (search_index_name => 'KnowledgeIndex', container_id => ['container-1', 'container-2']);
```

**Result**

One row. Schema `KnowledgeSpaceFileChunksOutputRepresentation`.

| Column | API name | Type | Description |
|---|---|---|---|
| `all_chunks` | `allChunks` | VARCHAR | Content of all chunks. Since v65.0. |
| `file_path` | `filepath` | VARCHAR | File path. Since v65.0. |

**Notes:** The spec doesn't define `container_id` (its example uses `container-1`) or `additional_filter`. It returns one row even though `container_id` is a list, and `all_chunks` is one string with the chunk text run together. The column is `filepath` here and `filePath` elsewhere. Neither kit's skill calls this function.

This isn't the Intelligent Context chunks endpoint. The [Retail kit](https://github.com/salesforce-misc/Data360AgentforceSolutionKitRetail/blob/main/.claude/skills/intelligent-context/SKILL.md) reports that `POST /ssot/intelligent-context/{lens}/chunks` returns `UNKNOWN_EXCEPTION` indefinitely on `{"files":[]}`, and transiently for about the first 90 seconds. This call has no `files` option, and no source shows how it treats an empty `container_id`.

## Schemas

Attribute names are keywords inside the object they belong to, so completion offers exactly these.

### KnowledgeModalInput_selectedList

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `knowledge_ids` | `knowledgeIds` | array |  | Seen in examples: the spec types the parent as a free-form object. |
| `search_indexes` | `searchIndexes` | array |  | Seen in examples: the spec types the parent as a free-form object. |

### KnowledgeSpaceDeepResearchPlanPatchPlanInputRepresentation

Represents the plan payload for deep research plan updates.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `id` | `id` | string |  | ID of the asset. Since v58.0. |
| `name` | `name` | string |  | Name of the asset. Since v58.0. |
| `namespace` | `namespace` | string |  | Namespace of the asset. Since v58.0. |
| `steps` | `steps` | array of [KnowledgeSpaceDeepResearchPlanStepInput](#knowledgespacedeepresearchplanstepinputrepresentation) |  | List of research plan steps to execute. Since v67.0. |

### KnowledgeSpaceDeepResearchPlanStepInputRepresentation

Represents a step in a deep research plan.

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `id` | `id` | string |  | ID of the asset. Since v58.0. |
| `name` | `name` | string |  | Name of the asset. Since v58.0. |
| `namespace` | `namespace` | string |  | Namespace of the asset. Since v58.0. |
| `description` | `description` | string |  | Description of what the step does. Since v67.0. |
| `title` | `title` | string |  | Title or name of the step. Since v67.0. |

### KnowledgeSpaceIndexFilesInput_knowledgeSourceFilesList

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `file_name` | `fileName` | string |  | Seen in examples: the spec types the parent as a free-form object. |
| `file_path` | `filePath` | string |  | Seen in examples: the spec types the parent as a free-form object. |
| `file_type` | `fileType` | string |  | Seen in examples: the spec types the parent as a free-form object. |
