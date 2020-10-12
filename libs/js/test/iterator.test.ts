import { DuckDB } from '../dist/duckdb_node.js';
import * as duckdb from '../dist/duckdb_node.js';

var db: DuckDB;

beforeEach(async () => {
    db = new DuckDB();
    await db.open();
});

afterEach(() => {
});

test('INTEGER column', async () => {
    let conn = await db.connect();
    let result = await db.sendQuery(conn, `
        SELECT v::INTEGER FROM generate_series(0, 10000) as t(v);
    `);
    expect(result.root.columnTypesLength()).toBe(1);

    let resultChunks = new duckdb.webapi.QueryResultChunkStream(db, conn, result);
    let resultIter = await duckdb.webapi.QueryResultIterator.iterate(resultChunks);

//    QueryResultIterator iter{conn, result};
//    for (unsigned i = 0; i <= 10000; ++i) {
//        ASSERT_FALSE(iter.IsEnd());
//        ASSERT_EQ(iter.GetValue(0).GetValue<int32_t>(), i);
//        iter.Next();
//    }
//    ASSERT_TRUE(iter.IsEnd());
});
