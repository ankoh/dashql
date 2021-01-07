import * as proto from "@dashql/proto";
import * as webdb from "@dashql/webdb/dist/webdb_async";
import * as model from "../model";
import { ActionID, Statement } from "../model";
import { ProgramActionLogic } from "./action_logic";
import { ActionContext } from "./action_context";
import { collectTableInfo } from "./table_create_logic";
import ActionStatusCode = proto.action.ActionStatusCode;

export class ViewCreateActionLogic extends ProgramActionLogic {
    constructor(action_id: ActionID, action: proto.action.ProgramAction, statement: Statement) {
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

            // Return plan object
            const now = new Date();
            const table: model.DatabaseTable = {
                objectId: this.buffer.objectId(),
                objectType: model.PlanObjectType.DATABASE_TABLE,
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
