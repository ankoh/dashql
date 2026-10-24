import * as React from 'react';
import symbols from '@ankoh/dashql-svg-symbols';

import { useConnectionReferences, useConnectionRegistry } from '../connection_registry.js';
import type { ConnectionState } from '../connection_state.js';
import { connectionLabelParts, connectionLabelText, connectionOrdinals } from './connection_label.js';
import { ConnectionLabelView } from './connection_label_view.js';
import { ConnectionMetricsDashboard } from './connection_metrics_dashboard.js';
import { ConnectionOverviewDetails } from './connection_overview_details.js';
import { CONNECTION_HEALTH_COLORS, CONNECTION_HEALTH_NAMES } from './connection_status.js';
import * as styles from './connection_overview_page.module.css';

/// Does a connection run its queries in the embedded Hyper, whose log the metrics are read from?
function isEmbeddedHyperConnection(connection: ConnectionState): boolean {
    const params = connection.params;
    return 'hyper' in params && params.hyper.protocol === 'WASM';
}

interface Props {
    /// The id of the connection
    connectionId: string;
    /// Close the overview
    onClose: () => void;
}

/// The operational overview of a connection.
/// Closes itself once the connection is deleted.
export const ConnectionOverviewPage: React.FC<Props> = ({ connectionId, onClose }) => {
    const [registry] = useConnectionRegistry();
    const references = useConnectionReferences();
    const connection = registry.connections.get(connectionId) ?? null;
    React.useEffect(() => {
        if (connection == null) onClose();
    }, [connection == null, onClose]);
    if (connection == null) return null;
    const label = connectionLabelParts(connection, connectionOrdinals(registry, references).get(connectionId) ?? null);
    const labelText = connectionLabelText(label);
    return (
        <div className={styles.container}>
            <section className={styles.page} aria-label={`Overview of ${labelText}`}>
                <header className={styles.header}>
                    <svg width="16" height="16" aria-hidden="true">
                        <use xlinkHref={`${symbols}#${connection.connectorInfo.icons.colored}`} />
                    </svg>
                    <h2 className={styles.title}>
                        <ConnectionLabelView parts={label} />
                        <span className={styles.title_separator}>/</span>
                        <span>Overview</span>
                    </h2>
                    <span className={styles.status_pill} data-testid="connection-overview-status">
                        <span className={styles.status_dot} style={{ backgroundColor: CONNECTION_HEALTH_COLORS[connection.connectionHealth ?? 0] }} />
                        {CONNECTION_HEALTH_NAMES[connection.connectionHealth ?? 0]}
                    </span>
                </header>
                <div>
                    {isEmbeddedHyperConnection(connection)
                        ? <ConnectionMetricsDashboard connectionId={connectionId} details={<ConnectionOverviewDetails connection={connection} />} />
                        : (
                            <p className={styles.unavailable} data-testid="connection-metrics-unavailable">
                                Query metrics are available for embedded Hyper connections.
                            </p>
                        )}
                </div>
            </section>
        </div>
    );
};
