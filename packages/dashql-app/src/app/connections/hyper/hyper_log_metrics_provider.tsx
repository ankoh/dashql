import * as React from 'react';

import { useLogger } from '../../../platform/logger/logger_provider.js';
import { useConnectionRegistryStore, type ConnectionRegistry } from '../connection_registry.js';
import { EmbeddedHyperDatabaseChannel } from '../embedded/embedded_database_channel.js';
import { HYPER_CONNECTOR } from '../connector_info.js';
import { HyperLogMetrics, type HyperQueryEnd, type HyperResourceSample } from './hyper_log_metrics.js';

const LOG_METRICS_CTX = React.createContext<HyperLogMetrics | null>(null);

const NO_QUERIES: HyperQueryEnd[] = [];
const NO_SAMPLES: HyperResourceSample[] = [];

/// Assign the sessions of the embedded Hyper channels to their connections, and forget deleted connections
function syncConnections(logMetrics: HyperLogMetrics, registry: ConnectionRegistry): void {
    for (const [connectionId, connection] of registry.connections) {
        if (connection.details.type !== HYPER_CONNECTOR) continue;
        const channel = connection.details.value.channel;
        if (channel instanceof EmbeddedHyperDatabaseChannel && channel.sessionId != null) {
            logMetrics.assign(connectionId, channel.sessionId);
        }
    }
    logMetrics.retain(new Set(registry.connections.keys()));
}

interface Props {
    /// The children
    children: React.ReactElement;
}

/// Provides the finished queries of the embedded Hyper connections and the resource samples of the embedded Hyper.
/// Must be nested in the connection registry.
export const HyperLogMetricsProvider: React.FC<Props> = (props: Props) => {
    const logger = useLogger();
    const registryStore = useConnectionRegistryStore();
    const [logMetrics] = React.useState(() => new HyperLogMetrics({ logger }));
    React.useEffect(() => {
        syncConnections(logMetrics, registryStore.current);
        return registryStore.subscribe(() => syncConnections(logMetrics, registryStore.current));
    }, [logMetrics, registryStore]);
    React.useEffect(() => () => { void logMetrics.stop(); }, [logMetrics]);
    return <LOG_METRICS_CTX.Provider value={logMetrics}>{props.children}</LOG_METRICS_CTX.Provider>;
};

/// The Hyper log metrics, null outside of a HyperLogMetricsProvider
export function useHyperLogMetrics(): HyperLogMetrics | null {
    return React.useContext(LOG_METRICS_CTX);
}

function useLogMetricsSnapshot<T>(read: (logMetrics: HyperLogMetrics) => T, fallback: T): T {
    const logMetrics = useHyperLogMetrics();
    const subscribe = React.useCallback(
        (listener: () => void) => logMetrics?.subscribe(listener) ?? (() => {}),
        [logMetrics],
    );
    return React.useSyncExternalStore(subscribe, () => logMetrics == null ? fallback : read(logMetrics));
}

/// The finished queries of a connection, ordered by their end
export function useHyperConnectionQueries(connectionId: string): HyperQueryEnd[] {
    return useLogMetricsSnapshot(logMetrics => logMetrics.queries(connectionId), NO_QUERIES);
}

/// The resource samples of the embedded Hyper, ordered by time
export function useHyperResourceSamples(): HyperResourceSample[] {
    return useLogMetricsSnapshot(logMetrics => logMetrics.resourceSamples(), NO_SAMPLES);
}
