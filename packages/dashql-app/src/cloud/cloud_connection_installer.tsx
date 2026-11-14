import * as React from 'react';
import * as styles from './cloud_installer.module.css';

import { ButtonSize, ButtonVariant, IconButton } from '../ui/foundations/button.js';
import { TrashIcon } from '../ui/foundations/symbol_icon.js';
import type { ConnectionState } from '@ankoh/dashql-runtime/connections/connection_state';
import { isLocalCloud } from '../connections/cloud_connection.js';
import { CloudInstaller } from './cloud_installer.js';
import { cloudDatabaseOf, useCloudQuery } from './cloud_query.js';
import { useCloudState } from './cloud_state.js';
import { dropCloudStore, type CloudInstallation } from './cloud_store_schema.js';

// The installer of DashQL in a cloud. The local cloud also drops its tables to try the installer again.

export interface CloudConnectionInstallerProps {
    /// The cloud connection, online
    cloud: ConnectionState;
    /// Called with what the installer found, after every look at the tables
    onInspected?: (installation: CloudInstallation) => void;
}

export function CloudConnectionInstaller(props: CloudConnectionInstallerProps): React.ReactElement {
    const { cloud, onInspected } = props;
    const cloudState = useCloudState(cloud.connectionId);
    const query = useCloudQuery(cloud.connectionId)!;
    const database = cloudDatabaseOf(cloud.params);
    const options = React.useMemo(() => ({ database }), [database]);
    const local = isLocalCloud(cloud.params);
    const [installation, setInstallation] = React.useState<CloudInstallation | null>(null);
    // A reset of the local cloud shows a new installer
    const [resets, setResets] = React.useState(0);
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);

    const refresh = cloudState?.refresh;
    const inspected = React.useCallback((found: CloudInstallation) => {
        setInstallation(found);
        void refresh?.();
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
            void refresh?.();
        }
    });

    const resetAction = local && installation != null && installation.state !== 'unreachable' && installation.state !== 'missing'
        ? (
            <IconButton variant={ButtonVariant.Invisible} size={ButtonSize.Small} aria-label="Reset local cloud" disabled={busy}
                onClick={() => void resetLocalCloud()} data-testid="cloud-reset-local">
                <TrashIcon size={16} />
            </IconButton>
        )
        : null;
    return (
        <>
            <CloudInstaller
                key={`${cloud.connectionId} ${resets}`}
                query={query}
                options={options}
                actions={resetAction}
                onInspected={inspected}
            />
            {error && <p className={styles.error} role="alert">{error}</p>}
        </>
    );
}
