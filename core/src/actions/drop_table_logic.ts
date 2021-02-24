import * as proto from "@dashql/proto";
import * as webdb from "@dashql/webdb/dist/webdb_async";
import { ActionHandle } from "../model";
import { SetupActionLogic } from "./action_logic";
import { ActionContext } from "./action_context";
import ActionStatusCode = proto.action.ActionStatusCode;

export class DropTableActionLogic extends SetupActionLogic {
    constructor(action_id: ActionHandle, action: proto.action.SetupAction) {
        super(action_id, action);
    }

    public async execute(context: ActionContext): Promise<ActionHandle> {
        const db = context.platform.database;
        await db.use(async (c: webdb.AsyncConnection) => {
            await c.runQuery(`DROP TABLE IF EXISTS ${this.buffer.targetNameShort()}`);
        });
        return this.returnWithStatus(ActionStatusCode.COMPLETED);
    }
}
