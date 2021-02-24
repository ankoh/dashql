import * as proto from "@dashql/proto";
import * as utils from "../utils";
import { ActionHandle } from "../model";
import { SetupActionLogic } from "./action_logic";
import { ActionContext } from "./action_context";
import ActionStatusCode = proto.action.ActionStatusCode;

export class ImportBlobActionLogic extends SetupActionLogic {
    constructor(action_id: ActionHandle, action: proto.action.SetupAction) {
        super(action_id, action);
    }

    public async execute(_context: ActionContext): Promise<ActionHandle> {
        return this.returnWithStatus(ActionStatusCode.COMPLETED);
    }
}
