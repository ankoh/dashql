import * as React from 'react';
import ActionList from './action_list';
import LogViewer from './log_viewer';
import classNames from 'classnames';
import { StudioIcon, DatabaseIcon, TaskListIcon, LogIcon, IIconProps } from '../svg/icons';
import { withRouter, RouteComponentProps, Link } from 'react-router-dom';
import Avatar from 'react-avatar';
import { auth } from '../auth';

import styles from './navigation_bar.module.css';

import logo from '../../public/logo.svg';

interface TabProps extends IIconProps {
    pathName: string;
}
function createTab(path: string, Icon: React.FunctionComponent<IIconProps>): React.FunctionComponent<TabProps> {
    return (props: TabProps) => {
        return (
            <div
                key={path}
                className={classNames(styles.tab, {
                    [styles.active]: props.pathName == path,
                })}
            >
                <Link to={path}>
                    {<Icon width="22px" height="22px" fill="rgb(230, 230, 230)" {...(props as IIconProps)} />}
                </Link>
            </div>
        );
    };
}
const StudioTab = createTab('/studio', StudioIcon);

interface StatusPanelProps {
    icon: React.FunctionComponent<IIconProps>;
    iconProps?: IIconProps;
    children: JSX.Element;
    statusID: number;
    expandedStatus: number | null;
    onClick: (tab: number) => void;
}

function StatusPanel(props: StatusPanelProps) {
    const Icon = props.icon;
    const expanded = props.statusID == props.expandedStatus;
    return (
        <div
            className={classNames(styles.status, {
                [styles.active]: expanded,
            })}
        >
            <div className={styles.statusicon} onClick={() => props.onClick(props.statusID)}>
                {<Icon width="22px" height="22px" fill="rgb(230, 230, 230)" {...props.iconProps} />}
            </div>
            {expanded && <div className={styles.statuspanel}>{props.children}</div>}
        </div>
    );
}

interface RouteParams {}
interface NavigationBarProps extends RouteComponentProps<RouteParams> {}
interface NavigationBarState {
    expandedStatus: number | null;
}

class NavigationBar extends React.Component<NavigationBarProps, NavigationBarState> {
    constructor(props: NavigationBarProps) {
        super(props);
        this.state = {
            expandedStatus: null,
        };
    }

    protected toggleTab(tab: number) {
        this.setState({
            ...this.state,
            expandedStatus: this.state.expandedStatus == tab ? null : tab,
        });
    }

    public render() {
        return (
            <div className={styles.navbar}>
                <div className={styles.logo}>
                    <img src={logo} />
                </div>
                <div className={styles.tabs}>
                    <StudioTab pathName={this.props.location.pathname} />
                </div>
                <div className={styles.account} onClick={async () => auth()}>
                    <Avatar githubHandle="ankoh" size="36" round={true} />
                </div>
                <div className={styles.statuslist}>
                    <StatusPanel
                        statusID={0}
                        expandedStatus={this.state.expandedStatus}
                        onClick={this.toggleTab.bind(this)}
                        icon={DatabaseIcon}
                    >
                        <div />
                    </StatusPanel>
                    <StatusPanel
                        statusID={1}
                        expandedStatus={this.state.expandedStatus}
                        onClick={this.toggleTab.bind(this)}
                        icon={TaskListIcon}
                    >
                        <ActionList onClose={() => this.toggleTab(1)} />
                    </StatusPanel>
                    <StatusPanel
                        statusID={2}
                        expandedStatus={this.state.expandedStatus}
                        onClick={this.toggleTab.bind(this)}
                        icon={LogIcon}
                    >
                        <LogViewer onClose={() => this.toggleTab(1)} />
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
