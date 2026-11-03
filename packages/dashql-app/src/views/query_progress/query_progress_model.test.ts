import * as dashql from '@ankoh/dashql-core';
import { QueryProgressModels, readProfileRecording, replayRecording } from '../../query/query_progress_model.js';
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

    it('applies the operator summaries of pruned samples to the plan', () => {
        const models = new QueryProgressModels();
        const stage = (id: string, plan: object) => ({ stageId: `q.${id}`, plan: { jsonRepresentation: JSON.stringify(plan) } });
        const info = { queryId: 'q', stages: { stages: [
            stage('0', { id: '1', name: 'Output', children: [{ id: '2', name: 'TableScan', children: [] }] }),
        ] } };
        const loaded = models.apply(core, 3, { kind: 'trino_query_info', info, receivedAt: 1 })!;
        expect(loaded.structure.read().pipelinesLength()).toEqual(0);
        const summary = (operatorId: number, planNodeId: string, rows: number) =>
            ({ pipelineId: 0, operatorId, planNodeId, inputPositions: rows, outputPositions: rows });
        const sample = { stages: { stages: [{ stageId: 'q.0', state: 'FINISHED', stageStats: {
            operatorSummaries: [summary(0, '2', 25), summary(1, '1', 25)],
        } }] } };
        const progress = models.apply(core, 3, { kind: 'trino_query_info_stats', info: sample, receivedAt: 2 })!;
        // The pipeline appears in the structure, the edge from the scan carries its rows
        const structure = progress.structure.read();
        expect(structure.pipelinesLength()).toEqual(1);
        const edge = structure.operatorEdges(0)!;
        expect(progress.execution.edgeRows(edge.slot(), edge.child())).toEqual(25n);
        models.release(3);
    });
});

describe('Profile recordings', () => {
    it('record the payloads of a query and replay them to any point in time', () => {
        const models = new QueryProgressModels();
        models.apply(core, 5, { kind: 'trino_statement_stats', stats: poll('RUNNING', 2), receivedAt: 1000 });
        const last = models.apply(core, 5, { kind: 'trino_statement_stats', stats: poll('RUNNING', 8), receivedAt: 4000 })!;
        const recording = last.recording();
        expect(recording.payloads.map(p => p.elapsedMs)).toEqual([0, 3000]);
        models.release(5);

        // The recording outlives the model and serializes as JSON
        const replayed = readProfileRecording(JSON.stringify(recording));
        expect(replayRecording(core, replayed, -1)).toBeNull();
        expect(workOf(replayRecording(core, replayed, 0)!.execution.query)).toEqual({ done: 2, total: 20 });
        expect(workOf(replayRecording(core, replayed, 3000)!.execution.query)).toEqual({ done: 8, total: 20 });
    });

    it('read the recordings of the Trino test harness', () => {
        const stage = (id: string, plan: object, summaries: object[]) => ({
            stageId: `q.${id}`, state: 'FINISHED',
            plan: { jsonRepresentation: JSON.stringify(plan) },
            stageStats: { operatorSummaries: summaries },
        });
        const final = { queryId: 'q', stages: { stages: [
            stage('0', { id: '1', name: 'Output', children: [{ id: '2', name: 'TableScan', children: [] }] }, [
                { pipelineId: 0, operatorId: 0, planNodeId: '2', inputPositions: 9, outputPositions: 9 },
                { pipelineId: 0, operatorId: 1, planNodeId: '1', inputPositions: 9, outputPositions: 9 },
            ]),
        ] } };
        const harness = {
            statementResponses: [
                { elapsedMs: 1, body: { stats: { state: 'QUEUED' } } },
                { elapsedMs: 200, body: { stats: { state: 'RUNNING', rootStage: { stageId: '0', state: 'RUNNING' } } } },
                { elapsedMs: 900, body: { stats: { state: 'FINISHED', rootStage: { stageId: '0', state: 'FINISHED' } } } },
            ],
            queryInfos: [{ elapsedMs: 800, body: final }],
        };
        const recording = readProfileRecording(JSON.stringify(harness));
        // The plans arrive when the stages appear, the operator summaries at the end
        const kinds = recording.payloads.map(p => [p.elapsedMs, p.payload.kind]);
        expect(kinds).toEqual([[1, 'trino_statement_stats'], [200, 'trino_statement_stats'], [200, 'trino_query_info'], [800, 'trino_query_info_stats'], [900, 'trino_statement_stats']]);
        const early = replayRecording(core, recording, 500)!;
        expect(early.structure.read().operatorsLength()).toEqual(2);
        expect(early.structure.read().pipelinesLength()).toEqual(0);
        const end = replayRecording(core, recording, 900)!;
        expect(end.structure.read().pipelinesLength()).toEqual(1);
        expect(() => readProfileRecording('{"a": 1}')).toThrow();
    });
});

describe('Hyper query progress', () => {
    it('reports the progress of the whole query', () => {
        const models = new QueryProgressModels();
        const status = (completionStatus: string, progress: number | null) => ({
            completionStatus, rowCount: 7, progress, executionStats: { wallClockTime: 1500, rowsProcessed: 12000 },
        });
        const running = models.apply(core, 4, { kind: 'hyper_query_status', status: status('RUNNING_OR_UNSPECIFIED', 0.42), receivedAt: 1 })!;
        const query = running.execution.query!;
        expect(query.status).toEqual(dashql.buffers.profile.ProfileExecutionStatus.RUNNING);
        expect(workOf(query)).toEqual({ done: 420, total: 1000 });
        expect([query.stats.tuplesIn, query.stats.tuplesOut, query.stats.wallTimeUs]).toEqual([12000n, 7n, 1_500_000n]);
        // Percentages count like fractions
        expect(workOf(models.apply(core, 4, { kind: 'hyper_query_status', status: status('RUNNING_OR_UNSPECIFIED', 60), receivedAt: 2 })!.execution.query)).toEqual({ done: 600, total: 1000 });
        const finished = models.apply(core, 4, { kind: 'hyper_query_status', status: status('FINISHED', null), receivedAt: 3 })!;
        expect(finished.execution.query!.status).toEqual(dashql.buffers.profile.ProfileExecutionStatus.SUCCEEDED);
        expect(listProgressStages(finished)).toHaveLength(0);
        models.release(4);
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
