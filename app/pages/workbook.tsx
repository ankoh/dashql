import React from 'react';
import NavigationBar from '../view/navigation_bar';
import WorkbookView from '../view/workbook';

import styles from '../view/page.module.scss';

class Workbook extends React.Component {
    render() {
        return (
            <div className={styles.router}>
                <NavigationBar />
                <div className={styles.router_page_container}>
                    <WorkbookView />
                </div>
            </div>
        );
    }
}

export default Workbook;
