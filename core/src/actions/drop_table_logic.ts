import * as proto from "@dashql/proto";
import { ActionID } from "../model";
import { SetupActionLogic } from "./action_logic";
import { ActionContext } from "./action_context";
import ActionStatusCode = proto.action.ActionStatusCode;

export class DropTableActionLogic extends SetupActionLogic {
    constructor(action_id: ActionID, action: proto.action.SetupAction) {
        super(action_id, action);
    }

    public async execute(context: ActionContext): Promise<ActionID> {
        const db = context.platform.database;
        db.dropTable(this.buffer.targetNameShort()!)
        return this.returnWithStatus(ActionStatusCode.COMPLETED);
    }
}
