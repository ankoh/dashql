import Immutable from 'immutable';
import * as React from 'react';
import styles from './cloud.module.css';
import { ActivityTimeseries, ActivitySummary, WorkerStatus, ScriptEntryCollection, ActivityMap } from '../components';
import { Script } from '../model';
import { AutoSizer } from '../utils';

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
                <ActivityTimeseries className={styles.stats_sessions_timeseries} />
                <ActivitySummary />
                <div className={styles.stats_sessions_geo_container}>
                    <AutoSizer>
                        {({ width, height }) => (
                            <ActivityMap width={width} height={height} className={styles.stats_sessions_geo_map} />
                        )}
                    </AutoSizer>
                </div>
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
