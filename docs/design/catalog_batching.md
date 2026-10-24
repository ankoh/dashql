# Catalog Batching

Catalog loading produces independent SQL sources per connection, typically one relation catalog and one
function catalog. Scanning, parsing and analyzing large generated sources on the browser event loop blocks
the UI, and publishing each source as it finishes could expose a partially refreshed catalog. The batch API
separates preparation from publication:

- A request carries complete source texts instead of coordinating live scripts across threads.
- Preparation runs in a dedicated worker with its own core module and never touches the UI's catalog.
- Results are owned, portable buffers (catalog descriptors), not handles into a core module.
- The app validates all results before it replaces any catalog entry.
- The previous catalog stays published when preparation fails, is cancelled, or becomes obsolete.

The native API is synchronous; the worker provides the asynchronous boundary. A batch processes its scripts
sequentially. Interactive editing, completion and query execution do not use the batch API.

How descriptor entries live in the catalog (layers, versions, `replace_descriptor`, catalog changes) is
described in `core_analysis_catalog.md`.

## Execution Model

```mermaid
sequenceDiagram
    participant UI as App / main core
    participant W as Batch worker / worker core
    UI->>UI: Begin a catalog batch; fetch metadata
    UI->>W: BatchRequest with catalog SQL
    W->>W: Scan / parse / analyze in a fresh catalog
    W-->>UI: Diagnostics and descriptor buffers
    UI->>UI: Check generation, abort signal and results
    loop Each entry
        UI->>UI: Replace the catalog script text
        UI->>UI: Replace its descriptor (one catalog version)
    end
```

## Batch Contract

The TypeScript entry point is `DashQL.processBatch(request)` (`packages/dashql-core-js/src/api.ts`,
`batch.ts`). It calls the wasm-bindgen export `processBatch` (`packages/dashql-core-wasm/src/lib.rs`), which
wraps `dashql_core::batch::process_batch` (`packages/dashql-core/src/batch.rs`). Request and result are
FlatBuffers of `proto/fb/dashql/batch.fbs`.

Each input has a caller-defined string id, SQL text, and a mask of outputs:

| Output | Bit | Contents |
|---|---|---|
| `scanned` | 1 | Scanner result |
| `parsed` | 2 | Parser result |
| `analyzed` | 4 | Analyzer result |
| `catalogDescriptor` | 8 | Portable table, column and function declarations |

- Only the stages needed for the requested outputs run. A descriptor runs the full pipeline without
  returning the intermediate buffers unless requested; a zero mask does no SQL processing. Results preserve
  input order and ids; ids need not be unique at this layer.
- Every call builds a fresh catalog. Optional context descriptors in the request are imported into it as
  `CONNECTION` entries; earlier descriptors win. Inputs are never published, so declarations of one input are
  not visible to another, and successive batches share no catalog state.
- Diagnostics carry stage, severity, byte offset, length and message. SQL errors are diagnostics, not
  failures; errors suppress the descriptor, warnings do not.
- Unknown output bits and descriptor validation failures (`pack_catalog_descriptor` →
  `validate_descriptor`) produce a per-script `failure`; packed stage outputs stay available. A malformed
  request envelope (including invalid UTF-8 text) or context descriptor rejects the whole call.
- TypeScript outputs are copied into fresh `Uint8Array`s that own their bytes independently of Wasm memory.

## Worker

There is one batch worker per main-thread `DashQL` instance (`batch_worker.ts`, `batch_worker_client.ts`,
exported as `@ankoh/dashql-core/browser-worker`).

- `DashQLCoreProvider` initializes the worker during initial core setup when created with
  `initialSetup={{ setupBatchWorker: true }}` (`packages/dashql-app/src/app/providers/core_provider.tsx`). The
  session app enables it; the shell does not. The option is captured at creation.
- `initialize()` warms the module with an empty batch and memoizes readiness. Initialization failure fails
  core setup and disposes the worker.
- The worker caches its core module across requests; only the scripts and the temporary catalog are
  job-local. Jobs are serialized through a promise queue, and output buffers are transferred to the caller.
- A transport error closes the client and rejects pending requests. Catalog batches fail without an
  initialized worker (`getCatalogBatchWorker`); there is no automatic replacement.
- Provider disposal terminates the worker and aborts outstanding publication.

## Application Publication

`packages/dashql-app/src/app/connections/catalog_batch.ts` is the commit boundary. Production callers request
only `catalogDescriptor` outputs.

- `beginCatalogBatch(catalog)` allocates a generation per catalog before metadata is fetched;
  `invalidateCatalogBatch` supersedes it. Stopping a connection invalidates the generation and aborts its
  running catalog tasks (`connection_state.ts`).
- Immediately before commit, `publishCatalogBatch` checks the generation, the abort signal, an optional
  `isCurrent()` connection check, and the core lifetime. It then prechecks every result: count, matching ids,
  failures, error diagnostics, descriptor presence, and `requireFunctions` (a non-empty function catalog).
- Entries are then committed sequentially without an asynchronous gap: `script.replaceText` of the catalog
  script, then `catalog.replaceDescriptor(entryId, CatalogLayer.CONNECTION, bytes)`. If a step fails, only
  that entry's text is restored. Earlier entries stay published and later ones are not attempted, so a
  refresh is atomic per descriptor but not across descriptors.
- Cancellation stops waiting and prevents publication; it does not interrupt a job already running in the
  worker.
- `catalog_loader.tsx` queues forced refreshes behind the running one. Automatic refresh skips connections
  whose catalog was restored (`catalogUpdates.restoredAt`); only a forced refresh replaces it.

## Uses

| Path | Inputs |
|---|---|
| Restoring a connection catalog (`connection_restore.ts`) | Persisted relation and function SQL of `connections/<id>/`; durable connections only. The catalog changes file is applied with `applyCatalogChangesSql`, not batched. |
| Hyper refresh (`hyper/hyper_catalog_update.ts`) | Relations from `pg_attribute` per attached database (or the hyper.cloud catalog query); functions from `pg_proc` for the WASM protocol, otherwise prefetched function SQL. `requireFunctions` is set unless the live `pg_proc` catalog is used. |
| Salesforce refresh (`salesforce/salesforce_catalog_update.ts`) | Metadata-derived relations and prefetched functions |
| Trino refresh (`catalog_query_information_schema.ts`) | Relations from `information_schema` |

`publishCatalogBatchSync` runs the same preparation and commit on the main thread. Its only caller,
`loadPrefetchedHyperFunctions`, is used by tests; `updatePgCatalog` likewise has no production caller.

The live Hyper function query uses `unnest(...) WITH ORDINALITY` and `format_type` over native arrays
(`catalog_query_pg_proc.ts`), because Hyper WASM supports neither `array_to_json` nor casting `oidvector` to
`oid[]`. Hyper exposes incomplete built-in function signatures; missing return types become `any`, and
batching does not reconstruct argument metadata the engine does not expose.

## Tests

- Core: `packages/dashql-core/tests/batch_test.rs`, `catalog_descriptor_test.rs`.
- Core JS: `packages/dashql-core-js/src/batch.test.ts`, `batch_worker_client.test.ts`.
- App: a live Hyper WASM test (`catalog_query_pg_proc.test.ts`) runs the function metadata query, generates
  SQL, prepares a descriptor, imports it and checks completion, which mocked Arrow fixtures cannot establish.

## Main Files

- `proto/fb/dashql/batch.fbs`, `catalog.fbs`: wire contracts.
- `packages/dashql-core/src/batch.rs`: isolated native processing.
- `packages/dashql-core/src/catalog/descriptor.rs`, `catalog/mod.rs`: descriptor validation and publication.
- `packages/dashql-core-js/src/batch.ts`, `api.ts`: API and buffer ownership.
- `packages/dashql-core-js/src/batch_worker.ts`, `batch_worker_client.ts`, `batch_worker_protocol.ts`: worker
  transport.
- `packages/dashql-app/src/app/connections/catalog_batch.ts`: commit boundary.
- `packages/dashql-app/src/app/connections/catalog_loader.tsx`: refresh queue and supersession.
- `packages/dashql-app/src/app/connections/connection_restore.ts`: catalog restoration.
