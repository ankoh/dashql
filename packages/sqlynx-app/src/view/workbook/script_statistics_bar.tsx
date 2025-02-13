import * as sqlynx from '@ankoh/sqlynx-core';

import * as React from 'react';
import Immutable from 'immutable';

import { formatBytes, formatNanoseconds } from '../../utils/format.js';
import { classNames } from '../../utils/classnames.js';

import * as styles from './script_statistics_bar.module.css';

interface HistoryProps {
    data: Float64Array;
    maximum: number;
}

const History: React.FC<HistoryProps> = (props: HistoryProps) => {
    const out = [];
    const scaledMax = props.maximum * 1.2;
    for (let i = 0; i < props.data.length; ++i) {
        const percent = (props.data[i] * 100) / scaledMax;
        out.push(
            <div
                key={i}
                style={{
                    height: `${percent}%`,
                    backgroundColor: 'var(--stats_bar_fg)',
                }}
            />,
        );
    }
    return <div className={styles.metric_history}>{out}</div>;
};

interface Props {
    className?: string;
    stats: Immutable.List<sqlynx.FlatBufferPtr<sqlynx.proto.ScriptStatistics>> | null;
}

export const ScriptStatisticsBar: React.FC<Props> = (props: Props) => {
    const stats = props.stats ?? Immutable.List();
    if (stats.isEmpty()) {
        return <div className={props.className}></div>;
    }

    const protoStats = new sqlynx.proto.ScriptStatistics();
    const protoTimings = new sqlynx.proto.ScriptProcessingTimings();
    const protoMemory = new sqlynx.proto.ScriptMemoryStatistics();
    const protoProcessingMemory = new sqlynx.proto.ScriptProcessingMemoryStatistics();

    const computeTotalElapsed = (timings: sqlynx.proto.ScriptProcessingTimings) =>
        timings.scannerLastElapsed() + timings.parserLastElapsed() + timings.analyzerLastElapsed();
    const sumProcessingMemory = (mem: sqlynx.proto.ScriptProcessingMemoryStatistics) =>
        mem.scannerInputBytes() +
        mem.scannerNameDictionaryBytes() +
        mem.parserAstBytes() +
        mem.analyzerDescriptionBytes() +
        mem.analyzerNameIndexBytes();
    const computeTotalMemory = (mem: sqlynx.proto.ScriptMemoryStatistics) => {
        let total = mem.ropeBytes();
        total += sumProcessingMemory(mem.latestScript(protoProcessingMemory)!);
        return total;
    };

    const last = stats.last()!.read(protoStats)!;
    const lastTotalElapsed = computeTotalElapsed(last.timings(protoTimings)!);
    const lastTotalMemory = computeTotalMemory(last.memory(protoMemory)!);

    const n = Math.min(stats.size, 20);
    const bufferSize = Math.max(n, 20);
    const elapsedHistory = new Float64Array(bufferSize);
    const memoryHistory = new Float64Array(bufferSize);
    let maxTotalElapsed = 0;
    let maxTotalMemory = 0;
    let writer = 0;
    for (const reading of stats.toSeq().take(n)) {
        const stats = reading.read(protoStats)!;
        const totalElapsed = computeTotalElapsed(stats.timings(protoTimings)!);
        const totalMemory = computeTotalMemory(stats.memory(protoMemory)!);
        elapsedHistory[writer] = totalElapsed;
        memoryHistory[writer] = totalMemory;
        maxTotalElapsed = Math.max(maxTotalElapsed, totalElapsed);
        maxTotalMemory = Math.max(maxTotalMemory, totalMemory);
        ++writer;
    }

    return (
        <div className={classNames(props.className, styles.container)}>
            <div className={styles.metric_container}>
                <History data={elapsedHistory} maximum={maxTotalElapsed} />
                <div className={styles.metric_last_reading}>{formatNanoseconds(lastTotalElapsed)}</div>
            </div>
            <div className={styles.metric_container}>
                <History data={memoryHistory} maximum={maxTotalMemory} />
                <div className={styles.metric_last_reading}>{formatBytes(lastTotalMemory)}</div>
            </div>
        </div>
    );
};
