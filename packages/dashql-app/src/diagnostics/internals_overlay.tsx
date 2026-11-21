import * as React from 'react';
import icons from '@akohn/dashql-svg-symbols';

import { AnchorAlignment, AnchorSide } from '@akohn/dashql-react/dom/anchored_position';
import { AnchoredOverlay } from '@akohn/dashql-react/components/anchored_overlay';
import { AppSettings } from './app_settings_view.js';
import { StorageWriterView } from '../workbook/persistence/storage_writer_view.js';
import { LogViewer } from './logs/log_viewer.js';
import { OverlaySize } from '@akohn/dashql-react/components/overlay';
import { QueryViewer } from '../connections/query_viewer.js';
import { HttpRequestViewer } from './http_request_viewer.js';
import { VerticalTabs, VerticalTabVariant } from '@akohn/dashql-react/components/vertical_tabs';
import { StorageBrowserView } from './storage_browser_view.js';
import { ToolsView } from './tools_view.js';

interface InternalsViewerProps {
    /// The active workbook UUID, used by workbook-scoped tabs (e.g. the query cache inspector).
    workbookId: string | null;
    onClose: () => void;
}

enum TabKey {
    LogViewer = 0,
    QueryViewer = 1,
    AppSettings = 2,
    StorageWriter = 3,
    StorageBrowser = 6,
    HttpRequests = 8,
    Tools = 9,
}

/// The groups of the tabs, separated by bars in the tab bar
const TAB_GROUP_DIAGNOSTICS = 'Diagnostics';
const TAB_GROUP_CONNECTIONS = 'Connections';
const TAB_GROUP_STORAGE = 'Storage';
const TAB_GROUP_SETTINGS = 'Settings';

export const InternalsViewer: React.FC<InternalsViewerProps> = (props: InternalsViewerProps) => {
    const [selectedTab, selectTab] = React.useState<TabKey>(TabKey.LogViewer);
    const tabKeys = [TabKey.LogViewer, TabKey.HttpRequests, TabKey.QueryViewer, TabKey.StorageBrowser, TabKey.StorageWriter, TabKey.Tools, TabKey.AppSettings];

    return (
        <VerticalTabs
            variant={VerticalTabVariant.Stacked}
            selectedTab={selectedTab}
            selectTab={selectTab}
            tabProps={{
                [TabKey.LogViewer]: {
                    tabId: TabKey.LogViewer,
                    group: TAB_GROUP_DIAGNOSTICS,
                    icon: `${icons}#log_24`,
                    labelShort: 'Logs',
                    ariaLabel: 'Application logs',
                    description: 'View application logs',
                    disabled: false,
                },
                [TabKey.HttpRequests]: {
                    tabId: TabKey.HttpRequests,
                    group: TAB_GROUP_CONNECTIONS,
                    icon: `${icons}#globe_24`,
                    labelShort: 'Requests',
                    ariaLabel: 'HTTP requests',
                    description: 'View the outgoing HTTP requests',
                    disabled: false,
                },
                [TabKey.QueryViewer]: {
                    tabId: TabKey.QueryViewer,
                    group: TAB_GROUP_CONNECTIONS,
                    icon: `${icons}#database`,
                    labelShort: 'Queries',
                    ariaLabel: 'Query execution history',
                    description: 'View query execution history',
                    disabled: false,
                },
                [TabKey.StorageWriter]: {
                    tabId: TabKey.StorageWriter,
                    group: TAB_GROUP_STORAGE,
                    icon: `${icons}#versions_24`,
                    labelShort: 'Storage Writer',
                    ariaLabel: 'Storage writer',
                    description: 'View storage writer statistics',
                    disabled: false,
                },
                [TabKey.StorageBrowser]: {
                    tabId: TabKey.StorageBrowser,
                    group: TAB_GROUP_STORAGE,
                    icon: `${icons}#folder`,
                    labelShort: 'Storage',
                    ariaLabel: 'Storage browser',
                    description: 'Browse the app storage folders',
                    disabled: false,
                },
                [TabKey.AppSettings]: {
                    tabId: TabKey.AppSettings,
                    group: TAB_GROUP_SETTINGS,
                    icon: `${icons}#settings_24`,
                    labelShort: 'Settings',
                    ariaLabel: 'Application settings',
                    description: 'Configure application settings',
                    disabled: false,
                },
                [TabKey.Tools]: {
                    tabId: TabKey.Tools,
                    group: TAB_GROUP_SETTINGS,
                    icon: `${icons}#tools_24`,
                    labelShort: 'Tools',
                    ariaLabel: 'Tools',
                    description: 'Open the tools of DashQL',
                    disabled: false,
                },
            }}
            tabKeys={tabKeys}
            tabRenderers={{
                [TabKey.LogViewer]: _props => (
                    <LogViewer onClose={props.onClose} />
                ),
                [TabKey.HttpRequests]: _props => (
                    <HttpRequestViewer onClose={props.onClose} />
                ),
                [TabKey.QueryViewer]: _props => (
                    <QueryViewer onClose={props.onClose} />
                ),
                [TabKey.StorageWriter]: _props => (
                    <StorageWriterView workbookId={props.workbookId} onClose={props.onClose} />
                ),
                [TabKey.StorageBrowser]: _props => (
                    <StorageBrowserView onClose={props.onClose} />
                ),
                [TabKey.AppSettings]: _props => (
                    <AppSettings onClose={props.onClose} />
                ),
                [TabKey.Tools]: _props => (
                    <ToolsView onClose={props.onClose} />
                ),
            }}
        />
    );
}

type InternalsViewerOverlayProps = {
    /// The active workbook UUID, forwarded to workbook-scoped tabs (e.g. the query cache inspector).
    /// Omitted on setup/loading pages that have no active workbook — the query cache tab then shows
    /// an empty "no active workbook" state.
    workbookId?: string | null;
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
            <InternalsViewer workbookId={props.workbookId ?? null} onClose={props.onClose} />
        </AnchoredOverlay>
    );
}
