import * as arrow from 'apache-arrow';
import { testBackends } from '../../testenv/test_backends';

describe('Backend', () => {
    testBackends(backend => {
        it('hello database', async () => {
            const frontend = {} as any;
            const session = await backend.workflow.createSession(frontend);
            const query = await backend.workflow.runQuery(session, 'select 42::integer as v');

            const reader = arrow.RecordBatchReader.from<{ v: arrow.Int32 }>(query);
            expect(reader.isSync()).toBeTruthy();
            expect(reader.isFile()).toBeTruthy();
            const table = new arrow.Table(reader as arrow.RecordBatchFileReader);
            const rows = table.toArray();
            expect(rows.length).toEqual(1);
            expect(rows[0].v).toEqual(42);

            await backend.workflow.closeSession(session);
        });
    });
});
