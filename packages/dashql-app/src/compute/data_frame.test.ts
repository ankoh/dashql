// @vitest-environment node
import * as arrow from 'apache-arrow';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { instantiateTestWebDB } from '../duckdb/duckdb_test_worker.js';
import { DuckDB } from '../duckdb/duckdb_api.js';
import { DataFrame, generateTableName } from './data_frame.js';

declare const WEBDB_PRECOMPILED: Promise<Uint8Array>;

let webdbWasmBinary: Uint8Array;

function toPlainObjects(table: arrow.Table): any[] {
    return table.toArray().map(row => {
        const obj: any = {};
        for (const key of Object.keys(row)) {
            obj[key] = (row as any)[key];
        }
        return obj;
    });
}

beforeAll(async () => {
    webdbWasmBinary = await WEBDB_PRECOMPILED;
});

describe('DataFrame', () => {
    let webdb: DuckDB;

    beforeEach(async () => {
        webdb = await instantiateTestWebDB(webdbWasmBinary);
        await webdb.open({ maximumThreads: 1 });
    });

    afterEach(() => {
        if (webdb) {
            webdb.terminate();
        }
    });

    it('keeps named tables readable across ad-hoc connections', async () => {
        const tableName = generateTableName('__frame');
        const summaryName = generateTableName('__summary');
        const inputTable = arrow.tableFromArrays({
            id: new Int32Array([1, 2, 3]),
            label: ['alpha', 'beta', 'gamma'],
        });

        const dataFrame = await DataFrame.fromArrowTable(webdb, inputTable, tableName);
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
            webdb,
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
});
