import * as React from 'react';
import { withRouter, RouteComponentProps, Link } from 'react-router-dom';
import classNames from 'classnames';
import { DashQLLogo } from '../svg/logo';
import { StudioIcon, DatabaseIcon, TaskListIcon, LogIcon, IIconProps } from '../svg/icons';
import ActionList from './action_list';

import styles from './navigation_bar.module.css';

interface RouteParams {}
interface NavigationBarProps extends RouteComponentProps<RouteParams> {}

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
}

interface StatusPanelState {
    expanded: boolean;
}

class StatusPanel extends React.Component<StatusPanelProps, StatusPanelState> {
    constructor(props: StatusPanelProps) {
        super(props);
        this.state = {
            // XXX
            expanded: props.icon == TaskListIcon
        };
    }

    public render() {
        const Icon = this.props.icon;
        return (
            <div className={classNames(styles.status, {
                    [styles.active]: this.state.expanded
                })}
                onClick={() => {this.setState({...this.state, expanded: !this.state.expanded})}}>
                <div className={styles.statusicon}>
                    {<Icon width="22px" height="22px" {...(this.props.iconProps)} />}
                </div>
                {this.state.expanded &&
                    <div className={styles.statuspanel}>
                        {this.props.children}
                    </div>
                }
            </div>
        )
    }
}

class NavigationBar extends React.Component<NavigationBarProps> {

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
                    <StatusPanel icon={DatabaseIcon}>
                        <div />
                    </StatusPanel>
                    <StatusPanel icon={TaskListIcon}>
                        <ActionList />
                    </StatusPanel>
                    <StatusPanel icon={LogIcon}>
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
