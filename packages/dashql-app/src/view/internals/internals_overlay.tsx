import * as React from 'react';
import icons from '@ankoh/dashql-svg-symbols';

import { AnchorAlignment, AnchorSide } from '../foundations/anchored_position.js';
import { AnchoredOverlay } from '../foundations/anchored_overlay.js';
import { AppSettings } from './app_settings_view.js';
import { StorageWriterView } from './storage_writer_view.js';
import { LogViewer } from './log_viewer.js';
import { OverlaySize } from '../foundations/overlay.js';
import { QueryViewer } from './query_viewer.js';
import { VerticalTabs, VerticalTabVariant } from '../foundations/vertical_tabs.js';
import { DockerManager } from './docker_manager.js';
import { useDockerClient } from '../../platform/docker/docker_client_provider.js';

interface InternalsViewerProps {
    onClose: () => void;
}

enum TabKey {
    LogViewer = 0,
    QueryViewer = 1,
    AppSettings = 2,
    StorageWriter = 3,
    Docker = 4,
}

export const InternalsViewer: React.FC<InternalsViewerProps> = (props: InternalsViewerProps) => {
    const [selectedTab, selectTab] = React.useState<TabKey>(TabKey.LogViewer);
    const dockerClient = useDockerClient();
    const dockerEnabled = dockerClient != null;

    const tabKeys = React.useMemo(() => {
        const keys: TabKey[] = [TabKey.LogViewer, TabKey.QueryViewer, TabKey.StorageWriter];
        if (dockerEnabled) {
            keys.push(TabKey.Docker);
        }
        keys.push(TabKey.AppSettings);
        return keys;
    }, [dockerEnabled]);

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
                [TabKey.StorageWriter]: {
                    tabId: TabKey.StorageWriter,
                    icon: `${icons}#folder`,
                    labelShort: 'Storage Writer',
                    ariaLabel: 'Storage writer',
                    description: 'View storage writer statistics',
                    disabled: false,
                },
                [TabKey.Docker]: {
                    tabId: TabKey.Docker,
                    icon: `${icons}#package`,
                    labelShort: 'Docker',
                    ariaLabel: 'Docker containers',
                    description: 'Manage local Hyper containers',
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
            tabKeys={tabKeys}
            tabRenderers={{
                [TabKey.LogViewer]: _props => (
                    <LogViewer onClose={props.onClose} />
                ),
                [TabKey.QueryViewer]: _props => (
                    <QueryViewer onClose={props.onClose} />
                ),
                [TabKey.StorageWriter]: _props => (
                    <StorageWriterView onClose={props.onClose} />
                ),
                [TabKey.Docker]: _props => (
                    <DockerManager onClose={props.onClose} />
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
