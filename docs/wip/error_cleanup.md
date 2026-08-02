# Error Logging Cleanup

## Goal

Reserve `Error` logs for failures that require immediate user attention. The logger popup overlay should show only errors; warnings should remain visible in the application logs without interrupting the current workflow.

Query execution failures are represented by query state and rendered in the query UI. They should therefore be logged as warnings rather than errors. The same principle applies to connection setup, catalog refresh, background checks, and other operations whose failure is already represented by feature-specific UI state.

## Severity Policy

### Error

Use `Error` when at least one of the following applies:

- The application cannot start or continue meaningfully.
- The user must take action before continuing.
- An explicit user action failed and no inline UI reports the failure.
- Data may be lost, corrupted, or displayed incorrectly.
- The UI reports success or removes an item even though the persistent operation failed.

Errors enter the logger popup overlay and should be rare.

### Warn

Use `Warn` when:

- An operation failed but can be retried.
- Feature-specific UI or state already reports the failure.
- The application safely continues or falls back.
- A background or optional operation failed.
- An internal invariant was violated but there is no useful immediate user action.

Warnings remain available in the logs but do not create popup overlays.

### Info

Use `Info` for:

- Expected cancellation.
- Validation rejection or normal negative outcomes.
- Expected fallback behavior.
- Intermediate retry failures where a later attempt may succeed.

## Popup Behavior

`LoggerToast` should consume only `LogLevel.Error` records. Native Rust logs are imported into the same buffer by `NativeLogger`, so native `log::error!` calls also create popup overlays. Browser `console.error(...)` and Cloud Worker `console_error!` calls do not enter this buffer.

## Recommended Downgrades

### Connection Setup and OAuth

Downgrade these to `Warn` because connection state and settings UI already show the failure and allow retry:

- `packages/dashql-app/src/connection/hyper/hyper_connection_setup.tsx:84`
- `packages/dashql-app/src/connection/trino/trino_connection_setup.ts:92`
- `packages/dashql-app/src/connection/trino/trino_connection_setup.ts:343`
- `packages/dashql-app/src/connection/salesforce/salesforce_connection_setup.ts:322`
- `packages/dashql-app/src/connection/salesforce/salesforce_api_client.ts:198`
- `packages/dashql-app/src/connection/salesforce/salesforce_connection_setup_mock.tsx:150`
- `packages/dashql-app/src/view/connection/trino_connection_settings.tsx:309`
- `packages/dashql-app/src/view/connection/trino_connection_settings.tsx:311`

Some of these currently report the same propagated exception more than once.

### Catalog Refresh

Downgrade these to `Warn`; refresh is recoverable, cancellation may be expected, and the previous catalog remains available:

- `packages/dashql-app/src/connection/catalog_loader.tsx:64`
- `packages/dashql-app/src/connection/catalog_loader.tsx:68`
- `packages/dashql-app/src/connection/catalog_loader.tsx:176`
- `packages/dashql-app/src/connection/catalog_loader.tsx:182`

Cancellation may be better represented as `Info` if it is caused by a newer forced refresh superseding an earlier task.

### Command State Guards

Downgrade these to `Warn`; they are defensive precondition checks or race handling:

- `packages/dashql-app/src/notebook/notebook_commands.tsx:95`
- `packages/dashql-app/src/notebook/notebook_commands.tsx:102`
- `packages/dashql-app/src/notebook/notebook_commands.tsx:135`
- `packages/dashql-app/src/agent/agent_run_provider.tsx:146`

### Query and Computation State

Query execution failures, cancellations, empty results, and result-processing failures should be `Warn` because query state surfaces them in the UI.

Downgrade computation exceptions to `Warn` because query/task state and column visualization already render the failure:

- `packages/dashql-app/src/compute/computation_logic.ts:978`
- `packages/dashql-app/src/compute/computation_logic.ts:1132`

Downgrade unknown DataFrame releases to `Warn`; this is an internal lifecycle diagnostic:

- `packages/dashql-app/src/compute/data_frame.ts:95`

### Session Restoration and Optional Persistence

Downgrade partial restoration failures to `Warn` because loading continues with other sessions and restoration status is represented in the loading UI:

- `packages/dashql-app/src/platform/storage/app_state_loader.ts:429`
- `packages/dashql-app/src/platform/storage/app_state_loader.ts:687`

Downgrade these isolated or recoverable persistence failures:

- `packages/dashql-app/src/view/session_selector_page.tsx:229` - session ordering may revert after restart.
- `packages/dashql-app/src/platform/storage/composite_storage_backend.ts:93` - native filesystem permission restoration can be retried and later produces blocked-session UI.

### Background and Optional Operations

Downgrade update checks to `Warn`; they do not affect the running version:

- `packages/dashql-app/src/platform/version/web_version_check.tsx:130`
- `packages/dashql-app/src/platform/version/native_version_check.tsx:98`

Downgrade query-cache administration failures to `Warn`; query caching is optional and best-effort:

- `packages/dashql-app/src/view/internals/query_cache_view.tsx:93`
- `packages/dashql-app/src/view/internals/query_cache_view.tsx:109`

Downgrade clear-storage diagnostics because the operation already uses a direct alert, or the backend simply does not support the capability:

- `packages/dashql-app/src/view/internals/app_settings_view.tsx:90`
- `packages/dashql-app/src/view/internals/app_settings_view.tsx:110`

### Internal Lifecycle Diagnostics

Downgrade these to `Warn`; they are programming diagnostics without useful immediate user action:

- `packages/dashql-app/src/platform/events/event_listener.ts:140`
- `packages/dashql-app/src/platform/events/event_listener.ts:157`

### Native gRPC

Downgrade native gRPC channel and call failures to `Warn`. The errors propagate to query or connection state, which provides the user-facing result:

- `packages/dashql-native/src/grpc_proxy.rs:65`
- `packages/dashql-native/src/grpc_proxy.rs:292`
- `packages/dashql-native/src/grpc_proxy.rs:321`

Server-stream read failures should also remain `Warn`:

- `packages/dashql-native/src/grpc_stream_manager.rs:139`

## Errors To Keep

### Critical Startup Failures

Keep these as `Error` because the app cannot start or continue meaningfully:

- `packages/dashql-app/src/core_provider.tsx:126` - DashQL core failed to instantiate.
- `packages/dashql-app/src/platform/duckdb/duckdb_provider_native.ts:21` - native DuckDB failed to instantiate.
- `packages/dashql-app/src/platform/duckdb/duckdb_provider_web.ts:51` - web DuckDB failed to instantiate.
- `packages/dashql-app/src/app_loading_logic.ts:125` - required demo connection is disabled.
- `packages/dashql-app/src/connection/dataless/dataless_demo_setup.ts:26` - required demo setup failed.

### Data Loss or Persistence Mismatch

Keep these as `Error` because data may be lost or the UI may imply an operation succeeded when it did not:

- `packages/dashql-app/src/platform/storage/storage_writer.ts:290` - a background write failed and there is no save-failure UI.
- `packages/dashql-app/src/platform/storage/storage_migration_flow.ts:55` - explicit session relocation failed.
- `packages/dashql-app/src/platform/storage/storage_migration_flow.ts:101` - explicit native-session import failed.
- `packages/dashql-app/src/app_loader.tsx:244` - invalid-session deletion failed even though the item is removed from the current selector.

### Explicit Actions Without Inline Failure UI

Keep these as `Error` until the relevant UI has a local failure state:

- `packages/dashql-app/src/utils/clipboard.tsx:38` - clipboard copy failed.
- `packages/dashql-app/src/view/connection/trino_connection_settings.tsx:289` - unavailable connector invoked.
- `packages/dashql-app/src/view/connection/hyper_connection_settings.tsx:148` - unavailable connector invoked.
- `packages/dashql-app/src/view/connection/hyper_docker_settings.tsx:172` - unavailable connector invoked.
- `packages/dashql-app/src/connection/query_executor.tsx:108` - query references a missing connection before query state exists.

The connector cases should eventually be replaced by disabled controls and inline explanations.

### Data Correctness

Keep these as `Error` because an active filter or ordering may silently display incorrect rows:

- `packages/dashql-app/src/view/query_result/data_table.tsx:94`
- `packages/dashql-app/src/view/query_result/data_table.tsx:101`

### Native Event Delivery

Keep these as `Error` because the user-triggered flow can otherwise appear successful while the app never receives the event:

- `packages/dashql-native/src/deep_link.rs:50`
- `packages/dashql-native/src/oauth_callback.rs:245`

## Ambiguous Sites

These require narrower error handling or more context before changing severity:

- `packages/dashql-app/src/core_provider.tsx:91` routes all core `stderr` through `Error`. `stderr` does not necessarily mean user action is required. Prefer explicit severity from core, or default this bridge to `Warn` while keeping thrown initialization failures at `Error`.
- `packages/dashql-app/src/platform/http/native_http_client.ts:211` reports HTTP 200 without a stream ID. This is a serious proxy contract violation, but callers may already surface the failed operation.
- `packages/dashql-app/src/view/demos/prompt_demo.tsx:87` catches both duplicate core setup failure and demo-specific initialization failure. Split the catch by phase before choosing severity.
- `packages/dashql-native/src/oauth_callback.rs:314` handles a failed individual callback connection and is probably a warning.
- `packages/dashql-native/src/oauth_callback.rs:319` handles failure to accept callback connections and may remain an error because OAuth can no longer complete.

## Duplicate Reporting

Prefer one severity-bearing log at the layer with the best structured context. Outer layers should update state or add context without producing another `Error` popup for the same exception.

Known duplicate paths:

- Core initialization logs a structured error and then calls `console.error`.
- Native and web DuckDB initialization log a structured error and call `console.error`; `ComputeConnectionProvider` logs the same rejected setup promise again.
- Catalog update failure logs through the structured logger and `console.error`.
- Trino setup and OAuth failures can be logged by both setup and settings layers.
- Salesforce token exchange can be logged by both the API client and outer OAuth setup.
- Unknown DataFrame release uses both `console.error` and the structured logger.

Browser `console.error` does not create a logger popup, but duplicate console output still makes diagnosis noisier.

## Non-Popup Error Logs

These error mechanisms are not consumed by `LoggerToast`:

- Browser `console.error(...)` calls.
- Cloud Worker `console_error!` calls, including Apple identity verification and neuron accounting.
- Packaging and release process `log::error!` calls.

Their severity should be reviewed for operational correctness, but changing them does not affect the app popup policy.

## Suggested Implementation Order

1. Downgrade connection setup, OAuth, catalog, query, computation, and native gRPC failures that already have UI state.
2. Remove duplicate Error logging across propagated exception layers.
3. Downgrade background checks, cache maintenance, and lifecycle diagnostics.
4. Add local UI failure states for clipboard, connector availability, migration, and deletion where useful.
5. Revisit the ambiguous bridge-level logs after their callers or core severity metadata are better understood.
6. Add focused tests proving warnings do not create `LoggerToast` entries and errors still do.
