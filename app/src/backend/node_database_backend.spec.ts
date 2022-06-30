import * as dashql from '@dashql/dashql-core/node';

describe('DashQL Database Node', () => {
    beforeAll(async () => {});
    beforeEach(async () => {});
    afterEach(async () => {});

    it('hello world', async () => {
        const instance = dashql.openInMemory();
        const conn = instance.connect();
        const result = await conn.runQuery('select 42;');
        await result.delete();
        await conn.close();
        await instance.close();
    });
});
