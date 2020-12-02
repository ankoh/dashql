import * as React from 'react';
import classNames from 'classnames';
import { DatabaseIcon, TaskListIcon, LogIcon, IIconProps } from '../svg/icons';
import ActionList from './action_list';

import styles from './floating_status.module.css';

interface StatusPanelProps {
    icon: React.FunctionComponent<IIconProps>
    iconProps?: IIconProps
    children: JSX.Element;
    statusID: number;
    expandedStatus: number | null;
    onClick: (tab: number) => void;
}

function StatusPanel(props: StatusPanelProps) {
    const Icon = props.icon;
    const expanded = props.statusID == props.expandedStatus;
    return (
        <div className={classNames(styles.status, {
                [styles.active]: expanded
            })}>
            <div className={styles.statusicon} onClick={() => props.onClick(props.statusID)}>
                {<Icon width="22px" height="22px" {...(props.iconProps)} />}
            </div>
            {expanded &&
                <div className={styles.statuspanel}>
                    {props.children}
                </div>
            }
        </div>
    )
}

interface FloatingStatusProps {
}

interface FloatingStatusState {
    expandedStatus: number | null
}

export class FloatingStatus extends React.Component<FloatingStatusProps, FloatingStatusState> {
    constructor(props: FloatingStatusProps) {
        super(props);
        this.state = {
            expandedStatus: 1
        };
    }

    protected toggleTab(tab: number) {
        this.setState({
            ...this.state,
            expandedStatus: (this.state.expandedStatus == tab) ? null : tab
        });
    }

    public render() {
        return (
            <div className={styles.floating_status}>
                <StatusPanel statusID={0} expandedStatus={this.state.expandedStatus} onClick={this.toggleTab.bind(this)} icon={DatabaseIcon}>
                    <div />
                </StatusPanel>
                <StatusPanel statusID={1} expandedStatus={this.state.expandedStatus} onClick={this.toggleTab.bind(this)} icon={TaskListIcon}>
                    <ActionList close={() => this.toggleTab(1)} />
                </StatusPanel>
                <StatusPanel statusID={2} expandedStatus={this.state.expandedStatus} onClick={this.toggleTab.bind(this)} icon={LogIcon}>
                    <div />
                </StatusPanel>
            </div>
        );
    }
}

export function withFloatingStatus<P>(Component: React.ComponentType<P>): React.FunctionComponent<P> {
    return (props: P) => {
        return (
            <div className={styles.container}>
                <div className={styles.page}>
                    <Component {...props} />
                </div>
                <FloatingStatus />
            </div>
        );
    };
}
