import * as proto from "@dashql/proto";
import * as webdb from "@dashql/webdb/dist/webdb_async";
import { ActionID, Statement } from "../model";
import { ProgramActionLogic } from "./action_logic";
import { ActionContext } from "./action_context";
import ActionStatusCode = proto.action.ActionStatusCode;

export class CreateTableActionLogic extends ProgramActionLogic {
    constructor(action_id: ActionID, action: proto.action.ProgramAction, statement: Statement) {
        super(action_id, action, statement);
    }

    public async execute(context: ActionContext): Promise<ActionID> {
        console.log("foo");
        const script = this.script;
        if (!script) {
            return this.returnWithStatus(ActionStatusCode.COMPLETED);
        }

        console.log("bar");
        const db = context.platform.database;
        await db.use(async (c: webdb.AsyncWebDBConnection) => {
            console.log("baz");
            console.log(c);
            console.log(script);
            await c.runQuery(script);
        });

        return this.returnWithStatus(ActionStatusCode.COMPLETED);
    }
};
