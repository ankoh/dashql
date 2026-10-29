import * as React from 'react';
import * as styles from './session_page.module.css';

import { useSessionScripts } from '../scripts/session_scripts_registry.js';
import { useConnectionRegistry } from '../../connections/connection_registry.js';
import type { ConnectionState } from '../../connections/connection_state.js';
import { newScriptConnection, sessionConnectionIds } from '../scripts/session_scripts.js';
import { useLogger } from '../../../platform/logger/logger_provider.js';
import { useRouteContext } from '../../router/router.js';

import { SessionFeedPage } from './feed/session_feed_page.js';
import { SessionViewMode, useSessionViewMode } from './session_view_mode.js';

const SessionShellsPage = React.lazy(() => import('../shell/session_shells_page.js'));

const LOG_CTX = 'session_page';

export interface SessionPageDependencies {
    useSessionScripts: typeof useSessionScripts;
    useConnectionRegistry: typeof useConnectionRegistry;
    useLogger: typeof useLogger;
    useRouteContext: typeof useRouteContext;
    useSessionViewMode: typeof useSessionViewMode;
    SessionFeedPage: typeof SessionFeedPage;
    SessionShellsPage: typeof SessionShellsPage;
}

const DEFAULT_DEPENDENCIES: SessionPageDependencies = {
    useSessionScripts,
    useConnectionRegistry,
    useLogger,
    useRouteContext,
    useSessionViewMode,
    SessionFeedPage,
    SessionShellsPage,
};

interface Props {
    dependencies?: SessionPageDependencies;
}

export const SessionPage: React.FC<Props> = (props: Props) => {
    const dependencies = props.dependencies ?? DEFAULT_DEPENDENCIES;
    const route = dependencies.useRouteContext();
    const logger = dependencies.useLogger();
    const [sessionScripts, modifySessionScripts] = dependencies.useSessionScripts(route.sessionId ?? null);
    // The connections that the scripts of the session run on, and the one the next script runs on
    const [connectionRegistry] = dependencies.useConnectionRegistry();
    const nextConnectionId = sessionScripts == null ? null : newScriptConnection(sessionScripts, null)?.connectionId ?? null;
    const conn = nextConnectionId == null ? null : connectionRegistry.connections.get(nextConnectionId) ?? null;
    const scriptConnections = new Map<string, ConnectionState>();
    for (const connectionId of sessionScripts == null ? [] : sessionConnectionIds(sessionScripts)) {
        const connection = connectionRegistry.connections.get(connectionId);
        if (connection != null) scriptConnections.set(connectionId, connection);
    }
    const { mode: sessionMode } = dependencies.useSessionViewMode();
    const sessionPageVisible = sessionMode !== SessionViewMode.Shell;
    // The connection of the visible shell, the connection of the next script until another one is picked.
    // Kept while the shell is closed, the shell reopens on the picked connection of the session.
    const [shellPick, setShellPick] = React.useState<{ sessionId: string; connectionId: string } | null>(null);
    const shellConnectionId = shellPick != null && shellPick.sessionId === route.sessionId ? shellPick.connectionId : null;
    const shellConnection = (shellConnectionId == null ? null : connectionRegistry.connections.get(shellConnectionId)) ?? conn ?? null;

    React.useEffect(() => {
        if (route.sessionId === null) {
            logger.warn('missing session id', {}, LOG_CTX);
        }
    }, [route.sessionId]);

    if (route.sessionId === null || sessionScripts == null) {
        return <div />;
    }
    return (
        <div className={styles.page}>
            <div className={sessionPageVisible ? styles.view : styles.view_hidden}>
                <dependencies.SessionFeedPage
                    sessionScripts={sessionScripts}
                    modifySessionScripts={modifySessionScripts}
                    connection={conn ?? null}
                    scriptConnections={scriptConnections}
                    active={sessionMode === SessionViewMode.Session}
                />
            </div>
            {sessionMode === SessionViewMode.Shell && (
                <div className={styles.view}>
                    <React.Suspense fallback={(
                        <div className={styles.shellLoading} role="status">
                            <strong>[ RUN ]</strong> Loading shell
                        </div>
                    )}>
                        <dependencies.SessionShellsPage
                            key={sessionScripts.sessionId}
                            sessionId={sessionScripts.sessionId}
                            sessionName={sessionScripts.name}
                            connectionId={shellConnection?.connectionId ?? null}
                            onPickConnection={connectionId => setShellPick({ sessionId: sessionScripts.sessionId, connectionId })}
                        />
                    </React.Suspense>
                </div>
            )}
        </div>
    );
};
