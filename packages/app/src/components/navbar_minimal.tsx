import * as React from 'react';
import SystemIndicators from './system_indicators';
import { withRouter, RouteComponentProps } from 'react-router-dom';

import styles from './navbar.module.css';

import logo from '../../static/svg/logo/logo.svg';

type Props = RouteComponentProps<Record<string, string | undefined>>;

class NavBarImpl extends React.Component<Props> {
    constructor(props: Props) {
        super(props);
    }

    public render() {
        return (
            <div className={styles.navbar_minimal}>
                <div className={styles.logo}>
                    <img src={logo} />
                </div>
                <SystemIndicators className={styles.systemlist_minimal} />
            </div>
        );
    }
}

export const NavBar = withRouter(NavBarImpl);

export function withNavBar<P>(Component: React.ComponentType<P>): React.FunctionComponent<P> {
    // eslint-disable-next-line react/display-name
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
