import * as React from 'react';
import { Link } from 'react-router-dom';
import classNames from 'classnames';

import styles from './navigation_bar.module.css';

export class NavigationBar extends React.Component<{}> {
    public render() {
        return (
            <div className={styles.container}>
                <div className={styles.banner}>DashQL</div>
                <div className={styles.tabs}>
                    {[
                        ['/explorer', 'Explorer'],
                        ['/workbook', 'Workbook'],
                        ['/library', 'Library'],
                    ].map(([route, name]) => (
                        <div key={route}
                            className={classNames(
                                styles.tab,
                                styles.tab_name
                            )}
                        >
                            <Link to={route}>
                                {name}
                            </Link>
                        </div>
                    ))}
                </div>
            </div>
        );
    }
}
