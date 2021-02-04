import * as proto from "@dashql/proto";
import * as webdb from "@dashql/webdb/dist/webdb_async";
import { ActionID } from "../model";
import { SetupActionLogic } from "./action_logic";
import { ActionContext } from "./action_context";
import ActionStatusCode = proto.action.ActionStatusCode;

export class DropViewActionLogic extends SetupActionLogic {
    constructor(action_id: ActionID, action: proto.action.SetupAction) {
        super(action_id, action);
    }

    public async execute(context: ActionContext): Promise<ActionID> {
        const db = context.platform.database;
        await db.use(async (c: webdb.AsyncConnection) => {
            await c.runQuery(`DROP VIEW IF EXISTS ${this.buffer.targetNameShort()}`);
        });
        return this.returnWithStatus(ActionStatusCode.COMPLETED);
    }
}
