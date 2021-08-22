import * as React from 'react';
import SystemIndicators from './system_indicators';

import styles from './navbar.module.css';

import logo from '../../static/svg/logo/logo.svg';

export const NavBar = (): React.ReactElement => {
    return (
        <div className={styles.navbar_minimal}>
            <div className={styles.logo}>
                <svg width="32px" height="32px">
                    <use xlinkHref={`${logo}#sym`} />
                </svg>
            </div>
            <SystemIndicators className={styles.systemlist_minimal} />
        </div>
    );
};

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
