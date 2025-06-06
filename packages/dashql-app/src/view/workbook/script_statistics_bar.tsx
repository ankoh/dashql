import * as dashql from '@ankoh/dashql-core';

import * as React from 'react';
import * as Immutable from 'immutable';

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
    stats: Immutable.List<dashql.FlatBufferPtr<dashql.buffers.statistics.ScriptStatistics>> | null;
}

export const ScriptStatisticsBar: React.FC<Props> = (props: Props) => {
    const stats = props.stats ?? Immutable.List();
    if (stats.isEmpty()) {
        return (
            <div className={classNames(props.className, styles.container)}>
                <div className={styles.metric_container}>
                    <div className={styles.metric_last_reading}>- us</div>
                </div>
                <div className={styles.metric_container}>
                    <div className={styles.metric_last_reading}>- bytes</div>
                </div>
            </div>
        );
    }

    const protoStats = new dashql.buffers.statistics.ScriptStatistics();
    const protoTimings = new dashql.buffers.statistics.ScriptProcessingTimings();
    const protoMemory = new dashql.buffers.statistics.ScriptMemoryStatistics();
    const protoProcessingMemory = new dashql.buffers.statistics.ScriptProcessingMemoryStatistics();

    const computeTotalElapsed = (timings: dashql.buffers.statistics.ScriptProcessingTimings) =>
        timings.scannerLastElapsed() + timings.parserLastElapsed() + timings.analyzerLastElapsed();
    const sumProcessingMemory = (mem: dashql.buffers.statistics.ScriptProcessingMemoryStatistics) =>
        mem.scannerInputBytes() +
        mem.scannerNameDictionaryBytes() +
        mem.parserAstBytes() +
        mem.analyzerDescriptionBytes() +
        mem.analyzerNameIndexBytes();
    const computeTotalMemory = (mem: dashql.buffers.statistics.ScriptMemoryStatistics) => {
        let total = mem.ropeBytes();
        total += sumProcessingMemory(mem.latestScript(protoProcessingMemory)!);
        return total;
    };

    const last = stats.last()!.read(protoStats)!;
    const lastTimings = last.timings(protoTimings)!;
    const lastElapsedScanner = lastTimings.scannerLastElapsed();
    const lastElapsedParser = lastTimings.parserLastElapsed();
    const lastElapsedAnalyzer = lastTimings.analyzerLastElapsed();
    const lastTotalMemory = computeTotalMemory(last.memory(protoMemory)!);

    const n = Math.min(stats.size, 20);
    const bufferSize = Math.max(n, 20);
    const elapsedScannerHistory = new Float64Array(bufferSize);
    const elapsedParserHistory = new Float64Array(bufferSize);
    const elapsedAnalyzerHistory = new Float64Array(bufferSize);
    const memoryHistory = new Float64Array(bufferSize);
    let maxElapsedScanner = 0;
    let maxElapsedParser = 0;
    let maxElapsedAnalyzer = 0;
    let maxTotalMemory = 0;
    let writer = 0;
    for (const reading of stats.toSeq().take(n)) {
        const stats = reading.read(protoStats)!;
        const timings = stats.timings(protoTimings)!;
        const totalMemory = computeTotalMemory(stats.memory(protoMemory)!);
        const elapsedScanner = timings.scannerLastElapsed();
        const elapsedParser = timings.parserLastElapsed();
        const elapsedAnalyzer = timings.analyzerLastElapsed();
        elapsedScannerHistory[writer] = elapsedScanner;
        elapsedParserHistory[writer] = elapsedParser;
        elapsedAnalyzerHistory[writer] = elapsedAnalyzer;
        memoryHistory[writer] = totalMemory;
        maxElapsedScanner = Math.max(maxElapsedScanner, elapsedScanner);
        maxElapsedParser = Math.max(maxElapsedParser, elapsedParser);
        maxElapsedAnalyzer = Math.max(maxElapsedAnalyzer, elapsedAnalyzer);
        maxTotalMemory = Math.max(maxTotalMemory, totalMemory);
        ++writer;
    }

    return (
        <div className={classNames(props.className, styles.container)}>
            <div className={styles.metric_container}>
                <History data={memoryHistory} maximum={maxTotalMemory} />
                <div className={styles.metric_text_overlay}>
                    <div className={styles.metric_name}>M</div>
                    <div className={styles.metric_last_reading}>{formatBytes(lastTotalMemory)}</div>
                </div>
            </div>
            <div className={styles.metric_container}>
                <History data={elapsedScannerHistory} maximum={maxElapsedScanner} />
                <div className={styles.metric_text_overlay}>
                    <div className={styles.metric_name}>S</div>
                    <div className={styles.metric_last_reading}>{formatNanoseconds(lastElapsedScanner)}</div>
                </div>
            </div>
            <div className={styles.metric_container}>
                <History data={elapsedParserHistory} maximum={maxElapsedParser} />
                <div className={styles.metric_text_overlay}>
                    <div className={styles.metric_name}>P</div>
                    <div className={styles.metric_last_reading}>{formatNanoseconds(lastElapsedParser)}</div>
                </div>
            </div>
            <div className={styles.metric_container}>
                <History data={elapsedAnalyzerHistory} maximum={maxElapsedAnalyzer} />
                <div className={styles.metric_text_overlay}>
                    <div className={styles.metric_name}>A</div>
                    <div className={styles.metric_last_reading}>{formatNanoseconds(lastElapsedAnalyzer)}</div>
                </div>
            </div>
        </div>
    );
};
