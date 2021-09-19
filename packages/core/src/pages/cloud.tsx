import Immutable from 'immutable';
import * as React from 'react';
import styles from './cloud.module.css';
import {
    ActivityTimeseries,
    ActivitySummary,
    WorkerStatus,
    ScriptEntryCollection,
    ActivityMapChart,
} from '../components';
import { Script } from '../model';

interface Props {
    className?: string;
}

export const Cloud: React.FC<Props> = () => {
    return (
        <div className={styles.root}>
            <div className={styles.stats_panel}>
                <div className={styles.stats_task_header}>Cloud Service</div>
                <WorkerStatus className={styles.stats_task_status} />
                <div className={styles.stats_summary_header}>Analytics</div>
                <ActivityMapChart className={styles.stats_sessions_geo_map} />
                <ActivityTimeseries className={styles.stats_sessions_timeseries} />
                <ActivitySummary />
            </div>
            <div className={styles.scripts_panel}>
                <ScriptEntryCollection
                    name="Most Views"
                    scripts={Immutable.Map<string, Script>()}
                    fallback="Not implemented"
                />
                <ScriptEntryCollection
                    name="Most Views"
                    scripts={Immutable.Map<string, Script>()}
                    fallback="Not implemented"
                />
            </div>
        </div>
    );
};
