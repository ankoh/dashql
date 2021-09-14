import * as React from 'react';
import styles from './platform.module.css';
import { ActivityTimeseries } from '../components';

interface Props {
    className?: string;
}

export const Platform: React.FC<Props> = () => {
    return (
        <div className={styles.root}>
            <div className={styles.stats_panel}>
                <div className={styles.stats_panel_header}>Platform</div>
                <ActivityTimeseries className={styles.stats_session_chart} title="Total platform views" />
            </div>
            <div className={styles.scripts}>
                <div className={styles.script_collection}>
                    <div className={styles.script_collection_name}>Most Views</div>
                    <div className={styles.script_collection_grid_placeholder}>Not implemented</div>
                </div>
            </div>
        </div>
    );
};
