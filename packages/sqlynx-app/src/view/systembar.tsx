import * as React from 'react';
import { RefreshingLogViewer } from './log_viewer.js';
import { useAppConfig } from '../app_config.js';
import { Button, HoverMode } from './button.js';

import styles from './systembar.module.css';

import * as icons from '../../static/svg/symbols.generated.svg';

interface SystemPanelProps {
    icon: string;
    children: JSX.Element;
    systemID: number;
    expandedPanel: number | null;
    onClick: (tab: number) => void;
    preferredHeight: string;
    preferredWidth: string;
}

const SystemPanel: React.FC<SystemPanelProps> = (props: SystemPanelProps) => {
    const expanded = props.systemID == props.expandedPanel;
    return (
        <div className={styles.system_button}>
            <Button
                className={styles.system_toggle}
                hover={HoverMode.Darken}
                onClick={() => props.onClick(props.systemID)}
            >
                <svg className={styles.system_icon} width="20px" height="20px">
                    <use xlinkHref={props.icon} />
                </svg>
            </Button>
            {expanded && (
                <div
                    className={styles.system_panel}
                    style={{
                        height: props.preferredHeight,
                        width: props.preferredWidth,
                    }}
                >
                    {props.children}
                </div>
            )}
        </div>
    );
};

interface Props {
    className?: string;
}

export const SystemBar: React.FC<Props> = (props: Props) => {
    const [expanded, setExpanded] = React.useState<number | null>(null);
    const appConfig = useAppConfig();

    const toggleTab = (tab: number): void => setExpanded(expanded == tab ? null : tab);
    return (
        <div className={props.className}>
            {appConfig?.value?.features?.logViewer && (
                <SystemPanel
                    systemID={1}
                    expandedPanel={expanded}
                    onClick={toggleTab.bind(this)}
                    icon={`${icons}#log`}
                    preferredHeight="400px"
                    preferredWidth="500px"
                >
                    <RefreshingLogViewer onClose={() => toggleTab(1)} />
                </SystemPanel>
            )}
            {appConfig?.value?.features?.appInfo && (
                <SystemPanel
                    systemID={2}
                    expandedPanel={expanded}
                    onClick={toggleTab.bind(this)}
                    icon={`${icons}#info`}
                    preferredHeight="400px"
                    preferredWidth="400px"
                >
                    <div />
                </SystemPanel>
            )}
        </div>
    );
};
