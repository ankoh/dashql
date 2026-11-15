import * as React from 'react';
import type * as arrow from 'apache-arrow';
import type * as core from '@ankoh/dashql-core';

import { CoreRuntime } from '@ankoh/dashql-runtime/core_runtime';

import { useLogger } from '../platform/logger/logger_provider.js';
import { useComputeDatabase } from '../compute/compute_connection_provider.js';
import { FRAME_UPDATE_SCHEDULER } from '../utils/store_hooks.js';
import { useDashQLCoreSetup } from './core_provider.js';

// The hooks of the runtime of the module (docs/wip/runtime_api.md): a component reads the view of a slice, which
// re-renders it when that slice changes and no other, dispatches an action to a slice and resolves the tables of a
// view by their handles. The views come from the store of the runtime, never from the module.

const CORE_RUNTIME_CTX = React.createContext<CoreRuntime | null>(null);

/// Provide the runtime of the module, the RuntimeProvider provides the one of the runtime of the app
export const CoreRuntimeProvider = CORE_RUNTIME_CTX.Provider;

/// The runtime of the module of the provider above, its commands and its store. Throws without one.
export function useCoreRuntime(): CoreRuntime {
    const runtime = React.useContext(CORE_RUNTIME_CTX);
    if (runtime == null) throw new Error('the runtime needs a RuntimeProvider or a StandaloneCoreRuntime');
    return runtime;
}

/// The runtime of the module, null without a provider: a test may render a component without one as long as it
/// doesn't call it
export function useOptionalCoreRuntime(): CoreRuntime | null {
    return React.useContext(CORE_RUNTIME_CTX);
}

const NO_SUBSCRIPTION = () => () => { };
const NO_VIEW = () => null;

/// The view of a slice, null without one. The component renders again when the slice changes.
export function useView<K extends core.ViewKind>(kind: K, id: core.ViewId<K> | null | undefined): core.ViewOf<K> | null {
    const runtime = React.useContext(CORE_RUNTIME_CTX);
    const store = runtime?.store ?? null;
    const subscribe = React.useMemo(
        () => store == null || id == null ? NO_SUBSCRIPTION : (listener: () => void) => store.subscribe(kind, id, listener),
        [store, kind, id],
    );
    const getSnapshot = React.useMemo(
        () => store == null || id == null ? NO_VIEW : () => store.get(kind, id),
        [store, kind, id],
    );
    return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/// Dispatch actions to a slice. The runtime is resolved when the function is called.
export function useDispatch(target: core.Target | null): (action: core.RuntimeAction) => core.DispatchOutcome {
    const runtime = React.useContext(CORE_RUNTIME_CTX);
    const key = target == null ? null : JSON.stringify(target);
    return React.useCallback((action: core.RuntimeAction) => {
        if (runtime == null) throw new Error('the runtime needs a RuntimeProvider or a StandaloneCoreRuntime');
        if (key == null) return { ok: false, changed: false, error: 'no target', id: null };
        return runtime.dispatch(JSON.parse(key) as core.Target, action);
    }, [runtime, key]);
}

/// An Arrow table of the runtime by its handle, null without one. A handle names one table for as long as it lives.
export function useTable(handle: number | null | undefined): arrow.Table | null {
    const runtime = React.useContext(CORE_RUNTIME_CTX);
    return runtime?.table(handle) ?? null;
}

/// Delete the computation of a result, the runtime is resolved when the function is called
export function useDeleteComputation(): (tableId: number) => void {
    const runtime = React.useContext(CORE_RUNTIME_CTX);
    return React.useCallback((tableId: number) => {
        if (runtime == null) throw new Error('the runtime needs a RuntimeProvider or a StandaloneCoreRuntime');
        runtime.deleteComputation(tableId);
    }, [runtime]);
}

/// The view of the computation of a result
export const useComputation = (tableId: number | null | undefined) => useView('computation', tableId);
/// Dispatch actions to the computation of a result
export const useComputationDispatch = (tableId: number | null | undefined) => useDispatch(tableId == null ? null : { computation: tableId });

/// A runtime of the module without the runtime of the app, e.g. of the shell of Hyper, on the compute database of the
/// provider above. Its core is the one of the provider above, without one the default core.
export function StandaloneCoreRuntime(props: { children?: React.ReactNode }) {
    const logger = useLogger();
    const setupCore = useDashQLCoreSetup();
    const computeDatabase = useComputeDatabase();
    const [runtime] = React.useState(() => new CoreRuntime({ logger, scheduler: FRAME_UPDATE_SCHEDULER, setupCore, computeDatabase }));
    // The compute database starts after the settings loaded, the tasks that start later use it. Only a change of the
    // provider is passed on, a page may set the database of its own, e.g. the shell its embedded database.
    const attached = React.useRef(computeDatabase);
    if (attached.current !== computeDatabase) {
        attached.current = computeDatabase;
        runtime.setComputeDatabase(computeDatabase);
    }
    return <CoreRuntimeProvider value={runtime}>{props.children}</CoreRuntimeProvider>;
}
