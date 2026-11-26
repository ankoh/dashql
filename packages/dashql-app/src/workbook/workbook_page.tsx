import * as React from 'react';
import * as styles from './workbook_page.module.css';

import { useLocation } from 'react-router-dom';

import { useConnection, useConnectionViews, useDispatch, useWorkbook } from '@akohn/dashql-react/hooks';
import { useLogger } from '../host/logger_provider.js';
import { PROMOTE_WORKBOOK, useRouteContext, useRouterNavigate } from '../app/router.js';

import { WorkbookFeedPage } from './feed/workbook_feed_page.js';
import { WorkbookViewMode, searchNamesView, useWorkbookViewMode, viewModeOfDefaultView } from './workbook_view_mode.js';

const WorkbookShellsPage = React.lazy(() => import('./shell/workbook_shells_page.js'));

const LOG_CTX = 'workbook_page';

type FeedProps = React.ComponentProps<typeof WorkbookFeedPage>;
type ShellsProps = React.ComponentProps<typeof WorkbookShellsPage>;

const renderFeed = (props: FeedProps) => <WorkbookFeedPage {...props} />;
const renderShells = (props: ShellsProps) => <WorkbookShellsPage {...props} />;

interface Props {
    /// The feed, dashboard and dataflow of the workbook, the feed page by default. A test shows a stand-in, the feed
    /// page needs the whole app.
    feed?: (props: FeedProps) => React.ReactNode;
    /// The shells of the workbook, the shells page by default, loaded once a shell opens
    shells?: (props: ShellsProps) => React.ReactNode;
}

export const WorkbookPage: React.FC<Props> = ({ feed = renderFeed, shells = renderShells }: Props) => {
    const route = useRouteContext();
    const logger = useLogger();
    const workbookScripts = useWorkbook(route.workbookId ?? null);
    const modifyWorkbookScripts = useDispatch(route.workbookId == null ? null : { workbook: route.workbookId });
    // The connections that the scripts of the workbook run on, and the one the next script runs on. The map keeps its
    // identity while these connections are unchanged, a change of another connection doesn't render the feed page.
    const workbookConnections = useConnectionViews(workbookScripts?.connectionIds);
    const scriptConnections = React.useMemo(
        () => new Map((workbookConnections ?? []).map(connection => [connection.connectionId, connection])),
        [workbookConnections],
    );
    const conn = useConnection(workbookScripts?.nextScriptConnectionId ?? null);
    const { mode: workbookMode, setMode: setWorkbookMode } = useWorkbookViewMode();
    const workbookPageVisible = workbookMode !== WorkbookViewMode.Shell;
    // The connection of the visible shell, the connection of the next script until another one is picked.
    // Kept while the shell is closed, the shell reopens on the picked connection of the workbook.
    const [shellPick, setShellPick] = React.useState<{ workbookId: string; connectionId: string } | null>(null);
    const shellConnectionId = shellPick != null && shellPick.workbookId === route.workbookId ? shellPick.connectionId : null;
    const shellConnection = useConnection(shellConnectionId) ?? conn;

    React.useEffect(() => {
        if (route.workbookId === null) {
            logger.warn('missing workbook id', {}, LOG_CTX);
        }
    }, [route.workbookId, logger]);

    // The greeter stays at the root until a script promotes its workbook
    const navigate = useRouterNavigate();
    const location = useLocation();
    const pathname = location.pathname;
    // A workbook opens in its default view, e.g. the dashboard of a shared workbook: once whenever the page shows
    // another workbook. A URL that names a view keeps it, an open shell stays open. A workbook that is still opening
    // waits until the app loader selects it, the selection moves to the path of the workbook and would drop the view.
    const shownWorkbookId = route.openingWorkbook ? null : workbookScripts?.workbookId ?? null;
    const defaultMode = viewModeOfDefaultView(workbookScripts?.defaultView);
    const openedWorkbookId = React.useRef<string | null>(null);
    const openDefaultView = React.useEffectEvent(() => {
        if (searchNamesView(location.search) || workbookMode === WorkbookViewMode.Shell) return;
        if (workbookMode !== defaultMode) setWorkbookMode(defaultMode);
    });
    React.useEffect(() => {
        if (shownWorkbookId == null || openedWorkbookId.current === shownWorkbookId) return;
        openedWorkbookId.current = shownWorkbookId;
        openDefaultView();
    }, [shownWorkbookId]);
    const promotedWorkbookId = workbookScripts != null && !workbookScripts.ephemeral && pathname === '/' ? workbookScripts.workbookId : null;
    React.useEffect(() => {
        if (promotedWorkbookId != null) navigate({ type: PROMOTE_WORKBOOK, value: promotedWorkbookId });
    }, [navigate, promotedWorkbookId]);

    if (route.workbookId === null || workbookScripts == null) {
        return <div />;
    }
    return (
        <div className={styles.page}>
            <div className={workbookPageVisible ? styles.view : styles.view_hidden}>
                {feed({
                    workbookScripts,
                    modifyWorkbookScripts,
                    connection: conn ?? null,
                    scriptConnections,
                    active: workbookMode === WorkbookViewMode.Workbook,
                })}
            </div>
            {workbookMode === WorkbookViewMode.Shell && (
                <div className={styles.view}>
                    <React.Suspense fallback={(
                        <div className={styles.shellLoading} role="status">
                            <strong>[ RUN ]</strong> Loading shell
                        </div>
                    )}>
                        <React.Fragment key={workbookScripts.workbookId}>
                            {shells({
                                workbookId: workbookScripts.workbookId,
                                workbookName: workbookScripts.name,
                                connectionId: shellConnection?.connectionId ?? null,
                                onPickConnection: connectionId => setShellPick({ workbookId: workbookScripts.workbookId, connectionId }),
                            })}
                        </React.Fragment>
                    </React.Suspense>
                </div>
            )}
        </div>
    );
};
