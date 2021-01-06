import * as proto from "@dashql/proto";
import * as webdb from "@dashql/webdb/dist/webdb_async";
import * as model from "../model";
import { ProgramActionLogic } from "./action_logic";
import { ActionContext } from "./action_context";
import ActionStatusCode = proto.action.ActionStatusCode;

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
        const table = await db.use(async (c: webdb.AsyncWebDBConnection) => {
            /// First run the query
            await c.runQuery(script);

            // Collect statistics
            const limit0 = await c.runQuery(`SELECT * FROM ${this.buffer.targetNameShort()} LIMIT 0`);
            let columnNames: string[] = [];
            let columnTypes: webdb.SQLType[] = [];
            for (let ci = 0; ci < limit0.columnNamesLength(); ++ci) {
                columnNames.push(limit0.columnNames(ci));
                columnTypes.push(webdb.getSQLType(limit0.columnTypes(ci)));
            }

            // Return plan object
            const now = new Date();
            const table: model.DatabaseTable = {
                objectId: this.buffer.objectId(),
                objectType: model.PlanObjectType.DATABASE_TABLE,
                timeCreated: now,
                timeUpdated: now,
                nameQualified: this.buffer.targetNameQualified() || "",
                nameShort: this.buffer.targetNameShort() || "",
                columnNames: columnNames,
                columnTypes: columnTypes,
                rowCount: 0,
            };
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
