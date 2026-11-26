// The perf marks on the timeline: the spans of functions, also of the module of the core, which records the planner
// while the store takes the changes. See "Perf marks" in docs/design/dashql_runtime.md.
import { afterEach, describe, expect, it } from 'vitest';

import * as perfMarks from '../core/perf_marks.js';
import { newDefaultHyperWasmConnection } from '../platform/connections/connection_params.js';
import { createTestRuntime, type TestRuntime } from './testing/test_runtime.js';

/// The spans of DashQL on the timeline, by name
function spans(): PerformanceMeasure[] {
    return performance.getEntriesByType('measure').filter(entry => entry.name.startsWith(perfMarks.PREFIX)) as PerformanceMeasure[];
}

/// The names of the spans of DashQL without the prefix
function names(): string[] {
    return spans().map(entry => entry.name.substring(perfMarks.PREFIX.length));
}

describe('the perf marks', () => {
    let runtime: TestRuntime | null = null;
    afterEach(async () => {
        perfMarks.setEnabled(false);
        performance.clearMeasures();
        await runtime?.destroy();
        runtime = null;
    });

    it('record nothing while they are off', () => {
        expect(perfMarks.measure('test:off', () => 1)).toBe(1);
        expect(perfMarks.start()).toBeNull();
        perfMarks.end('test:off', perfMarks.start(), () => { throw new Error('the detail is built while off'); });
        expect(names()).toEqual([]);
    });

    it('record the spans of functions, also of those that resolve or throw', async () => {
        perfMarks.setEnabled(true);
        expect(perfMarks.measure('test:sync', () => 1, 'a.sql')).toBe(1);
        expect(await perfMarks.measure('test:async', async () => 2)).toBe(2);
        expect(() => perfMarks.measure('test:throws', () => { throw new Error('failed'); })).toThrow('failed');
        expect(names()).toEqual(['test:sync', 'test:async', 'test:throws']);
        // The detail and the track of the performance panel of Chrome
        expect(spans()[0].detail).toMatchObject({ text: 'a.sql', devtools: { dataType: 'track-entry', track: 'test', trackGroup: 'DashQL' } });
    });

    it('record the planner of the core in the flush of the store', async () => {
        const rt = runtime = await createTestRuntime();
        // The browser tests share one core across the frames of the test page, another copy of the package may have
        // created it: its recorder joins the marks of this copy
        perfMarks.attachModule(rt.core.bindings.setPerfRecorder);
        const connection = rt.createConnection(newDefaultHyperWasmConnection({ active: false }));
        const workbook = rt.createWorkbook(connection.connectionId, 'Marks', false);
        rt.flush();
        perfMarks.setEnabled(true);
        rt.dispatch({ workbook: workbook.workbookId }, { kind: 'createScript', value: { text: 'select 1', base: 'a' } });
        rt.flush();
        const recorded = names();
        expect(recorded).toEqual(expect.arrayContaining([
            'runtime:dispatch', 'store:flush', 'store:takeChanges', 'store:views',
            'planner:derive', 'planner:plan', 'planner:references', 'planner:dataflow', 'planner:inputs',
        ]));
        // The planner derives in the take of the changes
        const take = spans().find(entry => entry.name === `${perfMarks.PREFIX}store:takeChanges`)!;
        const derive = spans().find(entry => entry.name === `${perfMarks.PREFIX}planner:derive`)!;
        expect(derive.startTime).toBeGreaterThanOrEqual(take.startTime);
        expect(derive.startTime + derive.duration).toBeLessThanOrEqual(take.startTime + take.duration);
        expect((derive.detail as { text: string }).text).toBe(workbook.workbookId);

        // Off, the core records nothing either
        perfMarks.setEnabled(false);
        performance.clearMeasures();
        rt.dispatch({ workbook: workbook.workbookId }, { kind: 'createScript', value: { text: 'select 2', base: 'b' } });
        rt.flush();
        expect(names()).toEqual([]);
    });
});
