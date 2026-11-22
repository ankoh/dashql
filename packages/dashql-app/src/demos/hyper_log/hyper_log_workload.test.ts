import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { EmbeddedComputeDatabase } from '@akohn/dashql/platform/embedded_database';
import { TestLogger } from '@akohn/dashql/platform/testing/test_logger';
import { setupWebHyperDB } from '../../host/hyperdb/hyperdb_provider_web.js';
import { createWorkloadTable, HyperLogWorkload, runWorkloadQuery, WORKLOAD_QUERIES, type WorkloadCounts } from './hyper_log_workload.js';

describe('The workload of the Hyper log demo in HyperDB WASM', () => {
    let database: EmbeddedComputeDatabase;

    beforeAll(async () => {
        database = await setupWebHyperDB('hyper_log_workload_test', new TestLogger());
        await createWorkloadTable(database);
    });
    afterAll(async () => {
        await database?.terminate();
    });

    it('runs every query of the workload, only the failing one fails', async () => {
        const failed: string[] = [];
        for (const query of WORKLOAD_QUERIES) {
            if (!(await runWorkloadQuery(database, query))) failed.push(query.name);
        }
        expect(failed).toEqual(['failing']);
    });

    it('sends the queries round robin and counts the failed ones', async () => {
        let counts: WorkloadCounts = { sent: 0, failed: 0 };
        const workload = new HyperLogWorkload(database, next => { counts = next; });
        for (let i = 0; i < WORKLOAD_QUERIES.length; ++i) await workload.tick();
        expect(counts).toEqual({ sent: WORKLOAD_QUERIES.length, failed: 1 });
    });
});
