import * as dashql from '@ankoh/dashql-core';
import { QueryProgressModels } from '../../query/query_progress_model.js';
import {
    formatCompactBytes,
    formatCompactCount,
    formatElapsed,
    formatPhase,
    listProgressStages,
    monotonicFraction,
    workOf,
} from './query_progress_model.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

let core: dashql.DashQL;
beforeAll(async () => {
    core = await dashql.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED });
});
afterEach(() => core.resetUnsafe());

/// The statement stats of a Trino poll with a stage tree 0 -> 1 -> 2
function poll(state: string, done: number) {
    return {
        state,
        completedSplits: done,
        totalSplits: 20,
        processedRows: 1000 * done,
        rootStage: {
            stageId: '0', state: 'RUNNING', totalSplits: 2, completedSplits: 0,
            subStages: [{
                stageId: '1', state: 'RUNNING', totalSplits: 8, completedSplits: done / 2,
                subStages: [{ stageId: '2', state: 'FINISHED', totalSplits: 10, completedSplits: 10, cpuTimeMillis: 42 }],
            }],
        },
    };
}

describe('QueryProgressModels', () => {
    it('follows the Trino polls of a query and lists its stages', () => {
        const models = new QueryProgressModels();
        // Without core the payload is dropped
        expect(models.apply(null, 1, { kind: 'trino_statement_stats', stats: poll('QUEUED', 0), receivedAt: 1 })).toBeNull();

        const first = models.apply(core, 1, { kind: 'trino_statement_stats', stats: poll('RUNNING', 4), receivedAt: 2 })!;
        expect(first.structure.read().fragmentsLength()).toEqual(3);
        expect(workOf(first.execution.query)).toEqual({ done: 4, total: 20 });

        const second = models.apply(core, 1, { kind: 'trino_statement_stats', stats: poll('RUNNING', 8), receivedAt: 3 })!;
        expect(second).not.toBe(first);
        expect(workOf(second.execution.query)).toEqual({ done: 8, total: 20 });
        // A repeated poll changes nothing
        expect(models.apply(core, 1, { kind: 'trino_statement_stats', stats: poll('RUNNING', 8), receivedAt: 4 })).toBe(second);

        const stages = listProgressStages(second);
        expect(stages.map(s => [s.label, s.depth])).toEqual([['0', 0], ['1', 1], ['2', 2]]);
        expect(stages[1].work).toEqual({ done: 4, total: 8 });
        expect(stages[2].status).toEqual(dashql.buffers.profile.ProfileExecutionStatus.SUCCEEDED);
        expect(stages[2].cpuTimeUs).toEqual(42000);
        expect(stages[0].rows).toBeNull();

        // Fields of unexpected types are not reported
        expect(models.apply(core, 1, { kind: 'trino_statement_stats', stats: { state: 7 }, receivedAt: 5 })).toBe(second);
        models.release(1);
    });

    it('replaces the stages with the plan of the QueryInfo and keeps their state', () => {
        const models = new QueryProgressModels();
        models.apply(core, 2, { kind: 'trino_statement_stats', stats: poll('RUNNING', 4), receivedAt: 1 });
        const stage = (id: string, plan: object) => ({ stageId: `q.${id}`, plan: { jsonRepresentation: JSON.stringify(plan) } });
        const remote = (id: string, source: string) => ({ id, name: 'RemoteSource', descriptor: { sourceFragmentIds: `[${source}]` }, children: [] });
        const info = { queryId: 'q', stages: { stages: [
            stage('0', { id: '1', name: 'Output', children: [remote('2', '1')] }),
            stage('1', { id: '3', name: 'Aggregate', children: [remote('4', '2')] }),
            stage('2', { id: '5', name: 'TableScan', descriptor: { table: 'tpch:sf1:lineitem' }, children: [] }),
        ] } };
        const progress = models.apply(core, 2, { kind: 'trino_query_info', info, receivedAt: 2 })!;
        expect(progress.structure.read().operatorsLength()).toEqual(5);
        // The stages are the fragments of the plan, with the state of the latest poll
        const stages = listProgressStages(progress);
        expect(stages.map(s => [s.label, s.depth])).toEqual([['0', 0], ['1', 1], ['2', 2]]);
        expect(stages[1].work).toEqual({ done: 2, total: 8 });
        expect(workOf(progress.execution.query)).toEqual({ done: 4, total: 20 });

        // A broken plan leaves the stages without plan
        const broken = models.apply(core, 2, { kind: 'trino_query_info', info: { stages: { stages: [{ stageId: 'q.0', plan: { jsonRepresentation: '{' } }] } }, receivedAt: 3 })!;
        expect(broken.structure.read().operatorsLength()).toEqual(0);
        expect(listProgressStages(broken)).toHaveLength(3);
        models.release(2);
    });
});

describe('query progress formatting', () => {
    it('never moves the bar backwards when the engine learns about more work', () => {
        let fraction = monotonicFraction(0, { done: 5, total: 10 });
        expect(fraction).toEqual(0.5);
        fraction = monotonicFraction(fraction, { done: 5, total: 20 });
        expect(fraction).toEqual(0.5);
        expect(monotonicFraction(fraction, null)).toEqual(0.5);
        expect(monotonicFraction(fraction, { done: 20, total: 20 })).toEqual(1);
    });

    it('formats counts, bytes, durations and phases compactly', () => {
        expect([12, 1300, 2_100_000, 4_200_000_000].map(formatCompactCount)).toEqual(['12', '1.3K', '2.1M', '4.2B']);
        expect([512, 7_792_440].map(formatCompactBytes)).toEqual(['512 B', '7.79 MB']);
        expect([850, 1240, 123_000, 3_720_000].map(formatElapsed)).toEqual(['850 ms', '1.24 s', '2m 03s', '1h 02m']);
        expect(formatPhase('WAITING_FOR_RESOURCES')).toEqual('Waiting for resources');
    });
});
