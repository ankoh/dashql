import * as React from 'react';
import Link from 'next/link';
import { withRouter } from 'next/router';
import { WithRouterProps } from 'next/dist/client/with-router';
import classNames from 'classnames';

import styles from './navigation_bar.module.scss';

type Props = WithRouterProps;

class NavigationBar extends React.Component<Props> {
    public render() {
        return (
            <div className={styles.container}>
                <div className={styles.brand}>TIGON</div>
                <div className={styles.tabs}>
                    {[
                        ['/explorer', 'Explorer'],
                        ['/workbook', 'Workbook'],
                        ['/library', 'Library'],
                    ].map(([route, name]) => (
                        <div key={route} className={styles.tab_container}>
                            <Link href={route}>
                                <a
                                    className={classNames(
                                        styles.tab,
                                        styles.tab_name,
                                        {
                                            [styles.active]:
                                                this.props.router.route ===
                                                route,
                                        },
                                    )}
                                >
                                    {name}
                                </a>
                            </Link>
                        </div>
                    ))}
                </div>
            </div>
        );
    }
}

export default withRouter(NavigationBar);
