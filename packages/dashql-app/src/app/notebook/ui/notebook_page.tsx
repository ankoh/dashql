import * as React from 'react';
import * as styles from './notebook_page.module.css';

import { useNotebookScriptsRegistry, useNotebookScripts } from '../scripts/notebook_scripts_registry.js';
import { useAttachedDatabaseState } from '../connections/attached_database_registry.js';
import { useLogger } from '../../../platform/logger/logger_provider.js';
import { useRouteContext, useRouterNavigate, NOTEBOOK_PATH } from '../../router/router.js';

import { NotebookFeedPage } from './feed/notebook_feed_page.js';
import { NotebookViewMode, useNotebookViewMode } from '../scripts/notebook_commands.js';

const NotebookShellPage = React.lazy(() => import('../shell/notebook_shell_page.js'));

const LOG_CTX = 'notebook_page';

interface Props { }

export const NotebookPage: React.FC<Props> = (_props: Props) => {
    const route = useRouteContext();
    const navigate = useRouterNavigate();
    const logger = useLogger();
    const notebookScriptsRegistry = useNotebookScriptsRegistry()[0];
    const [notebookScripts, modifyNotebookScripts] = useNotebookScripts(route.notebookId ?? null);
    const [conn] = useAttachedDatabaseState(notebookScripts?.notebookId ?? null);
    const { mode: notebookMode } = useNotebookViewMode();

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

    if (route.notebookId === null || notebookScripts == null) {
        return <div />;
    }
    return (
        <div className={styles.page}>
            {notebookMode === NotebookViewMode.Notebook ? (
                <NotebookFeedPage
                    notebookScripts={notebookScripts}
                    modifyNotebookScripts={modifyNotebookScripts}
                    connection={conn ?? null}
                    active
                />
            ) : (
                <React.Suspense fallback={(
                    <div className={styles.shellLoading} role="status">
                        <strong>[ RUN ]</strong> Loading shell
                    </div>
                )}>
                    <NotebookShellPage notebookId={notebookScripts.notebookId} notebookName={notebookScripts.name} connection={conn ?? null} active />
                </React.Suspense>
            )}
        </div>
    );
};
