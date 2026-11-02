import type { LogRecord } from './log_buffer.js';
import { LogLevel } from './log_buffer.js';
import { Logger } from './logger.js';

/// A log record for tests, an info message unless overridden
export function testLogRecord(fields: Partial<LogRecord> = {}): LogRecord {
    return {
        timestamp: 0,
        level: LogLevel.Info,
        target: 'test',
        message: 'test message',
        context: null,
        tracing: null,
        keyValues: {},
        ...fields,
    };
}

export class TestLogger extends Logger {
    constructor() {
        super();
    }

    /// Destroy the logger
    public async destroy(): Promise<void> { }

    /// Helper to flush pending records
    protected flushPendingRecords(): void {
        if (this.pendingRecords.length == 0) {
            return;
        }
        const pending = this.pendingRecords;
        this.pendingRecords = [];
        for (let i = 0; i < pending.length; ++i) {
            const record = pending[i];
            this.outputBuffer.push(record);
        }
    }
};
