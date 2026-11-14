# hyperdb-edge stores

Status: drafts for four agent libraries, tested in Bazel against the libraries, their reference stores and their agent
loops; not exported by the package yet.

The state stores of agent libraries on a hot embedded Hyper (`hyperdb-wasm`): an agent keeps its sessions, checkpoints
and memories in one `.hyper` file, and the same file answers analytical SQL over all of them (tool calls per session,
tokens per week, the steps of every thread, the memories that are most alike). The drafts live in
`packages/hyperdb-edge/stores/` and move with hyperdb-edge into a repository of its own.

| Library | Interface | Draft | Checked against |
|---|---|---|---|
| Claude Agent SDK (`@anthropic-ai/claude-agent-sdk` 0.3.323) | `SessionStore` (alpha), `sessionStore` of `query()` | `HyperSessionStore`, `claude_agent_sdk.ts` | `InMemorySessionStore` of the SDK; `importSessionToStore`, `getSessionMessages`, `listSessions` of the SDK |
| OpenAI Agents SDK (`@openai/agents` 0.22.0) | `Session` with `SessionHistoryTransactionAwareSession`, `session` of `run()` | `HyperAgentSession`, `openai_agents.ts` | `MemorySession` of the SDK; `run()` with a fake model over two turns |
| LangGraph.js (`@langchain/langgraph` 1.7.4) | `BaseCheckpointSaver`, `checkpointer` of `compile()` | `HyperCheckpointSaver`, `langgraph_checkpoint.ts` | `@langchain/langgraph-checkpoint-validation` 1.2.1, all of its checks; a graph resumed by a second saver |
| LangGraph.js | `BaseStore` with `IndexConfig` (embeddings), `store` of `compile()` | `HyperStore`, `langgraph_store.ts` | `InMemoryStore` of LangGraph with the same embeddings |
| Mastra (`@mastra/core` 1.83) | `MemoryStorage` domain, `MastraVector` | Not drafted | See [Next](#next) |
| Vercel AI SDK (`ai` 7) | None: an app saves its `UIMessage[]` itself | Not drafted | |

## Why a hot Hyper

The command line tool starts an engine per call (about 0.7 s, 0.85 GB). A store keeps one engine for the process, so a
write costs what the statement costs. Measured on 0.0.27361, Node 24.22, WSL2, entries of about 1 KB:

| Operation | Cost |
|---|---|
| Append of 1 entry, idempotent by uuid, with the redo log | about 5 ms |
| Append of 10 / 100 entries | about 6 ms / about 11 ms |
| Load of a session of 500 entries, a listing over 21,000 entries | about 10 ms |
| First access to the tables of a database file after the start | about 1.3 s, once |

The Claude Agent SDK flushes about every 100 ms, or per frame with `sessionStoreFlush: 'eager'`; both fit.

## The database

`HyperDatabase` (`stores/hyper_database.ts`) opens one `.hyper` file for the process and is shared by all stores:

- **Durability.** Hyper writes an attached database to its file only when it detaches it, so a killed process loses
  everything since the attach. The stores start the engine with `experimental_redo_log`: every commit goes to
  `<file>.dblog` and the next attach replays it. A process killed with `kill -9` after 150 appends kept all 150
  (`HyperSessionStore`). Through the command line tool, appends killed 1.6 s and 2.0 s after the engine started kept
  96 and 187 rows with the redo log and none without it.
- **`experimental_data_type_persistence`**, for the `real[]` columns of the embeddings of `HyperStore`.
- **One engine per file.** `open()` takes the lock file of hyperdb-edge (`<file>.lock`); a second open fails with
  `DatabaseInUseError`, the lock of a process that ended is taken over.
- **One statement at a time.** Calls queue in the order they came; `transaction(body)` runs `BEGIN`, the statements of
  `body` and `COMMIT`, or `ROLLBACK` when one fails. Inside `body`, statements go through the runner it gets.
- **Tables per store** under a prefix (`claude_`, `openai_`, `langgraph_`), created with `CREATE TABLE IF NOT EXISTS`
  on first use, so several stores and several prefixes share a file.

`hyperdb-wasm` takes SQL text only, without parameters, so every value goes in as a literal (`stores/sql.ts`):

- A literal may hold about 1 MiB (1,048,574 characters); a longer text is joined from parts of 2^17 code units with
  `||`. A 20 MB text goes in that way.
- `json` keeps the text as written, duplicate keys and number formats included, so `JSON.parse` of a stored value
  equals what went in. Entries go into `json` columns, and SQL reads them with `->` and `->>`.
- Bytes go in as base64 that `decode(…, 'base64')` turns into `bytea`.
- `LIMIT` and `OFFSET` take a plain integer, not a cast (`count()`).

What Hyper lacks, and how the stores do without it:

| Missing | Instead |
|---|---|
| Primary keys and unique constraints ("Index support is disabled") | `INSERT … SELECT … WHERE NOT EXISTS` in the transaction |
| `ON CONFLICT`, `MERGE` ("MERGE is not supported") | `DELETE` and `INSERT`, or `UPDATE` and an `INSERT` when it changed no row |
| `json_typeof`, `json_build_object`, `to_json`, `jsonb` | The JSON text of a field: `CAST(value->'field' AS text)` is `"x"` for a string, `5` for a number, `null` for null |
| `vector_search`, `hybrid_search`, `keyword_search` (need the search indexes of Data Cloud) | `cosine_similarity` over a scan of `real[]` |

`->>` returns the text `'null'` for a JSON null, not SQL NULL; a missing key gives NULL.

## Claude Agent SDK

`HyperSessionStore` implements every method of `SessionStore`:

- `<prefix>session_entries`: `project_key`, `session_id`, `subpath` (`''` for the main transcript), `seq`, `uuid`,
  `type`, `entry json`, `stored_at`. One row per transcript line.
- `append` stores an entry with a uuid once (retries, `importSessionToStore()`), entries without one every time, and
  folds the summary of a main transcript with `foldSessionSummary` of the SDK in the same transaction
  (`<prefix>session_summaries`, `data` verbatim as the contract asks).
- The mtimes come from one clock and increase strictly, as in the in-memory store of the SDK: `listSessions` and the
  summaries agree.
- Deleting a main transcript deletes its subagent transcripts and its summary; deleting a subpath only that one.

SQL over the transcripts, from the tests:

```sql
WITH assistant AS (
    SELECT session_id, entry->'message' AS message FROM claude_session_entries WHERE type = 'assistant'
)
SELECT c->>'name' AS tool, count(*) AS calls, count(DISTINCT session_id) AS sessions
FROM assistant, json_array_elements(message->'content') AS x(c)
WHERE c->>'type' = 'tool_use'
GROUP BY 1;

SELECT sum(CAST(entry->'message'->'usage'->>'output_tokens' AS bigint)) FROM claude_session_entries WHERE type = 'assistant';
```

## OpenAI Agents SDK

`HyperAgentSession` is one session of a database, as `MemorySession` is one session in memory:
`new HyperAgentSession(database, { sessionId })`.

- `<prefix>session_items`: `session_id`, `seq`, `item json`, `added_at`.
- `getItems(limit)`, `addItems`, `popItem` (in a transaction), `clearSession`.
- `applyHistoryTransaction`: `append_items` and `replace_suffix` in one transaction with the operation id
  (`<prefix>session_operations`); a repeated operation applies nothing, a different transaction under the same id and
  a suffix that no longer matches fail with the errors of `MemorySession`. Transactions compare by JSON with sorted
  keys.
- `applyHistoryMutations` (rewriting a function call) and the compaction capabilities are not implemented; the runner
  falls back without them.

## LangGraph checkpointer

`HyperCheckpointSaver` follows the tables of the Postgres saver:

- `<prefix>checkpoints`: the checkpoint without channel values (`bytea` of the serializer), its metadata, and the
  metadata again as `metadata_json` when the serializer wrote JSON, for SQL over the steps of every thread.
- `<prefix>checkpoint_blobs`: the value of a channel per `(channel, version)`, written only for `newVersions`. An
  unchanged channel is not stored again with every superstep; reads rebuild `channel_values` from `channel_versions`.
- Versions are unique across the branches of a thread (`getNextVersion`): the counter zero-padded to 32 digits and a
  random part, as the Postgres saver makes them. A fork (replaying from an earlier checkpoint) counts up from the
  versions of its checkpoint; with counters alone its blobs took the keys of the other branch and it read that
  branch's values.
- `<prefix>checkpoint_writes`: the pending writes, returned in `writesSortKey` order, also for the sends that
  checkpoints before format 4 migrate.
- `list` with a metadata filter compares deserialized metadata in JS and applies the limit after it.
- `getTuple` and `list` read the writes and the blobs of all their checkpoints with one query each, a join with
  `VALUES`.

## LangGraph store

`HyperStore` takes the `IndexConfig` of LangGraph (`dims`, `embeddings`, `fields`):

- `<prefix>store_items`: `prefix` (the labels joined with `.`, which labels can't contain), `key`, `value json`,
  `created_at`, `updated_at` (an update keeps `created_at`). `<prefix>store_vectors`: an embedding per indexed field,
  `real[]`.
- A batch runs as in `InMemoryStore`: reads see the items before the batch, the puts apply at its end, the last put
  of an item wins, the embeddings of the puts are computed before the transaction. The puts of a batch take five
  statements whatever their number: the creation times of the keys, deleting their embeddings and rows, inserting
  the rows and the embeddings, each with the keys as one `VALUES` list.
- Filters run in SQL: equality as `===` on the JSON text of the field, `$ne`, `$in`, `$nin`, and `$gt`, `$gte`, `$lt`,
  `$lte` on fields with a JSON number.
- A search with a query ranks items by the best `cosine_similarity` of their fields, items without embeddings follow
  without a score. Scores are those of `real`, about 7 digits.
- Deleting an item, or putting it with `index: false`, drops its embeddings. `InMemoryStore` keeps them and still
  scores the old text.

## Tests

Two kinds per store, vitest with globals, each ending with SQL over the stored state:

- **The contract** (`<store>.test.ts`): the store against the reference of its library, the same calls on both.
- **Usage** (`<store>_usage.test.ts`): the agent loop of the library drives the store as an application does, with a
  fake model, a restart (the database closed and opened again) in the middle, and runs at once.

| Usage test | What runs |
|---|---|
| `claude_agent_sdk_usage` | `query()` with Claude Code against a fake Messages API (`stores/testing/fake_anthropic.ts`) and an in-process MCP tool. The store holds what the SDK appended, a prompt larger than a SQL literal included; a session resumes from the store alone, with an empty config folder of Claude Code; three sessions at once. Claude Code writes `api-request*` entries to disk that it doesn't mirror. One MCP server instance serves one query at a time |
| `openai_agents_usage` | `run()` with a function tool over three turns, a tool output of 1.5 MB, a restart before the third turn whose model request carries the whole history; five sessions at once |
| `langgraph_checkpoint_usage` | A graph with LangChain messages: an approval by `interrupt()` in a subgraph resumed after a restart, the approved calls fanned out with `Send`, time travel to the approval and the other branch (`invoke(null, config)` forks; a resume at the old checkpoint reuses its answer, in `MemorySaver` too), ten threads at once |
| `langgraph_store_usage` | A graph that remembers in one thread and recalls in another by meaning; 1,000 memories of 20 users with 384 dimensions, searched with a filter before and after a restart; a self-join of their embeddings in SQL (about 477,000 pairs) |

The libraries are dev dependencies of `packages/hyperdb-edge/package.json`, linked by `npm_link_all_packages` of the
package as `//packages/hyperdb-edge:node_modules/…`. The DashQL packages and the root `package.json` don't depend on
them, and the library and the command of hyperdb-edge don't import them.

| Target | What it runs |
|---|---|
| `//packages/hyperdb-edge:stores_typecheck_test` | The stores and their tests against the types of the libraries (`stores/tsconfig.json`) |
| `//packages/hyperdb-edge:stores_test` | Every test of the stores but the one with Claude Code: 750 tests, the conformance suite of LangGraph for checkpointers among them (`stores/vitest.config.mjs`) |
| `//packages/hyperdb-edge:stores_claude_code_test` | `claude_agent_sdk_usage` with the pinned Claude Code of `//tests/agents:claude`, outside the sandbox of Bazel as the tests in `tests/agents` (`stores/vitest.claude_code.config.mjs`) |

Outside Bazel the Claude Agent SDK runs `CLAUDE_BINARY` when set, its own Claude Code otherwise. The targets share the
copies of the files in `bazel-bin` (`:store_files`, `:typecheck_inputs`): copies of the Claude Code target, which runs
outside the sandbox, would conflict with those of the others.

## Next

- **Mastra.** Its storage has about 30 domains; the agent state is the `MemoryStorage` domain (threads, messages,
  resources; 10 abstract methods with fencing of concurrent writers) and `MastraVector` (indexes, upsert, query with a
  filter language). Both fit the same tables and `cosine_similarity`.
- **Vercel AI SDK.** No store interface to implement: a helper to save and load the `UIMessage[]` of a chat would be
  an API of our own.
- **The engine in a child process.** In the process of the application, the engine prints `LogFile: …` on stdout at
  every start, which breaks a server on stdio such as MCP. The session of hyperdb-edge
  ([hyperdb_edge.md](hyperdb_edge.md#in-process-tools)) runs the engine in a child for that reason; the stores need
  rows from it, not text.
- **Arrow instead of literals** for large batches, as `hyperdb_arrow_insert.ts` of the app does.
- **The package.** Exports for `stores/` and the libraries as optional peer dependencies, once the package moves to
  its own repository.
- **Browser.** The same stores on OPFS in a worker, where hyperdb-wasm runs in DashQL.
