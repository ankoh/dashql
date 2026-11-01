import { describe, it, expect } from 'vitest';
import { mergeQueryStatus, QueryStatus, readQueryStatus } from './hyperdb_http_client.js';

function makeStatus(overrides: Partial<QueryStatus>): QueryStatus {
    return {
        queryId: 'q1',
        completionStatus: 'RUNNING_OR_UNSPECIFIED',
        chunkCount: null,
        rowCount: null,
        progress: null,
        expirationTime: null,
        executionStats: null,
        ...overrides,
    };
}

describe('readQueryStatus', () => {
    it('reads counts that are serialized as strings', () => {
        const status = readQueryStatus({
            queryId: 'q1',
            completionStatus: 'FINISHED',
            chunkCount: '10',
            rowCount: '1234',
            progress: 100,
            executionStats: { wallClockTime: 12.5, rowsProcessed: '5000' },
        });
        expect(status).toEqual(makeStatus({
            completionStatus: 'FINISHED',
            chunkCount: 10,
            rowCount: 1234,
            progress: 100,
            executionStats: { wallClockTime: 12.5, rowsProcessed: 5000 },
        }));
    });

    it('defaults missing fields', () => {
        expect(readQueryStatus({ queryId: 'q1' })).toEqual(makeStatus({}));
    });
});

describe('mergeQueryStatus', () => {
    it('does not roll back a newer status', () => {
        const newer = makeStatus({
            completionStatus: 'FINISHED',
            chunkCount: 8,
            rowCount: 800,
            progress: 100,
            executionStats: { wallClockTime: 20, rowsProcessed: 1000 },
        });
        const older = makeStatus({
            completionStatus: 'RUNNING_OR_UNSPECIFIED',
            chunkCount: 3,
            rowCount: 300,
            progress: 40,
            executionStats: { wallClockTime: 5, rowsProcessed: 400 },
        });
        expect(mergeQueryStatus(newer, older)).toEqual(newer);
    });

    it('advances to a newer status', () => {
        const current = makeStatus({ chunkCount: 1, progress: 10 });
        const update = makeStatus({
            completionStatus: 'RESULTS_PRODUCED',
            chunkCount: 4,
            rowCount: 400,
            progress: 100,
            expirationTime: '2026-10-30T12:00:00Z',
            executionStats: { wallClockTime: 3, rowsProcessed: 400 },
        });
        expect(mergeQueryStatus(current, update)).toEqual(update);
    });

    it('keeps known values when an update omits them', () => {
        const current = makeStatus({
            chunkCount: 2,
            rowCount: 200,
            expirationTime: '2026-10-30T12:00:00Z',
            executionStats: { wallClockTime: 3, rowsProcessed: 200 },
        });
        expect(mergeQueryStatus(current, makeStatus({}))).toEqual(current);
    });
});
