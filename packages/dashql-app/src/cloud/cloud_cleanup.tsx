import * as React from 'react';
import * as styles from './cloud_installer.module.css';

import { Button, ButtonSize, ButtonVariant } from '@akohn/dashql-react/components/button';
import { IndicatorStatus, StatusIndicator } from '@akohn/dashql-react/components/status_indicator';
import type { ConnectionState } from '@akohn/dashql/platform/connections/connection_state';
import { cloudDatabaseOf, useCloudQuery } from './cloud_query.js';
import { useCloudState } from './cloud_state.js';
import { cleanupCloud, type CloudCleanup } from './cloud_store.js';

// The cleanup of a cloud, in its setup (docs/design/cloud.md, Setting Up a Cloud). It removes the workbooks and folders
// that were deleted more than 30 days ago, the versions that are being deleted and the uploads that were abandoned,
// and moves the folders of a loop of parents to the top. It walks every folder with a parent, so it runs on request.

/// A count with its noun
function countOf(count: number, noun: string): string {
    return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/// What a cleanup did, in a few words
export function describeCloudCleanup(cleanup: CloudCleanup): string {
    const removed = [
        cleanup.workbooks.length > 0 ? countOf(cleanup.workbooks.length, 'workbook') : null,
        cleanup.folders.length > 0 ? countOf(cleanup.folders.length, 'folder') : null,
        cleanup.versions.length > 0 ? countOf(cleanup.versions.length, 'version') : null,
    ].filter(part => part != null);
    const parts: string[] = [];
    if (removed.length > 0) {
        parts.push(`Removed ${removed.length === 1 ? removed[0] : `${removed.slice(0, -1).join(', ')} and ${removed[removed.length - 1]}`}`);
    }
    if (cleanup.rerooted.length > 0) {
        parts.push(`moved ${countOf(cleanup.rerooted.length, 'folder')} of a loop to the top`);
    }
    if (parts.length === 0) return 'Nothing to remove';
    const text = parts.join(', ');
    return text[0].toUpperCase() + text.slice(1);
}

export interface CloudCleanupLineProps {
    /// The cloud connection, online, with the tables of this DashQL
    cloud: ConnectionState;
}

/// Clean up a cloud on request, the counts of the cloud follow
export function CloudCleanupLine(props: CloudCleanupLineProps): React.ReactElement {
    const { cloud } = props;
    const query = useCloudQuery(cloud.connectionId)!;
    const database = cloudDatabaseOf(cloud.params);
    const refresh = useCloudState(cloud.connectionId)?.refresh;
    const [running, setRunning] = React.useState(false);
    const [result, setResult] = React.useState<CloudCleanup | null>(null);
    const [error, setError] = React.useState<string | null>(null);
    // A cleanup stops when the page closes or shows another cloud
    const abort = React.useRef<AbortController | null>(null);
    React.useEffect(() => () => abort.current?.abort(), [cloud.connectionId]);

    const run = async () => {
        const controller = new AbortController();
        abort.current = controller;
        setRunning(true);
        setResult(null);
        setError(null);
        try {
            setResult(await cleanupCloud(query, { database, signal: controller.signal }));
            void refresh?.();
        } catch (error) {
            if (controller.signal.aborted) return;
            setError(error instanceof Error ? error.message : String(error));
        } finally {
            if (!controller.signal.aborted) setRunning(false);
        }
    };

    const status = running ? IndicatorStatus.Running
        : error != null ? IndicatorStatus.Failed
        : result != null ? IndicatorStatus.Succeeded
        : IndicatorStatus.None;
    const summary = running ? 'Cleaning up'
        : error != null ? 'The cleanup failed'
        : result != null ? describeCloudCleanup(result)
        : 'Removes what was deleted more than 30 days ago';
    return (
        <div className={styles.installer} data-testid="cloud-cleanup">
            <div className={styles.status}>
                <StatusIndicator status={status} width="14px" height="14px" />
                <span className={styles.summary} data-testid="cloud-cleanup-summary">{summary}</span>
                <div className={styles.actions}>
                    <Button variant={ButtonVariant.Default} size={ButtonSize.Small} disabled={running} onClick={() => void run()}
                        data-testid="cloud-cleanup-run">
                        {error != null ? 'Try Again' : 'Clean Up'}
                    </Button>
                </div>
            </div>
            {error && <p className={styles.error} role="alert">{error}</p>}
        </div>
    );
}
