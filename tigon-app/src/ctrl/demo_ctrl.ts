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

    async loadTestModule() {
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
    }

    async encodeFixedLengthQueryResultColumn() {
        // type_id: RawTypeID;
        // null_mask: [bool];
        // fixed_length_data: [ubyte];
        // string_data: [string];
        
    }

    async writeNumericColumn(builder: flatbuffers.Builder, typeID: proto.duckdb.RawTypeID, rows: [number]): Promise<flatbuffers.Offset> {
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

    async writeVarCharColumn(builder: flatbuffers.Builder, rows: [string]): Promise<flatbuffers.Offset> {
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

    async loadTestQueryResults() {
    }
};
