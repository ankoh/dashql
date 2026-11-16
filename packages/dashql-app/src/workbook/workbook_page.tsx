import * as React from 'react';
import * as styles from './workbook_page.module.css';

import { useLocation } from 'react-router-dom';

import { useConnections, useDispatch, useWorkbook } from '../runtime/runtime_hooks.js';
import type { ConnectionState } from '@ankoh/dashql-runtime/connections/connection_state';
import { isEphemeralWorkbook, newScriptConnection, workbookConnectionIds } from '@ankoh/dashql-runtime/workbook/scripts/workbook_scripts';
import { useLogger } from '../platform/logger/logger_provider.js';
import { PROMOTE_WORKBOOK, useRouteContext, useRouterNavigate } from '../app/router/router.js';

import { WorkbookFeedPage } from './feed/workbook_feed_page.js';
import { WorkbookViewMode, useWorkbookViewMode } from './workbook_view_mode.js';

const WorkbookShellsPage = React.lazy(() => import('./shell/workbook_shells_page.js'));

const LOG_CTX = 'workbook_page';

export interface WorkbookPageDependencies {
    useWorkbook: typeof useWorkbook;
    useDispatch: typeof useDispatch;
    useConnections: typeof useConnections;
    useLogger: typeof useLogger;
    useRouteContext: typeof useRouteContext;
    useRouterNavigate: typeof useRouterNavigate;
    useLocation: typeof useLocation;
    useWorkbookViewMode: typeof useWorkbookViewMode;
    WorkbookFeedPage: typeof WorkbookFeedPage;
    WorkbookShellsPage: typeof WorkbookShellsPage;
}

const DEFAULT_DEPENDENCIES: WorkbookPageDependencies = {
    useWorkbook,
    useDispatch,
    useConnections,
    useLogger,
    useRouteContext,
    useRouterNavigate,
    useLocation,
    useWorkbookViewMode,
    WorkbookFeedPage,
    WorkbookShellsPage,
};

interface Props {
    dependencies?: WorkbookPageDependencies;
}

export const WorkbookPage: React.FC<Props> = (props: Props) => {
    const dependencies = props.dependencies ?? DEFAULT_DEPENDENCIES;
    const route = dependencies.useRouteContext();
    const logger = dependencies.useLogger();
    const workbookScripts = dependencies.useWorkbook(route.workbookId ?? null);
    const modifyWorkbookScripts = dependencies.useDispatch(route.workbookId == null ? null : { workbook: route.workbookId });
    // The connections that the scripts of the workbook run on, and the one the next script runs on
    const connections = dependencies.useConnections();
    const nextConnectionId = workbookScripts == null ? null : newScriptConnection(workbookScripts, null);
    const conn = nextConnectionId == null ? null : connections.get(nextConnectionId) ?? null;
    const scriptConnections = new Map<string, ConnectionState>();
    for (const connectionId of workbookScripts == null ? [] : workbookConnectionIds(workbookScripts)) {
        const connection = connections.get(connectionId);
        if (connection != null) scriptConnections.set(connectionId, connection);
    }
    const { mode: workbookMode } = dependencies.useWorkbookViewMode();
    const workbookPageVisible = workbookMode !== WorkbookViewMode.Shell;
    // The connection of the visible shell, the connection of the next script until another one is picked.
    // Kept while the shell is closed, the shell reopens on the picked connection of the workbook.
    const [shellPick, setShellPick] = React.useState<{ workbookId: string; connectionId: string } | null>(null);
    const shellConnectionId = shellPick != null && shellPick.workbookId === route.workbookId ? shellPick.connectionId : null;
    const shellConnection = (shellConnectionId == null ? null : connections.get(shellConnectionId)) ?? conn ?? null;

    React.useEffect(() => {
        if (route.workbookId === null) {
            logger.warn('missing workbook id', {}, LOG_CTX);
        }
    }, [route.workbookId]);

    // The greeter stays at the root until a script promotes its workbook
    const navigate = dependencies.useRouterNavigate();
    const pathname = dependencies.useLocation().pathname;
    const promotedWorkbookId = workbookScripts != null && !isEphemeralWorkbook(workbookScripts) && pathname === '/' ? workbookScripts.workbookId : null;
    React.useEffect(() => {
        if (promotedWorkbookId != null) navigate({ type: PROMOTE_WORKBOOK, value: promotedWorkbookId });
    }, [navigate, promotedWorkbookId]);

    if (route.workbookId === null || workbookScripts == null) {
        return <div />;
    }
    return (
        <div className={styles.page}>
            <div className={workbookPageVisible ? styles.view : styles.view_hidden}>
                <dependencies.WorkbookFeedPage
                    workbookScripts={workbookScripts}
                    modifyWorkbookScripts={modifyWorkbookScripts}
                    connection={conn ?? null}
                    scriptConnections={scriptConnections}
                    active={workbookMode === WorkbookViewMode.Workbook}
                />
            </div>
            {workbookMode === WorkbookViewMode.Shell && (
                <div className={styles.view}>
                    <React.Suspense fallback={(
                        <div className={styles.shellLoading} role="status">
                            <strong>[ RUN ]</strong> Loading shell
                        </div>
                    )}>
                        <dependencies.WorkbookShellsPage
                            key={workbookScripts.workbookId}
                            workbookId={workbookScripts.workbookId}
                            workbookName={workbookScripts.name}
                            connectionId={shellConnection?.connectionId ?? null}
                            onPickConnection={connectionId => setShellPick({ workbookId: workbookScripts.workbookId, connectionId })}
                        />
                    </React.Suspense>
                </div>
            )}
        </div>
    );
};
