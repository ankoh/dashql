import * as duckdbx from '../src';
import * as arrow from 'apache-arrow';

export function testBindings() {
    describe('Bindings', () => {
        it('hello duckdb', async () => {
            const db = await duckdbx.openInMemory();
            const conn = await db.connect();
            const result = await conn.runQuery('select 42::integer as a');
            const buffer = result.access();
            expect(buffer.length).toBeGreaterThan(0);
            const reader = arrow.RecordBatchReader.from<{
                a: arrow.Int32;
            }>(buffer);
            expect(reader.isSync()).toBeTrue();
            expect(reader.isFile()).toBeTrue();
            const table = new arrow.Table(reader);
            expect(table.numCols).toEqual(1);
            expect(table.numRows).toEqual(1);
            const rows = table.toArray();
            expect(rows[0].a).toEqual(42);
            await conn.close();
        });
        it('invalid sql', async () => {
            const db = await duckdbx.openInMemory();
            const conn = await db.connect();
            let error = null;
            try {
                await conn.runQuery('invalid sql');
            } catch (e) {
                error = e;
            }
            expect(error).not.toEqual(null);
            expect(async () => await conn.runQuery('select 42::integer as a')).not.toThrow();
        });
    });
}
