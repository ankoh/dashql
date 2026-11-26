// The events of a reported run (`runWorkbookReported`) on a runtime over the embedded Hyper of the tests
import { afterEach, describe, expect, it } from 'vitest';

import type { ConnectionParams } from '../platform/connections/connection_params.js';
import type { HyperDB } from '../platform/hyperdb/hyperdb_wasm.js';
import { createQueryResponseStreamMetrics, type QueryExecutionResponseStream } from '../platform/query/query_execution_state.js';
import { tableFromArrays } from '../platform/testing/arrow_fixtures.js';
import { openTestHyperDB } from '../platform/testing/test_hyperdb.js';
import type { RunEvent } from '../platform/workbook/run_events.js';
import { createTestRuntime, type TestRuntime } from './testing/test_runtime.js';
import { runWorkbookReported } from './workbook_run_report.js';

describe('a reported run of a workbook', () => {
    let runtime: TestRuntime | null = null;
    let database: HyperDB | null = null;

    afterEach(async () => {
        await runtime?.destroy();
        runtime = null;
        await database?.terminate();
        database = null;
    });

    /// Run a workbook of one script whose connection answers with five rows, the events that carry `rows` rows
    async function run(rows: number): Promise<Extract<RunEvent, { type: 'script_done' }>> {
        database = await openTestHyperDB('workbook_run_report_test');
        const rt = await createTestRuntime({ computeDatabase: database });
        runtime = rt;
        // Descending values: rows out of the order of the result would show
        const result = tableFromArrays({ n: Int32Array.from([5, 4, 3, 2, 1]) });
        const stream: QueryExecutionResponseStream = {
            getMetrics: createQueryResponseStreamMetrics,
            getSchema: async () => result.schema,
            read: async function* () { for (const batch of result.batches) yield { type: 'batch' as const, batch }; },
        };
        const connectionId = crypto.randomUUID();
        await rt.addConnection({ connectionId, params: { hyper: { protocol: 'V3_GRPC', endpoint: 'http://hyper' } } as ConnectionParams, channel: { executeQuery: async () => stream } });
        const workbook = rt.addWorkbook(connectionId, [['five.sql', 'select n from numbers']], { name: 'report' });
        const events: RunEvent[] = [];
        await runWorkbookReported(rt, workbook, {
            scripts: [],
            refresh: false,
            signal: new AbortController().signal,
            rows,
            onReportError: error => { throw error; },
        }, event => events.push(event));
        const done = events.find(event => event.type === 'script_done');
        expect(done).toBeDefined();
        return done as Extract<RunEvent, { type: 'script_done' }>;
    }

    it('reports the first rows of a result in its order, read from the compute database', async () => {
        const done = await run(2);
        expect(done.rows).toBe(5);
        expect(done.queryId).not.toBeNull();
        // The rows come from the data frame of the analysis without the columns that the computation added
        expect(done.table?.schema.fields.map(field => field.name)).toEqual(['n']);
        expect([...(done.table!.getChild('n')!.toArray() as Int32Array)]).toEqual([5, 4]);
    });

    it('reports the schema of a result without rows when it is asked for none', async () => {
        const done = await run(0);
        expect(done.rows).toBe(5);
        expect(done.table?.numRows).toBe(0);
        expect(done.table?.schema.fields.map(field => field.name)).toEqual(['n']);
    });
});
