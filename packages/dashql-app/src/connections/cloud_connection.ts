import * as React from 'react';

import type { ConnectionState } from '@akohn/dashql/platform/connections/connection_state';
import { useConnections } from '@akohn/dashql-react/hooks';
import { useAppConfig, useAppReconfigure, type AppSettings } from '../config/app_config.js';

// A cloud is a connection that keeps the workbooks that the user publishes to it in the tables of DashQL. The app may
// have several clouds, all equal: new workbooks don't start on one, and publishing names the cloud. Which connections
// can be one and which is a local cloud, the runtime tells (`cloudCapable` and `localCloud` of the connection view). See
// docs/design/cloud.md.

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
