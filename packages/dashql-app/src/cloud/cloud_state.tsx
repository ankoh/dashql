import * as React from 'react';

import { ConnectionHealth, type ConnectionState } from '@ankoh/dashql-sdk/connections/connection_state';
import { useCloudConnections } from '../connections/cloud_connection.js';
import { cloudDatabaseOf, useCloudQuery } from './cloud_query.js';
import { readCloudStats, type CloudStats } from './cloud_store.js';
import { inspectCloudStore, type CloudInstallation, type CloudQuery } from './cloud_store_schema.js';

// What the app knows about its clouds: for every cloud connection whether DashQL is installed in it and how many
// workbooks it holds. See docs/design/cloud.md.
//
// The state looks at a cloud whenever its connection comes online and on request, e.g. after the installer ran or a
// workbook was published. It never lists the workbooks of a cloud, a cloud may hold very many: the overview of a cloud
// reads them a page at a time. Its counts come from a single statement.

export interface CloudState {
    /// The cloud connection
    connectionId: string;
    connection: ConnectionState;
    /// The database of DashQL in the cloud connection
    database: string;
    /// Is the cloud connection online?
    online: boolean;
    /// What the last look found, null before one
    installation: CloudInstallation | null;
    /// May this DashQL read the tables of the cloud? DashQL is installed and not too new for it.
    readable: boolean;
    /// The counts of the cloud, null before they were read or when the tables can't be read
    stats: CloudStats | null;
    /// Is a look running?
    loading: boolean;
    /// Why the last look failed
    error: string | null;
    /// Counts the looks at the cloud that ended, the listings of the cloud read again when it grows
    revision: number;
    /// Look at the cloud again
    refresh: () => Promise<void>;
}

export interface CloudsApi {
    /// The clouds in the order they became clouds
    clouds: CloudState[];
    /// Show the page that sets up a cloud: choose or add the connection, log in, install DashQL. With a cloud the page
    /// sets up that one.
    openSetup: (connectionId?: string) => void;
    /// The last request of the setup page, the app loader shows the page when it changes
    setupRequest: CloudSetupRequest | null;
}

/// A request of the setup page
export interface CloudSetupRequest {
    /// Counts the requests
    id: number;
    /// The cloud to set up, null to choose or add one
    connectionId: string | null;
}

const NO_CLOUDS: CloudsApi = {
    clouds: [],
    openSetup: () => {},
    setupRequest: null,
};

const CLOUDS_CTX = React.createContext<CloudsApi>(NO_CLOUDS);

/// The clouds of the app
export function useClouds(): CloudsApi {
    return React.useContext(CLOUDS_CTX);
}

/// The state of a cloud, null if the connection is no cloud
export function useCloudState(connectionId: string | null | undefined): CloudState | null {
    const { clouds } = useClouds();
    return connectionId == null ? null : clouds.find(cloud => cloud.connectionId === connectionId) ?? null;
}

/// Can the tables of a cloud be read, by what the installer found?
export function isCloudReadable(installation: CloudInstallation | null): boolean {
    return installation != null && installation.canRead && installation.state !== 'unreachable' && installation.state !== 'missing';
}

/// Look at a cloud: is DashQL installed, and how many workbooks does it hold?
async function lookAtCloud(query: CloudQuery, database: string, signal: AbortSignal): Promise<{ installation: CloudInstallation; stats: CloudStats | null }> {
    const installation = await inspectCloudStore(query, { database, signal });
    const stats = isCloudReadable(installation) ? await readCloudStats(query, { database, signal }) : null;
    return { installation, stats };
}

type LookState = Pick<CloudState, 'installation' | 'stats' | 'loading' | 'error' | 'revision'>;
const NO_LOOK: LookState = { installation: null, stats: null, loading: false, error: null, revision: 0 };

/// Looks at one cloud and reports its state to the provider
function CloudWatcher(props: { connection: ConnectionState; report: (state: CloudState | null) => void }): null {
    const { connection, report } = props;
    const online = connection.connectionHealth === ConnectionHealth.ONLINE;
    const connectionId = connection.connectionId;
    const query = useCloudQuery(online ? connectionId : null);
    const database = cloudDatabaseOf(connection.params);
    const [look, setLook] = React.useState<LookState>(NO_LOOK);
    const running = React.useRef<AbortController | null>(null);

    const refresh = React.useCallback(async () => {
        running.current?.abort();
        if (query == null) {
            running.current = null;
            setLook(previous => ({ ...NO_LOOK, revision: previous.revision + 1 }));
            return;
        }
        const controller = new AbortController();
        running.current = controller;
        setLook(previous => ({ ...previous, loading: true, error: null }));
        try {
            const found = await lookAtCloud(query, database, controller.signal);
            if (running.current === controller) setLook(previous => ({ ...found, loading: false, error: null, revision: previous.revision + 1 }));
        } catch (error) {
            if (running.current === controller) {
                setLook(previous => ({ ...previous, loading: false, error: error instanceof Error ? error.message : String(error), revision: previous.revision + 1 }));
            }
        } finally {
            if (running.current === controller) running.current = null;
        }
    }, [database, query]);

    // Look at the cloud when its connection comes online or changes
    React.useEffect(() => {
        void refresh();
        return () => running.current?.abort();
    }, [refresh]);

    React.useEffect(() => {
        report({
            ...look, connectionId, connection, database, online, readable: isCloudReadable(look.installation), refresh,
        });
    }, [look, connectionId, connection, database, online, refresh, report]);
    React.useEffect(() => () => report(null), [report]);
    return null;
}

interface CloudStateProviderProps {
    children: React.ReactNode;
}

export function CloudStateProvider(props: CloudStateProviderProps): React.ReactElement {
    const connections = useCloudConnections();
    const [states, setStates] = React.useState<ReadonlyMap<string, CloudState>>(new Map());
    const [setupRequest, setSetupRequest] = React.useState<CloudSetupRequest | null>(null);

    // Every watcher reports under the id of its connection
    const reporters = React.useRef(new Map<string, (state: CloudState | null) => void>());
    const reporterOf = (connectionId: string) => {
        let reporter = reporters.current.get(connectionId);
        if (reporter == null) {
            reporter = (state: CloudState | null) => setStates(previous => {
                const next = new Map(previous);
                if (state == null) next.delete(connectionId);
                else next.set(connectionId, state);
                return next;
            });
            reporters.current.set(connectionId, reporter);
        }
        return reporter;
    };

    const openSetup = React.useCallback((connectionId?: string) => {
        setSetupRequest(previous => ({ id: (previous?.id ?? 0) + 1, connectionId: connectionId ?? null }));
    }, []);
    const clouds = React.useMemo(
        () => connections.flatMap(connection => states.get(connection.connectionId) ?? []),
        [connections, states],
    );
    const value = React.useMemo<CloudsApi>(() => ({ clouds, openSetup, setupRequest }), [clouds, openSetup, setupRequest]);
    return (
        <CLOUDS_CTX.Provider value={value}>
            {connections.map(connection => (
                <CloudWatcher key={connection.connectionId} connection={connection} report={reporterOf(connection.connectionId)} />
            ))}
            {props.children}
        </CLOUDS_CTX.Provider>
    );
}
