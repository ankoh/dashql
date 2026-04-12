import * as React from 'react';
import icons from '@ankoh/dashql-svg-symbols';

import { AnchorAlignment, AnchorSide } from '../foundations/anchored_position.js';
import { AnchoredOverlay } from '../foundations/anchored_overlay.js';
import { AppSettings } from './app_settings_view.js';
import { AppStats } from './app_stats_view.js';
import { LogViewer } from './log_viewer.js';
import { OverlaySize } from '../foundations/overlay.js';
import { QueryLogViewer } from '../query_status/query_log_viewer.js';
import { VerticalTabs, VerticalTabVariant } from '../foundations/vertical_tabs.js';

interface InternalsViewerProps {
    onClose: () => void;
}

enum TabKey {
    LogViewer = 0,
    QueryViewer = 1,
    AppSettings = 2,
    AppStats = 3,
}

export const InternalsViewer: React.FC<InternalsViewerProps> = (props: InternalsViewerProps) => {
    const [selectedTab, selectTab] = React.useState<TabKey>(TabKey.LogViewer);

    return (
        <VerticalTabs
            variant={VerticalTabVariant.Stacked}
            selectedTab={selectedTab}
            selectTab={selectTab}
            tabProps={{
                [TabKey.LogViewer]: {
                    tabId: TabKey.LogViewer,
                    icon: `${icons}#log`,
                    labelShort: 'Logs',
                    ariaLabel: 'Application logs',
                    description: 'View application logs',
                    disabled: false
                },
                [TabKey.QueryViewer]: {
                    tabId: TabKey.QueryViewer,
                    icon: `${icons}#database`,
                    labelShort: 'Queries',
                    ariaLabel: 'Query history',
                    description: 'View query execution history',
                    disabled: false,
                },
                [TabKey.AppStats]: {
                    tabId: TabKey.AppStats,
                    icon: `${icons}#stats_24`,
                    labelShort: 'Statistics',
                    ariaLabel: 'Application statistics',
                    description: 'View application statistics',
                    disabled: false,
                },
                [TabKey.AppSettings]: {
                    tabId: TabKey.AppSettings,
                    icon: `${icons}#settings`,
                    labelShort: 'Settings',
                    ariaLabel: 'Application settings',
                    description: 'Configure application settings',
                    disabled: false,
                },
            }}
            tabKeys={[TabKey.LogViewer, TabKey.QueryViewer, TabKey.AppStats, TabKey.AppSettings]}
            tabRenderers={{
                [TabKey.LogViewer]: _props => (
                    <LogViewer onClose={props.onClose} />
                ),
                [TabKey.QueryViewer]: _props => (
                    <QueryLogViewer onClose={props.onClose} />
                ),
                [TabKey.AppStats]: _props => (
                    <AppStats onClose={props.onClose} />
                ),
                [TabKey.AppSettings]: _props => (
                    <AppSettings onClose={props.onClose} />
                ),
            }}
        />
    );
}

type InternalsViewerOverlayProps = {
    isOpen: boolean;
    onClose: () => void;
    renderAnchor: (p: object) => React.ReactElement;
    side?: AnchorSide;
    align?: AnchorAlignment;
    anchorOffset?: number;
}
export function InternalsViewerOverlay(props: InternalsViewerOverlayProps) {
    return (
        <AnchoredOverlay
            open={props.isOpen}
            onClose={props.onClose}
            renderAnchor={props.renderAnchor}
            side={props.side}
            align={props.align}
            anchorOffset={props.anchorOffset}
            overlayProps={{
                width: OverlaySize.XL,
                height: OverlaySize.L,
            }}
        >
            <InternalsViewer onClose={props.onClose} />
        </AnchoredOverlay>
    );
}
