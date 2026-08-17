import * as React from 'react';
import icons from '@ankoh/dashql-svg-symbols';

import { AnchorAlignment, AnchorSide } from '../shared/ui/foundations/anchored_position.js';
import { AnchoredOverlay } from '../shared/ui/foundations/anchored_overlay.js';
import { OverlaySize } from '../shared/ui/foundations/overlay.js';
import { VerticalTabs, VerticalTabVariant } from '../shared/ui/foundations/vertical_tabs.js';
import { LogViewer } from '../shared/ui/logs/log_viewer.js';
import { QueryHistoryViewer, QueryTarget, type QueryEntry } from '../app/notebook/connections/ui/query_viewer.js';
import type { ShellQueryExecutionTracker } from './query_execution.js';
import * as styles from './shell_navbar.module.css';

enum TabKey {
    LogViewer = 0,
    QueryViewer = 1,
}

interface ShellInternalsViewerProps {
    onClose: () => void;
    queryExecutions: ShellQueryExecutionTracker;
}

const ShellQueryViewer: React.FC<ShellInternalsViewerProps> = props => {
    const executions = React.useSyncExternalStore(
        props.queryExecutions.subscribe,
        props.queryExecutions.getSnapshot,
        props.queryExecutions.getSnapshot,
    );
    const entries: QueryEntry[] = executions.map(query => ({
        connectionId: 'shell',
        sourceName: 'Hyper',
        target: QueryTarget.LOCAL,
        queryId: query.queryId,
        query,
    }));
    return <QueryHistoryViewer entries={entries} onClose={props.onClose} />;
};

export const ShellInternalsViewer: React.FC<ShellInternalsViewerProps> = props => {
    const [selectedTab, selectTab] = React.useState<TabKey>(TabKey.LogViewer);

    return (
        <VerticalTabs
            variant={VerticalTabVariant.Stacked}
            selectedTab={selectedTab}
            selectTab={selectTab}
            tabProps={{
                [TabKey.LogViewer]: {
                    tabId: TabKey.LogViewer,
                    icon: `${icons}#log_24`,
                    labelShort: 'Logs',
                    ariaLabel: 'Application logs',
                    description: 'View application logs',
                    disabled: false,
                },
                [TabKey.QueryViewer]: {
                    tabId: TabKey.QueryViewer,
                    icon: `${icons}#database`,
                    labelShort: 'Queries',
                    ariaLabel: 'Query history',
                    description: 'View query execution history',
                    disabled: false,
                },
            }}
            tabKeys={[TabKey.LogViewer, TabKey.QueryViewer]}
            tabRenderers={{
                [TabKey.LogViewer]: () => <LogViewer onClose={props.onClose} />,
                [TabKey.QueryViewer]: () => (
                    <ShellQueryViewer {...props} />
                ),
            }}
        />
    );
};

export const ShellInternals: React.FC<{ queryExecutions: ShellQueryExecutionTracker }> = props => {
    const [isOpen, setIsOpen] = React.useState(false);
    const close = React.useCallback(() => setIsOpen(false), []);

    return (
        <AnchoredOverlay
            open={isOpen}
            onOpen={() => setIsOpen(true)}
            onClose={close}
            side={AnchorSide.OutsideBottom}
            align={AnchorAlignment.End}
            anchorOffset={16}
            overlayProps={{ width: OverlaySize.XL, height: OverlaySize.L }}
            renderAnchor={(props: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
                <button
                    {...props}
                    type="button"
                    className={styles.actionButton}
                >
                    <svg width="14px" height="14px" aria-hidden="true">
                        <use xlinkHref={`${icons}#processor`} />
                    </svg>
                    <span className={styles.actionLabel}>Internals</span>
                </button>
            )}
        >
            <ShellInternalsViewer onClose={close} queryExecutions={props.queryExecutions} />
        </AnchoredOverlay>
    );
};
