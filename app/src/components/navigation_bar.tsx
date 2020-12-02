import * as React from 'react';
import { withRouter, RouteComponentProps, Link } from 'react-router-dom';
import classNames from 'classnames';
import { StudioIcon, IIconProps } from '../svg/icons';

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

interface RouteParams {}
interface NavigationBarProps extends RouteComponentProps<RouteParams> {}

class NavigationBar extends React.Component<NavigationBarProps> {
    constructor(props: NavigationBarProps) {
        super(props);
    }

    public render() {
        return (
            <div className={styles.navbar}>
                <div className={styles.tabs}>
                    <StudioTab pathName={this.props.location.pathname} />
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
