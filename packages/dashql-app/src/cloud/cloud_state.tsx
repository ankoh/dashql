import * as React from 'react';

import { ConnectionHealth } from '../connections/connection_state.js';
import { useCloudConnection } from '../connections/cloud_connection.js';
import { listCloudTree, type CloudTree } from './cloud_folders.js';
import { cloudDatabaseOf, useCloudQuery } from './cloud_query.js';
import { inspectCloudStore, type CloudInstallation, type CloudQuery } from './cloud_store_schema.js';

// What the app knows about the cloud: whether DashQL is installed in the cloud connection and its workbooks. See
// docs/design/cloud.md.
//
// The state looks at the cloud whenever the cloud connection comes online and on request, e.g. after the installer
// ran. The workbooks are listed only when this DashQL may read the tables.

export interface CloudState {
    /// The cloud connection, null without one
    connectionId: string | null;
    /// The database of DashQL in the cloud connection
    database: string;
    /// Is the cloud connection online?
    online: boolean;
    /// What the last look found, null before one
    installation: CloudInstallation | null;
    /// The folders and workbooks of the cloud, null before they were listed or when the tables can't be read
    tree: CloudTree | null;
    /// Is a look running?
    loading: boolean;
    /// Why the last look failed
    error: string | null;
}

export interface CloudStateApi extends CloudState {
    /// Look at the cloud again
    refresh: () => Promise<void>;
    /// Show the page that sets up the cloud: choose the connection, log in, install DashQL
    openSetup: () => void;
    /// How often the setup page was asked for, the app loader shows it when the count grows
    setupRequests: number;
}

const NO_CLOUD: CloudStateApi = {
    connectionId: null,
    database: 'dashql',
    online: false,
    installation: null,
    tree: null,
    loading: false,
    error: null,
    refresh: async () => {},
    openSetup: () => {},
    setupRequests: 0,
};

const CLOUD_STATE_CTX = React.createContext<CloudStateApi>(NO_CLOUD);

/// The cloud as the app knows it
export function useCloudState(): CloudStateApi {
    return React.useContext(CLOUD_STATE_CTX);
}

/// Look at the cloud: is DashQL installed, and which workbooks does it hold?
async function lookAtCloud(query: CloudQuery, database: string, signal: AbortSignal): Promise<Pick<CloudState, 'installation' | 'tree'>> {
    const installation = await inspectCloudStore(query, { database, signal });
    const readable = installation.canRead && installation.state !== 'unreachable' && installation.state !== 'missing';
    const tree = readable ? await listCloudTree(query, { database, signal }) : null;
    return { installation, tree };
}

interface CloudStateProviderProps {
    children: React.ReactNode;
}

export function CloudStateProvider(props: CloudStateProviderProps): React.ReactElement {
    const cloud = useCloudConnection();
    const online = cloud?.connectionHealth === ConnectionHealth.ONLINE;
    const connectionId = cloud?.connectionId ?? null;
    const query = useCloudQuery(online ? connectionId : null);
    const database = cloudDatabaseOf(cloud?.params);
    const [state, setState] = React.useState<Pick<CloudState, 'installation' | 'tree' | 'loading' | 'error'>>({
        installation: null, tree: null, loading: false, error: null,
    });
    const [setupRequests, setSetupRequests] = React.useState(0);
    const running = React.useRef<AbortController | null>(null);

    const refresh = React.useCallback(async () => {
        running.current?.abort();
        if (query == null) {
            running.current = null;
            setState({ installation: null, tree: null, loading: false, error: null });
            return;
        }
        const controller = new AbortController();
        running.current = controller;
        setState(previous => ({ ...previous, loading: true, error: null }));
        try {
            const found = await lookAtCloud(query, database, controller.signal);
            if (running.current === controller) setState({ ...found, loading: false, error: null });
        } catch (error) {
            if (running.current === controller) {
                setState(previous => ({ ...previous, loading: false, error: error instanceof Error ? error.message : String(error) }));
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

    const openSetup = React.useCallback(() => setSetupRequests(count => count + 1), []);
    const value = React.useMemo<CloudStateApi>(() => ({
        ...state, connectionId, database, online, refresh, openSetup, setupRequests,
    }), [state, connectionId, database, online, refresh, openSetup, setupRequests]);
    return <CLOUD_STATE_CTX.Provider value={value}>{props.children}</CLOUD_STATE_CTX.Provider>;
}
