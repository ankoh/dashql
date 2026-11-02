import { describe, expect, it } from 'vitest';

import { LogLevel } from '../../platform/logger/log_buffer.js';
import { testLogRecord } from '../../platform/logger/test_logger.js';
import { shouldShowLoggerToast } from './logger_toast.js';

const record = (level: LogLevel) => testLogRecord({ level });

describe('shouldShowLoggerToast', () => {
    it('does not show warnings', () => {
        expect(shouldShowLoggerToast(record(LogLevel.Warn))).toBe(false);
    });

    it('shows errors', () => {
        expect(shouldShowLoggerToast(record(LogLevel.Error))).toBe(true);
    });
});
