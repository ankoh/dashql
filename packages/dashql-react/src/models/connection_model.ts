import * as React from 'react';
import type * as core from '@akohn/dashql';

import type { ConnectionParams } from '@akohn/dashql/platform/connections/connection_params';
import type { ConnectionState } from '@akohn/dashql/platform/connections/connection_state';

import { useCatalog, useConnection, useDispatch, useOptionalRuntime } from '../hooks.js';

// The model of a connection (docs/agents/writing_components.md): what a component shows of a connection and what it can
// do with it. The kinds, targets, actions and commands of the runtime stay in this module. An operation that changes the
// state resolves once the store shows the change, the component renders with a new model right after.

/// A connection as a component shows it, and what the component can do with it
export interface ConnectionModel {
    readonly connectionId: string;
    /// The connection: its connector, params, draft, health, status, details and the queries of its history
    readonly connection: ConnectionState;
    /// The catalog of the connection, read-only, null while the runtime holds none
    readonly catalog: core.DashQLCatalog | null;

    /// Set the connection up with its params, or with others, e.g. the draft of a form. Resolves with the outcome, a
    /// failure is in the view of the connection as well.
    setUp(options?: core.SetupOptions): Promise<core.SetupOutcome>;
    /// Save the params, by default the params of the connection: the app manifest and the copies in the workbooks
    save(params?: ConnectionParams): Promise<core.ConnectionSaveOutcome>;
    /// Keep the draft of a form, params of another connector are ignored
    setDraft(params: ConnectionParams): Promise<void>;
    /// Drop the draft and the errors of the last setup
    discardDraft(): Promise<void>;
    /// Rename the connection, a blank name removes the name
    rename(name: string): Promise<void>;
    /// Choose whether the connection caches the results of its queries
    setQueryResultCaching(caching: boolean): Promise<void>;
    /// Ask the connection about its catalog again, `force` also while an update runs
    refreshCatalog(force?: boolean): void;
    /// Stop the connection and clear its catalog and queries
    reset(): Promise<void>;
    /// Stop the connection and drop it, a connection that workbooks use stays
    remove(): Promise<boolean>;
}

/// Where the models of the connections come from: the runtime of the app, or a fake model of a test
export interface ConnectionModelSource {
    /// The model of a connection, null while the connection is unknown. A hook, the source of a provider never changes.
    useConnectionModel(connectionId: string | null | undefined): ConnectionModel | null;
}

/// The model of a connection over the runtime of the provider above
function useRuntimeConnectionModel(connectionId: string | null | undefined): ConnectionModel | null {
    const runtime = useOptionalRuntime();
    const connection = useConnection(connectionId);
    const catalog = useCatalog(connectionId);
    const dispatch = useDispatch(connectionId == null ? null : { connection: connectionId });
    return React.useMemo(() => {
        if (connection == null || connectionId == null) return null;
        const live = () => {
            if (runtime == null) throw new Error('the model of a connection needs a runtime');
            return runtime;
        };
        const changed = async (action: core.ConnectionAction) => {
            const outcome = dispatch(action);
            await outcome.settled;
            if (!outcome.ok) throw new Error(outcome.error ?? 'the runtime refused the change of the connection');
            return outcome;
        };
        return {
            connectionId,
            connection,
            catalog,
            setUp: options => live().setupConnection(connectionId, options),
            save: params => live().saveConnection(connectionId, params),
            setDraft: async params => { await changed({ kind: 'setDraft', value: { params: params as core.JsonParams } }); },
            discardDraft: async () => { await changed({ kind: 'discardDraft' }); },
            rename: async name => { await changed({ kind: 'rename', value: { name } }); },
            setQueryResultCaching: async caching => { await changed({ kind: 'setQueryResultCaching', value: { caching } }); },
            refreshCatalog: force => runtime?.refreshCatalog(connectionId, force ?? false),
            reset: async () => { await changed({ kind: 'resetConnection' }); },
            remove: async () => {
                const outcome = dispatch({ kind: 'deleteConnection' });
                await outcome.settled;
                return outcome.ok && outcome.changed;
            },
        };
    }, [runtime, connectionId, connection, catalog, dispatch]);
}

/// The models of the runtime of the provider above
export const RUNTIME_CONNECTION_MODELS: ConnectionModelSource = { useConnectionModel: useRuntimeConnectionModel };

const CONNECTION_MODELS = React.createContext<ConnectionModelSource>(RUNTIME_CONNECTION_MODELS);

/// Hand the components below another source of connection models, e.g. the fake models of a test
export const ConnectionModelProvider = CONNECTION_MODELS.Provider;

/// The model of a connection, null while the connection is unknown. It renders again when the connection changes:
/// when it is set up, saved or refreshed and when a query starts or finishes, not with the progress of a query.
export function useConnectionModel(connectionId: string | null | undefined): ConnectionModel | null {
    return React.useContext(CONNECTION_MODELS).useConnectionModel(connectionId);
}
