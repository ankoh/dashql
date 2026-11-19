import * as React from 'react';
import icons from '@akohn/dashql-svg-symbols';

import { AnchorAlignment, AnchorSide } from '@akohn/dashql-react/dom/anchored_position';
import { AnchoredOverlay } from '@akohn/dashql-react/components/anchored_overlay';
import { OverlaySize } from '@akohn/dashql-react/components/overlay';
import { VerticalTabs, VerticalTabVariant } from '@akohn/dashql-react/components/vertical_tabs';
import { LogViewer } from '../diagnostics/logs/log_viewer.js';
import { ShellQueryViewer } from './shell_query_history.js';
import { HttpRequestViewer } from '../diagnostics/http_request_viewer.js';
import * as styles from './shell_navbar.module.css';

enum TabKey {
    LogViewer = 0,
    QueryViewer = 1,
    HttpRequests = 2,
}

interface ShellInternalsViewerProps {
    onClose: () => void;
}

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
                [TabKey.HttpRequests]: {
                    tabId: TabKey.HttpRequests,
                    icon: `${icons}#globe_24`,
                    labelShort: 'Requests',
                    ariaLabel: 'HTTP requests',
                    description: 'View the outgoing HTTP requests',
                    disabled: false,
                },
            }}
            tabKeys={[TabKey.LogViewer, TabKey.QueryViewer, TabKey.HttpRequests]}
            tabRenderers={{
                [TabKey.LogViewer]: () => <LogViewer onClose={props.onClose} />,
                [TabKey.QueryViewer]: () => <ShellQueryViewer onClose={props.onClose} />,
                [TabKey.HttpRequests]: () => <HttpRequestViewer onClose={props.onClose} />,
            }}
        />
    );
};

export const ShellInternals: React.FC = () => {
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
                        <use xlinkHref={`${icons}#cpu_16`} />
                    </svg>
                    <span className={styles.actionLabel}>Client</span>
                </button>
            )}
        >
            <ShellInternalsViewer onClose={close} />
        </AnchoredOverlay>
    );
};
