import * as React from 'react';

import {
    ConnectionState,
    ConnectionAction,
    ConnectionStateWithoutId,
    SET_CONNECTION_DRAFT,
    DISCARD_CONNECTION_DRAFT,
} from '@ankoh/dashql-runtime/connections/connection_state';
import { Dispatch } from '@ankoh/dashql-runtime/utils/variant';
import { storeWithoutRuntime, useStoreState } from '../utils/store_hooks.js';
import { ConnectionRegistryService } from '@ankoh/dashql-runtime/connections/connection_registry_service';
import { useOptionalRuntime } from '../runtime/runtime_provider.js';
import { connectionParamsEqual, type ConnectionParams } from '@ankoh/dashql-runtime/connections/connection_params';
import {
    NO_CONNECTION_REFERENCES,
    resolveWorkbookConnections,
    type ConnectionAllocator,
    type ConnectionDispatch,
    type ConnectionReferences,
    type ConnectionRegistry as ConnectionRegistryState,
    type DynamicConnectionDispatch,
} from '@ankoh/dashql-runtime/connections/connection_registry_state';

// The state of the registry and its reducer are in connection_registry_state.ts, this module binds them to React
export {
    connectionEntryFromState,
    connectionOrdinals,
    findWorkbookQueries,
    isListedConnection,
    NO_CONNECTION_REFERENCES,
    registerConnection,
    resolveWorkbookConnections,
    workbookConnectionFromState,
    type ConnectionAllocator,
    type ConnectionDispatch,
    type ConnectionReferences,
    type DynamicConnectionDispatch,
} from '@ankoh/dashql-runtime/connections/connection_registry_state';
/// The connection registry, see connection_registry_state.ts
export type ConnectionRegistry = ConnectionRegistryState;

// The registry is a service of the runtime (packages/dashql-runtime/src/connections/connection_registry_service.ts) that
// the RuntimeProvider provides. The scripts own the references to their connections, the registry of the workbook
// scripts keeps them.

/// Get the references without subscribing to their changes
export function useConnectionReferences(): ConnectionReferences {
    return useOptionalRuntime()?.workbooks.references ?? NO_CONNECTION_REFERENCES;
}

/// Subscribe to a slice of the references.
/// The selector must return values that keep their identity while unchanged.
export function useConnectionReferencesSelector<T>(select: (references: ConnectionReferences) => T): T {
    const references = useConnectionReferences();
    return React.useSyncExternalStore(references.subscribe, () => select(references));
}

export type SetConnectionRegistryAction = React.SetStateAction<ConnectionRegistry>;

/// A stable handle to the latest registry.
///
/// The registry changes with every query lifecycle event (including the internal SQLFrame queries of
/// computations), which re-renders every context consumer.
/// Components that only care about a small slice of the registry subscribe to the store instead.
export interface ConnectionRegistryStore {
    /// The latest registry
    current: ConnectionRegistry;
    /// Subscribe to registry changes
    subscribe: (listener: () => void) => () => void;
}

// The hooks resolve the service when their function is called, a test may render a component without the runtime as
// long as it doesn't call them
function useLazyConnections(): () => ConnectionRegistryService {
    const runtime = useOptionalRuntime();
    return React.useCallback(() => {
        if (runtime == null) throw new Error('the connections need a RuntimeProvider');
        return runtime.connections;
    }, [runtime]);
}

/// The store of the registry, without a runtime one without state
function useConnectionStore() {
    return useOptionalRuntime()?.connections.store ?? NO_CONNECTION_STORE;
}
const NO_CONNECTION_STORE = storeWithoutRuntime<ConnectionRegistry>('the connections');


/// Get the registry store without subscribing to registry changes
export function useConnectionRegistryStore(): ConnectionRegistryStore {
    return useConnectionStore();
}

/// Subscribe to a slice of the registry.
/// The component only re-renders when the selected value changes.
/// The selector must return values that keep their identity while unchanged.
export function useConnectionRegistrySelector<T>(select: (registry: ConnectionRegistry) => T): T {
    const store = useConnectionRegistryStore();
    return React.useSyncExternalStore(store.subscribe, () => select(store.current));
}

/// Modify the registry without subscribing to registry changes
export function useConnectionRegistrySetter(): Dispatch<SetConnectionRegistryAction> {
    const service = useLazyConnections();
    return React.useCallback((action: SetConnectionRegistryAction) => service().store.update(action), [service]);
}


/// Allocate a new connection that no workbook references yet.
/// A workbook references the connection once its scripts use it.
/// Active connections are written into the app manifest right away.
export function useConnectionAllocator(): ConnectionAllocator {
    const service = useLazyConnections();
    return React.useCallback((state: ConnectionStateWithoutId, fixedId?: string) => service().allocate(state, fixedId), [service]);
}

export function useConnectionRegistry(): [ConnectionRegistry, Dispatch<SetConnectionRegistryAction>] {
    const store = useConnectionStore();
    return [useStoreState(store), store.update];
}

export function useDynamicConnectionDispatch(): [ConnectionRegistry, DynamicConnectionDispatch] {
    const registry = useStoreState(useConnectionStore());
    const dispatch = useConnectionDispatch();
    return [registry, dispatch];
}

/// Dispatch actions to connections without subscribing to registry changes.
/// The dispatches of all components are applied in order through the queue of the registry.
export function useConnectionDispatch(): DynamicConnectionDispatch {
    const service = useLazyConnections();
    return React.useCallback((connectionId: string | null, action: ConnectionAction) => service().dispatch(connectionId, action), [service]);
}

/// The connections that the scripts of a workbook use
export function useWorkbookConnections(workbookId: string | null): ConnectionState[] | null {
    const [registry] = useConnectionRegistry();
    const references = useConnectionReferences();
    // Re-render when the workbook uses other connections
    useConnectionReferencesSelector(references => workbookId == null ? '' : references.connectionsOf(workbookId).join('\n'));
    // The list keeps its identity while the connections are unchanged, consumers depend on it in effects
    const resolved = resolveWorkbookConnections(registry, references, workbookId);
    const latest = React.useRef(resolved);
    const same = latest.current === resolved || (latest.current != null && resolved != null
        && latest.current.length === resolved.length && latest.current.every((connection, i) => connection === resolved[i]));
    if (!same) latest.current = resolved;
    return latest.current;
}

export function useConnectionById(connectionId: string | null): [ConnectionState | null, ConnectionDispatch] {
    const [registry, dispatch] = useDynamicConnectionDispatch();
    const capturingDispatch = React.useCallback((action: ConnectionAction) => dispatch(connectionId, action), [connectionId, dispatch]);
    return [connectionId == null ? null : registry.connections.get(connectionId) ?? null, capturingDispatch];
}

/// Editing dispatches immediately; the registry debounces only the durable manifest write.
export function useConnectionDraft(connectionId: string | null) {
    const [database, dispatch] = useConnectionById(connectionId);
    const setDraft = React.useCallback((params: ConnectionParams) => {
        dispatch({ type: SET_CONNECTION_DRAFT, value: params });
    }, [dispatch]);
    const discard = React.useCallback(() => {
        dispatch({ type: DISCARD_CONNECTION_DRAFT, value: null });
    }, [dispatch]);
    return { params: database?.params ?? null, paramsDraft: database?.paramsDraft, setDraft, discard };
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
