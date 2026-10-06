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

export interface NotebookPageDependencies {
    useNotebookScriptsRegistry: typeof useNotebookScriptsRegistry;
    useNotebookScripts: typeof useNotebookScripts;
    useAttachedDatabaseState: typeof useAttachedDatabaseState;
    useLogger: typeof useLogger;
    useRouteContext: typeof useRouteContext;
    useRouterNavigate: typeof useRouterNavigate;
    useNotebookViewMode: typeof useNotebookViewMode;
    NotebookFeedPage: typeof NotebookFeedPage;
    NotebookShellPage: typeof NotebookShellPage;
}

const DEFAULT_DEPENDENCIES: NotebookPageDependencies = {
    useNotebookScriptsRegistry,
    useNotebookScripts,
    useAttachedDatabaseState,
    useLogger,
    useRouteContext,
    useRouterNavigate,
    useNotebookViewMode,
    NotebookFeedPage,
    NotebookShellPage,
};

interface Props {
    dependencies?: NotebookPageDependencies;
}

export const NotebookPage: React.FC<Props> = (props: Props) => {
    const dependencies = props.dependencies ?? DEFAULT_DEPENDENCIES;
    const route = dependencies.useRouteContext();
    const navigate = dependencies.useRouterNavigate();
    const logger = dependencies.useLogger();
    const notebookScriptsRegistry = dependencies.useNotebookScriptsRegistry()[0];
    const [notebookScripts, modifyNotebookScripts] = dependencies.useNotebookScripts(route.notebookId ?? null);
    const [conn] = dependencies.useAttachedDatabaseState(notebookScripts?.notebookId ?? null);
    const { mode: notebookMode } = dependencies.useNotebookViewMode();
    const notebookPageVisible = notebookMode !== NotebookViewMode.Shell;

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
            <div className={notebookPageVisible ? styles.view : styles.view_hidden}>
                <dependencies.NotebookFeedPage
                    notebookScripts={notebookScripts}
                    modifyNotebookScripts={modifyNotebookScripts}
                    connection={conn ?? null}
                    active={notebookMode === NotebookViewMode.Notebook}
                />
            </div>
            {notebookMode === NotebookViewMode.Shell && (
                <div className={styles.view}>
                    <React.Suspense fallback={(
                        <div className={styles.shellLoading} role="status">
                            <strong>[ RUN ]</strong> Loading shell
                        </div>
                    )}>
                        <dependencies.NotebookShellPage notebookId={notebookScripts.notebookId} notebookName={notebookScripts.name} connection={conn ?? null} active />
                    </React.Suspense>
                </div>
            )}
        </div>
    );
};
