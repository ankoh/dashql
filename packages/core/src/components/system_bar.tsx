import * as React from 'react';
import { RefreshingLogViewer } from './log_viewer';
import { DatabaseViewer } from './database_viewer';
import classNames from 'classnames';

import styles from './system_bar.module.css';

import icon_database from '../../static/svg/icons/database.svg';
import icon_log from '../../static/svg/icons/log.svg';
import icon_info from '../../static/svg/icons/info.svg';

interface SystemPanelProps {
    icon: string;
    children: JSX.Element;
    systemID: number;
    expandedPanel: number | null;
    light?: boolean;
    onClick: (tab: number) => void;
}

const SystemPanel: React.FC<SystemPanelProps> = (props: SystemPanelProps) => {
    const expanded = props.systemID == props.expandedPanel;
    return (
        <div
            className={classNames(styles.system_button, {
                [styles.system_button_light]: props.light || false,
                [styles.active]: expanded,
            })}
        >
            <div className={styles.system_toggle} onClick={() => props.onClick(props.systemID)}>
                <svg className={styles.system_icon} width="20px" height="20px">
                    <use xlinkHref={`${props.icon}#sym`} />
                </svg>
            </div>
            {expanded && <div className={styles.system_panel}>{props.children}</div>}
        </div>
    );
};

interface Props {
    className?: string;
    light?: boolean;
}

export const SystemBar: React.FC<Props> = (props: Props) => {
    const [expanded, setExpanded] = React.useState<number | null>(null);

    const toggleTab = (tab: number): void => setExpanded(expanded == tab ? null : tab);
    return (
        <div className={props.className}>
            <SystemPanel
                systemID={0}
                expandedPanel={expanded}
                onClick={toggleTab.bind(this)}
                icon={icon_database}
                light={props.light}
            >
                <DatabaseViewer onClose={() => toggleTab(0)} />
            </SystemPanel>
            <SystemPanel
                systemID={1}
                expandedPanel={expanded}
                onClick={toggleTab.bind(this)}
                icon={icon_log}
                light={props.light}
            >
                <RefreshingLogViewer onClose={() => toggleTab(1)} />
            </SystemPanel>
            <SystemPanel
                systemID={2}
                expandedPanel={expanded}
                onClick={toggleTab.bind(this)}
                icon={icon_info}
                light={props.light}
            >
                <div />
            </SystemPanel>
        </div>
    );
};