import * as React from 'react';
import { withRouter, RouteComponentProps, Link } from 'react-router-dom';
import classNames from 'classnames';
import { DashQLLogo } from '../svg/logo';
import { StudioIcon, DatabaseIcon, TaskListIcon, LogIcon, IIconProps } from '../svg/icons';
import ActionList from './action_list';

import styles from './navigation_bar.module.css';

interface TabProps extends IIconProps {
    pathName: string;
}
function createTab(path: string, Icon: React.FunctionComponent<IIconProps>): React.FunctionComponent<TabProps> {
    return (props: TabProps) => {
        return (
            <div key={path}
                className={classNames(styles.tab, {
                    [styles.active]: props.pathName == path
                })}>
                <Link to={path}>
                    {<Icon width="22px" height="22px" {...(props as IIconProps)} />}
                </Link>
            </div>
        );
    };
}
const StudioTab = createTab('/studio', StudioIcon);

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
            })}
            onClick={() => props.onClick(props.statusID)}>
            <div className={styles.statusicon}>
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

interface RouteParams {}
interface NavigationBarProps extends RouteComponentProps<RouteParams> {

}
interface NavigationBarState {
    expandedStatus: number | null
}

class NavigationBar extends React.Component<NavigationBarProps, NavigationBarState> {
    constructor(props: NavigationBarProps) {
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
            <div className={styles.navbar}>
                <div className={styles.banner}>
                    <DashQLLogo width="26px" height="26px" />
                </div>
                <div className={styles.tabs}>
                    <StudioTab pathName={this.props.location.pathname} />
                </div>
                <div className={styles.statuslist}>
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
            </div>
        );
    }
}

export const NavBar = withRouter(NavigationBar);

export function withNavBar<P>(Component: React.ComponentType<P>): React.FunctionComponent<P> {
    return (props: P) => {
        return (
            <div className={styles.container}>
                <div className={styles.page}>
                    <Component {...props} />
                </div>
                <NavBar />
            </div>
        );
    };
}
