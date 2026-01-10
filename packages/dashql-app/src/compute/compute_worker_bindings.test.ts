import '@jest/globals';

import * as arrow from 'apache-arrow';
import * as compute from '@ankoh/dashql-compute';
import * as path from 'path';
import * as fs from 'fs';

import { fileURLToPath } from 'node:url';
import { TestLogger } from '../platform/test_logger.js';
import { instantiateTestWorker } from './compute_test_worker.js';
import { AsyncDataFrameRegistry } from './compute_worker_bindings.js';
import { createComputationState } from './computation_state.js';

const distPath = path.resolve(fileURLToPath(new URL('../../../dashql-compute/dist/', import.meta.url)));
const wasmPath = path.resolve(distPath, './dashql_compute_bg.wasm');

beforeAll(async () => {
    expect(async () => await fs.promises.access(wasmPath)).resolves;
    const buf = await fs.promises.readFile(wasmPath);
    await compute.default({
        module_or_path: buf
    });
    const version = compute.getVersion();
    expect(version.text).toMatch(/^[0-9]+.[0-9]+.[0-9]+(\-dev\.[0-9]+)?$/);
});

describe('DashQLCompute Worker', () => {
    it('read simple', async () => {
        const logger = new TestLogger();
        const computeWorkerBindings = await instantiateTestWorker(wasmPath, logger);

        const t = arrow.tableFromArrays({
            id: new Int32Array([
                1, 2, 3, 4,
            ]),
            score: new Float64Array([
                42, 10, 10, 30,
            ])
        });

        // Create the arrow ingest
        const arrowIngest = await computeWorkerBindings.createArrowIngest();
        await arrowIngest.writeTable(t);
        const dataFrame = await arrowIngest.finish();

        const tableScan = await dataFrame.readTable();
        const results = tableScan.toArray().map(o => ({ id: o.id, score: o.score }));
        expect(results).toEqual([
            { id: 1, score: 42 },
            { id: 2, score: 10 },
            { id: 3, score: 10 },
            { id: 4, score: 30 },
        ]);
    });
});

describe('DashQLCompute Memory', () => {
    it('acquire and release a data frame', async () => {
        const logger = new TestLogger();
        const memory = new AsyncDataFrameRegistry(logger);
        const worker = await instantiateTestWorker(wasmPath, logger);
        const t = arrow.tableFromArrays({
            id: new Int32Array([
                1, 2, 3, 4,
            ]),
            score: new Float64Array([
                42, 10, 10, 30,
            ])
        });
        const dataFrame = await worker.createDataFrameFromTable(t);
        memory.acquire(dataFrame);
        expect(memory.getRegisteredDataFrames().size).toEqual(1);
        memory.release(dataFrame);
        expect(memory.getRegisteredDataFrames().size).toEqual(0);
    });
});
