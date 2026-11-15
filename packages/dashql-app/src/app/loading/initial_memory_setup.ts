import * as React from 'react';

import type { Logger } from '@ankoh/dashql-runtime/platform/logger/logger';
import { ConnectionHealth, type ConnectionState } from '@ankoh/dashql-runtime/connections/connection_state';
import { isHyperLinkParams } from '@ankoh/dashql-runtime/connections/hyper/hyper_link';
import { useHyperLinkTabState } from '../../connections/hyper/hyper_link_tab.js';

/// What the startup asks of the runtime: the setup of a connection with its params, a reset and a cancellation
export interface InitialSetups {
    /// Set up a connection, it resolves with the outcome
    setup(connectionId: string): Promise<{ status: string; message: string | null }>;
    /// Reset a connection, e.g. one to the Hyper of an earlier link
    reset(connectionId: string): void;
    /// Cancel the setup of a connection
    cancel(connectionId: string): void;
}

/// Set up the embedded database and the Hyper of a link once for the workbook the app opens with.
/// Every connection of the workbook is considered, other connections are connected by the user. The runtime cancels a
/// setup of the startup when the settings start another one or cancel it.
export function useInitialMemorySetup(
    workbookId: string | null,
    connections: readonly ConnectionState[] | null,
    setups: InitialSetups | null,
    logger: Logger,
): void {
    const hyperLinks = useHyperLinkTabState();
    const considered = React.useRef(new Set<string>());
    const running = React.useRef(new Set<string>());
    const considerConnection = (database: ConnectionState, setups: InitialSetups) => {
        const params = database.params;
        // The connection to the Hyper of a link connects once per link, without the token of a link it waits for one
        const linked = isHyperLinkParams(params);
        const token = hyperLinks.tokens[database.connectionId];
        if (linked && token == null) return;
        const key = linked && 'hyper' in params ? `${database.connectionId} ${params.hyper.endpoint} ${token}` : database.connectionId;
        if (considered.current.has(key)) return;
        // Consume the initial selection even when online, cancelled, or carrying a draft.
        // Later resets, draft discards, and workbook switches must not opt back into setup.
        considered.current.add(key);
        if (database.paramsDraft != null
            || !('hyper' in params)
            || (params.hyper.protocol !== 'WASM' && !linked)) return;
        if (database.connectionHealth !== ConnectionHealth.NOT_STARTED) {
            if (!linked) return;
            // The connection speaks to the Hyper of an earlier link
            setups.reset(database.connectionId);
        }
        running.current.add(database.connectionId);
        void setups.setup(database.connectionId).then(outcome => {
            if (outcome.status === 'failed') logger.warn('Memory database setup failed', {
                workbookId, error: outcome.message ?? '',
            }, 'app_loader');
        }).finally(() => {
            running.current.delete(database.connectionId);
        });
    };
    React.useEffect(() => {
        if (workbookId == null || connections == null || setups == null) return;
        for (const database of connections) {
            considerConnection(database, setups);
        }
    }, [connections, hyperLinks, logger, workbookId, setups]);
    React.useEffect(() => () => {
        for (const connectionId of running.current) setups?.cancel(connectionId);
    }, [setups]);
}
