import { describe, expect, it } from 'vitest';

import * as dashql from '@ankoh/dashql';
import { QueryExecutionStatus, type QueryExecutionState } from '@ankoh/dashql/platform/query/query_execution_state';
import { ProfileExecutionState } from '@ankoh/dashql/platform/query/profile_execution_state';
import { deriveEntryStatus, EntryStatusKind, getQueryStatusText } from './entry_status_model.js';
import { IndicatorStatus } from '../ui/foundations/status_indicator.js';

describe('getQueryStatusText', () => {
    it.each([
        [QueryExecutionStatus.REQUESTED, 'Requested query'],
        [QueryExecutionStatus.SENDING, 'Sending query'],
        [QueryExecutionStatus.QUEUED, 'Queued query'],
        [QueryExecutionStatus.RUNNING, 'Executing query'],
        [QueryExecutionStatus.RECEIVED_FIRST_BATCH, 'Executing query, fetching results'],
        [QueryExecutionStatus.RECEIVED_ALL_BATCHES, 'Executing query, received all results'],
        [QueryExecutionStatus.PROCESSING_RESULTS, 'Processing results'],
        [QueryExecutionStatus.PROCESSED_RESULTS, 'Processed results'],
        [QueryExecutionStatus.FAILED, 'Statement execution failed'],
        [QueryExecutionStatus.CANCELLED, 'Statement execution was cancelled'],
        [QueryExecutionStatus.SUCCEEDED, 'Statement executed successfully'],
    ])('names status %s', (status, expected) => {
        expect(getQueryStatusText(status)).toBe(expected);
    });

    it('shows the message of a failure with its details', () => {
        const status = deriveEntryStatus({
            queryId: 7,
            status: QueryExecutionStatus.FAILED,
            queryText: 'select * from missing',
            queryMetadata: { title: 'Missing relation' },
            // The details of an error of the runtime are a JSON object
            error: {
                message: 'relation does not exist',
                details: JSON.stringify({ sqlState: '42P01', hint: 'Check the table name' }),
            },
            metrics: null,
            traceId: 42,
        } as any);

        expect(status.message).toBe('relation does not exist');
        expect(status.errorDetail).toEqual({
            status: 'failed',
            message: 'relation does not exist',
            queryId: 7,
            traceId: 42,
            query: 'select * from missing',
            metadata: { title: 'Missing relation' },
            details: { sqlState: '42P01', hint: 'Check the table name' },
        });
    });

    it('provides error details even when the connector only supplies a message', () => {
        const status = deriveEntryStatus({
            queryId: 7,
            status: QueryExecutionStatus.FAILED,
            queryText: 'select 1',
            queryMetadata: null,
            error: { message: 'connection lost', details: null },
            metrics: null,
            traceId: 42,
        } as any);

        expect(status.errorDetail).toEqual({
            status: 'failed',
            message: 'connection lost',
            queryId: 7,
            traceId: 42,
            query: 'select 1',
        });
    });
});

describe('deriveEntryStatus', () => {
    const query = (fields: object) => ({ queryId: 1, error: null, traceId: 5, ...fields }) as never;

    it('shows running, succeeded, cached and idle entries', () => {
        expect(deriveEntryStatus(query({ status: QueryExecutionStatus.RUNNING }))).toEqual({
            kind: EntryStatusKind.Query, indicator: IndicatorStatus.Running, message: 'Executing query', traceId: 5, errorDetail: null,
        });
        expect(deriveEntryStatus(query({ status: QueryExecutionStatus.SUCCEEDED }))).toMatchObject({ indicator: IndicatorStatus.Succeeded, message: 'Statement executed successfully' });
        expect(deriveEntryStatus(query({ status: QueryExecutionStatus.SUCCEEDED, servedFromCache: true }))).toMatchObject({ message: 'Result loaded from cache' });
        expect(deriveEntryStatus(null)).toEqual({ kind: EntryStatusKind.Idle, indicator: IndicatorStatus.None, message: 'Not run yet', traceId: null, errorDetail: null });
    });

    it('adds the phase, progress and throughput of structured progress to a running query', () => {
        const profile = dashql.buffers.profile;
        const stats = new profile.ProfileStatsT(
            profile.ProfileStatsField.TUPLES_IN | profile.ProfileStatsField.WORK_DONE | profile.ProfileStatsField.WORK_TOTAL,
            0n, 0n, 2_400_000n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 21n, 50n,
        );
        const execution = new ProfileExecutionState({ status: profile.ProfileExecutionStatus.RUNNING, stats }, [], [], [], []);
        const running = { queryId: 8, status: QueryExecutionStatus.RUNNING } as unknown as QueryExecutionState;
        // The progress of a query comes from the executor, next to its view
        const progress = (phase: string) => ({ phase, executionTimeMs: 2000, profileProgress: { execution } }) as never;
        expect(deriveEntryStatus(running, progress('RUNNING')).message).toBe('Executing query · 42% · 1.2M rows/s');
        expect(deriveEntryStatus(running, progress('FINISHING')).message).toBe('Executing query · Finishing · 42% · 1.2M rows/s');
    });
});

