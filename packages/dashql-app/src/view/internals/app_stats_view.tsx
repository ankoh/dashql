import * as React from 'react';
import * as styles from './app_stats_view.module.css';

import { XIcon } from '@primer/octicons-react';
import { ButtonVariant, IconButton } from '../../view/foundations/button.js';
import { useStorageWriter } from '../../platform/storage/storage_provider.js';
import { StorageWriteStatisticsMap } from '../../platform/storage/storage_writer.js';
import { formatBytes, formatMilliseconds } from '../../utils/format.js';

export function AppStats(props: { onClose: () => void; }) {

    // Subscribe for storage write statistics
    const storageWriter = useStorageWriter();
    const [storageWriterStats, setStorageWriterStats] = React.useState<StorageWriteStatisticsMap | null>(storageWriter.getStatistics());
    React.useEffect(() => {
        const listener = setStorageWriterStats;
        storageWriter.subscribeStatisticsListener(listener);
        return () => storageWriter.unsubscribeStatisticsListener(listener);
    }, []);

    // Storage statistics
    let storageStatsList: React.ReactElement[] = React.useMemo(() => {
        if (!storageWriterStats) {
            return [];
        }
        const entries = [...storageWriterStats.entries()];
        entries.sort(([lk, _lv], [rk, _rv]) => lk > rk ? 1 : -1);
        const out: React.ReactElement[] = [];
        out.push(<span key="header/0">Key</span>);
        out.push(<span key="header/1">Tasks</span>);
        out.push(<span key="header/2">Writes</span>);
        out.push(<span key="header/3">Time</span>);
        out.push(<span key="header/4">Bytes</span>);

        for (const [k, v] of entries) {
            out.push(<span key={`${k}/0`}>{k}</span>);
            out.push(<span key={`${k}/1`}>{v.totalScheduledWrites}</span>);
            out.push(<span key={`${k}/2`}>{v.totalWrites}</span>);
            out.push(<span key={`${k}/3`}>{formatMilliseconds(v.totalWriteTime)}</span>);
            out.push(<span key={`${k}/4`}>{formatBytes(v.totalWrittenBytes)}</span>);
        }
        return out;
    }, [storageWriterStats]);

    return (
        <div className={styles.settings_root}>
            <div className={styles.header_container}>
                <div className={styles.header_left_container}>
                    <div className={styles.title}>App Statistics</div>
                </div>
                <div className={styles.header_right_container}>
                    <IconButton
                        variant={ButtonVariant.Invisible}
                        aria-label="close-overlay"
                        onClick={props.onClose}
                    >
                        <XIcon />
                    </IconButton>
                </div>
            </div>
            <div className={styles.internals_container}>
                <div className={styles.stats_group}>
                    <div className={styles.stats_group_topic}>
                        Storage Statistics
                    </div>
                    <div className={styles.storage_stats_metrics_table}>
                        {storageStatsList}
                    </div>
                </div>
            </div>
        </div>
    );
}
