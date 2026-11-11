import * as React from 'react';

import type { ConnectionParams } from './connection_params.js';
import type { ConnectionState } from './connection_state.js';
import { useConnectionRegistry } from './connection_registry.js';
import { useAppConfig, useAppReconfigure } from '../config/app_config.js';
import { embeddedCloudDatabases, LOCAL_CLOUD_DATABASE } from './hyper/local_cloud.js';

export { LOCAL_CLOUD_DATABASE };

// The cloud connection is the connection that the user logs in to when the app starts. New workbooks start on it and
// DashQL stores the workbooks that the user publishes in its tables. See docs/design/cloud.md.

/// The params of a local cloud: a connection of the embedded Hyper whose session attaches only the database of the local
/// cloud, like a connection to a Hyper server that attaches the database of DashQL
export function createLocalCloudParams(): ConnectionParams {
    return { hyper: { protocol: 'WASM', attachedDatabases: [{ ...LOCAL_CLOUD_DATABASE }] } } as unknown as ConnectionParams;
}

/// Is the connection a local cloud, a connection of the embedded Hyper that attaches the database of the local cloud?
export function isLocalCloud(params: ConnectionParams | null | undefined): boolean {
    if (params == null || !('hyper' in params)) return false;
    return embeddedCloudDatabases(params.hyper).some(database => database.path === LOCAL_CLOUD_DATABASE.path && database.alias === LOCAL_CLOUD_DATABASE.alias);
}

/// Can a connection be the cloud connection? It has to keep the tables of DashQL: a Hyper server whose credentials the
/// user enters, Database.com, or the local cloud that keeps them in a database of this browser to try the cloud. The
/// embedded Hyper itself keeps its database only as long as the window, the credentials of a Hyper link live only in its
/// tab, and Salesforce Data Cloud and Trino don't write.
export function isCloudCapable(params: ConnectionParams | null | undefined): boolean {
    if (params == null) return false;
    if ('dbcom' in params) return true;
    if ('hyper' in params) {
        const protocol = params.hyper?.protocol ?? 'WASM';
        return protocol === 'V3_GRPC' || protocol === 'V3_HTTP' || isLocalCloud(params);
    }
    return false;
}

/// The cloud connection among the connections, null if none is set or the connection is gone
export function findCloudConnection(connections: ReadonlyMap<string, ConnectionState>, cloudConnectionId: string | null | undefined): ConnectionState | null {
    return cloudConnectionId == null ? null : connections.get(cloudConnectionId) ?? null;
}

/// The id of the cloud connection of the app settings, null if there is none
export function useCloudConnectionId(): string | null {
    return useAppConfig()?.settings?.cloudConnectionId ?? null;
}

/// The cloud connection, null if none is set or the connection is gone
export function useCloudConnection(): ConnectionState | null {
    const cloudConnectionId = useCloudConnectionId();
    const [registry] = useConnectionRegistry();
    return findCloudConnection(registry.connections, cloudConnectionId);
}

/// Set the cloud connection in the app settings, null stops using one
export function useSetCloudConnection(): (connectionId: string | null) => void {
    const reconfigure = useAppReconfigure();
    return React.useCallback((connectionId: string | null) => {
        reconfigure(config => {
            if (config == null) return null;
            const { cloudConnectionId: _previous, ...settings } = config.settings ?? {};
            return { ...config, settings: connectionId == null ? settings : { ...settings, cloudConnectionId: connectionId } };
        });
    }, [reconfigure]);
}
