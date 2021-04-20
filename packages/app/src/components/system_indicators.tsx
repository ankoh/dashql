import * as React from 'react';
import ActionList from './action_list';
import LogViewer from './log_viewer';
import DatabaseViewer from './database_viewer';
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

function SystemPanel(props: SystemPanelProps) {
    const expanded = props.systemID == props.expandedPanel;
    return (
        <div
            className={classNames(styles.system, {
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
}

interface Props {
    className: string;
}

interface State {
    expandedPanel: number | null;
}

class SystemIndicators extends React.Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = {
            expandedPanel: null,
        };
    }

    protected toggleTab(tab: number): void {
        this.setState({
            ...this.state,
            expandedPanel: this.state.expandedPanel == tab ? null : tab,
        });
    }
    public render(): React.ReactElement {
        return (
            <div className={this.props.className}>
                <SystemPanel
                    systemID={0}
                    expandedPanel={this.state.expandedPanel}
                    onClick={this.toggleTab.bind(this)}
                    icon={icon_database}
                >
                    <DatabaseViewer onClose={() => this.toggleTab(0)} />
                </SystemPanel>
                <SystemPanel
                    systemID={1}
                    expandedPanel={this.state.expandedPanel}
                    onClick={this.toggleTab.bind(this)}
                    icon={icon_tasks}
                >
                    <ActionList onClose={() => this.toggleTab(1)} />
                </SystemPanel>
                <SystemPanel
                    systemID={2}
                    expandedPanel={this.state.expandedPanel}
                    onClick={this.toggleTab.bind(this)}
                    icon={icon_log}
                >
                    <LogViewer onClose={() => this.toggleTab(2)} />
                </SystemPanel>
            </div>
        );
    }
}

export default SystemIndicators;
