import { describe, expect, it } from 'vitest';

import { ChannelError, getProxyErrorData } from './channel_common.js';

describe('proxy errors', () => {
    it('reads native proxy details', () => {
        const error = {
            message: 'duckdb operation failed',
            details: {
                operation: 'insert arrow ipc stream',
                error: 'unsupported arrow type',
            },
        };

        expect(getProxyErrorData(error)).toEqual(error.details);
        expect(new ChannelError(error, 400).keyValues).toEqual(error.details);
    });

    it('prefers data when both error shapes are present', () => {
        expect(getProxyErrorData({
            message: 'failed',
            data: { source: 'client' },
            details: { source: 'native' },
        })).toEqual({ source: 'client' });
    });
});
