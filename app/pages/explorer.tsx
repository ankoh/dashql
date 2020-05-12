import React from 'react';
import NavigationBar from '../view/navigation_bar';
import ExplorerView from '../view/explorer';

import styles from '../view/page.module.scss';

class Explorer extends React.Component {
    render() {
        return (
            <div className={styles.router}>
                <NavigationBar />
                <div className={styles.router_page_container}>
                    <ExplorerView />
                </div>
            </div>
        );
    }
}

export default Explorer;
