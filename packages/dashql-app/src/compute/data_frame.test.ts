// @vitest-environment node
import * as arrow from 'apache-arrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSerializedNodeTestClient } from '../shared/platform/hyperdb/hyperdb_test_client.js';
import { HyperDB } from '../shared/platform/hyperdb/hyperdb_wasm.js';
import { TestLogger } from '../shared/platform/logger/test_logger.js';
import { DataFrame, DataFrameRegistry, generateTableName } from './data_frame.js';

function toPlainObjects(table: arrow.Table): any[] {
    return table.toArray().map(row => {
        const obj: any = {};
        for (const key of Object.keys(row)) {
            obj[key] = (row as any)[key];
        }
        return obj;
    });
}

describe('DataFrame', () => {
    let database: HyperDB | null = null;
    let releaseClient: (() => Promise<void>) | null = null;

    beforeEach(async () => {
        const { client, release } = await createSerializedNodeTestClient();
        releaseClient = release;
        database = await HyperDB.create(client);
    }, 30_000);

    afterEach(async () => {
        try {
            await database?.terminate();
        } finally {
            await releaseClient?.();
        }
    });

    it('keeps named tables readable across ad-hoc connections', async () => {
        const tableName = generateTableName('__frame');
        const summaryName = generateTableName('__summary');
        const inputTable = arrow.tableFromArrays({
            id: new Int32Array([1, 2, 3]),
            label: ['alpha', 'beta', 'gamma'],
        });

        const dataFrame = await DataFrame.fromArrowTable(database!, inputTable, tableName);
        const [firstRead, secondRead] = await Promise.all([
            dataFrame.readTable(),
            dataFrame.readTable(),
        ]);

        expect(toPlainObjects(firstRead)).toEqual([
            { id: 1, label: 'alpha' },
            { id: 2, label: 'beta' },
            { id: 3, label: 'gamma' },
        ]);
        expect(toPlainObjects(secondRead)).toEqual(toPlainObjects(firstRead));

        const summaryFrame = await DataFrame.fromSQL(
            database!,
            `SELECT COUNT(*)::INTEGER AS row_count FROM "${tableName}"`,
            summaryName,
        );
        const summary = await summaryFrame.readTable();
        expect(toPlainObjects(summary)).toEqual([{ row_count: 3 }]);

        await summaryFrame.destroy();
        await expect(summaryFrame.readTable()).rejects.toThrow();

        await dataFrame.destroy();
        await expect(dataFrame.readTable()).rejects.toThrow();
    });

    it('drops a data frame when its last registry reference is released', async () => {
        const tableName = generateTableName('__released');
        const dataFrame = await DataFrame.fromArrowTable(database!, arrow.tableFromArrays({ id: [1] }), tableName);
        const registry = new DataFrameRegistry(new TestLogger());
        const destroy = vi.spyOn(dataFrame, 'destroy');

        registry.acquire(dataFrame);
        registry.release(dataFrame);

        expect(destroy).toHaveBeenCalledOnce();
        await destroy.mock.results[0].value;
        await expect(dataFrame.readTable()).rejects.toThrow();
        expect(registry.getRegisteredDataFrames().size).toBe(0);
    });
});
