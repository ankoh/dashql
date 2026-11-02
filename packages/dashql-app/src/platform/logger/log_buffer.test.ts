import { describe, expect, it, vi } from 'vitest';

import { getLogLevelName, LogBuffer, LogLevel, parseLogLevel } from './log_buffer.js';
import { testLogRecord } from './test_logger.js';

const traced = (traceId: number, message = `trace ${traceId}`) =>
    testLogRecord({ message, tracing: { traceId, spanId: 1, parentSpanId: null } });

describe('log levels', () => {
    it('round-trips the level names', () => {
        for (const level of [LogLevel.Trace, LogLevel.Debug, LogLevel.Info, LogLevel.Warn, LogLevel.Error]) {
            expect(parseLogLevel(getLogLevelName(level))).toEqual(level);
        }
        expect(parseLogLevel('verbose')).toBeNull();
    });
});

describe('LogBuffer', () => {
    it('drops records below the minimum level', () => {
        const buffer = new LogBuffer();
        expect(buffer.getMinLogLevel()).toEqual(LogLevel.Info);
        buffer.push(testLogRecord({ level: LogLevel.Debug }));
        expect(buffer.length).toEqual(0);

        buffer.setMinLogLevel(LogLevel.Debug);
        buffer.push(testLogRecord({ level: LogLevel.Debug }));
        expect(buffer.length).toEqual(1);
        expect(buffer.version).toEqual(2);
    });

    it('reads every record across frozen chunks', () => {
        const buffer = new LogBuffer();
        const count = 2 * 1024 + 3;
        for (let i = 0; i < count; ++i) buffer.push(testLogRecord({ message: `${i}` }));
        expect(buffer.length).toEqual(count);
        expect([0, 1023, 1024, 2047, 2048, count - 1].map(i => buffer.at(i)?.message)).toEqual(
            ['0', '1023', '1024', '2047', '2048', `${count - 1}`],
        );
        expect(buffer.at(count)).toBeNull();
    });

    it('notifies the observers of every record', () => {
        const buffer = new LogBuffer();
        const observer = vi.fn();
        buffer.subscribe(observer, true);
        expect(observer).toHaveBeenCalledTimes(1);
        buffer.push(testLogRecord());
        expect(observer).toHaveBeenCalledTimes(2);
        expect(buffer.observers.has(observer)).toBe(true);
    });

    it('notifies the observers of a trace until they unsubscribe', () => {
        const buffer = new LogBuffer();
        const observer = vi.fn();
        buffer.subscribeTrace(7, observer);
        buffer.push(traced(7));
        buffer.push(traced(8));
        buffer.unsubscribeTrace(7, observer);
        buffer.push(traced(7));
        expect(observer.mock.calls.map(([record]) => record.message)).toEqual(['trace 7']);
        // Unsubscribing an unknown trace is a no-op
        buffer.unsubscribeTrace(9, observer);
    });

    it('collects the records of a trace from frozen chunks and pending records', () => {
        const buffer = new LogBuffer();
        for (let i = 0; i < 1024; ++i) buffer.push(i === 3 ? traced(5, 'frozen') : traced(100 + (i % 2)));
        // A chunk without any traces
        for (let i = 0; i < 1024; ++i) buffer.push(testLogRecord());
        buffer.push(traced(5, 'pending'));
        expect(buffer.collectTraceLogs(5).map(record => record.message)).toEqual(['frozen', 'pending']);
        expect(buffer.collectTraceLogs(1000)).toEqual([]);
    });
});
