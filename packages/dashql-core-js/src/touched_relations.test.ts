import * as dashql from './index.js';

import { loadCoreWasm } from './test_fixture.js';

let dql: dashql.DashQL;

beforeAll(async () => {
    dql = await dashql.DashQL.create({ wasmBinary: await loadCoreWasm() });
});

afterEach(() => {
    dql.resetUnsafe();
});

describe('touchedRelations', () => {
    it('names the relations of statements as written', () => {
        const touched = dql.touchedRelations('create table a.b.c (x int); select 1; drop table t; alter table s.u rename to v;');
        expect(touched.map(r => [r.databaseName, r.schemaName, r.tableName])).toEqual([
            ['a', 'b', 'c'], [null, null, 't'], [null, 's', 'u'], [null, 's', 'v'],
        ]);
    });

    it('names nothing for a statement that does not parse', () => {
        expect(dql.touchedRelations('alter table t owner to someone')).toEqual([]);
    });
});
