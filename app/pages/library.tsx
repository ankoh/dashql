import React from 'react';
import NavigationBar from '../view/navigation_bar';
import LibraryView from '../view/library';

import styles from '../view/page.module.scss';

class Library extends React.Component {
    render() {
        return (
            <div className={styles.router}>
                <NavigationBar />
                <div className={styles.router_page_container}>
                    <LibraryView />
                </div>
            </div>
        );
    }
}

export default Library;
