import * as React from 'react';

import { isLocalCloud, useSetCloudConnection } from '../connections/cloud_connection.js';
import type { ConnectionParams } from '@ankoh/dashql-runtime/connections/connection_params';
import { useConnectionReferences } from '../connections/connection_registry.js';
import { useDeleteConnection } from '../connections/connection_deletion.js';
import { useDetachConnection } from '../workbook/workbook_connection_detach.js';
import { useLogger } from '../platform/logger/logger_provider.js';
import { stringifyError } from '@ankoh/dashql-runtime/platform/logger/logger';

// Deleting a local cloud. A cloud on a server only stops being a cloud, its tables stay on the server. A local cloud
// exists only to be one, so deleting it deletes its connection and drops its database with the published workbooks.
// See docs/design/cloud.md.

/// Delete a local cloud: it stops being a cloud, the workbooks that would only start new scripts on it fall back to the
/// embedded Hyper, then its connection and its database are deleted. Throws while scripts of workbooks run on it, the
/// connection stays then.
export function useDeleteLocalCloud(): (connectionId: string) => Promise<void> {
    const references = useConnectionReferences();
    const setCloud = useSetCloudConnection();
    const deleteConnection = useDeleteConnection();
    const detach = useDetachConnection();
    return React.useCallback(async (connectionId: string) => {
        await detach(connectionId);
        const using = references.workbooksOf(connectionId).length;
        if (using > 0) {
            throw new Error(`${using} ${using === 1 ? 'workbook has' : 'workbooks have'} scripts on the local cloud, move them to another connection first`);
        }
        setCloud(connectionId, false);
        await deleteConnection(connectionId);
    }, [deleteConnection, detach, references, setCloud]);
}

/// How the menus of a cloud remove it
export interface CloudRemoval {
    /// Is it a local cloud that is deleted, or a cloud that only stops being one?
    deletes: boolean;
    /// The text of the action
    text: string;
    /// Remove the cloud, a deletion asks first. A failure is logged and shown.
    run: () => void;
}

/// Remove a cloud from the menus of the cloud: delete a local cloud, stop using any other as a cloud
export function useCloudRemoval(connectionId: string, params: ConnectionParams | null | undefined, onRemoved?: () => void): CloudRemoval {
    const setCloud = useSetCloudConnection();
    const deleteLocalCloud = useDeleteLocalCloud();
    const logger = useLogger();
    if (!isLocalCloud(params)) {
        return { deletes: false, text: 'Stop using as cloud', run: () => { setCloud(connectionId, false); onRemoved?.(); } };
    }
    return {
        deletes: true,
        text: 'Delete local cloud',
        run: () => {
            if (!window.confirm('Delete the local cloud? It deletes the workbooks published to it in this browser.')) return;
            deleteLocalCloud(connectionId).then(() => onRemoved?.(), error => {
                logger.error('Deleting the local cloud failed', { connectionId, error: stringifyError(error) }, 'cloud_deletion');
                window.alert(error instanceof Error ? error.message : String(error));
            });
        },
    };
}
