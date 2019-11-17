import * as Model from '../model';
import * as proto from 'tigon-proto';
import { CoreController } from './core_ctrl';
import { LogController } from './log_ctrl';
import { flatbuffers } from 'flatbuffers';

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
        this.store.dispatch(Model.pushTransientTQLModule(tql));

        // Build a query result
        let q1Res = new QueryResultWriter();
        q1Res.addNumericColumn("col1", proto.duckdb.SQLTypeID.INTEGER, [
            1, 2, 3, 4, 5, 6, 7, 8, 9
        ]);
        q1Res.addNumericColumn("col2", proto.duckdb.SQLTypeID.INTEGER, [
            10, 11, 12, 13, 14, 15, 16, 17, 18, 19
        ]);

        // Encode the query result
        let q1ResBuilder = new flatbuffers.Builder();
        let q1ResOfs = q1Res.write(q1ResBuilder);
        q1ResBuilder.finish(q1ResOfs);
        let [q1ResPtr, q1ResSize] = await this.core.copyFlatBuffer(session, q1ResBuilder.dataBuffer());
        let q1ResBuffer = new Model.QueryResultBuffer(this.core, session, q1ResPtr, q1ResSize);

        
    }
};

export class QueryResultWriter {
    protected columnData: Array<Array<string> | Array<number>>;
    protected columnRawTypes: Array<proto.duckdb.RawTypeID>;
    protected columnSQLTypes: Array<proto.duckdb.SQLTypeID>;
    protected columnNames: Array<string>;

    constructor() {
        this.columnData = new Array();
        this.columnRawTypes = new Array();
        this.columnSQLTypes = new Array();
        this.columnNames = new Array();
    }

    public addNumericColumn(name: string, sqlType: proto.duckdb.SQLTypeID, rows: Array<number>) {
        switch (sqlType) {
            case proto.duckdb.SQLTypeID.BIGINT:
                this.columnRawTypes.push(proto.duckdb.RawTypeID.BIGINT);
                break;
            case proto.duckdb.SQLTypeID.BOOLEAN:
                this.columnRawTypes.push(proto.duckdb.RawTypeID.BOOLEAN);
                break;
            case proto.duckdb.SQLTypeID.DOUBLE:
                this.columnRawTypes.push(proto.duckdb.RawTypeID.DOUBLE);
                break;
            case proto.duckdb.SQLTypeID.FLOAT:
                this.columnRawTypes.push(proto.duckdb.RawTypeID.FLOAT);
                break;
            case proto.duckdb.SQLTypeID.INTEGER:
                this.columnRawTypes.push(proto.duckdb.RawTypeID.INTEGER);
                break;
            case proto.duckdb.SQLTypeID.SMALLINT:
                this.columnRawTypes.push(proto.duckdb.RawTypeID.SMALLINT);
                break;
            case proto.duckdb.SQLTypeID.TINYINT:
                this.columnRawTypes.push(proto.duckdb.RawTypeID.TINYINT);
                break;
            // TODO
        }
        this.columnSQLTypes.push(sqlType);
        this.columnData.push(rows);
        this.columnNames.push(name);
    }

    public addVarcharColumn(name: string, rows: Array<string>) {
        this.columnSQLTypes.push(proto.duckdb.SQLTypeID.VARCHAR);
        this.columnRawTypes.push(proto.duckdb.RawTypeID.VARCHAR);
        this.columnData.push(rows);
        this.columnNames.push(name);
    }

    public write(builder: flatbuffers.Builder): flatbuffers.Offset {
        // Encode columns
        let columns = new Array<flatbuffers.Offset>();
        for (let i = 0; i < this.columnRawTypes.length; ++i) {
            if (this.columnRawTypes[i] == proto.duckdb.RawTypeID.VARCHAR) {
                columns.push(this.writeVarCharColumn(builder, this.columnData[i] as Array<string>))
            } else {
                columns.push(this.writeNumericColumn(builder, this.columnRawTypes[i], this.columnData[i] as Array<number>))
            }
        }
        let columnsOfs = proto.duckdb.QueryResultChunk.createColumnsVector(builder, columns);

        // Encode chunk
        proto.duckdb.QueryResultChunk.startQueryResultChunk(builder);
        proto.duckdb.QueryResultChunk.addColumns(builder, columnsOfs);
        let chunkOfs = proto.duckdb.QueryResultChunk.endQueryResultChunk(builder);
        let chunksOfs = proto.duckdb.QueryResult.createDataChunksVector(builder, [chunkOfs]);

        // Encode names
        let names = this.columnNames.map(n => builder.createString(n));
        let namesOfs = proto.duckdb.QueryResult.createColumnNamesVector(builder, names);
        let rawTypesOfs = proto.duckdb.QueryResult.createColumnRawTypesVector(builder, this.columnRawTypes);

        // Encode sql types
        proto.duckdb.QueryResult.startColumnRawTypesVector(builder, this.columnSQLTypes.length);
        for (let i = 0; i < this.columnSQLTypes.length; ++i) {
            proto.duckdb.SQLType.createSQLType(builder, this.columnSQLTypes[i], 0, 0);
        }
        let sqlTypesOfs = builder.endVector();

        // Encode result
        proto.duckdb.QueryResult.startQueryResult(builder);
        proto.duckdb.QueryResult.addColumnNames(builder, namesOfs);
        proto.duckdb.QueryResult.addColumnSqlTypes(builder, sqlTypesOfs);
        proto.duckdb.QueryResult.addColumnRawTypes(builder, rawTypesOfs);
        proto.duckdb.QueryResult.addDataChunks(builder, chunksOfs);
        return proto.duckdb.QueryResult.endQueryResult(builder);
    }

    protected writeNumericColumn(builder: flatbuffers.Builder, typeID: proto.duckdb.RawTypeID, rows: Array<number>): flatbuffers.Offset {
        // Encode the null mask
        let nullMask = new Array<boolean>();
        nullMask.length = rows.length;
        nullMask.fill(true);
        let nullMaskOfs = proto.duckdb.QueryResultColumn.createNullMaskVector(builder, nullMask);

        // Encode the rows
        let rowOfs: flatbuffers.Offset | null = null;
        switch (typeID) {
            case proto.duckdb.RawTypeID.BOOLEAN:
                rowOfs = proto.duckdb.QueryResultColumn.createRowsU8Vector(builder, rows);
                break;
            case proto.duckdb.RawTypeID.TINYINT:
                rowOfs = proto.duckdb.QueryResultColumn.createRowsI16Vector(builder, rows);
                break;
            case proto.duckdb.RawTypeID.SMALLINT:
                rowOfs = proto.duckdb.QueryResultColumn.createRowsI32Vector(builder, rows);
                break;
            case proto.duckdb.RawTypeID.INTEGER: {
                let buffer = rows.map(row => new flatbuffers.Long(row, 0));
                rowOfs = proto.duckdb.QueryResultColumn.createRowsI64Vector(builder, buffer);
                break;
            }
            case proto.duckdb.RawTypeID.BIGINT: {
                let buffer = rows.map(row => new flatbuffers.Long(row, 0));
                rowOfs = proto.duckdb.QueryResultColumn.createRowsI64Vector(builder, buffer);
                break;
            }
            case proto.duckdb.RawTypeID.HASH: {
                let buffer = rows.map(row => new flatbuffers.Long(row, 0));
                rowOfs = proto.duckdb.QueryResultColumn.createRowsU64Vector(builder, buffer);
                break;
            }
            case proto.duckdb.RawTypeID.POINTER: {
                let buffer = rows.map(row => new flatbuffers.Long(row, 0));
                rowOfs = proto.duckdb.QueryResultColumn.createRowsU64Vector(builder, buffer);
                break;
            }
            case proto.duckdb.RawTypeID.FLOAT:
                rowOfs = proto.duckdb.QueryResultColumn.createRowsF32Vector(builder, rows);
                break;
            case proto.duckdb.RawTypeID.DOUBLE:
                rowOfs = proto.duckdb.QueryResultColumn.createRowsF64Vector(builder, rows);
                break;
        }

        // Encode the result column
        proto.duckdb.QueryResultColumn.startQueryResultColumn(builder);
        proto.duckdb.QueryResultColumn.addTypeId(builder, typeID);
        proto.duckdb.QueryResultColumn.addNullMask(builder, nullMaskOfs);
        switch (typeID) {
            case proto.duckdb.RawTypeID.BOOLEAN:
                proto.duckdb.QueryResultColumn.addRowsU8(builder, rowOfs!);
                break;
            case proto.duckdb.RawTypeID.TINYINT:
                proto.duckdb.QueryResultColumn.addRowsI16(builder, rowOfs!);
                break;
            case proto.duckdb.RawTypeID.SMALLINT:
                proto.duckdb.QueryResultColumn.addRowsI32(builder, rowOfs!);
                break;
            case proto.duckdb.RawTypeID.INTEGER:
                proto.duckdb.QueryResultColumn.addRowsI64(builder, rowOfs!);
                break;
            case proto.duckdb.RawTypeID.BIGINT:
                proto.duckdb.QueryResultColumn.addRowsI64(builder, rowOfs!);
                break;
            case proto.duckdb.RawTypeID.HASH:
                proto.duckdb.QueryResultColumn.addRowsU64(builder, rowOfs!);
                break;
            case proto.duckdb.RawTypeID.POINTER:
                proto.duckdb.QueryResultColumn.addRowsU64(builder, rowOfs!);
                break;
            case proto.duckdb.RawTypeID.FLOAT:
                proto.duckdb.QueryResultColumn.addRowsF32(builder, rowOfs!);
                break;
            case proto.duckdb.RawTypeID.DOUBLE:
                proto.duckdb.QueryResultColumn.addRowsF64(builder, rowOfs!);
                break;
        }
        return proto.duckdb.QueryResultColumn.endQueryResultColumn(builder);
    }

    protected writeVarCharColumn(builder: flatbuffers.Builder, rows: Array<string>): flatbuffers.Offset {
        // Encode the null mask
        let nullMask = new Array<boolean>();
        nullMask.length = rows.length;
        nullMask.fill(true);
        let nullMaskOfs = proto.duckdb.QueryResultColumn.createNullMaskVector(builder, nullMask);

        // Encode the rows
        let strings = rows.map(row => builder.createString(row));
        let rowsOfs = proto.duckdb.QueryResultColumn.createRowsStringVector(builder, strings);

        // Encode the result column
        proto.duckdb.QueryResultColumn.startQueryResultColumn(builder);
        proto.duckdb.QueryResultColumn.addTypeId(builder, proto.duckdb.RawTypeID.VARCHAR);
        proto.duckdb.QueryResultColumn.addNullMask(builder, nullMaskOfs);
        proto.duckdb.QueryResultColumn.addRowsString(builder, rowsOfs);
        return proto.duckdb.QueryResultColumn.endQueryResultColumn(builder);
    }
};
