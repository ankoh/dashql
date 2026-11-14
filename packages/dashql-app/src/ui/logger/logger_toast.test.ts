import { describe, expect, it } from 'vitest';

import { LogLevel } from '@ankoh/dashql-sdk/platform/logger/log_buffer';
import { testLogRecord } from '@ankoh/dashql-sdk/testing/test_logger';
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
