import * as React from 'react';

import type { ConnectionParams } from '@akohn/dashql/platform/connections/connection_params';
import type { ConnectionState } from '@akohn/dashql/platform/connections/connection_state';
import { useConnections } from '@akohn/dashql-react/hooks';
import { useAppConfig, useAppReconfigure, type AppSettings } from '../config/app_config.js';
import { embeddedCloudDatabases, LOCAL_CLOUD_DATABASE } from '@akohn/dashql/platform/connections/hyper/local_cloud';

// A cloud is a connection that keeps the workbooks that the user publishes to it in the tables of DashQL. The app may
// have several clouds, all equal: new workbooks don't start on one, and publishing names the cloud. See
// docs/design/cloud.md.

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

/// The ids of the cloud connections of the app settings, in the order they became clouds
export function cloudConnectionIdsOf(settings: AppSettings | null | undefined): string[] {
    return [...new Set(settings?.cloudConnectionIds ?? [])];
}

/// The cloud connections among the connections, those that are gone are left out
export function findCloudConnections(connections: ReadonlyMap<string, ConnectionState>, cloudConnectionIds: readonly string[]): ConnectionState[] {
    return cloudConnectionIds.flatMap(connectionId => connections.get(connectionId) ?? []);
}

const NO_IDS: string[] = [];

/// The ids of the cloud connections of the app settings
export function useCloudConnectionIds(): string[] {
    const settings = useAppConfig()?.settings;
    return React.useMemo(() => {
        const ids = cloudConnectionIdsOf(settings);
        return ids.length === 0 ? NO_IDS : ids;
    }, [settings]);
}

/// The cloud connections, those that are gone are left out
export function useCloudConnections(): ConnectionState[] {
    const cloudConnectionIds = useCloudConnectionIds();
    const connections = useConnections();
    return React.useMemo(() => findCloudConnections(connections, cloudConnectionIds), [connections, cloudConnectionIds]);
}

/// Make a connection a cloud, or stop using it as one
export function useSetCloudConnection(): (connectionId: string, isCloud: boolean) => void {
    const reconfigure = useAppReconfigure();
    return React.useCallback((connectionId: string, isCloud: boolean) => {
        reconfigure(config => {
            if (config == null) return null;
            const { cloudConnectionIds: _ids, ...settings } = config.settings ?? {};
            const ids = cloudConnectionIdsOf(config.settings).filter(id => id !== connectionId);
            if (isCloud) ids.push(connectionId);
            return { ...config, settings: ids.length === 0 ? settings : { ...settings, cloudConnectionIds: ids } };
        });
    }, [reconfigure]);
}
