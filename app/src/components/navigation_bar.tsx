import * as React from 'react';
import { withRouter, RouteComponentProps, Link } from 'react-router-dom';
import classNames from 'classnames';
import { DashQLLogo } from '../svg/logo';
import { StudioIcon, ExplorerIcon, IIconProps } from '../svg/icons';

import styles from './navigation_bar.module.css';

interface RouteParams {}
interface NavigationBarProps extends RouteComponentProps<RouteParams> {}

interface TabProps extends IIconProps {
    pathName: string;
}

export function asTab(path: string, Icon: React.FunctionComponent<IIconProps>): React.FunctionComponent<P> {
    return (props: TabProps) => {
        return (
            <div key={path}
                className={classNames(
                    styles.tab,
                    {
                        [styles.active]: props.pathName == path
                    },
                )}
            >
                <Link to={path}>
                    {<Icon width="22px" height="22px" {...(props as IIconProps)} />}
                </Link>
            </div>
        );
    };
}

const StudioTab = asTab('/studio', StudioIcon);
const ExplorerTab = asTab('/explorer', ExplorerIcon);

class NavigationBar extends React.Component<NavigationBarProps> {

    public render() {
        return (
            <div className={styles.navbar}>
                <div className={styles.banner}>
                    <DashQLLogo width="24px" height="24px" />
                </div>
                <div className={styles.tabs}>
                    <StudioTab pathName={this.props.location.pathname} />
                    <ExplorerTab pathName={this.props.location.pathname} />
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
