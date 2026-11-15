import * as arrow from 'apache-arrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { openTestHyperDB } from '../testing/test_hyperdb.js';
import { HyperDB } from '../platform/hyperdb/hyperdb_wasm.js';
import { TestLogger } from '../testing/test_logger.js';
import { DataFrame, DataFrameRegistry } from './data_frame.js';
import { tableFromArrays } from '../testing/arrow_fixtures.js';

/// Import a table like the computations do (`importTable` of computation_native.ts)
async function importDataFrame(database: HyperDB, table: arrow.Table, tableName: string): Promise<DataFrame> {
    await DataFrame.withConnection(database, conn => conn.insertArrowTable(table, { name: tableName, create: true }));
    return new DataFrame(database, tableName);
}

/// Read the rows of a data frame
async function readDataFrame(dataFrame: DataFrame): Promise<arrow.Table> {
    return await dataFrame.withConnection(conn => conn.query(`SELECT * FROM "${dataFrame.tableName}"`));
}

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

    beforeEach(async () => {
        database = await openTestHyperDB('data_frame_test');
    }, 60_000);

    afterEach(async () => {
        await database?.terminate();
    });

    it('keeps named tables readable across ad-hoc connections', async () => {
        const tableName = '__frame';
        const summaryName = '__summary';
        const inputTable = tableFromArrays({
            id: new Int32Array([1, 2, 3]),
            label: ['alpha', 'beta', 'gamma'],
        });

        const dataFrame = await importDataFrame(database!, inputTable, tableName);
        const [firstRead, secondRead] = await Promise.all([
            readDataFrame(dataFrame),
            readDataFrame(dataFrame),
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
        const summary = await readDataFrame(summaryFrame);
        expect(toPlainObjects(summary)).toEqual([{ row_count: 3 }]);

        await summaryFrame.destroy();
        await expect(readDataFrame(summaryFrame)).rejects.toThrow();

        await dataFrame.destroy();
        await expect(readDataFrame(dataFrame)).rejects.toThrow();
    });

    it('drops a data frame when its last registry reference is released', async () => {
        const tableName = '__released';
        const dataFrame = await importDataFrame(database!, tableFromArrays({ id: [1] }), tableName);
        const registry = new DataFrameRegistry(new TestLogger());
        const destroy = vi.spyOn(dataFrame, 'destroy');

        registry.acquire(dataFrame);
        registry.release(dataFrame);

        expect(destroy).toHaveBeenCalledOnce();
        await destroy.mock.results[0].value;
        await expect(readDataFrame(dataFrame)).rejects.toThrow();
        expect(registry.getRegisteredDataFrames().size).toBe(0);
    });
});
