import * as React from 'react';
import Button from 'react-bootstrap/Button';
import classNames from 'classnames';
import { SystemBar } from './system_bar';
import { Link, useLocation } from 'react-router-dom';
import { useActiveGitHubProfile } from '../github';

import styles from './navbar.module.css';

import logo from '../../static/svg/logo/logo.svg';
import icon_examples from '../../static/svg/icons/book_open_blank_variant.svg';
import icon_web from '../../static/svg/icons/cloud.svg';
import icon_explorer from '../../static/svg/icons/compass.svg';
import icon_account from '../../static/svg/icons/folder_account.svg';

const Tab = (props: { route: string; location: string; icon: string }) => (
    <div
        key={props.route}
        className={classNames(styles.tab, {
            [styles.active]: props.location == props.route,
        })}
    >
        <Link to={props.route} className={styles.tab_link}>
            <Button variant="link" className={styles.tab_button}>
                <svg className={styles.tab_icon} width="20px" height="20px">
                    <use xlinkHref={`${props.icon}#sym`} />
                </svg>
            </Button>
        </Link>
    </div>
);

export const NavBar = (): React.ReactElement => {
    const location = useLocation();
    const ghProfile = useActiveGitHubProfile();
    return (
        <div className={styles.navbar}>
            <Link className={styles.logo} to="/">
                <svg width="32px" height="32px">
                    <use xlinkHref={`${logo}#sym`} />
                </svg>
            </Link>
            <div className={styles.tabs}>
                <Tab route="/explorer" location={location.pathname} icon={icon_explorer} />
                <Tab route="/examples" location={location.pathname} icon={icon_examples} />
                <Tab route="/cloud" location={location.pathname} icon={icon_web} />
            </div>
            <Link className={styles.account} to="/account">
                {ghProfile?.avatarUrl ? (
                    <img className={styles.avatar} width="32px" height="32px" src={ghProfile!.avatarUrl} />
                ) : (
                    <svg className={styles.avatar} width="26px" height="26px">
                        <use xlinkHref={`${icon_account}#sym`} />
                    </svg>
                )}
            </Link>
            <SystemBar className={styles.systemlist} />
        </div>
    );
};

export const SlimNavBar = (): React.ReactElement => {
    return (
        <div className={styles.navbar_slim}>
            <Link className={styles.logo_slim} to="/">
                <svg width="32px" height="32px">
                    <use xlinkHref={`${logo}#sym`} />
                </svg>
            </Link>
            <SystemBar className={styles.systemlist_slim} />
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

export function withSlimNavBar<P>(Component: React.ComponentType<P>): React.FunctionComponent<P> {
    // eslint-disable-next-line react/display-name
    return (props: P) => {
        return (
            <div className={styles.container}>
                <div className={styles.page}>
                    <Component {...props} />
                </div>
                <SlimNavBar />
            </div>
        );
    };
}
