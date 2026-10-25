import * as React from 'react';

import type { Logger } from '../../platform/logger/logger.js';
import { stringifyError } from '../../platform/logger/logger.js';
import type { DynamicConnectionDispatch } from '../connections/connection_registry.js';
import { ConnectionHealth, type ConnectionState } from '../connections/connection_state.js';
import type { HyperSetupApi } from '../connections/hyper/hyper_connection_setup.js';
import { cancelConnectionSetup, registerConnectionSetup } from '../connections/connection_setup_cancellation.js';
import { isHyperLinkParams, useHyperLinkTabState } from '../hyper_link/hyper_link.js';

const startupAttempts = new Map<string, AbortController>();

// Settings can cancel the loader-owned attempt without creating a second setup controller.
export function cancelInitialMemorySetup(connectionId: string): boolean {
    const abort = startupAttempts.get(connectionId);
    if (abort == null) return false;
    cancelConnectionSetup(connectionId);
    return true;
}

export function useInitialMemorySetup(
    sessionId: string | null,
    database: ConnectionState | null,
    setup: HyperSetupApi | null,
    dispatch: DynamicConnectionDispatch,
    logger: Logger,
): void {
    const hyperLinks = useHyperLinkTabState();
    const considered = React.useRef(new Set<string>());
    const attempts = React.useRef(new Map<string, AbortController>());
    React.useEffect(() => {
        if (sessionId == null || database == null || setup == null) return;
        const params = database.params;
        // The connection to the Hyper of a link connects once per link, without the token of a link it waits for one
        const linked = isHyperLinkParams(params);
        const token = hyperLinks.tokens[database.connectionId];
        if (linked && token == null) return;
        const key = linked && 'hyper' in params ? `${database.connectionId} ${params.hyper.endpoint} ${token}` : database.connectionId;
        if (considered.current.has(key)) return;
        // Consume the initial selection even when online, cancelled, or carrying a draft.
        // Later resets, draft discards, and session switches must not opt back into setup.
        considered.current.add(key);
        if (database.paramsDraft != null
            || !('hyper' in params)
            || (params.hyper.protocol !== 'WASM' && !linked)) return;
        if (database.connectionHealth !== ConnectionHealth.NOT_STARTED) {
            if (!linked) return;
            // The connection speaks to the Hyper of an earlier link
            cancelConnectionSetup(database.connectionId);
            void setup.reset(action => dispatch(database.connectionId, action));
        }
        const abort = new AbortController();
        attempts.current.set(database.connectionId, abort);
        startupAttempts.set(database.connectionId, abort);
        const unregister = registerConnectionSetup(database.connectionId, abort);
        void setup.setup(
            action => dispatch(database.connectionId, action),
            structuredClone(params.hyper) as Parameters<HyperSetupApi['setup']>[1],
            abort.signal,
            database.connectionId,
        ).catch(error => {
            if (!abort.signal.aborted) logger.warn('Memory database setup failed', {
                sessionId, error: stringifyError(error),
            }, 'app_loader');
        }).finally(() => {
            unregister();
            attempts.current.delete(database.connectionId);
            if (startupAttempts.get(database.connectionId) === abort) startupAttempts.delete(database.connectionId);
        });
    }, [database, dispatch, hyperLinks, logger, sessionId, setup]);
    React.useEffect(() => () => {
        for (const [connectionId, abort] of attempts.current) {
            abort.abort(new DOMException('App loader unmounted', 'AbortError'));
            if (startupAttempts.get(connectionId) === abort) startupAttempts.delete(connectionId);
        }
    }, []);
}
