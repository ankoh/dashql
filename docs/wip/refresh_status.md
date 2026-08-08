# Schema Refresh Status

## Goal

Improve schema refresh feedback in the notebook UI by replacing the refresh icon with the existing loading status indicator while a full catalog refresh is running.

The status should appear in both refresh entry points:

- The refresh button in the notebook header.
- The refresh action in the notebook action sidebar.

## Current Integration

Both controls dispatch the same notebook command:

- The header button is defined in `packages/dashql-app/src/view/notebook/notebook_page.tsx`.
- The sidebar action is defined in `packages/dashql-app/src/view/notebook/notebook_command_lists.tsx`.
- Both dispatch `NotebookCommandType.RefreshCatalog`.
- `NotebookCommands` handles that command in `packages/dashql-app/src/scripts/notebook_commands.tsx` and enqueues a forced catalog refresh through `CatalogLoaderProvider`.

The refresh lifecycle is already tracked in connection state:

- `CatalogLoaderProvider` creates a `FULL_CATALOG_REFRESH` task with status `STARTED`.
- `reduceCatalogAction` stores active tasks in `connection.catalogUpdates.tasksRunning`.
- Success, failure, and cancellation remove the task from `tasksRunning` and move it to `tasksFinished`.
- `connection.catalogUpdates.currentFullRefresh` identifies the running or most recently completed full refresh.

The UI already has a suitable animated icon: `StatusIndicator` with `IndicatorStatus.Running` from `packages/dashql-app/src/view/foundations/status_indicator.tsx`.

## Refresh State

Do not treat `currentFullRefresh !== null` as the loading condition. The field intentionally continues to identify the most recently completed refresh after the refresh finishes.

The running predicate should verify that the current full refresh is still in `tasksRunning`:

```ts
const currentRefreshId = connection.catalogUpdates.currentFullRefresh;
const isRefreshing =
    currentRefreshId !== null &&
    connection.catalogUpdates.tasksRunning.has(currentRefreshId);
```

This ensures that the loading indicator appears only for an active full refresh and that the normal refresh icon returns after success, failure, or cancellation.

Prefer adding a small shared selector near the catalog update state definitions instead of duplicating this lookup in both notebook components.

## UI Behavior

### Idle

- Show the existing `SyncIcon` in both controls.
- Keep the existing refresh command behavior.
- Preserve the existing connection health and connector capability checks.

### Refreshing

- Replace `SyncIcon` with a compact `StatusIndicator` using `IndicatorStatus.Running`.
- Use dimensions that fit the existing icon slots, such as `16px` by `16px`.
- Use the normal icon color for the surrounding control.
- Change the header button's accessible label and tooltip from `Refresh Schema` to `Refreshing Schema`.
- Set `aria-busy="true"` on the active refresh controls.
- Disable both refresh controls until the active refresh completes.

Disabling is recommended because the loader currently allows an explicit refresh to supersede an active refresh by aborting it. Leaving an animated refresh control clickable would make that restart behavior unclear and could cause unnecessary refresh churn.

### Completed

- Restore `SyncIcon` after success, failure, or cancellation.
- Restore the idle accessible label.
- Re-enable the controls when the connection is online and the connector supports schema refreshes.

## Implementation Steps

1. Add a shared `isCatalogRefreshRunning(connection)` selector near the catalog update state definitions.
2. Derive the refresh state from the active connection in `NotebookPage`.
3. Swap the header button's `SyncIcon` for a compact running `StatusIndicator` while refreshing.
4. Update the header button's disabled state, accessible label, tooltip, and `aria-busy` state.
5. Use the same selector in `ConnectionCommandList` and swap the sidebar action's leading icon while refreshing.
6. Disable the sidebar action while refreshing and expose its busy state.
7. Add focused UI tests for idle, running, and completed refresh states.

## Tests

Cover the following behavior:

- Idle controls display the refresh icon and are actionable when the connection and connector permit refreshes.
- An active full catalog refresh displays the loading status indicator in both locations.
- Active controls expose the refreshing accessible label or state and are disabled.
- A completed, failed, or cancelled refresh restores the refresh icon and idle interaction state.
- A non-full catalog task does not activate the schema refresh indicator.

## Verification

Run all verification through Bazel:

```bash
bazel test //packages/dashql-app:tsc_typecheck_test
bazel test //packages/dashql-app:test
```

## Terminology

The header currently says `Refresh Schema`, while the sidebar says `Refresh Catalog`. Both invoke the same operation. Preserve the existing labels for this focused change unless standardizing the terminology becomes a separate requirement.
