<!-- Generated from extensions/d360/clfn/spec/agentic_memory.yaml, edit that and run: bazel run //extensions/d360:update -->

# Agentic Memory & Context

Part of the [CDP function reference](functions.md). Nothing here is implemented or tested against an org. Every result also has the [standard columns](functions.md#result-schema).

Agentic Memory stores what agents and users say, then extracts session summaries, profile facts and preferences from it. Agents read that knowledge back as prompt context. These calls feed a conversation into Data 360, inspect it, curate memories by hand and fetch context for an LLM.

Register the agent first with [`agent_create`](agent_configuration.md#agent_create) and wait until `agent_get.status` is `Active`. [Until then the conversation and context calls return errors](https://developer.salesforce.com/docs/data/agentic-memory-context/guide/agentic-memory-agent-registration.md). Then create a conversation, open a session, add entries, close the session and close the conversation. Closing the session runs the last extraction.

Gotchas:

- **`agent_id` is a header**, [according to the docs](https://developer.salesforce.com/docs/data/agentic-memory-context/references/agentic-memory-context-api-ref/agentic-memory-context-ref-home.md). It's required on conversation calls and [optional on memory calls](https://developer.salesforce.com/docs/data/agentic-memory-context/references/agentic-memory-context-api-ref/agentic-memory-api-memory-apis.md). `memory_context_get` is the exception, with a query parameter and two headers of its own.
- **Reads fail closed.** [Governance](https://developer.salesforce.com/docs/data/agentic-memory-context/guide/agentic-memory-governance.md) filters every read by the `xid` and `aid` claims in the JWT. No match returns no data, and no page says how to get a token with those claims.
- **`memory_create` and `memory_update` send the same verb and path.** See their notes.
- **The host is inferred.** These pages give only paths. The tenant host comes from the [API notes](api_notes.md#hosts-and-tokens).
- **Extraction will cost credits.** It [consumes flex credits once pricing applies, and is free during Limited GA](https://developer.salesforce.com/docs/data/agentic-memory-context/guide/agentic-memory-billing.md).

```sql
CALL cdp.memory_conversation_create (agent_id => 'ACE_Demo_Agent', conversation_id => 'conv-2025-001', conversation_owner_id => '003AB000000XYZ', owner_type => 'individual');
CALL cdp.memory_session_create (agent_id => 'ACE_Demo_Agent', conversation_id => 'conv-2025-001', session_id => 'sess-9001', conversation_owner_id => '003AB000000XYZ', owner_type => 'individual', participants => [(id = '003AB000000XYZ', type = 'individual', role = 'owner'), (id = 'ACE_Demo_Agent', type = 'agent', role = 'participant')]);
CALL cdp.memory_entry_add (agent_id => 'ACE_Demo_Agent', conversation_id => 'conv-2025-001', session_id => 'sess-9001', entries => [(participant_id = '003AB000000XYZ', category = 'Message', type = 'user_message', content = 'How do I reset my password?')]);
CALL cdp.memory_session_close (agent_id => 'ACE_Demo_Agent', conversation_id => 'conv-2025-001', session_id => 'sess-9001');
CALL cdp.memory_context_get (agent_id => 'ACE_Demo_Agent', conversation_id => 'conv-2025-001', ctx_agent_id => 'ACE_Demo_Agent', ctx_dataspace_ds_name => 'default');
```

**Functions:** [`memory_conversation_create`](#memory_conversation_create), [`memory_conversation_list`](#memory_conversation_list), [`memory_conversation_get`](#memory_conversation_get), [`memory_conversation_close`](#memory_conversation_close), [`memory_entry_add`](#memory_entry_add), [`memory_session_create`](#memory_session_create), [`memory_session_list`](#memory_session_list), [`memory_session_close`](#memory_session_close), [`memory_participant_add`](#memory_participant_add), [`memory_create`](#memory_create), [`memory_list`](#memory_list), [`memory_update`](#memory_update), [`memory_delete`](#memory_delete), [`memory_context_get`](#memory_context_get)

## memory_conversation_create

`POST /api/v1/agentic/conversations` · [reference](https://developer.salesforce.com/docs/data/agentic-memory-context/references/agentic-memory-context-api-ref/agentic-memory-api-create-conversation.md) · evidence D · host tenant · changes org state

Create a conversation with an ID you choose and an owner. This is the first call of the ingest flow; sessions and entries go inside it.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `agent_id` | `agent_id` | header | string | yes | Registered agent API name, such as `ACE_Demo_Agent`. |
| `conversation_id` | `conversationId` | body | string | yes | Caller-supplied unique ID for this conversation. |
| `conversation_owner_id` | `conversationOwnerId` | body | string | yes | Individual or User ID of the owner. |
| `owner_type` | `ownerType` | body | enum(individual, employee) | yes | Type of owner. |
| `name` | `name` | body | string |  | Human-readable name. |
| `channel` | `channel` | body | [ConversationChannel](#conversationchannel) |  | Channel the conversation runs on. |
| `variable` | `variable` | body | map to string |  | Arbitrary key-value metadata. |

```sql
CALL cdp.memory_conversation_create (agent_id => 'ACE_Demo_Agent', conversation_id => 'conv-2025-001', conversation_owner_id => '003AB000000XYZ', owner_type => 'individual', name => 'Support, onboarding', channel => (type = 'chat', id = 'slack-C0123'));
```

**Result**

One row, HTTP 201.

| Column | API name | Type | Description |
|---|---|---|---|
| `status_code` | `statusCode` | VARCHAR | Operation status, `created`. |
| `conversation_id` | `conversationId` | VARCHAR | The created conversation's ID. |

**Notes:** The [page](https://developer.salesforce.com/docs/data/agentic-memory-context/references/agentic-memory-context-api-ref/agentic-memory-api-create-conversation.md) lists no 409, so the docs don't say what a duplicate `conversation_id` does.

## memory_conversation_list

`GET /api/v1/agentic/conversations` · [reference](https://developer.salesforce.com/docs/data/agentic-memory-context/references/agentic-memory-context-api-ref/agentic-memory-api-list-conversations.md) · evidence D · host tenant · read-only

List a person's conversations as summary rows, without sessions or entries. Use it to find a `conversation_id`.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `agent_id` | `agent_id` | header | string | yes | Agent identifier. [Requests without it are rejected](https://developer.salesforce.com/docs/data/agentic-memory-context/references/agentic-memory-context-api-ref/agentic-memory-api-conversation-retrieval-apis.md). |
| `owner_id` | `owner_id` | query | string | yes | End user's Individual ID. |
| `owner_type` | `owner_type` | query | string | yes | Owner type, such as `individual`. |
| `status` | `status` | query | string |  | Filter by conversation status. |
| `time_range` | `time_range` | query | string |  | Filter by time range. No page gives the format. |
| `fields` | `fields` | query | array of string |  | Fields to return. Sent as a repeated parameter: `fields=id&fields=name`. |
| `participant_id` | `participant_id` | query | string |  | Filter by participant. |
| `page_token` | `page_token` | query | string |  | `nextPageToken` from the previous page. |

```sql
CALL cdp.memory_conversation_list (agent_id => 'ACE_Demo_Agent', owner_id => '003AB000000XYZ', owner_type => 'individual');
```

**Result**

One row per item of `/conversations` in the response. Other response fields go to `_meta`.

| Column | API name | Type | Description |
|---|---|---|---|
| `id` | `id` | VARCHAR | Conversation ID. |
| `start_time` | `startTime` | TIMESTAMPTZ | When the conversation started. |
| `status` | `status` | VARCHAR | Conversation status, such as `ACTIVE`. |
| `name` | `name` | VARCHAR | Conversation name. |
| `modified_date` | `modifiedDate` | TIMESTAMPTZ | When the conversation last changed. |

**Paging:** `page_token`, from `nextPageToken`. An absent or empty token [ends the list](https://developer.salesforce.com/docs/data/agentic-memory-context/references/agentic-memory-context-api-ref/agentic-memory-api-conversation-retrieval-apis.md).

**Token:** Data 360 JWT. The `xid` and `aid` claims filter the rows, see [Governance](https://developer.salesforce.com/docs/data/agentic-memory-context/guide/agentic-memory-governance.md). A caller sees a conversation only if it's a participant.

**Notes:** No page lists the status values. The examples show `ACTIVE` and `COMPLETED`.

## memory_conversation_get

`GET /api/v1/agentic/conversations/{conversationId}` · [reference](https://developer.salesforce.com/docs/data/agentic-memory-context/references/agentic-memory-context-api-ref/agentic-memory-api-get-conversation-data-graph.md) · evidence D · host tenant · read-only

Read one conversation in full: its sessions, entries and metadata. Use it to inspect what was ingested.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `agent_id` | `agent_id` | header | string | yes | Agent identifier. [Requests without it are rejected](https://developer.salesforce.com/docs/data/agentic-memory-context/references/agentic-memory-context-api-ref/agentic-memory-api-conversation-retrieval-apis.md). |
| `conversation_id` | `conversationId` | path | string | yes | Conversation ID. |
| `owner_id` | `owner_id` | query | string | yes | End user's Individual ID. |
| `session_id` | `session_id` | query | string |  | Limit the result to one session. |
| `participant_id` | `participant_id` | query | string |  | Filter by participant. |
| `owner_type` | `owner_type` | query | string |  | Type of profile. Optional here, unlike the list calls. |
| `scope` | `scope` | query | enum(messages, traces, all) |  | Which entry types to return. |
| `page_token` | `page_token` | query | string |  | `nextPageToken` from the previous page. |

```sql
CALL cdp.memory_conversation_get (agent_id => 'ACE_Demo_Agent', conversation_id => 'conv-2025-001', owner_id => '003AB000000XYZ', scope => 'messages');
```

**Result**

One row. `nextPageToken` goes to `_meta`.

| Column | API name | Type | Description |
|---|---|---|---|
| `conversation_id` | `conversationId` | VARCHAR | Conversation ID. |
| `name` | `name` | VARCHAR | Conversation name. Nullable. |
| `status` | `status` | VARCHAR | Conversation status, such as `COMPLETED`. |
| `start_time` | `startTime` | TIMESTAMPTZ | When the conversation started. |
| `end_time` | `endTime` | TIMESTAMPTZ | When the conversation ended. Nullable. |
| `conversation_owner_id` | `conversationOwnerId` | VARCHAR | Owner ID. |
| `sessions` | `sessions` | JSON | Array of `session_id`, `status`, `start_time`, `end_time` and `entries`. Each entry has `id`, `interaction_id`, `participant_id`, `content`, `type`, `timestamp`, `category` and `variable`. |
| `metadata` | `metadata` | JSON | Conversation metadata. Nullable. |

**Paging:** `page_token`, from `nextPageToken`.

**Token:** Data 360 JWT. The `xid` and `aid` claims filter the data, see [Governance](https://developer.salesforce.com/docs/data/agentic-memory-context/guide/agentic-memory-governance.md).

**Notes:** The [page](https://developer.salesforce.com/docs/data/agentic-memory-context/references/agentic-memory-context-api-ref/agentic-memory-api-get-conversation-data-graph.md) doesn't say how `sessions` splits across pages. [Governance](https://developer.salesforce.com/docs/data/agentic-memory-context/guide/agentic-memory-governance.md) says a failed participant check returns no data, but not whether that's an empty result or the page's 404.

## memory_conversation_close

`POST /api/v1/agentic/conversations/{conversationId}/close` · [reference](https://developer.salesforce.com/docs/data/agentic-memory-context/references/agentic-memory-context-api-ref/agentic-memory-api-close-conversation.md) · evidence D · host tenant · changes org state

Mark a conversation complete across all its sessions. This also closes any sessions still open.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `agent_id` | `agent_id` | header | string | yes | Registered agent API name. |
| `conversation_id` | `conversationId` | path | string | yes | Conversation ID. |

```sql
CALL cdp.memory_conversation_close (agent_id => 'ACE_Demo_Agent', conversation_id => 'conv-2025-001');
```

**Result**

One row, HTTP 202.

| Column | API name | Type | Description |
|---|---|---|---|
| `status_code` | `statusCode` | VARCHAR | Operation status, `closed`. |
| `conversation_id` | `conversationId` | VARCHAR | The closed conversation's ID. |

**Done when:** `memory_conversation_get.status` is `COMPLETED`. That value comes from the page's example; no page lists the values or says when it changes.

**Notes:** Returns HTTP 202. No page gives a signal for when extraction from the closed sessions has finished.

## memory_entry_add

`POST /api/v1/agentic/conversations/{conversationId}/entries` · [reference](https://developer.salesforce.com/docs/data/agentic-memory-context/references/agentic-memory-context-api-ref/agentic-memory-api-add-entries.md) · evidence D · host tenant · changes org state

Send messages and traces to a session, in order. This is the main way data enters the memory pipeline, and several entries can go in one call.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `agent_id` | `agent_id` | header | string | yes | Registered agent API name. |
| `conversation_id` | `conversationId` | path | string | yes | Conversation ID. |
| `session_id` | `sessionId` | body | string | yes | Session that receives the entries. |
| `entries` | `entries` | body | array of [ConversationEntry](#conversationentry) | yes | Ordered entries. At least one. |

```sql
CALL cdp.memory_entry_add (agent_id => 'ACE_Demo_Agent', conversation_id => 'conv-2025-001', session_id => 'sess-9001', entries => [(participant_id = '003AB000000XYZ', category = 'Message', type = 'user_message', content = 'How do I reset my password?'), (participant_id = 'ACE_Demo_Agent', category = 'Trace', type = 'tool_call', variable = (tool = 'kb_search', query = 'password reset'))]);
```

**Result**

One row, HTTP 202.

| Column | API name | Type | Description |
|---|---|---|---|
| `status_code` | `statusCode` | VARCHAR | Operation status, `entriesAdded`. |
| `conversation_id` | `conversationId` | VARCHAR | Parent conversation ID. |
| `session_id` | `sessionId` | VARCHAR | Parent session ID. |

**Notes:** Returns HTTP 202 once storage and indexing are committed. [It doesn't wait for extraction](https://developer.salesforce.com/docs/data/agentic-memory-context/guide/agentic-memory-conversation-management.md). Entries are processed in the order received, so the guide advises sending timestamps. [Extraction runs](https://developer.salesforce.com/docs/data/agentic-memory-context/guide/agentic-memory-summary-generation.md) when unprocessed messages reach about half the LLM context window, after a configurable time, or when the session closes. The page doesn't say what `category` defaults to. It gives no idempotency key, so don't assume a retry is safe.

## memory_session_create

`POST /api/v1/agentic/conversations/{conversationId}/sessions` · [reference](https://developer.salesforce.com/docs/data/agentic-memory-context/references/agentic-memory-context-api-ref/agentic-memory-api-create-session.md) · evidence D · host tenant · changes org state

Open a session inside a conversation, with an ID you choose and at least one participant. A conversation can hold several sessions, for pauses and agent handoffs.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `agent_id` | `agent_id` | header | string | yes | Registered agent API name. |
| `conversation_id` | `conversationId` | path | string | yes | Parent conversation ID. |
| `session_id` | `sessionId` | body | string | yes | Caller-supplied unique ID for this session. |
| `conversation_owner_id` | `conversationOwnerId` | body | string | yes | Individual or User ID. Must align with the parent conversation. |
| `owner_type` | `ownerType` | body | enum(individual, employee) | yes | Type of owner. |
| `participants` | `participants` | body | array of [SessionParticipant](#sessionparticipant) | yes | Initial participants. At least one. |
| `variable` | `variable` | body | map to any |  | Arbitrary metadata. |

```sql
CALL cdp.memory_session_create (agent_id => 'ACE_Demo_Agent', conversation_id => 'conv-2025-001', session_id => 'sess-9001', conversation_owner_id => '003AB000000XYZ', owner_type => 'individual', participants => [(id = '003AB000000XYZ', type = 'individual', role = 'owner', start_time = '2026-01-01T00:00:00Z')]);
```

**Result**

One row, HTTP 201.

| Column | API name | Type | Description |
|---|---|---|---|
| `status_code` | `statusCode` | VARCHAR | Operation status, `created`. |
| `conversation_id` | `conversationId` | VARCHAR | Parent conversation ID. |
| `session_id` | `sessionId` | VARCHAR | The created session's ID. |

**Notes:** `conversation_owner_id` must align with the parent conversation. [Governance](https://developer.salesforce.com/docs/data/agentic-memory-context/guide/agentic-memory-governance.md) limits reads to participants, and when the token has `aid` the agent must be one too, so list the agent here or add it with `memory_participant_add`. For a restricted handoff, [Agent A closes its session and Agent B creates a new one](https://developer.salesforce.com/docs/data/agentic-memory-context/guide/agentic-memory-conversation-management.md). Agent B then sees conversation-level context, not the details of Agent A's session.

## memory_session_list

`GET /api/v1/agentic/conversations/{conversationId}/sessions` · [reference](https://developer.salesforce.com/docs/data/agentic-memory-context/references/agentic-memory-context-api-ref/agentic-memory-api-list-sessions.md) · evidence D · host tenant · read-only

List a conversation's sessions as summary rows, without entries.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `agent_id` | `agent_id` | header | string | yes | Agent identifier. [Requests without it are rejected](https://developer.salesforce.com/docs/data/agentic-memory-context/references/agentic-memory-context-api-ref/agentic-memory-api-conversation-retrieval-apis.md). |
| `conversation_id` | `conversationId` | path | string | yes | Conversation ID. |
| `owner_id` | `owner_id` | query | string | yes | End user's Individual ID. |
| `owner_type` | `owner_type` | query | string | yes | Owner type, such as `individual`. |
| `status` | `status` | query | string |  | Filter by session status. |
| `time_range` | `time_range` | query | string |  | Filter by time range. No page gives the format. |
| `fields` | `fields` | query | array of string |  | Fields to return. Sent as a repeated parameter. |
| `participant_id` | `participant_id` | query | string |  | Filter by participant. |
| `page_token` | `page_token` | query | string |  | `nextPageToken` from the previous page. |

```sql
CALL cdp.memory_session_list (agent_id => 'ACE_Demo_Agent', conversation_id => 'conv-2025-001', owner_id => '003AB000000XYZ', owner_type => 'individual');
```

**Result**

One row per item of `/sessions` in the response. Other response fields go to `_meta`.

| Column | API name | Type | Description |
|---|---|---|---|
| `id` | `id` | VARCHAR | Session ID. |
| `start_time` | `startTime` | TIMESTAMPTZ | When the session started. |
| `status` | `status` | VARCHAR | Session status, such as `ACTIVE` or `COMPLETED`. |

**Paging:** `page_token`, from `nextPageToken`. An absent or empty token [ends the list](https://developer.salesforce.com/docs/data/agentic-memory-context/references/agentic-memory-context-api-ref/agentic-memory-api-conversation-retrieval-apis.md).

**Token:** Data 360 JWT. The `xid` and `aid` claims filter the rows, see [Governance](https://developer.salesforce.com/docs/data/agentic-memory-context/guide/agentic-memory-governance.md).

**Notes:** Session IDs come back as `id` here and as `session_id` in `memory_conversation_get`.

## memory_session_close

`POST /api/v1/agentic/conversations/{conversationId}/sessions/{sessionId}/close` · [reference](https://developer.salesforce.com/docs/data/agentic-memory-context/references/agentic-memory-context-api-ref/agentic-memory-api-close-session.md) · evidence D · host tenant · changes org state

End a session. This triggers a final memory extraction for any messages not yet processed.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `agent_id` | `agent_id` | header | string | yes | Registered agent API name. |
| `conversation_id` | `conversationId` | path | string | yes | Conversation ID. |
| `session_id` | `sessionId` | path | string | yes | Session ID. |

```sql
CALL cdp.memory_session_close (agent_id => 'ACE_Demo_Agent', conversation_id => 'conv-2025-001', session_id => 'sess-9001');
```

**Result**

One row, HTTP 202.

| Column | API name | Type | Description |
|---|---|---|---|
| `status_code` | `statusCode` | VARCHAR | Operation status, `closed`. |
| `conversation_id` | `conversationId` | VARCHAR | Parent conversation ID. |
| `session_id` | `sessionId` | VARCHAR | The closed session's ID. |

**Done when:** `memory_session_list.status` is `COMPLETED`. That value comes from the page's example; no page lists the values or says when it changes.

**Notes:** Returns HTTP 202. No page gives a signal for when extraction has finished. The [guide](https://developer.salesforce.com/docs/data/agentic-memory-context/guide/agentic-memory-about.md) only says memories are available within seconds of extraction, so check with `memory_list`. Extraction [consumes flex credits](https://developer.salesforce.com/docs/data/agentic-memory-context/guide/agentic-memory-summary-generation.md), though the [billing page](https://developer.salesforce.com/docs/data/agentic-memory-context/guide/agentic-memory-billing.md) says it's free during Limited GA.

## memory_participant_add

`POST /api/v1/agentic/conversations/{conversationId}/sessions/{sessionId}/participants` · [reference](https://developer.salesforce.com/docs/data/agentic-memory-context/references/agentic-memory-context-api-ref/agentic-memory-api-add-participants.md) · evidence D · host tenant · changes org state

Add participants to an active session, for agent handoffs or several agents working together.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `agent_id` | `agent_id` | header | string | yes | Registered agent API name. |
| `conversation_id` | `conversationId` | path | string | yes | Conversation ID. |
| `session_id` | `sessionId` | path | string | yes | Session ID. |
| `participants` | `participants` | body | array of [AddedParticipant](#addedparticipant) | yes | Participants to add. At least one. |

```sql
CALL cdp.memory_participant_add (agent_id => 'ACE_Demo_Agent', conversation_id => 'conv-2025-001', session_id => 'sess-9001', participants => [(id = 'Billing_Agent', type = 'agent', role = 'participant')]);
```

**Result**

One row, HTTP 202.

| Column | API name | Type | Description |
|---|---|---|---|
| `status_code` | `statusCode` | VARCHAR | Operation status, `participantsAdded`. |
| `conversation_id` | `conversationId` | VARCHAR | Parent conversation ID. |
| `session_id` | `sessionId` | VARCHAR | Parent session ID. |

**Notes:** The [page](https://developer.salesforce.com/docs/data/agentic-memory-context/references/agentic-memory-context-api-ref/agentic-memory-api-add-participants.md) lists only `id`, `type` and `role`, while the [resource model](https://developer.salesforce.com/docs/data/agentic-memory-context/references/agentic-memory-context-api-ref/agentic-memory-api-conversation-ingest-apis.md) also shows `start_time`, `end_time` and `org_id` on a participant.

## memory_create

`POST /api/v1/agentic/memory` · [reference](https://developer.salesforce.com/docs/data/agentic-memory-context/references/agentic-memory-context-api-ref/agentic-memory-api-create-memories.md) · evidence D · host tenant · changes org state

Add memory entries to a profile by hand, alongside what extraction produces. Each entry gets a system-generated memory ID.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `agent_id` | `agent_id` | header | string |  | Registered agent API name. [Optional, because clients can also call these APIs](https://developer.salesforce.com/docs/data/agentic-memory-context/references/agentic-memory-context-api-ref/agentic-memory-api-memory-apis.md). |
| `profile_id` | `profile_id` | query | string | yes | Individual or User ID. Not derived from authentication. |
| `profile_type` | `profile_type` | query | enum(individual, employee) | yes | Type of profile. |
| `category` | `category` | query | string | yes | Partition key for the entries, such as `sys_PROFILE_FACT`. See the notes. |
| `memories` | `memories` | body | array of [MemoryCreateItem](#memorycreateitem) | yes | Entries to create. At least one. |

```sql
CALL cdp.memory_create (profile_id => '003AB000000XYZ', profile_type => 'individual', category => 'sys_PROFILE_PREFERENCES', memories => [(content = 'Prefers EST scheduling')]);
```

**Result**

One row per item of `/memories` in the response. Other response fields go to `_meta`. `status_code` there is `created`.

| Column | API name | Type | Description |
|---|---|---|---|
| `memory_id` | `memoryId` | VARCHAR | System-generated memory ID. |
| `content` | `content` | VARCHAR | Memory content. |

**Notes:** **Same verb and path as `memory_update`.** The [Create](https://developer.salesforce.com/docs/data/agentic-memory-context/references/agentic-memory-context-api-ref/agentic-memory-api-create-memories.md) and [Update](https://developer.salesforce.com/docs/data/agentic-memory-context/references/agentic-memory-context-api-ref/agentic-memory-api-update-memories.md) pages both give `POST /api/v1/agentic/memory`, with the same query parameters. It may not be a typo: the [Memory APIs overview](https://developer.salesforce.com/docs/data/agentic-memory-context/references/agentic-memory-context-api-ref/agentic-memory-api-memory-apis.md) names only `POST` and `DELETE` as write methods and says only the body differs. The documented difference is `memory_id` on each entry, but no page says the server uses it to choose. `status_code` in the response shows which one ran.

**`category` spelling conflicts.** The overview uses `sys_PROFILE_FACT` and `sys_PROFILE_PREFERENCES` and says custom categories have no prefix. This page's example is `PROFILE_FACT`, which by the overview's rule would be a custom category.

[A write cancels any active extraction batch for that scope](https://developer.salesforce.com/docs/data/agentic-memory-context/guide/agentic-memory-memory-management.md), and extraction re-runs on its next cycle. You can't create conversation-scoped memories. Entries are tagged with author type `USER_API`. No idempotency key is documented, so don't assume a retry is safe.

## memory_list

`GET /api/v1/agentic/memory` · [reference](https://developer.salesforce.com/docs/data/agentic-memory-context/references/agentic-memory-context-api-ref/agentic-memory-api-read-memories.md) · evidence D · host tenant · read-only

Read a profile's memory entries in one category. Use it to see what extraction or manual curation has stored.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `agent_id` | `agent_id` | header | string |  | Registered agent API name. [Optional, because clients can also call these APIs](https://developer.salesforce.com/docs/data/agentic-memory-context/references/agentic-memory-context-api-ref/agentic-memory-api-memory-apis.md). |
| `profile_id` | `profile_id` | query | string | yes | Individual or User ID. Not derived from authentication. |
| `profile_type` | `profile_type` | query | enum(individual, employee) | yes | Type of profile. |
| `category` | `category` | query | string | yes | Partition key that filters the entries, such as `sys_PROFILE_FACT`. |

```sql
CALL cdp.memory_list (profile_id => '003AB000000XYZ', profile_type => 'individual', category => 'sys_PROFILE_FACT');
```

**Result**

One row per item of `/memories` in the response. Other response fields go to `_meta`.

| Column | API name | Type | Description |
|---|---|---|---|
| `memory_id` | `memoryId` | VARCHAR | Memory ID. |
| `content` | `content` | VARCHAR | Memory content. |

**Token:** Data 360 JWT. [Governance](https://developer.salesforce.com/docs/data/agentic-memory-context/guide/agentic-memory-governance.md) scopes curated memory to the customer in the `xid` claim, and any agent serving that customer can read it.

**Notes:** The [page](https://developer.salesforce.com/docs/data/agentic-memory-context/references/agentic-memory-context-api-ref/agentic-memory-api-read-memories.md) documents no paging. The [Memory Management guide](https://developer.salesforce.com/docs/data/agentic-memory-context/guide/agentic-memory-memory-management.md) describes a "unified flag" that merges memories across a unified individual and adds the source individual ID to each entry. The reference lists no such parameter or field, so it isn't an option here; a returned source ID would land in `_raw`. See `memory_create` for the `category` spelling conflict.

## memory_update

`POST /api/v1/agentic/memory` · [reference](https://developer.salesforce.com/docs/data/agentic-memory-context/references/agentic-memory-context-api-ref/agentic-memory-api-update-memories.md) · evidence D · host tenant · changes org state

Replace the content of existing memory entries, each identified by its memory ID.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `agent_id` | `agent_id` | header | string |  | Registered agent API name. [Optional, because clients can also call these APIs](https://developer.salesforce.com/docs/data/agentic-memory-context/references/agentic-memory-context-api-ref/agentic-memory-api-memory-apis.md). |
| `profile_id` | `profile_id` | query | string | yes | Individual or User ID. Not derived from authentication. |
| `profile_type` | `profile_type` | query | enum(individual, employee) | yes | Type of profile. |
| `category` | `category` | query | string | yes | Partition key for the entries, such as `sys_PROFILE_FACT`. |
| `memories` | `memories` | body | array of [MemoryUpdateItem](#memoryupdateitem) | yes | Entries to update. At least one. |

```sql
CALL cdp.memory_update (profile_id => '003AB000000XYZ', profile_type => 'individual', category => 'sys_PROFILE_PREFERENCES', memories => [(memory_id = 'mem_abc123', content = 'Prefers PST scheduling')]);
```

**Result**

One row per item of `/memories` in the response. Other response fields go to `_meta`. `status_code` there is `updated`.

| Column | API name | Type | Description |
|---|---|---|---|
| `memory_id` | `memoryId` | VARCHAR | Memory ID. |
| `content` | `content` | VARCHAR | Updated content. |

**Notes:** **Same verb and path as `memory_create`.** See its notes. `memory_id` on each entry is the only documented difference in the request.

**The memory ID may change.** The [page](https://developer.salesforce.com/docs/data/agentic-memory-context/references/agentic-memory-context-api-ref/agentic-memory-api-update-memories.md) says an update generates a new memory ID and deactivates the old record, yet its example response returns the same ID. Take the ID from the result rather than keeping the old one.

The [Memory Management guide](https://developer.salesforce.com/docs/data/agentic-memory-context/guide/agentic-memory-memory-management.md) says expired entries can be recovered by updating `validTo`, but this page's body has no such field.

## memory_delete

`DELETE /api/v1/agentic/memory` · [reference](https://developer.salesforce.com/docs/data/agentic-memory-context/references/agentic-memory-context-api-ref/agentic-memory-api-delete-memories.md) · evidence D · host tenant · changes org state

Delete memory entries by memory ID. Deletion is permanent.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `agent_id` | `agent_id` | header | string |  | Registered agent API name. [Optional, because clients can also call these APIs](https://developer.salesforce.com/docs/data/agentic-memory-context/references/agentic-memory-context-api-ref/agentic-memory-api-memory-apis.md). |
| `profile_id` | `profile_id` | query | string | yes | Individual or User ID. Not derived from authentication. |
| `profile_type` | `profile_type` | query | enum(individual, employee) | yes | Type of profile. |
| `category` | `category` | query | string | yes | Partition key for the entries, such as `sys_PROFILE_FACT`. |
| `memories` | `memories` | body | array of [MemoryDeleteItem](#memorydeleteitem) | yes | Entries to delete. At least one. |

```sql
CALL cdp.memory_delete (profile_id => '003AB000000XYZ', profile_type => 'individual', category => 'sys_PROFILE_PREFERENCES', memories => [(memory_id = 'mem_abc123')]);
```

**Result**

One row per item of `/memories` in the response. Other response fields go to `_meta`. `status_code` there is `deleted`.

| Column | API name | Type | Description |
|---|---|---|---|
| `memory_id` | `memoryId` | VARCHAR | The deleted entry's ID. |
| `content` | `content` | VARCHAR | Empty for deleted entries. |

**Notes:** This `DELETE` carries a JSON body. The `category` and profile options are required even though each entry is identified by `memory_id`.

## memory_context_get

`GET /api/v1/agentic/context` · [reference](https://developer.salesforce.com/docs/data/agentic-memory-context/references/agentic-memory-context-api-ref/agentic-memory-api-get-context.md) · evidence D · host tenant · read-only

Assemble context for an agent turn from memories, conversation history, profile data and any additional data graphs, as text ready for an LLM prompt.

**Options**

| Option | API name | In | Type | Required | Description |
|---|---|---|---|---|---|
| `agent_id` | `agent_id` | query | string | yes | Agent identifier, the registered API name. A query parameter on this call only. |
| `conversation_id` | `conversation_id` | query | string | yes | Conversation to read messages and summaries from. |
| `owner_id` | `owner_id` | query | string |  | Individual or User ID. Requires `owner_type`. |
| `owner_type` | `owner_type` | query | enum(individual, employee) |  | Type of owner. Required when `owner_id` is set. |
| `mode` | `mode` | query | enum(fast) |  | Retrieval mode. `fast` returns pre-indexed context and is the default. |
| `latency_sensitivity` | `latency_sensitivity` | query | enum(low, medium, high) |  | Doesn't apply in `fast` mode. |
| `token_budget` | `token_budget` | query | integer |  | Maximum tokens in the response. Doesn't apply in `fast` mode. |
| `ctx_agent_id` | `ctx_agent_id` | header | string | yes | Sent as header `ctx-agent-id`. API name of the registered agent, such as `ACE_Demo_Agent`. |
| `ctx_dataspace_ds_name` | `ctx_dataspace_ds_name` | header | string | yes | Sent as header `ctx-dataspace-ds_name`. Data space the agent belongs to, such as `default`. |

```sql
CALL cdp.memory_context_get (agent_id => 'ACE_Demo_Agent', conversation_id => 'conv-2025-001', owner_id => '003AB000000XYZ', owner_type => 'individual', ctx_agent_id => 'ACE_Demo_Agent', ctx_dataspace_ds_name => 'default');
```

**Result**

One row per item of `/userContext` in the response. Other response fields go to `_meta`: `contextId` for tracing, `sessionId` and `createdAt`.

| Column | API name | Type | Description |
|---|---|---|---|
| `entry` | `entry` | VARCHAR | Context text. |
| `source_type` | `sourceType` | VARCHAR | Where the entry came from: `Profile`, `Conversation`, or another data graph's name. |

**Token:** Data 360 JWT. The `xid` and `aid` claims filter the data, see [Governance](https://developer.salesforce.com/docs/data/agentic-memory-context/guide/agentic-memory-governance.md).

**Notes:** **Agent ID appears twice.** The [page](https://developer.salesforce.com/docs/data/agentic-memory-context/references/agentic-memory-context-api-ref/agentic-memory-api-get-context.md) requires both the `agent_id` query parameter and the `ctx-agent-id` header. It also requires `ctx-dataspace-ds_name`, while the [Context API overview](https://developer.salesforce.com/docs/data/agentic-memory-context/references/agentic-memory-context-api-ref/agentic-memory-api-context-api.md) says `agent_id` resolves the data space.

**Tuning options do nothing today.** `fast` is the only mode and the default, and `latency_sensitivity` and `token_budget` don't apply to it. The page also mentions a `query` parameter that isn't in its parameter table, so it isn't an option here.

**Sources disagree on agent scope.** [Fast Mode](https://developer.salesforce.com/docs/data/agentic-memory-context/guide/agentic-memory-fast-mode.md) says the response excludes memories extracted by other agents. [Governance](https://developer.salesforce.com/docs/data/agentic-memory-context/guide/agentic-memory-governance.md) says facts and preferences are available to any agent serving the customer.

The reference marks `owner_id` optional, but Fast Mode uses it for the profile lookup. An empty `userContext` gives no rows. If an additional data graph is unavailable, [the response carries a warning in its metadata](https://developer.salesforce.com/docs/data/agentic-memory-context/guide/agentic-memory-agent-registration.md), which the response schema doesn't show. Fast mode [uses no flex credits for assembly](https://developer.salesforce.com/docs/data/agentic-memory-context/guide/agentic-memory-fast-mode.md).

## Schemas

Attribute names are keywords inside the object they belong to, so completion offers exactly these.

### AddedParticipant

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `id` | `id` | string | yes | The agent's registered API name, an Individual ID or a User ID, depending on `type`. |
| `type` | `type` | string | yes | `individual`, `employee`, `agent`, or a free-form string. |
| `role` | `role` | enum(owner, participant) | yes | Role in the session. |

### ConversationChannel

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `type` | `type` | enum(web, chat, voice, sms, email, other) |  | Channel type. |
| `id` | `id` | string |  | Channel identifier, such as `slack-C0123`. |

### ConversationEntry

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `id` | `id` | string |  | Entry ID. Server-generated if omitted. |
| `interaction_id` | `interactionId` | string |  | Groups related entries, such as a tool call and its result. |
| `participant_id` | `participantId` | string | yes | Author of the entry. |
| `content` | `content` | string |  | Required for the `Message` category. Not used for `Trace`. |
| `type` | `type` | enum(user_message, agent_response, agent_reasoning, tool_call, tool_result) |  | The first two go with `Message`, the other three with `Trace`. |
| `role` | `role` | string |  | Role of the participant. |
| `timestamp` | `timestamp` | string (date-time) |  | Entry time. The server stamps it if omitted. |
| `category` | `category` | enum(Message, Trace, Entry) |  | `Message` is human-readable, `Trace` is agent reasoning and tools, `Entry` is anything else. |
| `attachments` | `attachments` | array of [EntryAttachment](#entryattachment) |  | Attachments. |
| `variable` | `variable` | map to any |  | Free-form payload. `Trace` entries carry their tool call data here. |

### EntryAttachment

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `content_type` | `contentType` | string |  | - |
| `content_url` | `contentUrl` | string |  | - |

### MemoryCreateItem

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `content` | `content` | string | yes | Memory content. |

### MemoryDeleteItem

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `memory_id` | `memoryId` | string | yes | Entry to delete. |

### MemoryUpdateItem

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `memory_id` | `memoryId` | string | yes | Entry to update. |
| `content` | `content` | string | yes | New content. |

### SessionParticipant

| Attribute | API name | Type | Required | Description |
|---|---|---|---|---|
| `id` | `id` | string | yes | Participant ID. |
| `type` | `type` | string | yes | `individual`, `employee`, `agent`, or a free-form string. |
| `role` | `role` | enum(owner, participant) | yes | Role in the session. |
| `start_time` | `startTime` | string (date-time) |  | Join time. |
| `end_time` | `endTime` | string (date-time) |  | Leave time. Null means still active. |
| `org_id` | `orgId` | string |  | Organization ID, for cross-org handoffs. |
