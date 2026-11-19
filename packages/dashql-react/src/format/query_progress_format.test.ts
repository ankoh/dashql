import * as dashql from '@akohn/dashql';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { readProgressRecording, replayProgressRecording, type QueryProfileProgress } from '@akohn/dashql/platform/query/query_progress';
import {
    formatCompactBytes,
    formatCompactCount,
    formatElapsed,
    formatPhase,
    monotonicFraction,
    workOf,
} from './query_progress_format.js';
import { createProfileLayoutConfig } from '@akohn/dashql/platform/query/profile_layout_config';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

let core: dashql.DashQL;
beforeAll(async () => {
    core = await dashql.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED });
});
afterEach(() => core.resetUnsafe());

/// The fragments of a progress model as engine id and parent engine id
function fragmentsOf(progress: QueryProfileProgress): [string, string | null][] {
    const vm = progress.structure.read();
    const fragment = new dashql.buffers.profile.ProfileFragment();
    const engineId = (index: number) => vm.stringDictionary(vm.fragments(index, fragment)!.engineId());
    const out: [string, string | null][] = [];
    for (let i = 0; i < vm.fragmentsLength(); ++i) {
        const parent = vm.fragments(i, fragment)!.parentFragment();
        out.push([engineId(i), parent < vm.fragmentsLength() ? engineId(parent) : null]);
    }
    return out;
}

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

describe('Replayed query progress', () => {
    // The progress model runs in the core, its tests are in packages/dashql-core-runtime/tests/query_test.rs
    it('projects the stages and their state from a recording of Trino polls', () => {
        const payload = (done: number, receivedAt: number) => ({ kind: 'trino_statement_stats', stats: poll('RUNNING', done), receivedAt });
        const recording = JSON.stringify({ version: 1, payloads: [
            { elapsedMs: 0, payload: payload(2, 1000) },
            { elapsedMs: 3000, payload: payload(8, 4000) },
        ] });
        expect(replayProgressRecording(core, recording, -1)).toBeNull();
        const early = replayProgressRecording(core, recording, 0)!;
        expect(workOf(early.execution.query)).toEqual({ done: 2, total: 20 });
        // The stages are the fragments, nested like the stage tree
        expect(fragmentsOf(early)).toEqual([['0', null], ['1', '0'], ['2', '1']]);
        const late = replayProgressRecording(core, recording)!;
        expect(late.revision).toBeGreaterThan(early.revision);
        expect(workOf(late.execution.query)).toEqual({ done: 8, total: 20 });
        const stages = late.execution.fragments;
        expect(workOf(stages[1])).toEqual({ done: 4, total: 8 });
        expect(stages[2]!.status).toEqual(dashql.buffers.profile.ProfileExecutionStatus.SUCCEEDED);
        expect(stages[2]!.stats.cpuTimeUs).toEqual(42000n);
        // A replayed progress has no recording of a query and follows nothing
        expect(late.source).toBeNull();
        expect(readProgressRecording(late)).toBeNull();
        expect(() => replayProgressRecording(core, '{"a": 1}')).toThrow();
    });

    it('lays out the plan with the layout of the replay', () => {
        const { LEFT_TO_RIGHT, TOP_DOWN } = dashql.buffers.profile.ProfileLayoutOrientation;
        const stage = (id: string, plan: object) => ({ stageId: `q.${id}`, plan: { jsonRepresentation: JSON.stringify(plan) } });
        const info = { queryId: 'q', stages: { stages: [
            stage('0', { id: '1', name: 'Output', children: [{ id: '2', name: 'TableScan', children: [] }] }),
        ] } };
        const recording = JSON.stringify({ version: 1, payloads: [{ elapsedMs: 0, payload: { kind: 'trino_query_info', info, receivedAt: 1 } }] });
        const orientation = (progress: QueryProfileProgress) => progress.structure.read().layoutConfig()!.input()!.orientation();
        expect(orientation(replayProgressRecording(core, recording, 0, createProfileLayoutConfig(LEFT_TO_RIGHT))!)).toEqual(LEFT_TO_RIGHT);
        const rotated = replayProgressRecording(core, recording, 0, createProfileLayoutConfig(TOP_DOWN))!;
        expect(orientation(rotated)).toEqual(TOP_DOWN);
        expect(rotated.structure.read().operatorsLength()).toEqual(2);
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
