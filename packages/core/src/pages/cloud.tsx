import * as React from 'react';
import styles from './cloud.module.css';
import { ActivityTimeseries, ActivitySummary, WorkerStatus } from '../components';

interface Props {
    className?: string;
}

export const Cloud: React.FC<Props> = () => {
    return (
        <div className={styles.root}>
            <div className={styles.stats_panel}>
                <div className={styles.stats_task_header}>Cloud Worker</div>
                <WorkerStatus className={styles.stats_task_status} />
                <div className={styles.stats_summary_header}>Analytics</div>
                <ActivityTimeseries className={styles.stats_sessions} />
                <ActivitySummary />
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
