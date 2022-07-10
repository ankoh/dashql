import * as dashql from '@dashql/dashql-core/dist/node';
import * as arrow from 'apache-arrow';

describe('Node Database', () => {
    it('hello database', async () => {
        const instance = dashql.database.openInMemory();
        const conn = instance.connect();
        const result = await conn.runQuery('select 42::Integer as a;');
        const reader = arrow.RecordBatchReader.from<{ a: arrow.Int32 }>(result.access());
        expect(reader.isSync()).toBeTruthy();
        expect(reader.isFile()).toBeTruthy();
        const table = new arrow.Table(reader as arrow.RecordBatchFileReader);
        const rows = table.toArray();
        expect(rows.length).toEqual(1);
        expect(rows[0].a).toEqual(42);
        await result.delete();
        await conn.close();
        await instance.close();
    });
});
