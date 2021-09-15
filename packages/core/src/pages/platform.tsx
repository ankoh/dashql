import * as React from 'react';
import styles from './platform.module.css';
import { ActivityTimeseries, WorkerStatus } from '../components';

interface Props {
    className?: string;
}

export const Platform: React.FC<Props> = () => {
    return (
        <div className={styles.root}>
            <div className={styles.stats_panel}>
                <div className={styles.stats_panel_header}>Platform</div>
                <WorkerStatus />
                <ActivityTimeseries className={styles.stats_session_chart} />
            </div>
            <div className={styles.scripts_panel}>
                <div className={styles.script_collection}>
                    <div className={styles.script_collection_name}>Most Views</div>
                    <div className={styles.script_collection_grid_placeholder}>Not implemented</div>
                </div>
                <div className={styles.script_collection}>
                    <div className={styles.script_collection_name}>Most Stars</div>
                    <div className={styles.script_collection_grid_placeholder}>Not implemented</div>
                </div>
            </div>
        </div>
    );
};
