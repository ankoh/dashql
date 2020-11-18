import * as React from 'react';
import { withRouter, RouteComponentProps, Link } from 'react-router-dom';
import classNames from 'classnames';
import { DashQLLogo } from '../svg/logo';
import { StudioIcon, DatabaseIcon, TaskListIcon, LogIcon, IIconProps } from '../svg/icons';

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

interface StatusProps extends IIconProps {
    expanded?: boolean;
}
export function createStatus(Icon: React.FunctionComponent<StatusProps>): React.FunctionComponent<StatusProps> {
    return (props: StatusProps) => {
        return (
            <div className={styles.status}>
                {<Icon width="22px" height="22px" {...(props as StatusProps)} />}
            </div>
        );
    };
}
const DatabaseStatus = createStatus(DatabaseIcon);
const TaskStatus = createStatus(TaskListIcon);
const LogStatus = createStatus(LogIcon);

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
                    <DatabaseStatus />
                    <TaskStatus />
                    <LogStatus />
                </div>
            </div>
        );
    }
}

export const NavBar = withRouter(NavigationBar);

export function withNavBar<P>(Component: React.ComponentType<P>): React.FunctionComponent<P> {
    return (props: P) => {
        return (
            <div className={styles.wrapper}>
                <NavBar />
                <Component {...props} />
            </div>
        );
    };
}
