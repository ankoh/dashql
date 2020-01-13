import * as Store from '../store';
import * as proto from 'tigon-proto';
import { CoreController } from './core_ctrl';
import { LogController } from './log_ctrl';

export class DemoController {
    protected store: Store.ReduxStore;
    protected log: LogController;
    protected core: CoreController;

    constructor(store: Store.ReduxStore, core: CoreController, log: LogController) {
        this.store = store;
        this.core = core;
        this.log = log;
    }

    async init() {
        await this.core.waitUntilReady();
        let session = await this.core.createSession();
        let tql = await this.core.parseTQL(session, `
            DECLARE PARAMETER days AS INTEGER;

            LOAD whether_api_data FROM http (
                url = 'http://www.google.com',
                method = get
            );

            EXTRACT weather_data FROM whether_api_data USING json ();

            QUERY temp_weekly AS SELECT * FROM region, nation;

            QUERY rain_weekly AS SELECT * FROM region, nation;

            VIZ temp_weekly_table FROM temp_weekly USING TABLE (
                title = "Weekly Temperature Data",
                area = 6/20
            );

            VIZ temp_weekly_bar FROM temp_weekly USING Bar (
                title = "Weekly Temperature",
                area = 6/20/6/0
            );
        `);

        // Q1 result
        let q1Res = new QueryResultWriter();
        q1Res.addNumericColumn("col1", proto.engine.SQLTypeID.SQL_INTEGER, [
            1, 2, 3, 4, 5, 6, 7, 8, 9
        ]);
        q1Res.addNumericColumn("col2", proto.engine.SQLTypeID.SQL_INTEGER, [
            10, 11, 12, 13, 14, 15, 16, 17, 18, 19
        ]);
        q1Res.addNumericColumn("col3", proto.engine.SQLTypeID.SQL_INTEGER, [
            20, 21, 22, 23, 24, 25, 26, 27, 28, 29
        ]);
        q1Res.addNumericColumn("col4", proto.engine.SQLTypeID.SQL_INTEGER, [
            30, 31, 32, 33, 34, 35, 36, 37, 38, 39
        ]);

        this.store.dispatch(Store.pushTransientTQLStatements(tql.getStatementsList()));
        this.store.dispatch(Store.setTransientQueryResult("temp_weekly", q1Res.finish()));       
    }
};

export class QueryResultWriter {
    protected queryResult: proto.engine.QueryResult;
    protected dataChunk: proto.engine.QueryResultChunk;
    protected columnCount: number;
    protected rowCount: number;

    constructor() {
        this.queryResult = new proto.engine.QueryResult();
        this.dataChunk = new proto.engine.QueryResultChunk();
        this.columnCount = 0;
        this.rowCount = 0;
    }

    public addNumericColumn(name: string, sqlTypeID: proto.engine.SQLTypeIDMap[keyof proto.engine.SQLTypeIDMap], rows: Array<number>) {
        this.rowCount = rows.length;
        this.columnCount += 1;
        let column = new proto.engine.QueryResultColumn();
        let sqlType = new proto.engine.SQLType();
        let rawType: proto.engine.RawTypeIDMap[keyof proto.engine.RawTypeIDMap] = proto.engine.RawTypeID.RAW_INVALID;
        sqlType.setTypeId(sqlTypeID);
        switch (sqlTypeID) {
            case proto.engine.SQLTypeID.SQL_BIGINT:
                rawType = proto.engine.RawTypeID.RAW_BIGINT;
                column.setRowsU64List(rows);
                break;
            case proto.engine.SQLTypeID.SQL_BOOLEAN:
                rawType = proto.engine.RawTypeID.RAW_BOOLEAN;
                column.setRowsI32List(rows);
                break;
            case proto.engine.SQLTypeID.SQL_FLOAT:
                rawType = proto.engine.RawTypeID.RAW_FLOAT;
                column.setRowsF32List(rows);
                break;
            case proto.engine.SQLTypeID.SQL_DOUBLE:
                rawType = proto.engine.RawTypeID.RAW_DOUBLE;
                column.setRowsF64List(rows);
                break;
            case proto.engine.SQLTypeID.SQL_INTEGER:
                rawType = proto.engine.RawTypeID.RAW_INTEGER;
                column.setRowsI64List(rows);
                break;
            case proto.engine.SQLTypeID.SQL_SMALLINT:
                rawType = proto.engine.RawTypeID.RAW_SMALLINT;
                column.setRowsI32List(rows);
                break;
            case proto.engine.SQLTypeID.SQL_TINYINT:
                rawType = proto.engine.RawTypeID.RAW_TINYINT;
                column.setRowsI32List(rows);
                break;
            // TODO
        }
        let nullMask = new Array<boolean>();
        nullMask.length = rows.length;
        nullMask.fill(false);
        column.setTypeId(rawType);
        column.setNullMaskList(nullMask);
        this.queryResult.addColumnRawTypes(rawType);
        this.queryResult.addColumnNames(name);
        this.queryResult.addColumnSqlTypes(sqlType)
        this.dataChunk.addColumns(column);
    }

    public addVarcharColumn(name: string, rows: Array<string>) {
        this.rowCount = rows.length;
        this.columnCount += 1;
        let column = new proto.engine.QueryResultColumn();
        column.setRowsStrList(rows);
        let nullMask = new Array<boolean>();
        nullMask.length = rows.length;
        nullMask.fill(false);
        column.setNullMaskList(nullMask);
        this.dataChunk.addColumns(column);
        let sqlType = new proto.engine.SQLType();
        sqlType.setTypeId(proto.engine.SQLTypeID.SQL_VARCHAR);
        this.queryResult.addColumnSqlTypes(sqlType);
        this.queryResult.addColumnRawTypes(proto.engine.RawTypeID.RAW_VARCHAR);
        this.queryResult.addColumnNames(name);
    }

    public finish(): proto.engine.QueryResult {
        let queryResult = this.queryResult;
        this.dataChunk.setRowOffset(0);
        this.dataChunk.setRowCount(this.rowCount);
        queryResult.setColumnCount(this.columnCount);
        queryResult.setRowCount(this.rowCount);
        queryResult.addDataChunks(this.dataChunk);
        return queryResult;
    }
};
