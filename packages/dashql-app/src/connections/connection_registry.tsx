import * as React from 'react';
import type * as core from '@ankoh/dashql-core';

import type { ConnectionState, NewConnection } from '@ankoh/dashql-runtime/connections/connection_state';
import type { CoreRuntime } from '@ankoh/dashql-runtime/core_runtime';
import { useOptionalCoreRuntime, useView } from '../runtime/runtime_hooks.js';
import { connectionParamsEqual, type ConnectionParams } from '@ankoh/dashql-runtime/connections/connection_params';
import {
    connectionRegistryOf,
    NO_CONNECTION_REFERENCES,
    type ConnectionAllocator,
    type ConnectionDispatch,
    type ConnectionReferences,
    type ConnectionRegistry as ConnectionRegistryState,
    type DynamicConnectionDispatch,
} from '@ankoh/dashql-runtime/connections/connection_registry_state';

// The connections are slices of the runtime of the module (docs/wip/runtime_api.md): a component reads the view of a
// connection, which renders it again when the connection changes. A connection changes when it is set up, saved or
// refreshed and when a query starts or finishes; the progress of a query changes only the slice of the query.
export {
    connectionEntryFromState,
    connectionOrdinals,
    findWorkbookQueries,
    isListedConnection,
    NO_CONNECTION_REFERENCES,
    resolveWorkbookConnections,
    workbookConnectionFromState,
    type ConnectionAllocator,
    type ConnectionDispatch,
    type ConnectionReferences,
    type DynamicConnectionDispatch,
} from '@ankoh/dashql-runtime/connections/connection_registry_state';
/// The connections by id, see connection_registry_state.ts
export type ConnectionRegistry = ConnectionRegistryState;

/// The references between the connections and the workbooks of the runtime, from the views of the last flush: the
/// workbooks that use a connection are in the view of the connection, the connections that a workbook uses in the view
/// of the workbook
function referencesOf(runtime: CoreRuntime): ConnectionReferences {
    return {
        workbooksOf: connectionId => runtime.store.get('connection', connectionId)?.workbooks ?? [],
        connectionsOf: workbookId => runtime.store.get('workbook', workbookId)?.connectionIds ?? [],
        subscribe: listener => {
            const stops = [runtime.store.subscribeKind('workbook', listener), runtime.store.subscribeKind('connection', listener)];
            return () => { for (const stop of stops) stop(); };
        },
    };
}

/// Get the references without subscribing to their changes
export function useConnectionReferences(): ConnectionReferences {
    const runtime = useOptionalCoreRuntime();
    return React.useMemo(() => runtime == null ? NO_CONNECTION_REFERENCES : referencesOf(runtime), [runtime]);
}

/// Subscribe to a slice of the references.
/// The selector must return values that keep their identity while unchanged.
export function useConnectionReferencesSelector<T>(select: (references: ConnectionReferences) => T): T {
    const references = useConnectionReferences();
    return React.useSyncExternalStore(references.subscribe, () => select(references));
}

/// A stable handle to the latest connections, the views of the last flush of the store of the runtime
export interface ConnectionRegistryStore {
    /// The latest connections
    readonly current: ConnectionRegistry;
    /// Subscribe to changes of the connections and of their list
    subscribe: (listener: () => void) => () => void;
}

const EMPTY_REGISTRY: ConnectionRegistry = connectionRegistryOf(null, () => null);
const NO_CONNECTION_STORE: ConnectionRegistryStore = { current: EMPTY_REGISTRY, subscribe: () => () => { } };

/// Get the connections without subscribing to their changes
export function useConnectionRegistryStore(): ConnectionRegistryStore {
    const runtime = useOptionalCoreRuntime();
    return React.useMemo(() => runtime == null ? NO_CONNECTION_STORE : {
        get current() { return runtime.registry(); },
        subscribe: (listener: () => void) => {
            const stops = [runtime.store.subscribeKind('connection', listener), runtime.store.subscribeKind('connectionList', listener)];
            return () => { for (const stop of stops) stop(); };
        },
    }, [runtime]);
}

/// Subscribe to a slice of the connections.
/// The component only re-renders when the selected value changes.
/// The selector must return values that keep their identity while unchanged.
export function useConnectionRegistrySelector<T>(select: (registry: ConnectionRegistry) => T): T {
    const store = useConnectionRegistryStore();
    return React.useSyncExternalStore(store.subscribe, () => select(store.current));
}

/// The connections, the component renders again when a connection or the list changes
export function useConnectionRegistry(): [ConnectionRegistry] {
    return [useConnectionRegistrySelector(registry => registry)];
}

/// Create a connection that no workbook references yet.
/// A workbook references the connection once its scripts use it.
/// Active connections are written into the app manifest right away.
export function useConnectionAllocator(): ConnectionAllocator {
    const runtime = useOptionalCoreRuntime();
    return React.useCallback((connection: NewConnection, fixedId?: string) => {
        if (runtime == null) throw new Error('the connections need a RuntimeProvider');
        return runtime.createConnection(connection, fixedId);
    }, [runtime]);
}

export function useDynamicConnectionDispatch(): [ConnectionRegistry, DynamicConnectionDispatch] {
    const [registry] = useConnectionRegistry();
    const dispatch = useConnectionDispatch();
    return [registry, dispatch];
}

/// Dispatch actions to connections without subscribing to their changes
export function useConnectionDispatch(): DynamicConnectionDispatch {
    const runtime = useOptionalCoreRuntime();
    return React.useCallback((connectionId: string | null, action: core.RuntimeAction) => {
        if (runtime == null) throw new Error('the connections need a RuntimeProvider');
        runtime.dispatchConnection(connectionId, action);
    }, [runtime]);
}

/// The connections that a workbook uses, from the slice of the workbook: the connections of its scripts, then its
/// pending connection. Null while one of them is unknown.
export function useWorkbookConnections(workbookId: string | null): ConnectionState[] | null {
    const [registry] = useConnectionRegistry();
    const workbook = useView('workbook', workbookId);
    // The list keeps its identity while the connections are unchanged, consumers depend on it in effects
    const connectionIds = workbook?.connectionIds ?? null;
    let resolved: ConnectionState[] | null = null;
    if (connectionIds != null && connectionIds.length > 0) {
        const connections = connectionIds.map(connectionId => registry.connections.get(connectionId));
        if (connections.every(connection => connection != null)) resolved = connections as ConnectionState[];
    }
    const latest = React.useRef(resolved);
    const same = latest.current === resolved || (latest.current != null && resolved != null
        && latest.current.length === resolved.length && latest.current.every((connection, i) => connection === resolved[i]));
    if (!same) latest.current = resolved;
    return latest.current;
}

/// The view of a connection, it renders again when the connection changes
export function useConnection(connectionId: string | null | undefined): ConnectionState | null {
    return useView('connection', connectionId) as ConnectionState | null;
}

export function useConnectionById(connectionId: string | null): [ConnectionState | null, ConnectionDispatch] {
    const connection = useConnection(connectionId);
    const dispatch = useConnectionDispatch();
    const capturingDispatch = React.useCallback((action: core.RuntimeAction) => dispatch(connectionId, action), [connectionId, dispatch]);
    return [connection, capturingDispatch];
}

/// Editing dispatches immediately; the runtime debounces only the durable manifest write.
export function useConnectionDraft(connectionId: string | null) {
    const [database, dispatch] = useConnectionById(connectionId);
    const setDraft = React.useCallback((params: ConnectionParams) => {
        dispatch({ kind: 'setDraft', value: { params: params as unknown as core.JsonParams } });
    }, [dispatch]);
    const discard = React.useCallback(() => {
        dispatch({ kind: 'discardDraft' });
    }, [dispatch]);
    return { params: database?.params ?? null, paramsDraft: database?.paramsDraft ?? undefined, setDraft, discard };
}

/// Forms write from user actions, never from hydration effects (which could resurrect a draft).
export function useConnectionDraftForm<T>(
    connectionId: string | null,
    decode: (params: ConnectionParams | null) => T,
    encode: (form: T) => ConnectionParams,
): [T, React.Dispatch<React.SetStateAction<T>>] {
    const { params, paramsDraft, setDraft } = useConnectionDraft(connectionId);
    const source = paramsDraft ?? params;
    const [form, setForm] = React.useState(() => decode(source));
    const sourceRef = React.useRef(source);
    const formRef = React.useRef(form);
    const databaseIdRef = React.useRef(connectionId);
    const editedParamsRef = React.useRef<ConnectionParams | undefined>(undefined);
    if (databaseIdRef.current !== connectionId || sourceRef.current !== source) {
        const ownEdit = databaseIdRef.current === connectionId && paramsDraft != null
            && connectionParamsEqual(editedParamsRef.current, paramsDraft);
        databaseIdRef.current = connectionId;
        sourceRef.current = source;
        if (!ownEdit) {
            editedParamsRef.current = undefined;
            formRef.current = decode(source);
            setForm(formRef.current);
        }
    }
    const update = (value: React.SetStateAction<T>) => {
        const next = typeof value === 'function' ? (value as (prev: T) => T)(formRef.current) : value;
        formRef.current = next;
        setForm(next);
        const encoded = encode(next);
        editedParamsRef.current = encoded;
        setDraft(encoded);
    };
    return [formRef.current, update];
}
