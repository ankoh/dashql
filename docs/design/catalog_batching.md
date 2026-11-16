# Catalog Batching

A batch turns SQL text into catalog descriptors. Connections need that for the SQL they have: the file with their relations
when a connection is restored, and their functions, which come as SQL. The relations that a refresh reads are no SQL, they
become descriptors directly (see `catalog_updates.md`). The batch API separates preparation from publication:

- A request carries complete source texts instead of coordinating live scripts.
- Preparation runs on a catalog of its own and never touches the catalog it publishes into.
- Results are owned, portable buffers (catalog descriptors), not handles into a core module.
- The loader validates all results before it replaces any catalog entry.
- The previous catalog stays published when preparation fails, is cancelled, or becomes obsolete.

The native API is synchronous. A batch processes its scripts sequentially. Interactive editing, completion and query
execution do not use the batch API.

How descriptor entries live in the catalog (layers, versions, `replace_descriptor`, the relations of executed statements) is
described in `core_analysis_catalog.md`.

## Execution Model

```mermaid
sequenceDiagram
    participant L as Catalog loader (core module)
    participant B as Batch (own catalog)
    L->>L: Begin a catalog batch; fetch metadata
    L->>B: BatchRequest with catalog SQL
    B->>B: Scan / parse / analyze in a fresh catalog
    B-->>L: Diagnostics and descriptor buffers
    L->>L: Check generation, cancellation and results
    loop Each entry
        L->>L: Replace its descriptor (one catalog version)
    end
    L->>L: Replace the text of the function script
```

## Batch Contract

The TypeScript entry point is `DashQL.processBatch(request)` (`packages/dashql/src/core/api.ts`,
`batch.ts`). It calls the wasm-bindgen export `processBatch` (`packages/dashql-core-wasm/src/lib.rs`), which
wraps `dashql_core_script::batch::process_batch` (`packages/dashql-core-script/src/batch.rs`). Request and result are
FlatBuffers of `proto/fb/dashql/batch.fbs`.

Each input has a caller-defined string id, SQL text, and a mask of outputs:

| Output | Bit | Contents |
|---|---|---|
| `scanned` | 1 | Scanner result |
| `parsed` | 2 | Parser result |
| `analyzed` | 4 | Analyzer result |
| `catalogDescriptor` | 8 | Portable table, column and function declarations, with the location of each declaration in the input text |

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

The core package has a batch worker per main-thread `DashQL` instance (`batch_worker.ts`, `batch_worker_client.ts`,
exported as `@akohn/dashql/browser-worker`) for integrations that parse large files off the event loop. The app
doesn't start it: the catalog loader and the restore of the runtime parse their batches in the core module.

- `initialize()` warms the module with an empty batch and memoizes readiness.
- The worker caches its core module across requests; only the scripts and the temporary catalog are
  job-local. Jobs are serialized through a promise queue, and output buffers are transferred to the caller.
- A transport error closes the client and rejects pending requests.

## Publication

The catalog loader of the runtime publishes the batches of an update (`catalog_loader/batch.rs` and
`catalog_loader/service.rs` of `dashql_core_runtime`). Production callers request only `catalogDescriptor` outputs.

- An update begins a generation of the catalog (`CatalogGenerations::begin`) before it fetches metadata, a newer update
  of the catalog supersedes it.
- The batch of an update parses in the module (`CatalogBatch::process`), on a catalog of its own, between two steps of
  the update.
- Immediately before publication the update checks its generation and its cancellation, and the loader checks that the
  connection still runs the update. A reset or a delete of the connection aborts its updates. Then every result is
  prechecked: count, matching ids, failures, error diagnostics, descriptor presence, and `require_functions` (a
  non-empty function catalog).
- Entries are then published in order without an asynchronous gap (`publish_prepared`). A failure stops the
  publication, earlier entries stay published and later ones are not attempted, so a refresh is atomic per descriptor
  but not across descriptors. The text of the function script is replaced once its descriptor is published.
- A forced refresh aborts the running update of the connection. An automatic refresh only describes a connection that
  nothing describes yet (`CatalogUpdates::described`); only a forced refresh replaces a catalog.

## Uses

| Path | Inputs |
|---|---|
| Restoring a connection catalog (`restore/catalog.rs` of `dashql_core_runtime`) | Persisted relation and function SQL of `connections/<id>/`; durable connections only (`publish_catalog_batch_sync`). |
| Hyper refresh (`catalog_loader/hyper.rs`) | Functions from `pg_proc` for the WASM protocol, otherwise the bundled function SQL. `require_functions` is set unless the live `pg_proc` catalog is used. |
| Salesforce refresh (`catalog_loader/salesforce.rs`) | The bundled functions |

The functions of a refresh are published first. Its relations follow without a batch, a failure leaves them as they were.

The live Hyper function query uses `unnest(...) WITH ORDINALITY` and `format_type` over native arrays
(`catalog_loader/pg_proc.rs`), because Hyper WASM supports neither `array_to_json` nor casting `oidvector` to
`oid[]`. Hyper exposes incomplete built-in function signatures; missing return types become `any`, and
batching does not reconstruct argument metadata the engine does not expose.

## Tests

- Core: `packages/dashql-core-script/tests/batch_test.rs`, `packages/dashql-core/tests/catalog_descriptor_test.rs`.
- Core JS: `packages/dashql/src/core/batch.test.ts`, `batch_worker_client.test.ts`.
- Runtime: `packages/dashql-core-runtime/tests/catalog_loader_test.rs` (the updates and their batches) and
  `catalog_loader_service_test.rs` (the loader on a host). `catalog_updates.integration.test.ts` of
  `packages/dashql/src/runtime` runs lookups through the loader on the embedded Hyper.

## Main Files

- `proto/fb/dashql/batch.fbs`, `catalog.fbs`: wire contracts.
- `packages/dashql-core-script/src/batch.rs`: isolated native processing.
- `packages/dashql-core/src/catalog/descriptor.rs`, `catalog/mod.rs`: descriptor validation and publication.
- `packages/dashql/src/core/batch.ts`, `api.ts`: API and buffer ownership.
- `packages/dashql/src/core/batch_worker.ts`, `batch_worker_client.ts`, `batch_worker_protocol.ts`: worker
  transport.
- `packages/dashql-core-runtime/src/catalog_loader/batch.rs`: batches, generations and publication.
- `packages/dashql-core-runtime/src/catalog_loader/service.rs`: refresh queue, supersession and the updates.
- `packages/dashql-core-runtime/src/restore/catalog.rs`: catalog restoration.
