import * as proto from '@dashql/proto';
import * as webdb from '@dashql/webdb/dist/webdb_async';
import * as platform from '../platform';

const OVERSCAN = 1024;

export interface TableScanRange {
    offset: number;
    limit: number;
}

export class TableScanBuffer {
    /// The database manager
    _database: platform.DatabaseManager;
    /// The table name
    _tableName: string;
    /// The cached result buffer
    _cachedBuffer: proto.webdb.QueryResult | null = null;
    /// The cached table range
    _cachedRange: TableScanRange = {
        offset: 0,
        limit: 0,
    };

    /// Constructor
    constructor(db: platform.DatabaseManager, tableName: string) {
        this._database = db;
        this._tableName = tableName;
    }

    /// Is a range already available?
    public isCached(want: TableScanRange) {
        const have = this._cachedRange;
        return this._cachedBuffer && have.offset <= want.offset && have.offset + have.limit >= want.offset + want.limit;
    }

    /// Query a range of a table
    protected async queryRange(range: TableScanRange): Promise<[proto.webdb.QueryResult | null, TableScanRange]> {
        if (this.isCached(range)) {
            return [this._cachedBuffer, range];
        }
        const offset = Math.trunc(Math.max(range.offset, OVERSCAN) - OVERSCAN);
        const limit = Math.trunc(range.limit + range.offset + OVERSCAN - offset);
        const result = await this._database.use(async (conn: webdb.AsyncWebDBConnection) => {
            if (this.isCached(range)) {
                return this._cachedBuffer;
            }
            return await conn.runQuery(`SELECT * FROM ${this._tableName} LIMIT ${limit} OFFSET ${offset}`);
        });
        this._cachedBuffer = result;
        this._cachedRange = range;
        return [result, range];
    }

    /// Iterate a column range within a table
    public async iterateNumberColumnRange(
        range: TableScanRange,
        column: number,
        fn: (row: number, v: number | null) => void,
    ) {
        const [result, resultRange] = await this.queryRange(range);
        if (!result) return;

        let skip = range.offset - resultRange.offset;
        let iter = new webdb.MaterializedQueryResultChunks(result);
        let row = -1;
        while (iter.next()) {
            const skipHere = Math.min(skip, iter.currentChunk.rowCount());
            skip -= skipHere;
            iter.iterateNumberColumn(
                column,
                (_: number, v: number | null) => {
                    fn(++row, v);
                },
                skip,
            );
        }
    }
}
