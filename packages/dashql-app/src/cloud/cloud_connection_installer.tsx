import * as React from 'react';
import * as styles from './cloud_installer.module.css';

import { Button, ButtonVariant } from '../ui/foundations/button.js';
import type { ConnectionState } from '../connections/connection_state.js';
import { connectionLabel } from '../connections/connection_label.js';
import { isLocalCloud } from '../connections/cloud_connection.js';
import { CloudInstaller } from './cloud_installer.js';
import { useCloudQuery } from './cloud_query.js';
import { useCloudState } from './cloud_state.js';
import { dropCloudStore, type CloudInstallation } from './cloud_store_schema.js';

// The installer of DashQL in the cloud connection. The local cloud also drops its tables to try the installer again.

export interface CloudConnectionInstallerProps {
    /// The cloud connection, online
    cloud: ConnectionState;
    /// Called with what the installer found, after every look at the tables
    onInspected?: (installation: CloudInstallation) => void;
}

export function CloudConnectionInstaller(props: CloudConnectionInstallerProps): React.ReactElement {
    const { cloud, onInspected } = props;
    const cloudState = useCloudState();
    const query = useCloudQuery(cloud.connectionId)!;
    const options = React.useMemo(() => ({ database: cloudState.database }), [cloudState.database]);
    const local = isLocalCloud(cloud.params);
    const [installation, setInstallation] = React.useState<CloudInstallation | null>(null);
    // A reset of the local cloud shows a new installer
    const [resets, setResets] = React.useState(0);
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);

    const refresh = cloudState.refresh;
    const inspected = React.useCallback((found: CloudInstallation) => {
        setInstallation(found);
        void refresh();
        onInspected?.(found);
    }, [onInspected, refresh]);

    const run = async (action: () => Promise<void>) => {
        setBusy(true);
        setError(null);
        try {
            await action();
        } catch (error) {
            setError(error instanceof Error ? error.message : String(error));
        } finally {
            setBusy(false);
        }
    };
    const resetLocalCloud = () => run(async () => {
        if (!window.confirm('Reset the local cloud? It drops the tables of DashQL in this browser with the published workbooks.')) return;
        try {
            await dropCloudStore(query, options);
        } finally {
            setResets(count => count + 1);
            void refresh();
        }
    });

    return (
        <>
            <CloudInstaller
                key={`${cloud.connectionId} ${resets}`}
                query={query}
                connectionName={connectionLabel(cloud)}
                options={options}
                embedded={local}
                onInspected={inspected}
            />
            {local && installation != null && installation.state !== 'unreachable' && (
                <div className={styles.local_actions}>
                    {error && <p className={styles.error} role="alert">{error}</p>}
                    <Button variant={ButtonVariant.Danger} disabled={busy} onClick={() => void resetLocalCloud()} data-testid="cloud-reset-local">
                        Reset Local Cloud
                    </Button>
                </div>
            )}
        </>
    );
}
