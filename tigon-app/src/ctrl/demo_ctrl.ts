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

    async writeQueryResultColumn(builder: flatbuffers.Builder, typeID: proto.duckdb.RawTypeID, rows: [number]) {
        proto.duckdb.QueryResultColumn.startQueryResultColumn(builder);
        proto.duckdb.QueryResultColumn.addTypeId(builder, typeID);
        let nullMask = new Array<boolean>();
        nullMask.length = rows.length;
        nullMask.fill(true);
        proto.duckdb.QueryResultColumn.createNullMaskVector(builder, nullMask);
        switch (typeID) {
            case proto.duckdb.RawTypeID.BOOLEAN:
                proto.duckdb.QueryResultColumn.createRowsI16Vector(builder, rows);
                break;
            case proto.duckdb.RawTypeID.TINYINT:
                proto.duckdb.QueryResultColumn.createRowsI16Vector(builder, rows);
                break;
            case proto.duckdb.RawTypeID.SMALLINT:
                proto.duckdb.QueryResultColumn.createRowsI32Vector(builder, rows);
                break;
            case proto.duckdb.RawTypeID.INTEGER: {
                let buffer = rows.map(row => new flatbuffers.Long(row, 0));
                proto.duckdb.QueryResultColumn.createRowsI64Vector(builder, buffer);
                break;
            }
            case proto.duckdb.RawTypeID.BIGINT: {
                let buffer = rows.map(row => new flatbuffers.Long(row, 0));
                proto.duckdb.QueryResultColumn.createRowsI64Vector(builder, buffer);
                break;
            }
            case proto.duckdb.RawTypeID.HASH: {
                let buffer = rows.map(row => new flatbuffers.Long(row, 0));
                proto.duckdb.QueryResultColumn.createRowsU64Vector(builder, buffer);
                break;
            }
            case proto.duckdb.RawTypeID.POINTER: {
                let buffer = rows.map(row => new flatbuffers.Long(row, 0));
                proto.duckdb.QueryResultColumn.createRowsU64Vector(builder, buffer);
                break;
            }
            case proto.duckdb.RawTypeID.FLOAT:
                proto.duckdb.QueryResultColumn.createRowsF32Vector(builder, rows);
                break;
            case proto.duckdb.RawTypeID.DOUBLE:
                proto.duckdb.QueryResultColumn.createRowsF64Vector(builder, rows);
                break;
        }
    }

    async loadTestQueryResults() {
    }
};
