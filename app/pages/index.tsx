import React from 'react';
import NavigationBar from '../view/navigation_bar';
import Launcher from '../view/launcher';

import styles from '../view/page.module.scss';

class Index extends React.Component {
    render() {
        return (
            <div className={styles.router}>
                <NavigationBar />
                <div className={styles.router_page_container}>
                    <Launcher />
                </div>
            </div>
        );
    }
}

export default Index;
