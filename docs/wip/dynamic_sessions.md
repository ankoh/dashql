# WIP: Dynamic sessions — why adding a folder reloads the app

## Symptom / question

Adding a pre-existing session from a folder on disk (native app, "Open an existing
session folder") triggers a **full page reload**. Relocating an OPFS session to a native
folder does the same. This looks heavy-handed — why not just splice the new session into
the running app?

## Short answer

It's deliberate, not a bug. Registering a folder and *hydrating a live session into the
running app* are two different jobs, and only the second one is hard. Rather than duplicate
the hydration logic in an incremental path, the flow writes the manifest entry and reloads
so the already-tested boot chain brings the session in.

## The two halves of "add a session"

1. **Register the folder** — `CompositeStorageBackend.loadNativeSession(dir)`
   (`packages/dashql-app/src/platform/storage/composite_storage_backend.ts`). This reads the
   folder's `dashql-session.json`, validates the metadata, and records a `location=native`
   entry in the OPFS root manifest. It **copies/writes nothing else** and does **not** touch
   any in-memory state.

2. **Hydrate the session into the live registries** — building the `ConnectionState`, the
   `NotebookState`, the catalog scripts (relations + functions), and the eagerly-analyzed
   notebook scripts, then merging them into `connReg` / `notebookReg`. This is the expensive,
   stateful part.

Step 2 today lives entirely inside `restoreSession()` in
`packages/dashql-app/src/platform/storage/app_state_loader.ts`, which is **private** to that
module and only reachable through `restoreAppState()`. And `restoreAppState()` runs in
**exactly one place**: once at boot, via `app_loading_logic.ts` → `app_loader.tsx`. There is
no incremental "hydrate one session into the running app" entry point.

## Why reload instead of building an incremental path

`addNativeSessionFromFolder` / `relocateSessionToNative` (both in
`packages/dashql-app/src/platform/storage/storage_migration_flow.ts`) take the cheap,
correct shortcut:

```ts
const sessionId = await backend.loadNativeSession(folder); // register in the manifest only
// Reload to re-run StorageProvider init + restoreAppState, which loads the new session.
globalThis.location.reload();
```

The reload re-runs the whole tested boot chain —
`StorageProvider` init → `CompositeStorageBackend.refreshLocations()` (which re-grants native
fs scope and rebuilds the uuid→location map from the manifest) → `restoreAppState()` →
`restoreSession()` per manifest entry — so the newly-registered folder is picked up with zero
new code and zero risk of the live registries drifting out of sync with storage.

Relocate has an extra reason on top of this: it mutates OPFS mid-flight (copy → verify → flip
the registry entry → delete the OPFS copy), so a clean reload against the new per-session
layout is the simplest way to guarantee consistent state.

## What an incremental (reload-free) path would take

Removing the reload is real wiring, not a one-liner, because the batch boot context is baked
into the restore code:

- Export a **single-session entry point** from `app_state_loader.ts` — a thin wrapper over the
  existing `restoreSession` that returns the built `ConnectionState` + `NotebookState` for one
  `sessionId`.
- In `addNativeSessionFromFolder`: call `backend.refreshLocations()` (so the composite backend
  caches the new native location), then the new entry point, then merge the result into the
  live registries via `setConnReg` / `setNotebookReg` — instead of `location.reload()`.
- Handle the parts that currently assume batch context: **progress reporting** (the
  `ProgressCounter`s / `progressConsumer` are sized and driven for a full boot),
  the **invalid-session path** (a folder with missing/unreadable files must still surface as an
  invalid, deletable card rather than throwing), and **error handling / rollback**.

Until that's built, the reload is the deliberate trade-off: reuse the one restore path that's
already tested rather than maintain a second, incremental copy of it.
