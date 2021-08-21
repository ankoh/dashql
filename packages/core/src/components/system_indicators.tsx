import * as React from 'react';
import { TaskList } from './task_list';
import { LogViewer } from './log_viewer';
import { DatabaseViewer } from './database_viewer';
import classNames from 'classnames';

import styles from './system_indicators.module.css';

import icon_database from '../../static/svg/icons/database.svg';
import icon_log from '../../static/svg/icons/log.svg';
import icon_tasks from '../../static/svg/icons/task_list.svg';

interface SystemPanelProps {
    icon: string;
    children: JSX.Element;
    systemID: number;
    expandedPanel: number | null;
    onClick: (tab: number) => void;
}

const SystemPanel: React.FC<SystemPanelProps> = (props: SystemPanelProps) => {
    const expanded = props.systemID == props.expandedPanel;
    return (
        <div
            className={classNames(styles.system, {
                [styles.active]: expanded,
            })}
        >
            <div className={styles.system_toggle} onClick={() => props.onClick(props.systemID)}>
                <svg className={styles.system_icon} width="18px" height="18px">
                    <use xlinkHref={`${props.icon}#sym`} />
                </svg>
            </div>
            {expanded && <div className={styles.system_panel}>{props.children}</div>}
        </div>
    );
};

interface Props {
    className: string;
}

export const SystemIndicators: React.FC<Props> = (props: Props) => {
    const [expanded, setExpanded] = React.useState<number | null>(null);

    const toggleTab = (tab: number): void => setExpanded(expanded == tab ? null : tab);
    return (
        <div className={props.className}>
            <SystemPanel systemID={0} expandedPanel={expanded} onClick={toggleTab.bind(this)} icon={icon_database}>
                <DatabaseViewer onClose={() => toggleTab(0)} />
            </SystemPanel>
            <SystemPanel systemID={1} expandedPanel={expanded} onClick={toggleTab.bind(this)} icon={icon_tasks}>
                <TaskList onClose={() => toggleTab(1)} />
            </SystemPanel>
            <SystemPanel systemID={2} expandedPanel={expanded} onClick={toggleTab.bind(this)} icon={icon_log}>
                <LogViewer onClose={() => toggleTab(2)} />
            </SystemPanel>
        </div>
    );
};

export default SystemIndicators;
