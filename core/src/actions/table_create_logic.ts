import * as proto from "@dashql/proto";
import * as webdb from "@dashql/webdb/dist/webdb_async";
import * as model from "../model";
import { ProgramActionLogic } from "./action_logic";
import { ActionContext } from "./action_context";
import ActionStatusCode = proto.action.ActionStatusCode;

export async function collectTableInfo(conn: webdb.AsyncConnection, info: model.DatabaseTableInfo) {
    // Get column names and types
    const limit0 = await conn.runQuery(`SELECT * FROM ${info.nameShort} LIMIT 0`);
    info.columnNames = [];
    for (let ci = 0; ci < limit0.columnNamesLength(); ++ci) {
        info.columnNames.push(limit0.columnNames(ci));
        info.columnTypes.push(webdb.getSQLType(limit0.columnTypes(ci)));
    }

    // Get the row count
    const countResult = await conn.runQuery(`SELECT count(*)::INTEGER FROM ${info.nameShort}`);
    const countChunkIter = new webdb.QueryResultChunkStream(conn, countResult);
    const countRowIter = await webdb.QueryResultRowIterator.iterate(countChunkIter);
    info.rowCount = countRowIter.getValue().castAsInteger();

    info.timeUpdated = new Date();
}

export class CreateTableActionLogic extends ProgramActionLogic {
    constructor(action_id: model.ActionID, action: proto.action.ProgramAction, statement: model.Statement) {
        super(action_id, action, statement);
    }

    public async execute(context: ActionContext): Promise<model.ActionID> {
        const script = this.script;
        if (!script) {
            return this.returnWithStatus(ActionStatusCode.COMPLETED);
        }

        const db = context.platform.database;
        const table = await db.use(async (c: webdb.AsyncConnection) => {
            /// First run the query
            await c.runQuery(script);

            // Return plan object
            const now = new Date();
            const table: model.DatabaseTableInfo = {
                objectId: this.buffer.objectId(),
                objectType: model.PlanObjectType.DATABASE_TABLE_INFO,
                timeCreated: now,
                timeUpdated: now,
                nameQualified: this.buffer.targetNameQualified() || "",
                nameShort: this.buffer.targetNameShort() || "",
                columnNames: [],
                columnTypes: [],
                rowCount: 0,
            };
            await collectTableInfo(c, table);
            return table;
        });

        if (table) {
            const store = context.platform.store;
            model.mutate(store.dispatch, {
                type: model.StateMutationType.INSERT_PLAN_OBJECTS,
                data: [table]
            });
        }

        return this.returnWithStatus(ActionStatusCode.COMPLETED);
    }
};
