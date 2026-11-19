import { describe, expect, it } from 'vitest';

import { formatRelativeTime } from './time_format.js';

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe('formatRelativeTime', () => {
    it.each([
        [5, 'Just now'],
        [30, '30 seconds ago'],
        [MINUTE, '1 minute ago'],
        [5 * MINUTE, '5 minutes ago'],
        [HOUR, '1 hour ago'],
        [3 * HOUR, '3 hours ago'],
        [DAY, 'Yesterday'],
        [3 * DAY, '3 days ago'],
        [7 * DAY, '1 week ago'],
        [14 * DAY, '2 weeks ago'],
        [30 * DAY, '1 month ago'],
        [90 * DAY, '3 months ago'],
        [365 * DAY, '1 year ago'],
        [800 * DAY, '2 years ago'],
    ])('formats %d seconds ago as %s', (secondsAgo, text) => {
        expect(formatRelativeTime(new Date(Date.now() - secondsAgo * 1000 - 500))).toBe(text);
    });

    it('reads timestamps and formats missing ones as never', () => {
        expect(formatRelativeTime(new Date(Date.now() - 2 * HOUR * 1000).toISOString())).toBe('2 hours ago');
        expect(formatRelativeTime(null)).toBe('Never');
        expect(formatRelativeTime(undefined)).toBe('Never');
    });
});
