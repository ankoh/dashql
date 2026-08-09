import * as React from 'react';
import * as styles from './notebook_page.module.css';

import { ConnectionHealth } from '../../connection/connection_state.js';
import { ConnectionSettingsOverlay } from '../connection/connection_settings_overlay.js';
import { useNotebookScriptsRegistry, useNotebookScripts } from '../../scripts/notebook_scripts_registry.js';
import { useConnectionState } from '../../connection/connection_registry.js';
import { useLogger } from '../../platform/logger/logger_provider.js';
import { useRouteContext, useRouterNavigate, NOTEBOOK_PATH } from '../../router.js';

import { NotebookFeedPage } from './feed/notebook_feed_page.js';
import { NotebookViewMode, useNotebookViewMode } from '../../scripts/notebook_commands.js';

const NotebookShellPage = React.lazy(() => import('./shell/notebook_shell_page.js'));

const LOG_CTX = 'notebook_page';

interface Props { }

export const NotebookPage: React.FC<Props> = (_props: Props) => {
    const route = useRouteContext();
    const navigate = useRouterNavigate();
    const logger = useLogger();
    const notebookScriptsRegistry = useNotebookScriptsRegistry()[0];
    const [notebookScripts, modifyNotebookScripts] = useNotebookScripts(route.notebookId ?? null);
    const [conn, _modifyConn] = useConnectionState(notebookScripts?.notebookId ?? null);
    const [connectionOverlayOpen, setConnectionOverlayOpen] = React.useState<boolean>(false);
    const { mode: notebookMode } = useNotebookViewMode();
    const [shellOpened, setShellOpened] = React.useState(false);
    const connectionSettingsAnchorRef = React.useRef<HTMLButtonElement>(null);

    // Auto-close the connection settings overlay once a connect attempt succeeds
    const prevConnectionHealth = React.useRef<ConnectionHealth | null>(null);
    React.useEffect(() => {
        const health = conn?.connectionHealth ?? null;
        if (
            connectionOverlayOpen &&
            prevConnectionHealth.current === ConnectionHealth.CONNECTING &&
            health === ConnectionHealth.ONLINE
        ) {
            setConnectionOverlayOpen(false);
        }
        prevConnectionHealth.current = health;
    }, [conn?.connectionHealth, connectionOverlayOpen]);

    React.useEffect(() => {
        if (route.notebookId === null) {
            if (route.notebookId !== null) {
                const notebookId = notebookScriptsRegistry.notebookScriptsByConnection.get(route.notebookId);
                if (notebookId) {
                    navigate({
                        type: NOTEBOOK_PATH,
                        value: notebookId
                    });
                }
            } else {
                logger.warn('missing notebook id', {}, LOG_CTX);
            }
        }
    }, [route.notebookId]);

    React.useEffect(() => {
        if (notebookMode === NotebookViewMode.Shell) setShellOpened(true);
    }, [notebookMode]);

    if (route.notebookId === null || notebookScripts == null) {
        return <div />;
    }
    const openConnectionOverlay = (anchor?: HTMLButtonElement | null) => {
        connectionSettingsAnchorRef.current = anchor ?? null;
        setConnectionOverlayOpen(true);
    };

    return (
        <div className={styles.page}>
            <div
                className={notebookMode === NotebookViewMode.Notebook ? styles.mode : styles.modeHidden}
                inert={notebookMode !== NotebookViewMode.Notebook ? true : undefined}
                aria-hidden={notebookMode !== NotebookViewMode.Notebook}
            >
                <NotebookFeedPage
                    notebookScripts={notebookScripts}
                    modifyNotebookScripts={modifyNotebookScripts}
                    connection={conn ?? null}
                    active={notebookMode === NotebookViewMode.Notebook}
                    openConnectionOverlay={openConnectionOverlay}
                />
            </div>
            {shellOpened && (
                <div
                    className={notebookMode === NotebookViewMode.Shell ? styles.mode : styles.modeHidden}
                    inert={notebookMode !== NotebookViewMode.Shell ? true : undefined}
                    aria-hidden={notebookMode !== NotebookViewMode.Shell}
                >
                    <React.Suspense fallback={<div className={styles.shellLoading}>Loading shell...</div>}>
                        <NotebookShellPage
                            connection={conn ?? null}
                            active={notebookMode === NotebookViewMode.Shell}
                        />
                    </React.Suspense>
                </div>
            )}
            <ConnectionSettingsOverlay
                notebookId={route.notebookId}
                isOpen={connectionOverlayOpen}
                onClose={() => setConnectionOverlayOpen(false)}
                anchorRef={connectionSettingsAnchorRef}
            />
        </div>
    );
};
