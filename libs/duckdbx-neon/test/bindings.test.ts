import * as duckdbx from '../src';

export function testBindings() {
    describe('Bindings', () => {
        it('hello duckdb', async () => {
            const db = await duckdbx.openInMemory();
            const conn = await db.connect();
            const result = await conn.runQuery('select 1');
            const buffer = result.access();
            expect(buffer.length).toBeGreaterThan(0);
        });
    });
}
