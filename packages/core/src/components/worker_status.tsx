import * as React from 'react';
import cn from 'classnames';

import styles from './worker_status.module.css';

const addHours = (dt: Date, hours: number) => new Date(dt.getTime() + hours * 60 * 60 * 1000);
const addMins = (dt: Date, mins: number) => new Date(dt.getTime() + mins * 60 * 1000);

interface Props {
    className?: string;
}

interface WorkerRunStats {
    workerStartedAt: Date;
    workerFinishedAt: Date;
    ingestionTime: Date;
    ingestionDuration: number;
    totalEvents: number;
    totalEventBytes: number;
    totalScripts: number;
    totalAccounts: number;
    totalWrittenLocalBytes: number;
    totalUploadedBlobBytes: number;
}

export const WorkerStatus: React.FC<Props> = (props: Props) => {
    const runs: WorkerRunStats[] = [];
    let start = new Date(2021, 1, 1);
    for (let i = 0; i < 24 * 3; ++i) {
        start = addHours(start, 1);
        const end = addMins(start, Math.ceil(Math.random() * 30));
        runs.push({
            workerStartedAt: start,
            workerFinishedAt: end,
            ingestionTime: start,
            ingestionDuration: Math.random() * 60 * 10,
            totalEvents: Math.random() * 1000,
            totalEventBytes: Math.random() * 1000,
            totalScripts: Math.random() * 1000,
            totalAccounts: Math.random() * 1000,
            totalWrittenLocalBytes: Math.random() * 1000,
            totalUploadedBlobBytes: Math.random() * 1000,
        });
    }
    return (
        <div className={cn(styles.container, props.className)}>
            <div className={styles.title}>Worker</div>
            <div className={styles.indicators}>
                {runs.map((run, i) => (
                    <div key={i} className={styles.indicator} />
                ))}
            </div>
        </div>
    );
};
