import * as React from 'react';
import SystemIndicators from './system_indicators';
import classNames from 'classnames';
import { Link, useLocation } from 'react-router-dom';
import Avatar from 'react-avatar';
import Button from 'react-bootstrap/Button';
import { auth } from '../auth';

import styles from './navbar.module.css';

import logo from '../../static/svg/logo/logo.svg';
import icon_examples from '../../static/svg/icons/library_books.svg';
import icon_studio from '../../static/svg/icons/dashboard.svg';

const Tab = (props: { route: string; location: string; icon: string }) => (
    <div
        key={props.route}
        className={classNames(styles.tab, {
            [styles.active]: props.location == props.route,
        })}
    >
        <Link to={props.route}>
            <Button variant="link">
                <svg className={styles.tab_icon} width="20px" height="20px">
                    <use xlinkHref={`${props.icon}#sym`} />
                </svg>
            </Button>
        </Link>
    </div>
);

export const NavBar = (): React.ReactElement => {
    const location = useLocation();
    return (
        <div className={styles.navbar}>
            <div className={styles.logo}>
                <img src={logo} />
            </div>
            <div className={styles.tabs}>
                <Tab route="/studio" location={location.pathname} icon={icon_studio} />
                <Tab route="/examples" location={location.pathname} icon={icon_examples} />
            </div>
            <div className={styles.account} onClick={async () => auth()}>
                <Avatar githubHandle="ankoh" size="36" round={true} />
            </div>
            <SystemIndicators className={styles.systemlist} />
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