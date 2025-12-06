import * as React from 'react';
import * as styles from './app_stats_view.module.css';

import { ScriptStatisticsBar } from '../workbook/script_statistics_bar.js';
import { useWorkbookRegistry } from '../../workbook/workbook_state_registry.js';

import { XIcon } from '@primer/octicons-react';
import { ButtonVariant, IconButton } from '../../view/foundations/button.js';
import { WorkbookState } from '../../workbook/workbook_state.js';
import { useConnectionRegistry } from '../../connection/connection_registry.js';
import { Identicon } from './../foundations/identicon.js';
import { useStorageWriter } from '../../platform/storage_provider.js';
import { StorageWriteStatisticsMap } from '../../platform/storage_writer.js';
import { formatBytes, formatMilliseconds } from '../../utils/format.js';

export function AppStats(props: { onClose: () => void; }) {
    const [workbookRegistry, _modifyWorkbooks] = useWorkbookRegistry();
    const [connReg, _modifyConnReg] = useConnectionRegistry();

    // Connection statistics
    let connectionStatsList: React.ReactElement[] = React.useMemo(() => {
        let workbooks: WorkbookState[] = [];
        for (const typeWorkbooks of workbookRegistry.workbooksByConnectionType) {
            for (const workbookId of typeWorkbooks) {
                workbooks.push(workbookRegistry.workbookMap.get(workbookId)!);
            }
        }
        let i = 0;
        let out: React.ReactElement[] = [];
        for (const w of workbooks) {
            for (const s of Object.values(w.scripts)) {
                if (s.statistics.isEmpty()) {
                    continue;
                }
                const connState = connReg.connectionMap.get(w.connectionId)!;
                const connSig = connState.connectionSignature.hash.asPrng();
                const scriptSigHash = connState.connectionSignature.hash.clone();
                scriptSigHash.add(s.scriptKey.toString());
                const scriptSig = scriptSigHash.asPrng();

                out.push(
                    <Identicon
                        key={i++}
                        className={styles.script_stats_icon_container}
                        layers={[
                            connSig.next(),
                            connSig.next(),
                            scriptSig.next(),
                        ]}
                    />
                );
                out.push(
                    <div key={i++} className={styles.script_stats_metrics_histogram}>
                        <ScriptStatisticsBar stats={s.statistics} />
                    </div>
                );
            }
        }
        return out;
    }, [workbookRegistry]);

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
    }, []);

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
                        Script Statistics
                    </div>
                    <div className={styles.script_stats_list}>
                        {connectionStatsList}
                    </div>
                </div>
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
