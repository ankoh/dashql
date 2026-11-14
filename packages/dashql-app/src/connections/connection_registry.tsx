import * as React from 'react';

import {
    ConnectionState,
    ConnectionAction,
    ConnectionStateWithoutId,
    SET_CONNECTION_DRAFT,
    DISCARD_CONNECTION_DRAFT,
} from '@ankoh/dashql-runtime/connections/connection_state';
import { Dispatch } from '@ankoh/dashql-runtime/utils/variant';
import { UpdateQueue } from '@ankoh/dashql-runtime/store/store';
import { FRAME_UPDATE_SCHEDULER, useStoreState } from '../utils/store_hooks.js';
import { ConnectionRegistryService } from '@ankoh/dashql-runtime/connections/connection_registry_service';
import { useStorageWriter } from '../storage/storage_provider.js';
import { useLogger } from '../platform/logger/logger_provider.js';
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
    DEBOUNCE_DURATION_CONNECTION_DRAFT_WRITE,
    didConnectionParamsChange,
    didPersistedConnectionChange,
    findWorkbookQueries,
    isListedConnection,
    NO_CONNECTION_REFERENCES,
    registerConnection,
    resolveWorkbookConnections,
    scheduleConnectionParamsWrites,
    workbookConnectionFromState,
    type ConnectionAllocator,
    type ConnectionDispatch,
    type ConnectionReferences,
    type DynamicConnectionDispatch,
} from '@ankoh/dashql-runtime/connections/connection_registry_state';
/// The connection registry, see connection_registry_state.ts
export type ConnectionRegistry = ConnectionRegistryState;

const CONNECTION_REFERENCES_CTX = React.createContext<ConnectionReferences>(NO_CONNECTION_REFERENCES);
/// Provide the workbooks that use the connections
export const ConnectionReferencesProvider = CONNECTION_REFERENCES_CTX.Provider;

/// Get the references without subscribing to their changes
export function useConnectionReferences(): ConnectionReferences {
    return React.useContext(CONNECTION_REFERENCES_CTX);
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

const CONNECTION_REGISTRY_CTX = React.createContext<ConnectionRegistry | null>(null);
const CONNECTION_REGISTRY_SETTER_CTX = React.createContext<Dispatch<SetConnectionRegistryAction> | null>(null);
const CONNECTION_REGISTRY_STORE_CTX = React.createContext<ConnectionRegistryStore | null>(null);
const CONNECTION_REGISTRY_QUEUE_CTX = React.createContext<UpdateQueue<ConnectionRegistry> | null>(null);
const CONNECTION_REGISTRY_SERVICE_CTX = React.createContext<ConnectionRegistryService | null>(null);

/// The service that holds the connections
export function useConnectionRegistryService(): ConnectionRegistryService {
    return React.useContext(CONNECTION_REGISTRY_SERVICE_CTX)!;
}

type Props = {
    children: React.ReactElement | React.ReactElement[];
};

export const ConnectionRegistry: React.FC<Props> = (props: Props) => {
    const logger = useLogger();
    const storageWriter = useStorageWriter();
    const references = useConnectionReferences();
    const deps = { logger, storageWriter, references };
    const [service] = React.useState(() => new ConnectionRegistryService(deps, FRAME_UPDATE_SCHEDULER));
    service.setDependencies(deps);
    React.useEffect(() => () => service.dispose(), [service]);
    const store = service.store;
    const reg = useStoreState(store);
    return (
        <CONNECTION_REGISTRY_SERVICE_CTX.Provider value={service}>
            <CONNECTION_REGISTRY_STORE_CTX.Provider value={store}>
                <CONNECTION_REGISTRY_QUEUE_CTX.Provider value={service.queue}>
                    <CONNECTION_REGISTRY_SETTER_CTX.Provider value={store.update}>
                        <CONNECTION_REGISTRY_CTX.Provider value={reg}>
                            {props.children}
                        </CONNECTION_REGISTRY_CTX.Provider>
                    </CONNECTION_REGISTRY_SETTER_CTX.Provider>
                </CONNECTION_REGISTRY_QUEUE_CTX.Provider>
            </CONNECTION_REGISTRY_STORE_CTX.Provider>
        </CONNECTION_REGISTRY_SERVICE_CTX.Provider>
    );
};

/// Get the registry store without subscribing to registry changes
export function useConnectionRegistryStore(): ConnectionRegistryStore {
    return React.useContext(CONNECTION_REGISTRY_STORE_CTX)!;
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
    return React.useContext(CONNECTION_REGISTRY_SETTER_CTX)!;
}


/// Allocate a new connection that no workbook references yet.
/// A workbook references the connection once its scripts use it.
/// Active connections are written into the app manifest right away.
// The hooks resolve the service when their function is called, a test may render a component without the provider as
// long as it doesn't call them
export function useConnectionAllocator(): ConnectionAllocator {
    const service = useConnectionRegistryService();
    return React.useCallback((state: ConnectionStateWithoutId, fixedId?: string) => service.allocate(state, fixedId), [service]);
}

export function useConnectionRegistry(): [ConnectionRegistry, Dispatch<SetConnectionRegistryAction>] {
    return [React.useContext(CONNECTION_REGISTRY_CTX)!, React.useContext(CONNECTION_REGISTRY_SETTER_CTX)!];
}

export function useDynamicConnectionDispatch(): [ConnectionRegistry, DynamicConnectionDispatch] {
    const registry = React.useContext(CONNECTION_REGISTRY_CTX)!;
    const dispatch = useConnectionDispatch();
    return [registry, dispatch];
}

/// Dispatch actions to connections without subscribing to registry changes.
/// The dispatches of all components are applied in order through the queue of the registry.
export function useConnectionDispatch(): DynamicConnectionDispatch {
    const service = useConnectionRegistryService();
    return React.useCallback((connectionId: string | null, action: ConnectionAction) => service.dispatch(connectionId, action), [service]);
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
