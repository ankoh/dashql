import * as React from 'react';
import { withRouter, RouteComponentProps, Link } from 'react-router-dom';
import classNames from 'classnames';

import styles from './navigation_bar.module.css';

interface RouteParams {}
interface Props extends RouteComponentProps<RouteParams> {}

class NavigationBar extends React.Component<Props> {
    public renderTab(path: string, name: string) {
        return (
            <div key={path}
                className={classNames(
                    styles.tab,
                    styles.tab_name,
                    {
                        [styles.active]: this.props.location.pathname == path
                    },
                )}
            >
                <Link to={path}>
                    {name}
                </Link>
            </div>
        );
    }

    public render() {
        return (
            <div className={styles.container}>
                <div className={styles.banner}>DashQL</div>
                <div className={styles.tabs}>
                    {this.renderTab('/studio', 'Studio')}
                    {this.renderTab('/library', 'Library')}
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
