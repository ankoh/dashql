import { describe, expect, it } from 'vitest';

import { LogLevel, type LogRecord } from '../platform/logger/log_buffer.js';
import { shouldShowLoggerToast } from './logger_toast.js';

function record(level: LogLevel): LogRecord {
    return {
        timestamp: 0,
        level,
        target: 'test',
        message: 'test message',
        context: null,
        tracing: null,
        keyValues: {},
    };
}

describe('shouldShowLoggerToast', () => {
    it('does not show warnings', () => {
        expect(shouldShowLoggerToast(record(LogLevel.Warn))).toBe(false);
    });

    it('shows errors', () => {
        expect(shouldShowLoggerToast(record(LogLevel.Error))).toBe(true);
    });
});
