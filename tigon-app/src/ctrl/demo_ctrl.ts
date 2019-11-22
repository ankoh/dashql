import * as Model from '../model';
import * as proto from 'tigon-proto';
import { CoreController } from './core_ctrl';
import { LogController } from './log_ctrl';

export class DemoController {
    protected store: Model.ReduxStore;
    protected log: LogController;
    protected core: CoreController;

    constructor(store: Model.ReduxStore, core: CoreController, log: LogController) {
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

            VIZ temp_weekly_bar FROM temp_weekly USING BAR CHART;
        `);
        
        for (let stmt of tql.getStatementsList()) {
            this.store.dispatch(Model.pushTransientTQLStatement(stmt));
        }

        // Q1 result
        let q1Res = new QueryResultWriter();
        q1Res.addNumericColumn("col1", proto.duckdb.SQLTypeID.SQL_INTEGER, [
            1, 2, 3, 4, 5, 6, 7, 8, 9
        ]);
        q1Res.addNumericColumn("col2", proto.duckdb.SQLTypeID.SQL_INTEGER, [
            10, 11, 12, 13, 14, 15, 16, 17, 18, 19
        ]);
        this.store.dispatch(Model.setTransientQueryResult("temp_weekly", q1Res.finish()));       
    }
};

export class QueryResultWriter {
    protected queryResult: proto.duckdb.QueryResult;
    protected dataChunk: proto.duckdb.QueryResultChunk;
    protected columnCount: number;
    protected rowCount: number;

    constructor() {
        this.queryResult = new proto.duckdb.QueryResult();
        this.dataChunk = new proto.duckdb.QueryResultChunk();
        this.columnCount = 0;
        this.rowCount = 0;
    }

    public addNumericColumn(name: string, sqlTypeID: proto.duckdb.SQLTypeIDMap[keyof proto.duckdb.SQLTypeIDMap], rows: Array<number>) {
        this.rowCount = rows.length;
        this.columnCount += 1;
        let column = new proto.duckdb.QueryResultColumn();
        let sqlType = new proto.duckdb.SQLType();
        sqlType.setTypeId(sqlTypeID);
        switch (sqlTypeID) {
            case proto.duckdb.SQLTypeID.SQL_BIGINT:
                this.queryResult.addColumnRawTypes(proto.duckdb.RawTypeID.RAW_BIGINT);
                column.setRowsU64List(rows);
                break;
            case proto.duckdb.SQLTypeID.SQL_BOOLEAN:
                this.queryResult.addColumnRawTypes(proto.duckdb.RawTypeID.RAW_BOOLEAN);
                column.setRowsI32List(rows);
                break;
            case proto.duckdb.SQLTypeID.SQL_FLOAT:
                this.queryResult.addColumnRawTypes(proto.duckdb.RawTypeID.RAW_FLOAT);
                column.setRowsF32List(rows);
                break;
            case proto.duckdb.SQLTypeID.SQL_DOUBLE:
                this.queryResult.addColumnRawTypes(proto.duckdb.RawTypeID.RAW_DOUBLE);
                column.setRowsF64List(rows);
                break;
            case proto.duckdb.SQLTypeID.SQL_INTEGER:
                this.queryResult.addColumnRawTypes(proto.duckdb.RawTypeID.RAW_INTEGER);
                column.setRowsI64List(rows);
                break;
            case proto.duckdb.SQLTypeID.SQL_SMALLINT:
                this.queryResult.addColumnRawTypes(proto.duckdb.RawTypeID.RAW_SMALLINT);
                column.setRowsI32List(rows);
                break;
            case proto.duckdb.SQLTypeID.SQL_TINYINT:
                this.queryResult.addColumnRawTypes(proto.duckdb.RawTypeID.RAW_TINYINT);
                column.setRowsI32List(rows);
                break;
            // TODO
        }
        let nullMask = new Array<boolean>();
        nullMask.length = rows.length;
        nullMask.fill(false);
        column.setNullMaskList(nullMask);
        this.queryResult.addColumnNames(name);
        this.queryResult.addColumnSqlTypes(sqlType)
        this.dataChunk.addColumns(column);
    }

    public addVarcharColumn(name: string, rows: Array<string>) {
        this.rowCount = rows.length;
        this.columnCount += 1;
        let column = new proto.duckdb.QueryResultColumn();
        column.setRowsStrList(rows);
        let nullMask = new Array<boolean>();
        nullMask.length = rows.length;
        nullMask.fill(false);
        column.setNullMaskList(nullMask);
        this.dataChunk.addColumns(column);
        let sqlType = new proto.duckdb.SQLType();
        sqlType.setTypeId(proto.duckdb.SQLTypeID.SQL_VARCHAR);
        this.queryResult.addColumnSqlTypes(sqlType);
        this.queryResult.addColumnRawTypes(proto.duckdb.RawTypeID.RAW_VARCHAR);
        this.queryResult.addColumnNames(name);
    }

    public finish(): proto.duckdb.QueryResult {
        let queryResult = this.queryResult;
        queryResult.setColumnCount(this.columnCount);
        queryResult.setRowCount(this.rowCount);
        queryResult.addDataChunks(this.dataChunk);
        return queryResult;
    }
};
